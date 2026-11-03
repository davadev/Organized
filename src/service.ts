import { inBatches } from "./batches";
import { Notice, TFile } from "obsidian";
import { insertTask, migrateNote, moveTask, noteSection, parseTasks, projectSection, RECURRING_MARKER, removeUnique, replaceTask, sectionNamed, sortTasks, TaskLine, taskText } from "./codec";
import { DailyNotes } from "./daily";
import { localDate, makeId, MAX_WORK_SESSIONS, Movement, nextDate, path, PRIORITIES, Priority, setStatus, Status, Task, taskFrom, WorkSession } from "./model";
import { seconds } from "./sessions";
import { projectTemplate, Repository, splitNote } from "./repository";
import { parseWorked, retiredLines } from "./retention";
import { buildNote } from "./notes";
import { freePath, noteName, readableName } from "./names";
import { losesNote, normalizeRetire, planNames, plural, selectTasks, stripOrganized, type RetireOptions, type RetireScan } from "./retire";

export interface Change { file: TFile; before: string; after: string }
export interface Context { file: TFile; line: TaskLine }
/** Adds nested lines under one todo, indented to sit inside its list item. */
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
    const matches = parseTasks(text).filter(t => context.line.id ? t.id === context.line.id : t.line === context.line.line && t.raw === context.line.raw);
    const line = matches.find(t => t.line === context.line.line && t.raw === context.line.raw) ?? (matches.length === 1 && matches[0].raw === context.line.raw ? matches[0] : null);
    if (!line) throw new Error("Task context changed; select the line again and retry.");
    return { text, line };
  }
  async attach(context: Context, task: Task, duplicate = false): Promise<Context> {
    const { text, line } = await this.resolve(context);
    if (line.id && !duplicate) throw new Error("This task is already linked. Use duplicate as new task for independent copies.");
    await this.edit(context.file, text, replaceTask(text, line, { title: task.title, id: task.id, repeat: false }));
    const fresh = parseTasks(await this.repo.readText(context.file)).find(t => t.line === line.line)!;
    this.changed(); return { file: context.file, line: fresh };
  }
  async clean(context: Context, marker = " "): Promise<void> {
    const { text, line } = await this.resolve(context); await this.edit(context.file, text, replaceTask(text, line, { marker }));
  }
  async insert(file: TFile, task: Task, marker: string, repeat: boolean, changes?: Change[]): Promise<void> {
    const text = await this.repo.readText(file);
    if (parseTasks(text).some(t => t.id === task.id)) return;
    const line = `- [${marker}] ${task.title} <!--organized:${task.id}-->${repeat ? " <!--organized:repeat-->" : ""}`;
    const result = insertTask(text, line, task.daily_note_section_path);
    if (result.missing && this.repo.settings().missingSection === "ask" && !(await this.confirm(`The heading path is missing in ${file.path}. Recreate it?`))) throw new Error("Insertion canceled; no task occurrence was written.");
    await this.edit(file, text, result.text, changes);
  }
  async schedule(context: Context, date: string, kind: Movement["kind"] = "schedule", source: Movement["source"] = "manual", changes: Change[] = []): Promise<void> {
    const { line } = await this.resolve(context); if (!line.id) throw new Error("Attach the task first.");
    const task = await this.repo.read(line.id); const oldDate = task.scheduled;
    const target = await this.daily.ensure(date);
    const from = this.daily.date(context.file.path) ?? context.file.path;
    const event: Movement = { id: makeId(), kind: kind === "schedule" && oldDate && oldDate !== date ? "reschedule" : kind, source, from, to: date, at: new Date().toISOString() };
    const taskFile = await this.repo.resolve(task.id); const beforeTask = await this.repo.readText(taskFile);
    const next = await this.repo.update(task.id, current => ({ ...current, scheduled: date, daily_note_section_path: line.section,
      movement_history: current.scheduled === date ? current.movement_history : [...current.movement_history, event] }));
    changes.push({ file: taskFile, before: beforeTask, after: await this.repo.readText(taskFile) });
    await this.insert(target, next, task.time_tracking_started_at && kind === "forward" ? "/" : " ", false, changes);
    if (target.path !== context.file.path) {
      const current = await this.resolve(context);
      await this.edit(context.file, current.text, replaceTask(current.text, current.line, { marker: kind === "forward" ? (this.daily.date(context.file.path) ? ">" : " ") : "<" }), changes);
      await this.resortAfter(context.file, next, changes);
    }
    if (oldDate && oldDate !== date && kind !== "forward") {
      await this.cleanupSchedule(task.id, oldDate, context.file.path, changes);
    }
    this.changed();
  }
  async scheduleTask(id: string, date: string, context?: Context): Promise<void> {
    if (context?.line.id === id) { await this.schedule(context, date); return; }
    const task = await this.repo.read(id); const target = await this.daily.ensure(date);
    const event: Movement = { id: makeId(), kind: task.scheduled && task.scheduled !== date ? "reschedule" : "schedule", source: "manual", from: this.repo.taskPath(id), to: date, at: new Date().toISOString() };
    const next = await this.repo.update(id, t => ({ ...t, scheduled: date, movement_history: t.scheduled === date ? t.movement_history : [...t.movement_history, event] }));
    await this.insert(target, next, " ", false);
    if (task.scheduled && task.scheduled !== date) {
      await this.cleanupSchedule(id, task.scheduled);
    }
    this.changed();
  }
  private async cleanupSchedule(id: string, oldDate: string, originPath?: string, changes?: Change[]): Promise<void> {
    if (this.daily.path(oldDate) === originPath) return;
    try {
      // Explicit rescheduling is allowed to search by stable ID. Configuration
      // changes never turn undated references into guessed old destinations.
      const candidates = (await this.repo.occurrences(id)).filter(o => o.file.path !== originPath && this.daily.date(o.file.path) === oldDate);
      if (candidates.length !== 1 || candidates[0].tasks.length !== 1 || candidates[0].tasks[0].marker !== " " || candidates[0].tasks[0].repeat) throw new Error("Missing or ambiguous previous destination.");
      const old = candidates[0]; await this.edit(old.file, old.text, removeUnique(old.text, id), changes);
    } catch { new Notice("Previous scheduled occurrence is missing, ambiguous or changed. Preserved existing lines; use the references list to repair."); }
  }
  private isProjectFile(file: TFile): boolean { return this.repo.isProjectNote(file) || file.path.startsWith(`${this.repo.projectFolder()}/`); }
  async status(id: string, status: Status, context?: Context): Promise<void> {
    const task = await this.repo.update(id, t => setStatus(t, status));
    const marker = task.status === "completed" ? "x" : task.status === "canceled" ? "-" : task.time_tracking_started_at ? "/" : " ";
    const today = localDate();
    for (const occurrence of await this.repo.occurrences(id)) {
      const date = this.daily.date(occurrence.file.path);
      if (date && date < today) continue;
      if (task.recurring && date && (!context || occurrence.file.path !== context.file.path)) continue;
      let after = occurrence.text;
      for (const line of occurrence.tasks) {
        const occurrenceMarker = task.recurring && date ? (status === "completed" ? "x" : status === "canceled" ? "-" : status === "in_progress" ? "/" : " ") : marker;
        after = replaceTask(after, line, { marker: occurrenceMarker });
      }
      // In a project note the line also moves to the heading for the new status.
      if (occurrence.tasks.length === 1 && this.isProjectFile(occurrence.file)) after = moveTask(after, id, projectSection(task));
      await this.edit(occurrence.file, occurrence.text, after);
      if (!this.isProjectFile(occurrence.file)) await this.resortAfter(occurrence.file, task);
    }
    this.changed();
  }
  async title(id: string, title: string): Promise<void> {
    if (!title.trim() || /[\r\n]/.test(title)) throw new Error("Use a nonempty, single-line title.");
    await this.repo.update(id, t => ({ ...t, title: title.trim() }));
    for (const occurrence of await this.repo.occurrences(id)) {
      if (occurrence.tasks.length > 1) { new Notice(`Multiple occurrences in ${occurrence.file.path}; preserved for repair.`); continue; }
      await this.edit(occurrence.file, occurrence.text, replaceTask(occurrence.text, occurrence.tasks[0], { title: title.trim() }));
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
    try { await this.repo.renameNote(file, target); } catch { /* The old name stays; the next title edit tries again. */ }
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
  async recurrence(id: string, context?: Context): Promise<void> {
    const today = localDate(); const changes: Change[] = []; const skipped: string[] = [];
    const file = await this.repo.resolve(id); const before = await this.repo.readText(file);
    const task = await this.repo.update(id, t => {
      const periods = t.recurrence_periods.map(p => ({ ...p }));
      if (t.recurring) { const last = [...periods].reverse().find(p => p.stop === null); if (last) last.stop = today; }
      else periods.push({ start: today, stop: null });
      return { ...t, status: "open", recurring: !t.recurring, recurrence_periods: periods, daily_note_section_path: context?.line.section ?? t.daily_note_section_path };
    });
    changes.push({ file, before, after: await this.repo.readText(file) });
    // In a project note the line moves between Ongoing and its status heading.
    for (const notePath of task.projects) {
      const project = this.repo.file(notePath); if (!project) continue;
      try { const text = await this.repo.readText(project); await this.edit(project, text, moveTask(text, id, projectSection(task)), changes); } catch { skipped.push(project.path); }
    }
    for (const daily of this.daily.files().filter(d => d.date >= today)) {
      try {
        if (task.recurring) await this.insert(daily.file, task, " ", true, changes);
        else if (daily.date > today) {
          const text = await this.repo.readText(daily.file); const matches = parseTasks(text).filter(t => t.id === id && t.repeat);
          if (matches.length === 1) await this.edit(daily.file, text, removeUnique(text, id, true), changes);
          else if (matches.length > 1) skipped.push(daily.file.path);
        }
      } catch { skipped.push(daily.file.path); }
    }
    if (context) {
      try { const fresh = await this.resolve(context); await this.edit(context.file, fresh.text, replaceTask(fresh.text, fresh.line, { marker: " " }), changes); }
      catch { skipped.push(context.file.path); }
    }
    const skippedPaths = [...new Set(skipped)];
    this.summarize(changes, task.recurring ? "Recurrence enabled" : "Recurrence disabled", skippedPaths.length ? `Skipped/preserved for repair: ${skippedPaths.join(", ")}` : "");
  }
  async onDailyCreated(file: TFile): Promise<void> {
    const date = this.daily.date(file.path); if (!date || date < localDate()) return;
    for (const task of (await this.repo.list()).filter(t => t.recurring)) await this.insert(file, task, " ", true);
    this.changed();
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
        if (task.recurring || ["completed", "canceled"].includes(task.status) || (task.scheduled && task.scheduled > today)) continue;
        await this.schedule({ file: occurrence.file, line: occurrence.line }, today, "forward", "automatic", changes);
      } catch { skipped++; }
    }
    this.reconciled = today;
    if (changes.length || skipped) this.summarize(changes, "Unfinished tasks carried to today", skipped ? `${skipped} conflict${skipped === 1 ? "" : "s"} skipped · previous line preserved.` : "");
  }
  private async cleanupExpiredTasks(days: number, now: number): Promise<void> {
    const detail = this.repo.settings().retentionDetail; let removed = 0; const failed: string[] = [];
    for (const task of await this.repo.list()) {
      if (task.recurring || !["completed", "canceled"].includes(task.status) || !task.closed_at || now - Date.parse(task.closed_at) < days * 86400000) continue;
      try {
        const taskFile = this.repo.taskFile(task.id);
        if (!taskFile) throw new Error(`Task note missing for ${task.id}`);
        const occurrences = await this.repo.occurrences(task.id);
        // What the user chose to keep goes under one occurrence only (the latest daily note), so forwarded copies are not repeated.
        const keep = detail === "title" ? [] : retiredLines(task, splitNote(await this.repo.readText(taskFile)).body, detail, "");
        const target = keep.length ? occurrences.reduce((best, item) => (this.daily.date(item.file.path) ?? "") >= (this.daily.date(best.file.path) ?? "") ? item : best) : null;
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
        await this.repo.trashNote(taskFile); removed++;
      } catch { failed.push(task.title); }
    }
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
      await this.insert(file, { ...task, daily_note_section_path: section }, task.status === "completed" ? "x" : task.status === "canceled" ? "-" : task.time_tracking_started_at ? "/" : " ", false);
    }
    for (const removed of task.projects.filter(p => !projects.includes(p))) {
      const file = this.repo.file(removed);
      if (file) { const text = await this.repo.readText(file); try { await this.edit(file, text, removeUnique(text, id)); } catch { new Notice(`Could not safely unlink ${removed}; occurrence preserved for repair.`); } }
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
  async setProjectColor(notePath: string, color: string | null): Promise<void> {
    const file = this.repo.file(notePath); if (!file) throw new Error("The project note was renamed or removed.");
    await this.repo.setProjectColor(file, color); this.changed();
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
    await this.edit(file, text, lines.join("\n"));
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
      const note = this.repo.taskFile(task.id); if (note && (o.yaml === "strip" || task.time_tracking_started_at)) saved.set(note.path, await this.repo.readText(note));
    }
    const backupPath = await backup([...saved].map(([path, before]) => ({ path, before })), { renames: [...names].map(([id, to]) => ({ from: this.repo.taskPath(id), to })) });
    const changes: Change[] = []; const renames: { file: TFile; from: string }[] = []; const failed: string[] = [];
    let renamed = 0, stripped = 0, trashed = 0, done = 0, todos = 0;
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
          if (o.yaml === "strip") { const text = await this.repo.readText(note); await this.edit(note, text, stripOrganized(text), changes); stripped++; }
          if (o.notes === "trash") { await this.repo.trashNote(note); trashed++; }
          if (from !== null) { renames.push({ file: note, from }); renamed++; }
          done++;
        } catch {
          failed.push(listed.title);
          // Put the name back so the task is found again by its id; the todos it did not reach keep their ids.
          if (from !== null && note && note.path !== from) { try { await this.repo.renameNote(note, from); } catch { /* The report below names the task. */ } }
        }
      }
    } finally { progress.hide(); }
    this.references = null;
    const failedNames = failed.slice(0, 3).join(", ");
    const detail = `${done} of ${plural(chosen.length, "task")} retired · ${plural(todos, "todo")} unlinked${renamed ? ` · ${renamed} renamed` : ""}${stripped ? ` · ${stripped} stripped` : ""}${trashed ? ` · ${trashed} moved to Obsidian's trash` : ""}${failed.length ? ` · ${failed.length} left unchanged (${failedNames})` : ""}. Old text saved in note-backups (${backupPath.split("/").pop()}).`;
    if (trashed) { this.undoChanges = []; this.undoRenames = []; new Notice(`${detail} Trashed task notes can be restored from Obsidian's trash; Undo is not offered because it would relink todos to them.`, 20000); this.changed(); }
    else this.summarize(changes, "Tasks retired", detail, renames);
  }
  /** A note a task became was renamed or moved: the task keeps pointing at it, so the calendar still opens the right note. */
  async followRename(oldPath: string, newPath: string): Promise<void> {
    if (!newPath.endsWith(".md")) return;
    for (const id of this.repo.convertedTo(oldPath)) await this.repo.update(id, task => ({ ...task, converted_to: newPath }));
  }
  async deleteTask(id: string, onConfirmed?: () => void): Promise<boolean> {
    // The inspector must clear its now-invalid selection before occurrence or
    // trash events can trigger a refresh, so the confirmed hook runs first.
    const task = await this.repo.read(id);
    if (!(await this.confirm(`Delete “${task.title}”? Its task note moves to Obsidian's trash and every linked occurrence is removed. This cannot be undone from Organized.`, "Delete task", "Delete"))) return false;
    onConfirmed?.();
    for (const occurrence of await this.repo.occurrences(id)) {
      const removed = new Set(occurrence.tasks.map(line => line.line));
      const text = occurrence.text.split("\n").filter((_, index) => !removed.has(index)).join("\n");
      await this.edit(occurrence.file, occurrence.text, text);
    }
    const file = await this.repo.resolve(id, "deleting");
    await this.repo.trashNote(file);
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
      await this.edit(occurrence.file, occurrence.text, lines.filter((_line, index) => !ours.has(index) || index === first?.line).join("\n"));
    }
    // A running timer is stopped and logged first. Tracked time keeps its task note (hidden from lists) so the calendar still shows it.
    const stopped = setStatus(task, task.status === "in_progress" ? "open" : task.status);
    if (stopped.work_sessions.length) await this.repo.update(task.id, () => ({ ...stopped, converted_to: note.path }));
    else await this.repo.trashNote(taskFile);
    this.references = null; this.changed();
    return note;
  }
  async marker(context: Context, marker: string): Promise<void> {
    const id = context.line.id; if (!id) return;
    if (marker === ">") await this.schedule(context, nextDate(localDate()), "forward");
    else if ([" ", "x", "X", "/", "-"].includes(marker)) await this.status(id, marker === "x" || marker === "X" ? "completed" : marker === "/" ? "in_progress" : marker === "-" ? "canceled" : "open", context);
    else if (marker === "*") { await this.repo.update(id, t => ({ ...t, starred: !t.starred })); this.changed(); }
    else if (marker === RECURRING_MARKER) await this.recurrence(id, context);
  }
}
export function report(error: unknown): void { new Notice(`Organized: ${error instanceof Error ? error.message : String(error)}`, 10000); }
export function byPriority(tasks: Task[]): Task[] { return [...tasks].sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)); }
