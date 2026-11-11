import { inBatches } from "./batches";
import { Notice, TFile } from "obsidian";
import { descendants, duplicateRepeats, fixIndent, insertTask, insertUnder, migrateNote, moveTask, nestUnder, noteSection, parentIds, parseTasks, projectSection, removeLines, removeUnique, replaceTask, sectionNamed, sortTasks, TaskLine, taskText } from "./codec";
import { DailyNotes } from "./daily";
import { localDate, makeId, markerOf, MAX_DAYS, MAX_PLANNED_SESSIONS, MAX_WORK_SESSIONS, Movement, nextDate, path, PRIORITIES, Priority, setStatus, startPlanned, Status, Task, taskFrom, WorkSession } from "./model";
import { blockAt, claimHolds, dueStarts, dueStops, plannable } from "./planning";
import { ClockSpan, dayTimes, MAX_SKIPS, repeatingBlocks, shiftTo, stored, unworkedParts } from "./plans";
import { formatRule, repeatsOn, Rule, sameCadence, taskRule } from "./recurrence";
import { lengthOfSeconds, seconds } from "./sessions";
import { ProjectBudgets, projectTemplate, Repository, splitNote } from "./repository";
import { parseWorked, retiredLines } from "./retention";
import { buildNote } from "./notes";
import { freePath, noteName, readableName } from "./names";
import { keepsNote, losesNote, normalizeRetire, planNames, plural, selectTasks, stripOrganized, type RetireOptions, type RetireScan } from "./retire";

export interface Change { file: TFile; before: string; after: string }
export interface Context { file: TFile; line: TaskLine }
/** A scheduled day as the Schedule dialog leaves it: the day, its blocks, and the day it was before when the person moved it. Blocks that have begun are kept whatever the draft says. */
export interface DraftDay { date: string; blocks: WorkSession[]; from?: string; restore?: boolean }
/** Adds nested lines under one todo, indented to sit inside its list item. */
/** The planned times a todo shows; none when what reads as times is the end of the task's own title (`Call · 10:00–11:00`). */
const shownTimes = (task: Task, line: TaskLine): string | null => line.times !== null && `${line.title} · ${line.times}` === task.title ? null : line.times;
function insertBelow(text: string, line: number, extra: string[], prefix: string, crlf: boolean): string {
  const bullet = /^(\s*)([-+*]|\d+[.)]) /.exec(prefix)!; const indent = `${bullet[1]}${" ".repeat(bullet[2].length + 1)}`;
  const lines = text.split("\n"); lines.splice(line + 1, 0, ...extra.map(item => `${indent}${item}${crlf ? "\r" : ""}`)); return lines.join("\n");
}
export class TaskService {
  readonly daily: DailyNotes;
  private references: Map<string, Set<string>> | null = null;
  private referenceBuild: Promise<void> | null = null;
  private indexing = new Map<string, number>();
  private reconciled = "";
  private retentionReconciled = "";
  /** While one save writes several daily notes, the answer to "recreate the missing heading?" is asked once and holds for all of them. */
  private askOnce: { answer: boolean | null } | null = null;
  undoChanges: Change[] = [];
  /** Task notes renamed by the last batch, so Undo can give them their names back. */
  private undoRenames: { file: TFile; from: string }[] = [];
  constructor(readonly repo: Repository, readonly changed: () => void, readonly confirm: (message: string, heading?: string, confirmLabel?: string) => Promise<boolean>) { this.daily = new DailyNotes(repo, repo.settings); }
  async edit(file: TFile, before: string, after: string, changes?: Change[]): Promise<void> {
    await this.repo.write(file, before, after); if (before !== after) changes?.push({ file, before, after });
  }
  async undo(): Promise<void> {
    await this.repo.serial(async () => {
      const failures: string[] = [];
      for (const c of [...this.undoChanges].reverse()) {
        try { await this.repo.write(c.file, c.after, c.before); } catch { failures.push(c.file.path); }
      }
      for (const rename of [...this.undoRenames].reverse()) {
        try { await this.repo.renameNote(rename.file, rename.from); } catch { failures.push(rename.from); }
      }
      this.undoChanges = []; this.undoRenames = []; this.references = null; this.changed();
      new Notice(failures.length ? `Undo preserved concurrent edits in: ${failures.join(", ")}` : "Organized changes undone. Created notes are preserved.");
    });
  }
  summarize(changes: Change[], title: string, detail = "", renames: { file: TFile; from: string }[] = []): void {
    this.undoChanges = changes; this.undoRenames = renames;
    const notes = new Set(changes.map(c => c.file.path)).size;
    const fragment = createFragment();
    const notice = fragment.createDiv({ cls: "organized-notice" });
    notice.createDiv({ cls: "organized-notice-title", text: title });
    notice.createDiv({ cls: "organized-notice-detail", text: detail || `${notes} ${notes === 1 ? "note" : "notes"} updated.` });
    const button = notice.createEl("button", { text: "Undo", cls: "organized-notice-undo" });
    button.addEventListener("click", () => { void this.undo().catch(report); });
    new Notice(fragment, 12000); this.changed();
  }
  async resolve(context: Context): Promise<{ text: string; line: TaskLine }> {
    const text = await this.repo.readText(context.file);
    // A line whose planned times this plugin rewrote since (see `syncTimes`) is still the same line.
    const same = (t: TaskLine) => t.raw === context.line.raw || (t.id !== null && t.times !== context.line.times && taskText(t, { times: context.line.times }) === context.line.raw);
    const matches = parseTasks(text).filter(t => context.line.id ? t.id === context.line.id : t.line === context.line.line && t.raw === context.line.raw);
    const line = matches.find(t => t.line === context.line.line && same(t)) ?? (matches.length === 1 && same(matches[0]) ? matches[0] : null);
    if (!line) throw new Error("Task context changed; select the line again and retry.");
    return { text, line };
  }
  async attach(context: Context, task: Task, duplicate = false): Promise<Context> {
    const { text, line } = await this.resolve(context);
    if (line.id && !duplicate) throw new Error("This task is already linked. Use duplicate as new task for independent copies.");
    // The times shown are the linked task's own (a todo linked to another task does not keep the first one's).
    const date = this.daily.date(context.file.path); const times = date && !task.recurring ? dayTimes(task, date) : null;
    await this.edit(context.file, text, replaceTask(text, line, { title: task.title, id: task.id, repeat: false, times }));
    const written = await this.repo.readText(context.file); const fresh = parseTasks(written).find(t => t.line === line.line)!;
    // A todo linked while nested under another becomes its subtask.
    await this.syncSubtasks(parentIds(text), parentIds(written));
    this.changed(); return { file: context.file, line: fresh };
  }
  async clean(context: Context, marker = " "): Promise<void> {
    const { text, line } = await this.resolve(context); await this.edit(context.file, text, replaceTask(text, line, { marker }));
  }
  /** Writes a todo for `task` into `file` (nothing when it is already there). With `under`, it goes in as the last subtask of that todo when the note has it, and at the end of the section otherwise. */
  async insert(file: TFile, task: Task, marker: string, repeat: boolean, changes?: Change[], under: string | null = null): Promise<void> {
    const text = await this.repo.readText(file);
    if (parseTasks(text).some(t => t.id === task.id)) return;
    // A scheduled day's todo shows that day's planned times after its title (see `syncTimes`).
    const date = this.daily.date(file.path); const times = date && !repeat && !task.recurring ? dayTimes(task, date) : null;
    const line = `- [${marker}] ${task.title}${times ? ` · ${times}` : ""} <!--organized:${task.id}-->${repeat ? " <!--organized:repeat-->" : ""}`;
    const nested = under ? insertUnder(text, under, line, await this.repo.indentUnit()) : null;
    const result = nested === null ? insertTask(text, line, task.daily_note_section_path) : { text: nested, missing: false };
    if (result.missing && this.repo.settings().missingSection === "ask" && !(await this.recreate(file))) throw new Error("Insertion canceled; no task occurrence was written.");
    await this.edit(file, text, result.text, changes);
  }
  /**
   * Forwards or schedules the todo of `context`. Its subtasks that are still open or in progress travel with it, indented under it in the target note; done and canceled
   * ones stay behind as the record. A subtask moved on its own goes under its parent when the target note has the parent, and at the end of the section otherwise.
   */
  async schedule(context: Context, date: string, kind: Movement["kind"] = "schedule", source: Movement["source"] = "manual", changes: Change[] = [], options: { cascade?: boolean; under?: string | null; time?: WorkSession } = {}): Promise<void> {
    const { text: originText, line } = await this.resolve(context); if (!line.id) throw new Error("Attach the task first.");
    const task = await this.repo.read(line.id); const oldDate = task.scheduled; let moved = 0;
    const target = await this.dayNote(date);
    const from = this.daily.date(context.file.path) ?? context.file.path;
    const event: Movement = { id: makeId(), kind: kind === "schedule" && oldDate && oldDate !== date ? "reschedule" : kind, source, from, to: date, at: new Date().toISOString() };
    const taskFile = await this.repo.resolve(task.id); const beforeTask = await this.repo.readText(taskFile);
    // Forwarding moves the day of the note it leaves; scheduling moves the day the task is shown under (its next one).
    const leaving = kind === "forward" ? this.daily.date(context.file.path) ?? oldDate : oldDate;
    // A project note is the project's board: its headings are statuses, not where the todo goes in a day, and its todo keeps showing the status.
    const board = this.isProjectFile(context.file);
    const next = await this.repo.update(task.id, current => ({ ...current, scheduled_dates: [...current.scheduled_dates.filter(day => day !== leaving), date], daily_note_section_path: board ? current.daily_note_section_path : line.section,
      movement_history: current.scheduled === date ? current.movement_history : [...current.movement_history, event] }));
    changes.push({ file: taskFile, before: beforeTask, after: await this.repo.readText(taskFile) });
    const under = options.under !== undefined ? options.under : (await this.repo.parentOf(task.id))?.id ?? null;
    if (target) await this.insert(target, next, task.status === "in_progress" && kind === "forward" ? "/" : " ", false, changes, under);
    if (target?.path !== context.file.path) {
      const current = await this.resolve(context);
      await this.edit(context.file, current.text, replaceTask(current.text, current.line, { marker: board ? markerOf(task) : kind === "forward" ? (this.daily.date(context.file.path) ? ">" : " ") : "<" }), changes);
      await this.resortAfter(context.file, next, changes);
    }
    if (oldDate && oldDate !== date && kind !== "forward") await this.cleanupSchedule(task.id, oldDate, context.file.path, changes);
    // A todo the person forwards (`>`) takes the not-yet-begun blocks of the day it leaves along, or they would start its timer on that day. The automatic carry-over leaves the past as it was.
    const planDay = kind === "forward" ? (source === "manual" ? this.daily.date(context.file.path) : null) : oldDate;
    if (planDay && planDay !== date) moved = await this.movePlans(task, planDay, date, changes);
    if (options.time) await this.addPlanned(task.id, options.time, changes);
    if (options.cascade !== false) await this.carrySubtasks(context.file, originText, line, date, kind, source, changes);
    if (moved && options.cascade !== false) this.summarize(changes, "Planned time moved", `${plural(moved, "planned block")} of “${task.title}” moved from ${planDay} to ${date}.`);
    this.changed();
  }
  /** Moves the subtasks nested under `parent` in `originText` that are still open or in progress (and not already forwarded or scheduled), each under its nearest moved ancestor. */
  private async carrySubtasks(file: TFile, originText: string, parent: TaskLine, date: string, kind: Movement["kind"], source: Movement["source"], changes: Change[]): Promise<void> {
    const tasks = parseTasks(originText); const moved = new Set([parent.id!]); const failed: string[] = []; let count = 0;
    for (const child of descendants(tasks, parent.line)) {
      if (!child.id || ![" ", "/"].includes(child.marker) || tasks.filter(t => t.id === child.id).length !== 1) continue;
      try {
        const task = await this.repo.read(child.id); if (task.recurring || !["open", "in_progress"].includes(task.status)) continue;
        // Every subtask in the family leads up to the parent, which has moved: the nearest ancestor that moved is where this one goes.
        let up = tasks.find(t => t.line === child.parent)!; while (!moved.has(up.id!)) up = tasks.find(t => t.line === up.parent)!;
        await this.schedule({ file, line: child }, date, kind, source, changes, { cascade: false, under: up.id });
        moved.add(child.id); count++;
      } catch { failed.push(child.title); }
    }
    if (failed.length) new Notice(`Could not move ${plural(failed.length, "subtask")} with “${parent.title}”: ${failed.join(", ")}. Their lines were preserved.`);
    if (count && source === "manual") this.summarize(changes, `${kind === "forward" ? "Forwarded" : "Scheduled"} with subtasks`, `“${parent.title}” and ${plural(count, "open subtask")} moved to ${date}.`);
  }
  /** Schedules a task by id. `time`, when given, also sets that block aside on the day (see `addPlanned`). */
  async scheduleTask(id: string, date: string, context?: Context, nested?: { under: string | null }, changes?: Change[], time?: WorkSession): Promise<void> {
    if (context?.line.id === id) { await this.schedule(context, date, "schedule", "manual", changes, { time }); return; }
    const own = changes ?? []; let moved = 0;
    const task = await this.repo.read(id); const target = await this.dayNote(date);
    const event: Movement = { id: makeId(), kind: task.scheduled && task.scheduled !== date ? "reschedule" : "schedule", source: "manual", from: this.repo.taskPath(id), to: date, at: new Date().toISOString() };
    const next = await this.recorded(id, own, () => this.repo.update(id, t => ({ ...t, scheduled: date, movement_history: t.scheduled === date ? t.movement_history : [...t.movement_history, event] })));
    if (target) await this.insert(target, next, " ", false, own, nested ? nested.under : (await this.repo.parentOf(id))?.id ?? null);
    if (task.scheduled && task.scheduled !== date) {
      await this.cleanupSchedule(id, task.scheduled, undefined, own);
      moved = await this.movePlans(task, task.scheduled, date, own);
    }
    if (time) await this.addPlanned(id, time, own);
    if (!nested) await this.scheduleOpenSubtasks(task, date, own);
    if (moved && !changes) this.summarize(own, "Planned time moved", `${plural(moved, "planned block")} of “${task.title}” moved from ${task.scheduled} to ${date}.`);
    this.changed();
  }
  /**
   * Planned blocks on the day a task was scheduled for that have not begun go with it to its new day, at the same clock times; one that has begun (or is over) stays, it is
   * the record of that day. With `to` null (the date is cleared) they are removed. A block the new day already has is not added twice. Returns how many moved or went.
   */
  private async movePlans(task: Task, from: string, to: string | null, changes: Change[]): Promise<number> {
    const now = Date.now(); const moving = (b: WorkSession) => localDate(new Date(b.start)) === from && Date.parse(b.start) > now;
    const count = task.planned_sessions.filter(moving).length; if (!count) return 0;
    const shift = (b: WorkSession): WorkSession => shiftTo(b, to!);
    await this.recorded(task.id, changes, () => this.repo.update(task.id, t => {
      const kept = t.planned_sessions.filter(b => !moving(b)); const same = (a: WorkSession, b: WorkSession) => a.start === b.start && a.end === b.end;
      const moved = to === null ? [] : t.planned_sessions.filter(moving).map(shift).filter((b, n, all) => !kept.some(k => same(k, b)) && all.findIndex(o => same(o, b)) === n);
      return { ...t, planned_sessions: [...kept, ...moved] };
    }));
    await this.syncTimes(task.id, changes); await this.planEdited(task.id, task, changes);
    return count;
  }
  /**
   * Takes the date off a task: a todo that was scheduled away (`[<]`) is open again where it stands and the copy on the scheduled day is removed. The movement history keeps the record.
   * Planned blocks on that day that have not begun go too (see `movePlans`); the notice says so and offers Undo.
   */
  async unschedule(id: string): Promise<void> {
    const task = await this.repo.read(id); const date = task.scheduled; if (!date) return;
    const changes: Change[] = [];
    await this.recorded(id, changes, () => this.repo.update(id, t => ({ ...t, scheduled: null })));
    for (const occurrence of await this.repo.occurrences(id)) {
      const line = occurrence.tasks.find(t => t.marker === "<"); if (!line) continue;
      await this.edit(occurrence.file, occurrence.text, replaceTask(occurrence.text, line, { marker: markerOf(task) }), changes);
    }
    // Every scheduled day lets go of the task: its todo there, and its blocks that have not begun.
    let removed = 0;
    for (const day of task.scheduled_dates) { await this.cleanupSchedule(id, day, undefined, changes); removed += await this.movePlans(task, day, null, changes); }
    if (removed) this.summarize(changes, "Date cleared", `“${task.title}” is no longer scheduled; ${plural(removed, "planned block")} on ${task.scheduled_dates.length > 1 ? "its days" : date} removed with it.`);
    this.changed();
  }
  /** Schedules the open and in-progress subtasks of a task that is scheduled from the panel (there is no todo line to read their nesting from), each under its own parent. */
  private async scheduleOpenSubtasks(parent: Task, date: string, changes?: Change[], seen = new Set([parent.id])): Promise<void> {
    for (const child of await this.repo.subtasksOf(parent)) {
      if (seen.has(child.id)) continue; seen.add(child.id);
      if (child.status === "open" || child.status === "in_progress") await this.scheduleTask(child.id, date, undefined, { under: parent.id }, changes);
      if (child.status !== "canceled") await this.scheduleOpenSubtasks(child, date, changes, seen);
    }
  }
  private async recreate(file: TFile): Promise<boolean> {
    const asked = this.askOnce?.answer ?? null; if (asked !== null) return asked;
    const answer = await this.confirm(`The heading path is missing in ${file.path}. Recreate it?`); if (this.askOnce) this.askOnce.answer = answer; return answer;
  }
  /**
   * Saves a task's schedule as the Schedule dialog left it, as one change (one Undo). A moved day takes its todo along; an added day gets its todo in that day's note when there is one;
   * a removed day lets go of its todo. Each day's blocks become the draft's, except blocks that have begun, which are history and stay. A day whose note cannot be written is left as it was, and the notice names it.
   */
  async saveSchedule(id: string, draft: DraftDay[], context?: Context): Promise<void> {
    const before = await this.repo.read(id);
    if (before.recurring) throw new Error("A recurring task is planned by its repeating times; change them in Repeat.");
    if (new Set(draft.map(d => d.date)).size > MAX_DAYS) throw new Error(`A task can be scheduled for at most ${MAX_DAYS} days.`);
    const changes: Change[] = []; const failed: string[] = []; this.askOnce = { answer: null };
    try { await this.applySchedule(before, draft, context, changes, failed); } finally { this.askOnce = null; }
    await this.syncTimes(id, changes); await this.planEdited(id, before, changes);
    const after = await this.repo.read(id); const now = Date.now(); const ahead = after.scheduled_dates.filter(day => day >= localDate());
    const planned = after.planned_sessions.filter(b => Date.parse(b.end) > now).reduce((sum, b) => sum + seconds(b), 0);
    const when = ahead.length ? `scheduled for ${ahead.slice(0, 3).join(", ")}${ahead.length > 3 ? ` and ${ahead.length - 3} more` : ""}${planned ? ` · ${lengthOfSeconds(planned)} planned` : ""}` : after.scheduled_dates.length ? `scheduled only for days that are over` : "no longer scheduled";
    this.summarize(changes, "Schedule saved", `“${after.title}” is ${when}.${failed.length ? ` Not changed: ${failed.join(", ")}; its daily note could not be written.` : ""}`);
    this.changed();
  }
  private async applySchedule(before: Task, draft: DraftDay[], context: Context | undefined, changes: Change[], failed: string[]): Promise<void> {
    const now = Date.now(); const id = before.id; const had = before.scheduled_dates;
    const dayOf = (b: WorkSession) => localDate(new Date(b.start)); const same = (a: WorkSession, b: WorkSession) => a.start === b.start && a.end === b.end;
    const moves = draft.filter(d => d.from !== undefined && d.from !== d.date && had.includes(d.from));
    const wanted = new Set(draft.map(d => d.date)); const sources = new Set(moves.map(m => m.from!));
    const added = [...wanted].filter(day => !had.includes(day) && !moves.some(m => m.date === day));
    const board = context !== undefined && this.isProjectFile(context.file); const placed = context && !board ? { ...before, daily_note_section_path: context.line.section } : before; const under = (await this.repo.parentOf(id))?.id ?? null;
    const put = async (day: string) => { const file = await this.dayNote(day); if (file) await this.insert(file, placed, day === localDate() ? markerOf(before) : " ", false, changes, under); };
    // The daily notes first: a day whose note cannot be written stays as it was, todo and blocks.
    const days = new Set(had); const stuck = new Set<string>(); const at = new Date().toISOString(); const events: Movement[] = [];
    for (const move of moves) {
      try { await put(move.date); } catch { failed.push(move.date); stuck.add(move.date); stuck.add(move.from!); continue; }
      await this.cleanupSchedule(id, move.from!, context?.file.path, changes); days.delete(move.from!); days.add(move.date);
      events.push({ id: makeId(), kind: "reschedule", source: "manual", from: move.from!, to: move.date, at });
    }
    for (const day of added) { try { await put(day); days.add(day); } catch { failed.push(day); stuck.add(day); } }
    // The todo the dialog was opened from is not a copy to take away; its marker is set below.
    for (const day of had.filter(d => !wanted.has(d) && !sources.has(d))) { await this.cleanupSchedule(id, day, context?.file.path, changes); days.delete(day); }
    // A todo deleted from a day's note by hand comes back only when the person asks for it.
    for (const day of draft.filter(d => d.restore && days.has(d.date)).map(d => d.date)) { try { await put(day); } catch { failed.push(day); } }
    if (!had.length && days.size) events.push({ id: makeId(), kind: "schedule", source: "manual", from: context ? this.daily.date(context.file.path) ?? context.file.path : this.repo.taskPath(id), to: [...days].sort()[0], at });
    // Each day's blocks are the draft's; a block that has begun is the record of its day and stays.
    const touched = new Set([...had, ...wanted, ...sources].filter(day => !stuck.has(day)));
    const drafted = draft.filter(d => !stuck.has(d.date) && days.has(d.date)).flatMap(d => d.blocks);
    await this.recorded(id, changes, () => this.repo.update(id, t => {
      const kept = t.planned_sessions.filter(b => Date.parse(b.start) <= now || !touched.has(dayOf(b)));
      const fresh = drafted.filter((b, n) => !kept.some(k => same(k, b)) && drafted.findIndex(o => same(o, b)) === n);
      return { ...t, scheduled_dates: [...days], planned_sessions: [...kept, ...fresh].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(-MAX_PLANNED_SESSIONS), movement_history: [...t.movement_history, ...events], daily_note_section_path: placed.daily_note_section_path };
    }));
    // The todo the person scheduled from says where the task went: `<` while it is scheduled away from this note, its own marker once it is not (also for a `<` typed and then not used).
    const after = await this.repo.read(id); const own = context ? this.daily.date(context.file.path) : null;
    if (context) {
      const fresh = await this.resolve(context); const marker = days.size && !board && !(own && days.has(own)) ? "<" : markerOf(after);
      if (fresh.line.marker !== marker) { await this.edit(context.file, fresh.text, replaceTask(fresh.text, fresh.line, { marker }), changes); await this.resortAfter(context.file, after, changes); }
    }
    if (had.length && !days.size) for (const occurrence of await this.repo.occurrences(id)) {
      await this.edit(occurrence.file, occurrence.text, occurrence.tasks.filter(t => t.marker === "<").reduce((text, line) => replaceTask(text, line, { marker: markerOf(after) }), occurrence.text), changes);
    }
    // Subtasks go along the first time the task is scheduled, and with each day that moves.
    if (!had.length && days.size) await this.scheduleOpenSubtasks(before, [...days].sort()[0], changes);
    for (const move of moves.filter(m => days.has(m.date) && !days.has(m.from!))) await this.moveSubtaskDays(before, move.from!, move.date, changes);
  }
  /** Moves the day `from` of the open subtasks (at every depth) that are scheduled for it to `to`, todo and blocks. One that cannot be moved is named and keeps its day. */
  private async moveSubtaskDays(parent: Task, from: string, to: string, changes: Change[], seen = new Set([parent.id])): Promise<void> {
    const failed: string[] = [];
    for (const child of await this.repo.subtasksOf(parent)) {
      if (seen.has(child.id)) continue; seen.add(child.id);
      if ((child.status === "open" || child.status === "in_progress") && child.scheduled_dates.includes(from) && !child.scheduled_dates.includes(to)) {
        try {
          const file = await this.dayNote(to); if (file) await this.insert(file, child, to === localDate() ? markerOf(child) : " ", false, changes, parent.id);
          await this.cleanupSchedule(child.id, from, undefined, changes);
          await this.recorded(child.id, changes, () => this.repo.update(child.id, t => ({ ...t, scheduled_dates: [...t.scheduled_dates.filter(day => day !== from), to] })));
          await this.movePlans(child, from, to, changes);
        } catch { failed.push(child.title); }
      }
      await this.moveSubtaskDays(child, from, to, changes, seen);
    }
    if (failed.length) new Notice(`Could not move ${plural(failed.length, "subtask")} to ${to}: ${failed.join(", ")}. They keep ${from}.`);
  }
  /**
   * Writes each day's planned times after the task's todo in that day's note, today's and later (earlier days are history), so the note reads right without the plugin. Only
   * how the todo looks: one that cannot be written now is put right by the next change.
   */
  private async syncTimes(id: string, changes?: Change[]): Promise<void> {
    const task = await this.repo.read(id); if (task.recurring) return; const today = localDate();
    for (const occurrence of await this.repo.occurrences(id)) {
      const date = this.daily.date(occurrence.file.path); if (!date || date < today) continue;
      const times = dayTimes(task, date); const after = occurrence.tasks.reduce((text, line) => shownTimes(task, line) === times ? text : replaceTask(text, line, { title: task.title, times }), occurrence.text);
      try { await this.edit(occurrence.file, occurrence.text, after, changes); } catch { /* Shown again by the next change of its times. */ }
    }
  }
  /** Adds one day to a task's schedule; its todo goes in that day's note when there is one (see `dayNote`). */
  private async addDay(id: string, day: string, changes: Change[]): Promise<void> {
    const next = await this.recorded(id, changes, () => this.repo.update(id, t => ({ ...t, scheduled_dates: [...t.scheduled_dates, day] })));
    // Only ever a later day (see `addPlanned`), so the todo there is open.
    const file = await this.dayNote(day); if (file) await this.insert(file, next, " ", false, changes, (await this.repo.parentOf(id))?.id ?? null);
  }
  /** The daily note a scheduled day's todo goes in now: one that exists, or (made when missing) today's or an earlier day's. A later day with no note yet gets the todo when its note is made (see `onDailyCreated`). */
  private async dayNote(date: string): Promise<TFile | null> { return this.repo.file(this.daily.path(date)) ?? (date <= localDate() ? await this.daily.ensure(date) : null); }
  private async cleanupSchedule(id: string, oldDate: string, originPath?: string, changes?: Change[]): Promise<void> {
    // A day whose note was never made holds no todo to take away.
    if (this.daily.path(oldDate) === originPath || !this.repo.file(this.daily.path(oldDate))) return;
    try {
      // Explicit rescheduling is allowed to search by stable ID. Configuration
      // changes never turn undated references into guessed old destinations.
      const occurrences = await this.repo.occurrences(id); const candidates = occurrences.filter(o => o.file.path !== originPath && this.daily.date(o.file.path) === oldDate);
      // A todo in today's (or an earlier) note that is the task's only line stays: it may be the one the person wrote there, and the task would be left with no line where they work.
      // A later day's only line is the plan's own copy and goes.
      if (oldDate <= localDate() && occurrences.length === 1 && candidates.length === 1 && candidates[0].tasks.length === 1) return;
      if (candidates.length === 1 && candidates[0].tasks.length > 1) { new Notice(onTwoLines((await this.repo.read(id)).title, candidates[0].file.path, candidates[0].tasks.length, "Neither line there was removed; delete the ones you no longer need.")); return; }
      if (candidates.length !== 1 || candidates[0].tasks.length !== 1 || candidates[0].tasks[0].marker !== " " || candidates[0].tasks[0].repeat) throw new Error("Missing or ambiguous previous destination.");
      const old = candidates[0]; await this.edit(old.file, old.text, removeUnique(old.text, id), changes);
    } catch { new Notice("Previous scheduled occurrence is missing, ambiguous or changed. Preserved existing lines; use the references list to repair."); }
  }
  private isProjectFile(file: TFile): boolean { return this.repo.isProjectNote(file) || file.path.startsWith(`${this.repo.projectFolder()}/`); }
  /**
   * Sets a task's status in its note and on every line that shows it. Completing or canceling a task also completes or cancels its subtasks that are still open
   * (done and canceled ones are never changed, reopening and starting do not cascade), with one notice that can undo exactly what happened to the subtasks.
   */
  async status(id: string, status: Status, context?: Context): Promise<void> {
    const before = await this.repo.read(id);
    // A task on two lines of one note (a todo copied and pasted) does not change: which line is meant is unclear. The todo that was ticked gets its marker back.
    // A recurring task's line in another daily note is that day's own and is not written here (see syncLines), so a doubled one there does not count.
    const twice = (await this.repo.occurrences(id)).find(o => o.tasks.length > 1 && !(before.recurring && this.daily.date(o.file.path) && o.file.path !== context?.file.path));
    if (twice) {
      if (context) await this.clean(context, markerOf(before)).catch(() => undefined);
      throw new Error(onTwoLines(before.title, twice.file.path, twice.tasks.length, "Delete one copy, then change its status again."));
    }
    await this.applyStatus(id, status, context);
    if ((status !== "completed" && status !== "canceled") || before.status === status || before.recurring) return;
    const changes: Change[] = []; const changed = await this.cascadeStatus(before, status, changes, new Set([id]));
    if (changed.length) this.summarize(changes, status === "completed" ? "Subtasks completed" : "Subtasks canceled", `${status === "completed" ? "Completed" : "Canceled"} ${plural(changed.length, "subtask")} of “${before.title}”: ${changed.join(", ")}.`);
  }
  private async cascadeStatus(parent: Task, status: Status, changes: Change[], seen: Set<string>): Promise<string[]> {
    const changed: string[] = [];
    for (const child of await this.repo.subtasksOf(parent)) {
      if (seen.has(child.id)) continue; seen.add(child.id);
      if (child.status === "open" || child.status === "in_progress") { await this.applyStatus(child.id, status, undefined, changes); changed.push(`“${child.title}”`); }
      if (child.status !== "canceled") changed.push(...await this.cascadeStatus(child, status, changes, seen));
    }
    return changed;
  }
  private async applyStatus(id: string, status: Status, context?: Context, changes?: Change[], change: (task: Task) => Task = t => setStatus(t, status)): Promise<void> {
    const note = changes ? this.repo.taskFile(id) : null; const noteBefore = note ? await this.repo.readText(note) : "";
    const task = await this.repo.update(id, change);
    if (note) changes!.push({ file: note, before: noteBefore, after: await this.repo.readText(note) });
    await this.syncLines(task, status, await this.repo.occurrences(id), context, changes);
    this.changed();
  }
  /** Writes the marker of a task's status into its todo lines (today's and later daily notes, undated notes, project notes; see the rules below). */
  private async syncLines(task: Task, status: Status, occurrences: { file: TFile; text: string; tasks: TaskLine[] }[], context?: Context, changes?: Change[]): Promise<void> {
    const marker = markerOf(task);
    const today = localDate();
    // Earlier daily notes are history, except for a todo that only ever lived in one of them (never carried forward): that line is the task's only one, so it follows the status.
    const dated = (o: { file: TFile }) => this.daily.date(o.file.path); const live = occurrences.some(o => { const d = dated(o); return !d || d >= today; });
    const latestPast = live ? undefined : occurrences.reduce<(typeof occurrences)[number] | undefined>((best, o) => !best || dated(o)! > dated(best)! ? o : best, undefined);
    for (const occurrence of occurrences) {
      const date = dated(occurrence);
      if (date && date < today && occurrence !== latestPast) continue;
      if (task.recurring && date && (!context || occurrence.file.path !== context.file.path)) continue;
      let after = occurrence.text;
      for (const line of occurrence.tasks) {
        if (date && date < today && (line.marker === ">" || line.marker === "<")) continue;
        // A timer starting or stopping shows where the work is: the todo acted on and today's. The line it was scheduled away from (`<`) and a later day's copy keep theirs.
        if (!task.recurring && (marker === " " || marker === "/") && occurrence.file.path !== context?.file.path && (line.marker === "<" || (date && date > today && (line.marker === " " || line.marker === "/")))) continue;
        // A finished todo reopened while its task is scheduled for a day still ahead, outside that day's note, is the line it was scheduled away from: `<` again, not a second open copy.
        const away = !task.recurring && marker === " " && ["x", "X", "-"].includes(line.marker) && !this.isProjectFile(occurrence.file) && !(date && task.scheduled_dates.includes(date)) && task.scheduled_dates.some(day => day >= today);
        const occurrenceMarker = task.recurring && date ? (status === "completed" ? "x" : status === "canceled" ? "-" : status === "in_progress" ? "/" : " ") : away ? "<" : marker;
        after = replaceTask(after, line, { marker: occurrenceMarker });
      }
      // In a project note the line also moves to the heading for the new status.
      if (occurrence.tasks.length === 1 && this.isProjectFile(occurrence.file)) after = moveTask(after, task.id, projectSection(task));
      await this.edit(occurrence.file, occurrence.text, after, changes);
      if (!this.isProjectFile(occurrence.file) && !(date && date < today)) await this.resortAfter(occurrence.file, task, changes);
    }
  }
  async title(id: string, title: string): Promise<void> {
    if (!title.trim() || /[\r\n]/.test(title)) throw new Error("Use a nonempty, single-line title.");
    const old = await this.repo.read(id); await this.repo.update(id, t => ({ ...t, title: title.trim() }));
    for (const occurrence of await this.repo.occurrences(id)) {
      if (occurrence.tasks.length > 1) { new Notice(onTwoLines(title.trim(), occurrence.file.path, occurrence.tasks.length, "Delete one copy, then rename the task again.")); continue; }
      await this.edit(occurrence.file, occurrence.text, replaceTask(occurrence.text, occurrence.tasks[0], { title: title.trim(), times: shownTimes(old, occurrence.tasks[0]) }));
    }
    await this.nameNote(id);
    this.changed();
  }
  /** Gives the task note the name of its todo's title. Notes that already carry it (with or without a counter), time records and notes that cannot be renamed are left alone; the title is saved either way. */
  async nameNote(id: string): Promise<void> {
    const file = this.repo.taskFile(id); if (!file) return;
    const task = await this.repo.read(id); if (task.converted_to) return;
    const wanted = readableName(task.title).toLowerCase(); const current = file.basename.toLowerCase();
    if (current === wanted || current.replace(/ \d+$/, "") === wanted) return;
    const target = path(freePath(this.repo.settings().taskFolder, readableName(task.title), this.repo.nameTaken(file)));
    const parent = await this.repo.parentOf(id); const was = this.repo.linkOf(file);
    try { await this.repo.renameNote(file, target); } catch { return; /* The old name stays; the next title edit tries again. */ }
    // Obsidian rewrites links to a renamed note; the parent's list is made right here too, so it does not depend on that setting.
    if (parent) { const now = this.repo.linkOf(file); await this.repo.update(parent.id, t => ({ ...t, subtasks: t.subtasks.map(link => link.toLowerCase() === was.toLowerCase() ? now : link) })).catch(() => undefined); }
  }
  private async dropLinks(parentId: string, drop: (link: string) => boolean): Promise<boolean> {
    try {
      const parent = await this.repo.read(parentId); if (!parent.subtasks.some(drop)) return false;
      await this.repo.update(parentId, t => ({ ...t, subtasks: t.subtasks.filter(link => !drop(link)) })); return true;
    } catch { return false; }
  }
  /** Takes the links to task notes that were just removed (`gone`, lower case) out of every list that held one, so a later note with the same name is not taken for the subtask. */
  private async dropGone(tasks: Task[], gone: Set<string>): Promise<void> {
    for (const task of tasks) if (task.subtasks.some(link => gone.has(link.toLowerCase()))) await this.dropLinks(task.id, link => gone.has(link.toLowerCase()));
  }
  /** Adds a task to its parent's `subtasks` list and says what happened: nothing changes for a recurring task, a task that cannot be found, itself, or a parent that is the task's own descendant. A task has one parent, so it leaves the list it was in. */
  private async linkSubtask(parentId: string, childId: string): Promise<"linked" | "already" | "recurring" | "loop" | "missing"> {
    const file = this.repo.taskFile(childId); if (!file) return "missing"; if (parentId === childId) return "loop";
    try {
      const [parent, child] = [await this.repo.read(parentId), await this.repo.read(childId)]; if (parent.recurring || child.recurring) return "recurring";
      for (let up: Task | null = parent, depth = 0; up && depth < 64; depth++) { up = await this.repo.parentOf(up.id); if (up?.id === childId) return "loop"; }
      const current = await this.repo.parentOf(childId); if (current && current.id !== parentId) await this.dropLinks(current.id, link => this.repo.fileOfLink(link) === file);
      const link = this.repo.linkOf(file); if (parent.subtasks.includes(link)) return "already";
      await this.repo.update(parentId, t => ({ ...t, subtasks: [...t.subtasks, link] })); return "linked";
    } catch { return "missing"; }
  }
  /** Makes `childId` a subtask of `parentId` from the panel, without moving any todo line (the nesting in a note is only read when the person changes it). */
  async makeSubtask(parentId: string, childId: string): Promise<void> {
    const result = await this.linkSubtask(parentId, childId);
    if (result === "recurring") throw new Error("Recurring tasks cannot be parents or subtasks.");
    if (result === "loop") throw new Error("A task cannot be a subtask of itself or of one of its own subtasks.");
    if (result === "missing") throw new Error("The task note could not be found.");
    // The todo lines follow the relation: wherever both are in one note, the subtask is indented under its parent.
    const changes: Change[] = []; const parent = await this.repo.read(parentId); const child = await this.repo.read(childId); const unit = await this.repo.indentUnit(); let notes = 0;
    for (const occurrence of await this.repo.occurrences(childId)) {
      // A note that holds either task twice is left as it is: which line to indent under which is unclear.
      const parents = parseTasks(occurrence.text).filter(t => t.id === parentId).length; const doubled = occurrence.tasks.length > 1 ? child : parents > 1 ? parent : null;
      if (doubled) { new Notice(onTwoLines(doubled.title, occurrence.file.path, doubled === child ? occurrence.tasks.length : parents, "Delete one copy, then make it a subtask again.")); continue; }
      const after = nestUnder(occurrence.text, childId, parentId, true, unit) ?? fixIndent(occurrence.text, childId, parentId, unit); if (after === null) continue;
      await this.edit(occurrence.file, occurrence.text, after, changes); notes++;
    }
    if (notes) this.summarize(changes, "Subtask indented", `“${child.title}” now sits under “${parent.title}” in ${plural(notes, "note")}.`);
    else if (result === "already") new Notice("It is already a subtask of that task."); else this.changed();
  }
  /**
   * Indents todos under their parents wherever a parent's `subtasks` list says so and both are in one note but the subtask is still at the top of its list
   * (relations made before the panel indented lines), and gives subtasks that are indented differently from Obsidian's own Tab the vault's indentation. Notes are read, planned and backed up before any is written; a note that cannot be written is left as it was.
   */
  async nestSubtaskLines(backup: (files: { path: string; before: string }[]) => Promise<string>): Promise<{ changes: Change[]; failed: string[] }> {
    const pairs: [string, string][] = []; const unit = await this.repo.indentUnit();
    for (const parent of await this.repo.list()) for (const child of await this.repo.subtasksOf(parent)) pairs.push([parent.id, child.id]);
    const changes: Change[] = []; const failed: string[] = []; if (!pairs.length) return { changes, failed };
    const pending: { file: TFile; before: string; after: string }[] = [];
    for (const file of this.repo.app.vault.getMarkdownFiles()) {
      if (this.repo.isTaskRecord(file.path)) continue;
      const before = await this.repo.readText(file); if (!before.includes("<!--organized:")) continue;
      let after = before; for (const [parentId, childId] of pairs) after = nestUnder(after, childId, parentId, false, unit) ?? fixIndent(after, childId, parentId, unit) ?? after;
      if (after !== before) pending.push({ file, before, after });
    }
    if (!pending.length) return { changes, failed };
    await backup(pending.map(p => ({ path: p.file.path, before: p.before })));
    for (const p of pending) { try { await this.edit(p.file, p.before, p.after, changes); } catch { failed.push(p.file.path); } }
    return { changes, failed };
  }
  /** Takes a task out of its parent's list; the todo lines stay where they are. */
  async detachSubtask(childId: string): Promise<void> {
    const file = this.repo.taskFile(childId); const parent = await this.repo.parentOf(childId); if (!file || !parent) return;
    await this.dropLinks(parent.id, link => this.repo.fileOfLink(link) === file); this.changed();
  }
  /**
   * Keeps the parents' `subtasks` lists in step with how todos are nested in a note: `before` and `after` map each linked todo to the todo it sits under.
   * Only task notes' properties change, never a note's text. Returns how many lists changed.
   */
  async syncSubtasks(before: Map<string, string | null>, after: Map<string, string | null>): Promise<number> {
    let changed = 0;
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(id) ?? null; const now = after.get(id) ?? null; if (was === now) continue;
      const file = this.repo.taskFile(id);
      if (was && file && await this.dropLinks(was, link => this.repo.fileOfLink(link) === file)) changed++;
      if (now && await this.linkSubtask(now, id) === "linked") changed++;
    }
    return changed;
  }
  /** Makes the parents' lists match how the todos of one note are nested, and drops links to task notes that no longer exist. */
  async repairSubtasks(file: TFile): Promise<void> {
    const parents = parentIds(await this.repo.readText(file)); let fixed = await this.syncSubtasks(new Map(), parents);
    for (const id of new Set([...parents.values()])) if (id && await this.dropLinks(id, link => !this.repo.fileOfLink(link))) fixed++;
    new Notice(fixed ? `Repaired ${plural(fixed, "subtask list")} for the todos in this note.` : "The subtasks of the todos in this note are already in order."); this.changed();
  }
  async priority(context: Context, priority: Priority): Promise<void> {
    const { line } = await this.resolve(context); if (!line.id) throw new Error("Attach the task first.");
    const task = await this.repo.update(line.id, t => ({ ...t, priority })); await this.clean(context);
    await this.resort(context.file, task); this.changed();
  }
  /** Sets a priority from outside the note (the side panel): the task note changes, and so does the order of its list in the note, as with the editor's `!` marker. */
  async setPriority(id: string, priority: Priority, context?: Context): Promise<void> {
    const task = await this.repo.update(id, t => ({ ...t, priority }));
    if (this.repo.settings().sortScope !== "none") {
      if (context) await this.resort(context.file, task);
      else for (const occurrence of await this.repo.occurrences(id)) await this.resort(occurrence.file, task).catch(() => new Notice(`Priority saved, but ${occurrence.file.path} could not be reordered safely (it changed while sorting). Set the priority again to retry.`));
    }
    this.changed();
  }
  /** Re-sorts the list holding the task by priority, using the priority just saved rather than a possibly stale re-read of the task note. */
  private async resort(file: TFile, changed: Task, changes?: Change[]): Promise<void> {
    const text = await this.repo.readText(file); const line = parseTasks(text).find(t => t.id === changed.id); if (!line) return;
    const priorities = new Map((await this.repo.list()).map(t => [t.id, t.priority])); priorities.set(changed.id, changed.priority);
    await this.edit(file, text, sortTasks(text, line.line, this.repo.settings().sortScope, priorities), changes);
  }
  /** Re-sorts after a change that moves a line between ranks (started, forwarded, scheduled); a failed sort never fails the change itself. */
  private async resortAfter(file: TFile, task: Task, changes?: Change[]): Promise<void> {
    if (this.repo.settings().sortScope === "none") return; await this.resort(file, task, changes).catch(() => undefined);
  }
  /** Makes the task repeat by `rule`, or stops it with `null`. Daily notes from today on get (or lose) their copy to match; today's copy and every earlier one stay. */
  async recurrence(id: string, rule: Rule | null, context?: Context, times?: ClockSpan[]): Promise<void> {
    const today = localDate(); const changes: Change[] = []; const skipped: string[] = [];
    const file = await this.repo.resolve(id); const before = await this.repo.readText(file); const old = await this.repo.read(id);
    let started = false;
    const task = await this.repo.update(id, t => {
      started = t.status === "in_progress" && t.time_tracking_started_at === null;
      const periods = t.recurrence_periods.map(p => ({ ...p }));
      const open = [...periods].reverse().find(p => p.stop === null);
      // A new interval or unit starts a new count; a change of weekday keeps it.
      const keep = rule !== null && t.recurring && sameCadence(taskRule(t), rule);
      if (!keep && open) open.stop = today;
      if (rule !== null && !keep) periods.push({ start: today, stop: null });
      // A running timer keeps its claim, so the planned time it runs for still stops it (now, when that time went with the change).
      return { ...t, status: "open", closed_at: null, auto_started_block: t.time_tracking_started_at ? t.auto_started_block : null, recurrence_times: times ?? t.recurrence_times, recurring: rule !== null, recurrence: rule ? formatRule(rule) : null, recurrence_periods: periods, daily_note_section_path: context && !this.isProjectFile(context.file) ? context.line.section : t.daily_note_section_path };
    });
    changes.push({ file, before, after: await this.repo.readText(file) });
    // The task is open now: a todo a planned block had set in progress (`[/]`) would keep saying so for good. A running timer keeps its marker.
    if (started) for (const o of await this.repo.occurrences(id)) {
      const date = this.daily.date(o.file.path); if (date && date < today) continue;
      let after = o.text; for (const line of o.tasks) if (line.marker === "/") after = replaceTask(after, line, { marker: " " });
      if (after !== o.text) try { await this.edit(o.file, o.text, after, changes); } catch { skipped.push(o.file.path); }
    }
    // In a project note the line moves between Ongoing and its status heading.
    for (const notePath of task.projects) {
      const project = this.repo.file(notePath); if (!project) continue;
      try { const text = await this.repo.readText(project); await this.edit(project, text, moveTask(text, id, projectSection(task)), changes); } catch { skipped.push(project.path); }
    }
    for (const daily of this.daily.files().filter(d => d.date >= today)) {
      try {
        if (repeatsOn(task, daily.date)) await this.insert(daily.file, task, " ", true, changes);
        else if (daily.date > today) {
          // Only a copy nobody has touched goes; a ticked or edited one is the person's now.
          const text = await this.repo.readText(daily.file); const matches = parseTasks(text).filter(t => t.id === id && t.repeat);
          if (matches.length === 1 && matches[0].marker === " ") await this.edit(daily.file, text, removeUnique(text, id, true), changes);
          else if (matches.length > 1) skipped.push(daily.file.path);
        }
      } catch { skipped.push(daily.file.path); }
    }
    if (context) {
      try { const fresh = await this.resolve(context); await this.edit(context.file, fresh.text, replaceTask(fresh.text, fresh.line, { marker: " " }), changes); }
      catch { skipped.push(context.file.path); }
    }
    await this.planEdited(id, old, changes);
    const skippedPaths = [...new Set(skipped)];
    this.summarize(changes, task.recurring ? "Recurrence set" : "Recurrence disabled", skippedPaths.length ? `Skipped/preserved for repair: ${skippedPaths.join(", ")}` : "");
  }
  async onDailyCreated(file: TFile): Promise<void> {
    const date = this.daily.date(file.path); if (!date || date < localDate()) return;
    const tasks = await this.repo.list(); const due = tasks.filter(t => repeatsOn(t, date)); let failed: Task[] = []; let reason = "";
    // Tasks scheduled for the day get their todo now: a later day's note is not made ahead of time (see `dayNote`). Parents go first, so a subtask can go under its parent.
    const scheduled = tasks.filter(t => !t.recurring && (t.status === "open" || t.status === "in_progress") && t.scheduled_dates.includes(date));
    const parents = new Map<string, string | null>(); for (const task of scheduled) parents.set(task.id, (await this.repo.parentOf(task.id))?.id ?? null);
    const depth = (id: string) => { let n = 0; for (let up = parents.get(id); up && parents.has(up) && n < scheduled.length; up = parents.get(up)) n++; return n; };
    const add = (task: Task) => task.recurring ? this.insert(file, task, " ", true) : this.insert(file, task, date === localDate() ? markerOf(task) : " ", false, undefined, parents.get(task.id) ?? null);
    const all = [...due, ...scheduled.sort((a, b) => depth(a.id) - depth(b.id))];
    // One task that cannot be written (the new note is open and being typed in, or a sync is writing it) must not keep the others out; it gets one more try.
    for (const task of all) { try { await add(task); } catch { failed.push(task); } }
    const again = failed; failed = [];
    for (const task of again) { try { await add(task); } catch (error) { failed.push(task); reason = error instanceof Error ? error.message : String(error); } }
    this.changed();
    if (failed.length) throw new Error(`${plural(failed.length, failed.every(t => t.recurring) ? "recurring task" : "task")} (${failed.map(t => t.title).join(", ")}) could not be added to ${file.path}: ${reason}`);
  }
  /** Adds the recurring tasks and the tasks scheduled for `date` that are missing from its note (made while this plugin was not running, or filled on another device): the same fill a new note gets, run on request. Returns the titles it added. */
  async catchUp(date: string): Promise<string[]> {
    const file = await this.daily.ensure(date); const before = new Set(parseTasks(await this.repo.readText(file)).map(t => t.id));
    await this.onDailyCreated(file);
    return parseTasks(await this.repo.readText(file)).filter(t => t.id && !before.has(t.id)).map(t => t.title);
  }
  /** Removes repeat copies that repeat an earlier copy exactly (see `duplicateRepeats`); returns how many. Undoable. */
  async removeDuplicateRepeats(file: TFile): Promise<number> {
    const text = await this.repo.readText(file); const drop = new Set(duplicateRepeats(parseTasks(text)));
    if (!drop.size) return 0;
    const changes: Change[] = []; await this.edit(file, text, text.split("\n").filter((_line, index) => !drop.has(index)).join("\n"), changes);
    this.summarize(changes, "Duplicate recurring lines removed", `${plural(drop.size, "line")} removed from ${file.path}.`); return drop.size;
  }
  async reconcile(file: TFile): Promise<void> {
    const today = localDate(); const settings = this.repo.settings();
    if (this.daily.date(file.path) !== today) return;
    if (settings.taskRetentionDays > 0 && this.retentionReconciled !== today) {
      await this.cleanupExpiredTasks(settings.taskRetentionDays, Date.now()); this.retentionReconciled = today;
    }
    if (!settings.autoForward || this.reconciled === today) return;
    const latest = new Map<string, { file: TFile; line: TaskLine; date: string }>();
    for (const daily of this.daily.files().filter(d => d.date < today).sort((a, b) => a.date.localeCompare(b.date))) {
      for (const line of parseTasks(await this.repo.readText(daily.file))) if (line.id) latest.set(line.id, { ...daily, line });
    }
    const present = new Set(parseTasks(await this.repo.readText(file)).map(t => t.id)); const changes: Change[] = []; let skipped = 0;
    for (const [id, occurrence] of latest) {
       // The [r] marker is a recurrence instruction, not an unfinished task to carry forward.
       if (present.has(id) || ![" ", "/", ">", "<"].includes(occurrence.line.marker)) continue;
      try {
        const task = await this.repo.read(id);
        // An unfinished todo always comes along, also when a later day is scheduled; one scheduled away (`<`, `>`) waits for its day while that is still ahead.
        if (task.recurring || ["completed", "canceled"].includes(task.status) || ([">", "<"].includes(occurrence.line.marker) && task.scheduled && task.scheduled > today)) continue;
        await this.schedule({ file: occurrence.file, line: occurrence.line }, today, "forward", "automatic", changes);
        // Subtasks that travelled with their parent are in today's note now.
        for (const line of parseTasks(await this.repo.readText(file))) present.add(line.id);
      } catch { skipped++; }
    }
    // A scheduled day of the last week that went by with no daily note made for it left the todo nowhere: it comes to today, as an unfinished one would. An older day whose note is
    // missing was most likely deleted on purpose, and its task stays where it is.
    const week = localDate(new Date(Date.now() - 7 * 86400000));
    for (const task of await this.repo.list()) {
      const last = task.scheduled_dates.at(-1);
      if (!last || last >= today || last < week || present.has(task.id) || task.recurring || ["completed", "canceled"].includes(task.status) || this.repo.file(this.daily.path(last))) continue;
      try {
        const event: Movement = { id: makeId(), kind: "forward", source: "automatic", from: last, to: today, at: new Date().toISOString() };
        const next = await this.recorded(task.id, changes, () => this.repo.update(task.id, t => ({ ...t, scheduled_dates: [...t.scheduled_dates.filter(day => day !== last), today], movement_history: [...t.movement_history, event] })));
        await this.insert(file, next, markerOf(next), false, changes, (await this.repo.parentOf(task.id))?.id ?? null); present.add(task.id);
      } catch { skipped++; }
    }
    this.reconciled = today;
    if (changes.length || skipped) this.summarize(changes, "Unfinished tasks carried to today", skipped ? `${skipped} conflict${skipped === 1 ? "" : "s"} skipped · previous line preserved.` : "");
  }
  private async cleanupExpiredTasks(days: number, now: number): Promise<void> {
    const detail = this.repo.settings().retentionDetail; let removed = 0; const failed: string[] = [];
    const tasks = await this.repo.list(); const gone = new Set<string>();
    for (const task of tasks) {
      if (task.recurring || !["completed", "canceled"].includes(task.status) || !task.closed_at || now - Date.parse(task.closed_at) < days * 86400000) continue;
      try {
        const taskFile = this.repo.taskFile(task.id);
        if (!taskFile) throw new Error(`Task note missing for ${task.id}`);
        const occurrences = await this.repo.occurrences(task.id);
        // What the user chose to keep goes under one occurrence only (the latest daily note), so forwarded copies are not repeated.
        const keep = detail === "title" ? [] : retiredLines(task, splitNote(await this.repo.readText(taskFile)).body, detail, "");
        const target = keep.length && occurrences.length ? occurrences.reduce((best, item) => (this.daily.date(item.file.path) ?? "") >= (this.daily.date(best.file.path) ?? "") ? item : best) : null;
        for (const occurrence of occurrences) {
          let after = occurrence.text; const last = Math.max(...occurrence.tasks.map(line => line.line));
          for (const line of [...occurrence.tasks].sort((a, b) => b.line - a.line)) {
            const current = parseTasks(after).find(item => item.line === line.line);
            if (!current || current.id !== task.id || current.raw !== line.raw) throw new Error(`Changed occurrence in ${occurrence.file.path}`);
            after = replaceTask(after, current, { id: null, repeat: false });
            if (occurrence === target && line.line === last) after = insertBelow(after, line.line, keep, line.prefix, line.raw.endsWith("\r"));
          }
          await this.edit(occurrence.file, occurrence.text, after);
        }
        await this.repo.trashNote(taskFile); gone.add(this.repo.linkOf(taskFile).toLowerCase()); removed++;
      } catch { failed.push(task.title); }
    }
    await this.dropGone(tasks, gone);
    if (removed) { this.references = null; this.changed(); }
    if (removed || failed.length) {
      const fragment = createFragment();
      fragment.createDiv({ cls: "organized-notice-title", text: "Expired tasks cleaned up" });
      fragment.createDiv({ cls: "organized-notice-detail", text: `${removed} task${removed === 1 ? "" : "s"} moved to Obsidian's trash and unlinked${failed.length ? ` · ${failed.length} cleanup${failed.length === 1 ? " was" : "s were"} incomplete; task notes were preserved` : ""}.` });
      new Notice(fragment, 12000);
    }
  }
  async projects(id: string, projects: string[]): Promise<void> {
    const task = await this.repo.read(id);
    for (const notePath of projects) {
      const file = await this.repo.ensure(notePath, projectTemplate()); await this.repo.markProject(file);
      // A linked task lands under the heading for its status, so the project reads as open / in progress / done.
      const section = sectionNamed(await this.repo.readText(file), projectSection(task));
      await this.insert(file, { ...task, daily_note_section_path: section }, markerOf(task), false);
    }
    for (const removed of task.projects.filter(p => !projects.includes(p))) {
      const file = this.repo.file(removed);
      if (file) { const text = await this.repo.readText(file); const lines = parseTasks(text).filter(t => t.id === id).length;
        if (lines > 1) new Notice(onTwoLines(task.title, removed, lines, "The project is unlinked; neither line there was removed, so delete them by hand."));
        else try { await this.edit(file, text, removeUnique(text, id)); } catch { new Notice(`Could not safely unlink ${removed}; occurrence preserved for repair.`); } }
    }
    await this.repo.update(id, t => ({ ...t, projects })); this.changed();
  }
  /** Renames project notes and rewrites every task that links them; targets that already exist are skipped, never overwritten. */
  async moveProjects(pairs: { from: string; to: string }[]): Promise<{ moved: { from: string; to: string }[]; skipped: string[] }> {
    const moved: { from: string; to: string }[] = []; const skipped: string[] = [];
    for (const pair of pairs) {
      const file = this.repo.file(pair.from);
      if (!file || this.repo.file(pair.to)) { skipped.push(pair.from); continue; }
      try { await this.repo.folders(pair.to); await this.repo.app.fileManager.renameFile(file, pair.to); moved.push(pair); } catch { skipped.push(pair.from); }
    }
    const target = new Map(moved.map(pair => [pair.from, pair.to]));
    if (target.size) for (const task of await this.repo.list()) {
      if (!task.projects.some(project => target.has(project))) continue;
      await this.repo.update(task.id, current => ({ ...current, projects: [...new Set(current.projects.map(project => target.get(project) ?? project))] }));
    }
    this.references = null; this.changed();
    return { moved, skipped };
  }
  /** Moves every linked project note that is outside the project folder into it. */
  async migrateProjects(): Promise<{ moved: { from: string; to: string }[]; skipped: string[] }> {
    const folder = this.repo.projectFolder();
    const linked = new Set([...(await this.repo.list()).flatMap(t => t.projects), ...this.repo.settings().knownProjects]);
    const pairs = [...linked].filter(p => !p.startsWith(`${folder}/`) && this.repo.file(p)).map(from => ({ from, to: path(`${folder}/${from.split("/").at(-1)!}`) }));
    return this.moveProjects(pairs);
  }
  /** Logs time worked by hand; it counts toward the task's total like a timer run does. */
  async addSession(id: string, session: WorkSession): Promise<void> {
    await this.repo.update(id, t => ({ ...t, work_sessions: [...t.work_sessions, session].slice(-MAX_WORK_SESSIONS), time_tracked_seconds: t.time_tracked_seconds + seconds(session) })); this.changed();
  }
  /** Replaces one recorded session, or removes it when `to` is null, keeping the task's total in step. */
  async changeSession(id: string, from: WorkSession, to: WorkSession | null): Promise<void> {
    await this.repo.update(id, t => {
      const at = t.work_sessions.findIndex(s => s.start === from.start && s.end === from.end); if (at < 0) throw new Error("That session no longer exists; it may have been changed elsewhere.");
      const sessions = to ? t.work_sessions.map((s, n) => n === at ? to : s) : t.work_sessions.filter((_s, n) => n !== at);
      return { ...t, work_sessions: sessions, time_tracked_seconds: Math.max(0, t.time_tracked_seconds - seconds(from) + (to ? seconds(to) : 0)) };
    }); this.changed();
  }
  /** Sets or removes (null) the time a task is allowed to take. */
  async setBudget(id: string, seconds: number | null): Promise<void> { await this.repo.update(id, t => ({ ...t, time_budget_seconds: seconds })); this.changed(); }
  /** Sets time aside for a task: a block that never counts as worked. A block the task already has is not added again. */
  async addPlanned(id: string, block: WorkSession, changes?: Change[]): Promise<void> {
    const before = await this.repo.read(id); const own = changes ?? [];
    await this.recorded(id, own, () => this.repo.update(id, t => t.planned_sessions.some(b => b.start === block.start && b.end === block.end) ? t : { ...t, planned_sessions: [...t.planned_sessions, block].slice(-MAX_PLANNED_SESSIONS) }));
    await this.scheduleBlockDay(before, block, own);
    // Recorded with the rest, so Undo also takes back a timer this started (an Undo whose note changed after it was recorded would refuse).
    await this.syncTimes(id, own); await this.planEdited(id, before, own); this.changed();
  }
  /** Replaces one planned block, or removes it when `to` is null. A block moved to a later day schedules the task for that day (see `scheduleBlockDay`); the day it left stays scheduled. */
  async changePlanned(id: string, from: WorkSession, to: WorkSession | null): Promise<void> {
    const before = await this.repo.read(id); const own: Change[] = [];
    await this.recorded(id, own, () => this.repo.update(id, t => {
      const at = t.planned_sessions.findIndex(s => s.start === from.start && s.end === from.end); if (at < 0) throw new Error("That planned block no longer exists; it may have been changed elsewhere.");
      return { ...t, planned_sessions: to ? t.planned_sessions.map((s, n) => n === at ? to : s) : t.planned_sessions.filter((_s, n) => n !== at) };
    }));
    if (to) await this.scheduleBlockDay(before, to, own);
    await this.syncTimes(id, own); await this.planEdited(id, before, own); this.changed();
  }
  /**
   * A block on a later day schedules the task for that day too, so its todo is in that day's note. Recurring tasks have no days; a block today leaves the todo where it already is,
   * and one in the past is an estimate, not a plan.
   */
  private async scheduleBlockDay(before: Task, block: WorkSession, changes: Change[]): Promise<void> {
    const day = localDate(new Date(block.start));
    if (before.recurring || !plannable(before) || day <= localDate() || before.scheduled_dates.includes(day)) return;
    if (before.scheduled_dates.length) await this.addDay(before.id, day, changes); else await this.scheduleTask(before.id, day, undefined, undefined, changes);
    this.summarize(changes, "Scheduled", `“${before.title}” is ${before.scheduled_dates.length ? "also " : ""}scheduled for ${day}, the day of its planned block.`);
  }
  /**
   * Changes one day of a recurring task's repeating times on its own ("this day"): that day's repeating blocks become blocks of its own, `from` among them replaced by `to` (or left out when
   * `to` is null), and the day is marked so its repeating times no longer apply. The other days, and a later change of the times, leave it as it is.
   */
  async editRepeatingDay(id: string, day: string, from: WorkSession, to: WorkSession | null): Promise<void> {
    const before = await this.repo.read(id); const blocks = repeatingBlocks(before, day).map(stored);
    if (!blocks.some(b => b.start === from.start && b.end === from.end)) throw new Error("That repeating block no longer exists; its times may have been changed elsewhere.");
    const recent = localDate(new Date(Date.now() - 7 * 86400000));
    await this.repo.update(id, t => {
      const own = blocks.flatMap(b => b.start === from.start && b.end === from.end ? (to ? [to] : []) : [b]).filter(b => !t.planned_sessions.some(p => p.start === b.start && p.end === b.end));
      return { ...t, planned_sessions: [...t.planned_sessions, ...own].slice(-MAX_PLANNED_SESSIONS), recurrence_skips: [...new Set([...t.recurrence_skips.filter(d => d >= recent), day])].sort().slice(-MAX_SKIPS) };
    });
    await this.planEdited(id, before); this.changed();
  }
  /** Runs a write of the task note and records it in `changes` for Undo. */
  private async recorded<T>(id: string, changes: Change[], write: () => Promise<T>): Promise<T> {
    const note = await this.repo.resolve(id); const before = await this.repo.readText(note);
    const result = await write(); const after = await this.repo.readText(note); if (after !== before) changes.push({ file: note, before, after });
    return result;
  }
  /**
   * After the person changed a task's planned time, the timer follows at once, from now (inside the same queued action, so the minute check cannot come between):
   * - a block that now covers this moment, and did not before, starts the timer now: time before the block existed was not worked;
   * - planned time cut short or moved away under a running timer stops it now, not at the new end: time already tracked is never taken away.
   * The minute check still handles everything else, including a block that began while Obsidian was closed.
   */
  private async planEdited(id: string, before: Task, changes?: Change[], now = Date.now()): Promise<void> {
    if (!this.repo.settings().startAtPlannedTime) return;
    const after = await this.repo.read(id); const context = await this.todayContext(after);
    if (dueStops([after], now).some(stop => stop.end < now) && !dueStops([before], now).length) {
      await this.applyStatus(id, "open", context, changes, t => ({ ...setStatus(t, "open", new Date(now)), auto_started_block: null })); return;
    }
    const start = dueStarts([after], now)[0];
    if (start && !blockAt(before, now)) await this.applyStatus(id, "in_progress", context, changes, t => startPlanned(t, { ...start.block, start: new Date(now).toISOString() }, start.block.start));
  }
  /** The block turned out as planned: it leaves the plan, and the part of it not already worked (a timer that ran in it, time logged by hand) becomes worked time, so no minute counts twice. */
  async logPlanned(id: string, block: WorkSession): Promise<void> {
    await this.repo.update(id, t => {
      if (!t.planned_sessions.some(s => s.start === block.start && s.end === block.end)) throw new Error("That planned block no longer exists; it may have been changed elsewhere.");
      const parts = unworkedParts(block, t.work_sessions);
      return { ...t, planned_sessions: t.planned_sessions.filter(s => s.start !== block.start || s.end !== block.end), work_sessions: [...t.work_sessions, ...parts].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(-MAX_WORK_SESSIONS), time_tracked_seconds: t.time_tracked_seconds + parts.reduce((sum, part) => sum + seconds(part), 0) };
    }); await this.syncTimes(id); this.changed();
  }
  /**
   * Starts the timer of each task whose planned block has begun and stops each timer whose planned time is over, at the block's end (see `dueStarts`, `dueStops`).
   * Returns the titles of tasks whose timer it stopped, so the caller can say so.
   */
  async applyPlanning(now = Date.now()): Promise<string[]> {
    const tasks: Task[] = []; const stopped: string[] = []; const today = localDate(new Date(now));
    // A recurring task ticked or canceled for today is done with today's repeating time: its later blocks today do not start it again. Only seen here, never written.
    for (const task of await this.repo.list()) {
      const line = task.recurring && task.recurrence_times.length ? (await this.todayContext(task))?.line : undefined;
      tasks.push(line && ["x", "X", "-"].includes(line.marker) ? { ...task, recurrence_skips: [...task.recurrence_skips, today] } : task);
    }
    // A write that loses a race with the person typing (or an editor saving older text over it) leaves the task changed but the note not: a stop is undone so the next pass makes it again, a start is put right by the heal below.
    const lost = (error: unknown) => error instanceof Error && error.message.includes("changed concurrently");
    // A task is never in both: a start needs its timer stopped, a stop needs it running (a later block starts it on the next pass).
    const stops = dueStops(tasks, now); const starts = dueStarts(tasks, now);
    for (const { task, end } of stops) {
      try { await this.applyStatus(task.id, "open", await this.todayContext(task), undefined, t => ({ ...setStatus(t, "open", new Date(end)), auto_started_block: null })); stopped.push(task.title); } catch (error) {
        if (!lost(error)) throw error;
        await this.repo.update(task.id, t => ({ ...t, status: task.status, closed_at: task.closed_at, time_tracking_started_at: task.time_tracking_started_at, time_tracked_seconds: task.time_tracked_seconds, work_sessions: task.work_sessions, auto_started_block: task.auto_started_block }));
      }
    }
    for (const { task, block } of starts) { try { await this.applyStatus(task.id, "in_progress", await this.todayContext(task), undefined, t => startPlanned(t, block)); } catch (error) { if (!lost(error)) throw error; } }
    const moving = new Set([...stops, ...starts].map(item => item.task.id));
    for (const task of tasks) {
      if (moving.has(task.id)) continue;
      // Planned time that is over leaves nothing behind in the task note.
      if (task.time_tracking_started_at === null) { if (task.auto_started_block !== null && !claimHolds(task, now)) await this.repo.update(task.id, t => ({ ...t, auto_started_block: null })); continue; }
      // Only a timer of the planned time under way; one the person started outside it is theirs to fix.
      if (!claimHolds(task, now)) continue;
      try { await this.healStarted(task); } catch (error) { if (!lost(error)) throw error; }
    }
    if (stops.length || starts.length) this.changed();
    return stopped;
  }
  /** Today's todo of a recurring task, the one line its status is written to in daily notes (a status change elsewhere leaves other days' todos alone). */
  async todayContext(task: Pick<Task, "id" | "recurring">): Promise<Context | undefined> {
    const note = task.recurring ? this.repo.file(this.daily.path(localDate())) : null; if (!note) return undefined;
    const lines = parseTasks(await this.repo.readText(note)).filter(t => t.id === task.id);
    return lines.length === 1 ? { file: note, line: lines[0] } : undefined;
  }
  /** Writes the in-progress marker on the todo lines of a task whose timer a planned block runs, wherever its lines are; lines that already show it are not written. */
  private async healStarted(task: Task): Promise<void> {
    const found: { file: TFile; text: string; tasks: TaskLine[] }[] = [];
    for (const notePath of await this.refs(task.id)) {
      const file = this.repo.file(notePath)!; const text = await this.repo.readText(file); const tasks = parseTasks(text).filter(t => t.id === task.id); if (tasks.length) found.push({ file, text, tasks });
    }
    await this.syncLines(task, "in_progress", found, await this.todayContext(task));
  }
  async setProjectColor(notePath: string, color: string | null): Promise<void> {
    const file = this.repo.file(notePath); if (!file) throw new Error("The project note was renamed or removed.");
    await this.repo.setProjectColor(file, color); this.changed();
  }
  async setProjectBudgets(notePath: string, budgets: ProjectBudgets): Promise<void> {
    const file = this.repo.file(notePath); if (!file) throw new Error("The project note was renamed or removed.");
    await this.repo.setProjectBudgets(file, budgets); this.changed();
  }
  /**
   * One-time: rewrite task notes written in the old layout (`## Description`, `## Notes`) in the new one. Only real task notes are
   * touched (unreadable or newer-schema ones are left alone), a note already in the new layout is not written, and the text of
   * every note that will change is saved through `backup` first; when that fails nothing is changed.
   */
  /**
   * Renames task notes that are still named after their id to the title of their todo (oldest first, so a duplicate title gets its counter in
   * a stable order; names are unique across the vault). Time records of standalone notes, unreadable, newer-schema and ambiguous notes are left
   * alone. The planned renames are saved through `backup` first (nothing is renamed when that fails); a note that cannot be renamed stays as it was.
   */
  async migrateTaskNames(backup: (extra: { renames: { from: string; to: string }[] }) => Promise<string>): Promise<{ renames: { file: TFile; from: string }[]; failed: string[] }> {
    await this.repo.reindex(); const folder = this.repo.settings().taskFolder; const candidates: { file: TFile; task: Task }[] = [];
    for (const file of this.repo.app.vault.getMarkdownFiles()) {
      if (!this.repo.isTaskRecord(file.path)) continue;
      let task: Task; try { const frontmatter = splitNote(await this.repo.readText(file)).frontmatter; task = taskFrom(frontmatter, this.repo.idOf(file, frontmatter)); } catch { continue; }
      if (file.basename === task.id && !task.converted_to && this.repo.taskFile(task.id) === file) candidates.push({ file, task });
    }
    candidates.sort((a, b) => a.task.created.localeCompare(b.task.created) || a.task.id.localeCompare(b.task.id));
    const taken = this.repo.nameTaken(); const planned = new Set<string>(); const plan: { file: TFile; from: string; to: string; title: string }[] = [];
    for (const { file, task } of candidates) {
      const to = path(freePath(folder, readableName(task.title), candidate => taken(candidate) || planned.has(candidate.toLowerCase()))); planned.add(to.toLowerCase());
      plan.push({ file, from: file.path, to, title: task.title });
    }
    const renames: { file: TFile; from: string }[] = []; const failed: string[] = [];
    if (!plan.length) return { renames, failed };
    await backup({ renames: plan.map(({ from, to }) => ({ from, to })) });
    const progress = plan.length > 50 ? new Notice(`Naming task notes after their titles… 0 of ${plan.length}`, 0) : null;
    try {
      for (const [index, item] of plan.entries()) {
        try { await this.repo.renameNote(item.file, item.to); renames.push({ file: item.file, from: item.from }); } catch { failed.push(item.title); }
        if (progress && (index + 1) % 10 === 0) progress.setMessage(`Naming task notes after their titles… ${index + 1} of ${plan.length}`);
      }
    } finally { progress?.hide(); this.references = null; }
    return { renames, failed };
  }
  async migrateTaskBodies(backup: (files: { path: string; before: string }[]) => Promise<string>): Promise<{ changes: Change[]; failed: string[]; backupPath: string | null }> {
    const pending: { file: TFile; before: string; after: string }[] = [];
    for (const file of this.repo.app.vault.getMarkdownFiles().filter(f => this.repo.isTaskRecord(f.path))) {
      let before: string;
      try { before = await this.repo.readText(file); taskFrom(splitNote(before).frontmatter, this.repo.idOf(file, splitNote(before).frontmatter)); } catch { continue; }
      const after = migrateNote(before); if (after !== null) pending.push({ file, before, after });
    }
    if (!pending.length) return { changes: [], failed: [], backupPath: null };
    const backupPath = await backup(pending.map(p => ({ path: p.file.path, before: p.before })));
    const changes: Change[] = []; const failed: string[] = [];
    for (const p of pending) { try { await this.edit(p.file, p.before, p.after, changes); } catch { failed.push(p.file.path); } }
    return { changes, failed, backupPath };
  }
  /** Gives every project note that predates the project marker its frontmatter: linked ones, remembered ones and anything already in the project folder. */
  async markProjects(): Promise<number> {
    const folder = this.repo.projectFolder();
    const notes = new Set([...(await this.repo.list()).flatMap(t => t.projects), ...this.repo.settings().knownProjects, ...this.repo.app.vault.getMarkdownFiles().map(f => f.path).filter(p => p.startsWith(`${folder}/`))]);
    let marked = 0;
    for (const notePath of notes) { const file = this.repo.file(notePath); if (file && !this.repo.isTaskRecord(file.path) && await this.repo.markProject(file).catch(() => false)) marked++; }
    return marked;
  }
  /** How many days after a day a retired task can still have been completed; its time is kept in the note of that later day. */
  static readonly RETIRED_WINDOW_DAYS = 31;
  private retired = new Map<string, { stamp: string; tasks: Task[] }>();
  /** Time worked on tasks whose notes were retired with "keep everything", read back from the daily notes that could hold it. Notes are read once and re-read only when they change, so browsing the calendar stays cheap. */
  async retiredWork(from: string, to: string): Promise<{ task: Task; path: string }[]> {
    const [year, month, day] = to.split("-").map(Number); const last = localDate(new Date(year, month - 1, day + TaskService.RETIRED_WINDOW_DAYS));
    const result: { task: Task; path: string }[] = [];
    for (const { file, date } of this.daily.files()) {
      if (date < from || date > last) continue;
      const stamp = `${file.stat.mtime}:${file.stat.size}`; let entry = this.retired.get(file.path);
      if (entry?.stamp !== stamp) { entry = { stamp, tasks: parseWorked(await this.repo.readText(file)) }; this.retired.set(file.path, entry); }
      for (const task of entry.tasks) result.push({ task, path: file.path });
    }
    return result;
  }
  async refs(id: string): Promise<string[]> {
    // An edit or deletion can reset the index while it builds; rebuild rather than answer from a half-built or dropped one.
    let map: Map<string, Set<string>>;
    do {
      if (!this.references) {
        this.references = new Map();
        this.referenceBuild = inBatches(this.repo.app.vault.getMarkdownFiles(), file => this.index(file)).then(() => undefined);
      }
      map = this.references; await this.referenceBuild;
    } while (map !== this.references);
    const task = await this.repo.read(id); const today = localDate();
    return [...(map.get(id) ?? [])].filter(p => this.repo.file(p) && (!task.recurring || !this.daily.date(p) || this.daily.date(p) === today))
      .sort((a, b) => Number(this.daily.date(b) === today) - Number(this.daily.date(a) === today) || a.localeCompare(b));
  }
  /** Re-reads one note into the index. Only the newest read of a note counts, and a read that outlives a reset or `forget` is dropped. */
  async index(file: TFile): Promise<void> {
    const map = this.references; if (!map) return;
    const ticket = (this.indexing.get(file.path) ?? 0) + 1; this.indexing.set(file.path, ticket);
    const text = await this.repo.readText(file);
    if (this.references !== map || this.indexing.get(file.path) !== ticket) return;
    this.forget(file.path); this.indexing.set(file.path, ticket);
    for (const task of parseTasks(text)) if (task.id) {
      const refs = map.get(task.id) ?? new Set<string>(); refs.add(file.path); map.set(task.id, refs);
    }
  }
  hasReference(id: string | null, notePath: string): boolean { return id !== null && this.references?.get(id)?.has(notePath) === true; }
  forget(notePath: string): void { this.indexing.delete(notePath); if (this.references) for (const refs of this.references.values()) refs.delete(notePath); }
  async convertTodos(file: TFile): Promise<void> {
    if (this.repo.isTaskRecord(file.path)) throw new Error("Choose a regular note, not a task note.");
    const text = await this.repo.readText(file);
    const todos = parseTasks(text).filter(t => !t.id && t.marker === " " && t.title);
    if (!todos.length) { new Notice("No unchecked todos to convert in this note."); return; }
    const count = `${todos.length} unchecked todo${todos.length === 1 ? "" : "s"}`;
    if (!(await this.confirm(`Convert ${count} in ${file.path} into Organized tasks?`, "Convert todos", "Convert"))) return;
    // The note may change while the prompt is open; check before creating task notes that a stale write would orphan.
    if (await this.repo.readText(file) !== text) throw new Error(`${file.path} changed while confirming; preserved. Retry the action.`);
    const lines = text.split("\n");
    for (const todo of todos) {
      const task = await this.repo.create(todo.title);
      lines[todo.line] = taskText(todo, { id: task.id, repeat: false });
    }
    await this.edit(file, text, lines.join("\n")); await this.syncSubtasks(parentIds(text), parentIds(lines.join("\n")));
    this.changed(); new Notice(`Converted ${count} into Organized tasks.`);
  }
  /**
   * The reverse of converting: turn the linked checkboxes in `files` back into plain todos (the text and state stay, the hidden id and
   * recurrence comments go). Task notes are not touched, so descriptions, notes and tracked time are kept, only no longer linked.
   * This is how a person retires the plugin without leaving hidden comments behind. One Undo restores every note.
   */
  async unlinkTasks(files: TFile[], scope: string): Promise<void> {
    const found: { file: TFile; text: string; todos: TaskLine[] }[] = [];
    for (const file of files) {
      if (this.repo.isTaskRecord(file.path)) continue;
      const text = await this.repo.readText(file);
      if (!text.includes("<!--organized:")) continue;
      const todos = parseTasks(text).filter(t => t.id || t.repeat);
      if (todos.length) found.push({ file, text, todos });
    }
    const count = found.reduce((sum, item) => sum + item.todos.length, 0);
    if (!count) { new Notice(`No linked tasks to convert back in ${scope}.`); return; }
    const noun = `${count} linked task${count === 1 ? "" : "s"} in ${found.length} note${found.length === 1 ? "" : "s"}`;
    if (!(await this.confirm(`Turn ${noun} back into plain todos? The checkboxes keep their text and state. Recurrence stops. The task notes (descriptions, notes, tracked time) and project notes are not changed: they stay as ordinary Markdown files, and you can undo this right afterwards.`, "Convert back to todos", "Convert"))) return;
    const changes: Change[] = [];
    for (const { file, text, todos } of found) {
      // The note may have changed while the prompt was open; skip it rather than overwrite.
      if (await this.repo.readText(file) !== text) throw new Error(`${file.path} changed while confirming; nothing more was converted. Retry the action.`);
      const lines = text.split("\n");
      for (const todo of todos) lines[todo.line] = taskText(todo, { id: null, repeat: false });
      await this.edit(file, text, lines.join("\n"), changes);
    }
    this.summarize(changes, `Converted ${count} task${count === 1 ? "" : "s"} back to todos`);
  }
  /** Reads the vault once for the Retire window: the tasks, and the notes that hold a todo for each. */
  async scanRetire(): Promise<RetireScan> {
    const files = new Map<string, TFile[]>(); const lines = new Map<string, number>();
    for (const file of this.repo.app.vault.getMarkdownFiles()) {
      if (this.repo.isTaskRecord(file.path)) continue;
      const text = await this.repo.readText(file); if (!text.includes("<!--organized:")) continue;
      for (const todo of parseTasks(text)) {
        if (!todo.id) continue;
        lines.set(todo.id, (lines.get(todo.id) ?? 0) + 1);
        const known = files.get(todo.id) ?? []; if (!known.includes(file)) known.push(file); files.set(todo.id, known);
      }
    }
    const tasks = await this.repo.list();
    return { tasks, files, lines, unnamed: new Set(tasks.filter(task => this.repo.taskFile(task.id)?.basename === task.id).map(task => task.id)) };
  }
  /**
   * Retires tasks so the vault reads as plain Obsidian again: the todos lose their ids (becoming plain text or links to the task note),
   * and each task note is kept, renamed to its title, stripped of Organized's properties, or moved to the trash. Per task: the todos are
   * checked, the note renamed, the todos rewritten, then the properties stripped and the note trashed, and a task that fails at any step is
   * restored and reported while the others go on. The text that will change is saved through `backup` first. Undo restores the notes and
   * the names (never a trashed note, so a trashing run offers none).
   */
  async retireTasks(raw: RetireOptions, backup: (files: { path: string; before: string }[], extra: Record<string, unknown>) => Promise<string>, now = Date.now()): Promise<void> {
    const o = normalizeRetire(raw); const scan = await this.scanRetire(); const chosen = selectTasks(scan.tasks, o, now);
    if (!chosen.length) { new Notice("No tasks match, so nothing was retired."); return; }
    const folder = this.repo.settings().taskFolder;
    const names = o.notes === "rename" ? planNames(chosen.filter(task => scan.unnamed.has(task.id)), folder, this.repo.app.vault.getMarkdownFiles().map(f => f.path)) : new Map<string, string>();
    const saved = new Map<string, string>();
    for (const task of chosen) {
      for (const file of scan.files.get(task.id) ?? []) if (!saved.has(file.path)) saved.set(file.path, await this.repo.readText(file));
      const note = this.repo.taskFile(task.id); if (note && (o.yaml === "strip" || task.time_tracking_started_at || (task.recurring && keepsNote(o)))) saved.set(note.path, await this.repo.readText(note));
    }
    const backupPath = await backup([...saved].map(([path, before]) => ({ path, before })), { renames: [...names].map(([id, to]) => ({ from: this.repo.taskPath(id), to })) });
    const changes: Change[] = []; const renames: { file: TFile; from: string }[] = []; const failed: string[] = [];
    let renamed = 0, stripped = 0, trashed = 0, done = 0, todos = 0; const gone = new Set<string>();
    const progress = new Notice(`Retiring tasks… 0 of ${chosen.length}`, 0);
    try {
      for (const [index, listed] of chosen.entries()) {
        progress.setMessage(`Retiring tasks… ${index} of ${chosen.length}`);
        const note = this.repo.taskFile(listed.id); let from: string | null = null;
        try {
          if (!note) throw new Error(`Task note missing for ${listed.id}`);
          // A running timer is logged first, so the time worked is not left running in a note nothing tracks any more.
          const task = listed.time_tracking_started_at ? await this.repo.update(listed.id, t => setStatus(t, "open")) : listed;
          const keep = losesNote(o) && o.keep !== "title" ? retiredLines(task, splitNote(await this.repo.readText(note)).body, o.keep, "") : [];
          const occurrences: { file: TFile; text: string; todos: TaskLine[] }[] = [];
          for (const file of scan.files.get(task.id) ?? []) {
            const text = await this.repo.readText(file); const found = parseTasks(text).filter(t => t.id === task.id); if (found.length) occurrences.push({ file, text, todos: found });
          }
          const target = keep.length && occurrences.length ? occurrences.reduce((best, item) => (this.daily.date(item.file.path) ?? "") >= (this.daily.date(best.file.path) ?? "") ? item : best) : null;
          if (names.has(task.id)) { from = note.path; await this.repo.renameNote(note, names.get(task.id)!); }
          const alias = o.notes === "keep" ? task.title.replace(/[|[\]]/g, " ").replace(/\s+/g, " ").trim() : undefined;
          for (const occurrence of occurrences) {
            let after = occurrence.text; const last = Math.max(...occurrence.todos.map(line => line.line));
            for (const line of [...occurrence.todos].sort((a, b) => b.line - a.line)) {
              const link = o.lines === "link" ? this.repo.app.fileManager.generateMarkdownLink(note, occurrence.file.path, undefined, alias) : null;
              after = replaceTask(after, line, { id: null, repeat: false, ...(link === null ? {} : { title: link }) });
              if (occurrence === target && line.line === last) after = insertBelow(after, line.line, keep, line.prefix, line.raw.endsWith("\r"));
            }
            await this.edit(occurrence.file, occurrence.text, after, changes); todos += occurrence.todos.length;
          }
          // A task note that stays must stop repeating, or the next daily note would bring the todo back.
          if (task.recurring && keepsNote(o)) await this.stopRepeating(task.id, note, changes);
          if (o.yaml === "strip") { const text = await this.repo.readText(note); await this.edit(note, text, stripOrganized(text), changes); stripped++; }
          if (o.notes === "trash") { await this.repo.trashNote(note); gone.add(this.repo.linkOf(note).toLowerCase()); trashed++; }
          if (from !== null) { renames.push({ file: note, from }); renamed++; }
          done++;
        } catch {
          failed.push(listed.title);
          // Put the name back so the task is found again by its id; the todos it did not reach keep their ids.
          if (from !== null && note && note.path !== from) { try { await this.repo.renameNote(note, from); } catch { /* The report below names the task. */ } }
        }
      }
    } finally { progress.hide(); }
    await this.dropGone(scan.tasks, gone);
    this.references = null;
    const failedNames = failed.slice(0, 3).join(", ");
    const detail = `${done} of ${plural(chosen.length, "task")} retired · ${plural(todos, "todo")} unlinked${renamed ? ` · ${renamed} renamed` : ""}${stripped ? ` · ${stripped} stripped` : ""}${trashed ? ` · ${trashed} moved to Obsidian's trash` : ""}${failed.length ? ` · ${failed.length} left unchanged (${failedNames})` : ""}. Old text saved in note-backups (${backupPath.split("/").pop()}).`;
    if (trashed) { this.undoChanges = []; this.undoRenames = []; new Notice(`${detail} Trashed task notes can be restored from Obsidian's trash; Undo is not offered because it would relink todos to them.`, 20000); this.changed(); }
    else this.summarize(changes, "Tasks retired", detail, renames);
  }
  /** Ends a task's repeat rule without touching any daily note, and records the change so Undo gives the rule back. */
  private async stopRepeating(id: string, note: TFile, changes: Change[]): Promise<void> {
    const before = await this.repo.readText(note); const today = localDate();
    await this.repo.update(id, t => ({ ...t, recurring: false, recurrence: null, recurrence_periods: t.recurrence_periods.map(p => p.stop === null ? { ...p, stop: today } : p) }));
    changes.push({ file: note, before, after: await this.repo.readText(note) });
  }
  /** A note a task became was renamed or moved: the task keeps pointing at it, so the calendar still opens the right note. */
  async followRename(oldPath: string, newPath: string): Promise<void> {
    if (!newPath.endsWith(".md")) return;
    await this.eachTask(this.repo.convertedTo(oldPath), id => this.repo.update(id, task => ({ ...task, converted_to: newPath })), "follow the renamed note");
  }
  /** Runs `change` for every id; one task note that cannot be written does not keep the others from following, and the failures are named once at the end. */
  private async eachTask(ids: string[], change: (id: string) => Promise<unknown>, what: string): Promise<void> {
    const failed: string[] = [];
    for (const id of ids) { try { await change(id); } catch { failed.push(id); } }
    if (failed.length) throw new Error(`${plural(failed.length, "task")} could not ${what} (${failed.join(", ")}).`);
  }
  /** A project note was renamed or moved: the tasks linked to it follow it, so its colour and budgets keep applying to them. */
  async followProjectRename(oldPath: string, newPath: string): Promise<void> {
    if (!newPath.endsWith(".md")) return;
    const linked = (await this.repo.list(true)).filter(task => task.projects.includes(oldPath)).map(task => task.id);
    try { await this.eachTask(linked, id => this.repo.update(id, t => ({ ...t, projects: t.projects.map(p => p === oldPath ? newPath : p) })), "follow the renamed project"); } finally { this.changed(); }
  }
  async deleteTask(id: string, onConfirmed?: () => void): Promise<boolean> {
    // The inspector must clear its now-invalid selection before occurrence or
    // trash events can trigger a refresh, so the confirmed hook runs first.
    const task = await this.repo.read(id); const subtasks = (await this.repo.subtasksOf(task)).length;
    const kept = subtasks ? ` Its ${plural(subtasks, "subtask")} stay as separate tasks.` : "";
    if (!(await this.confirm(`Delete “${task.title}”? Its task note moves to Obsidian's trash and every linked occurrence is removed.${kept} This cannot be undone from Organized.`, "Delete task", "Delete"))) return false;
    onConfirmed?.();
    for (const occurrence of await this.repo.occurrences(id)) {
      await this.edit(occurrence.file, occurrence.text, removeLines(occurrence.text, occurrence.tasks.map(line => line.line)));
    }
    const file = await this.repo.resolve(id, "deleting"); const parent = await this.repo.parentOf(id);
    await this.repo.trashNote(file);
    if (parent) await this.dropLinks(parent.id, link => link.toLowerCase() === `[[${file.basename.toLowerCase()}]]`);
    this.references = null; return true;
  }
  /** Turns a task into a standalone note and leaves a link in its place: the note is titled after the task and holds its description (then sources and notes), in the chosen folder with the chosen tags and template. The task's other copies are removed and its task note moves to the trash. */
  async convertToNote(id: string, options: { folder: string; tags: string[]; template: string | null; clash: "new" | "existing" }, context?: Context): Promise<TFile> {
    const taskFile = await this.repo.resolve(id, "converting");
    const task = await this.repo.read(id); const folder = path(options.folder, true); const occurrences = await this.repo.occurrences(id);
    const body = splitNote(await this.repo.readText(taskFile)).body; const name = noteName(task.title);
    const wanted = folder ? `${folder}/${name}.md` : `${name}.md`; const existing = this.repo.file(wanted);
    if (existing && options.clash === "existing") return this.linkNote(task, existing, occurrences, context, taskFile);
    const templateFile = options.template ? this.repo.file(path(options.template)) : null; if (options.template && !templateFile) throw new Error(`The template ${options.template} was not found.`);
    const target = freePath(folder, name, candidate => this.repo.file(candidate) !== null);
    const content = buildNote({ title: task.title, description: noteSection(body, "Description"), sources: noteSection(body, "Sources"), template: templateFile ? await this.repo.readText(templateFile) : null, tags: options.tags, today: localDate() });
    const file = await this.repo.ensure(target, content);
    return this.linkNote(task, file, occurrences, context, taskFile);
  }
  /** Replaces the task's lines with one link to `note` (in the copy being worked from) and removes the rest and the task note. */
  private async linkNote(task: Task, note: TFile, occurrences: Awaited<ReturnType<Repository["occurrences"]>>, context: Context | undefined, taskFile: TFile): Promise<TFile> {
    const latest = (item: { file: TFile }) => this.daily.date(item.file.path) ?? "";
    const home = occurrences.find(item => item.file.path === context?.file.path) ?? [...occurrences].sort((a, b) => latest(b).localeCompare(latest(a)))[0];
    for (const occurrence of occurrences) {
      const lines = occurrence.text.split("\n"); const ours = new Set(occurrence.tasks.map(line => line.line)); const first = occurrence === home ? occurrence.tasks[0] : null;
      if (first) { const link = this.repo.app.fileManager.generateMarkdownLink(note, occurrence.file.path); lines[first.line] = `${first.prefix.slice(0, -1)}${link}${first.raw.endsWith("\r") ? "\r" : ""}`; }
      await this.edit(occurrence.file, occurrence.text, removeLines(lines.join("\n"), [...ours].filter(index => index !== first?.line)));
    }
    // A running timer is stopped and logged first. Tracked time keeps its task note (hidden from lists) so the calendar still shows it.
    const stopped = setStatus(task, task.status === "in_progress" ? "open" : task.status); const parent = await this.repo.parentOf(task.id);
    if (stopped.work_sessions.length) await this.repo.update(task.id, () => ({ ...stopped, converted_to: note.path }));
    else await this.repo.trashNote(taskFile);
    // A note is not a subtask: its parent's list lets go of it, so a later task with the same name is not taken for it.
    if (parent) await this.dropLinks(parent.id, link => link.toLowerCase() === this.repo.linkOf(taskFile).toLowerCase());
    this.references = null; this.changed();
    return note;
  }
  async marker(context: Context, marker: string): Promise<void> {
    const id = context.line.id; if (!id) return;
    if (marker === ">") await this.schedule(context, nextDate(localDate()), "forward");
    else if ([" ", "x", "X", "/", "-"].includes(marker)) await this.status(id, marker === "x" || marker === "X" ? "completed" : marker === "/" ? "in_progress" : marker === "-" ? "canceled" : "open", context);
    else if (marker === "*") { await this.repo.update(id, t => ({ ...t, starred: !t.starred })); this.changed(); }
  }
}
/** What to say when a note holds a task on more than one line: which line is meant is unclear, so that note was left as it was. */
export function onTwoLines(title: string, path: string, count: number, advice: string): string { return `“${title}” is on ${count} lines in ${path}. ${advice}`; }
export function report(error: unknown): void { new Notice(`Organized: ${error instanceof Error ? error.message : String(error)}`, 10000); }
export function byPriority(tasks: Task[]): Task[] { return [...tasks].sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)); }
