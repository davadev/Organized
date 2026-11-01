import { Notice, TFile } from "obsidian";
import { insertTask, parseTasks, removeUnique, replaceTask, sortTasks, TaskLine, taskText } from "./codec";
import { DailyNotes } from "./daily";
import { localDate, makeId, Movement, nextDate, PRIORITIES, Priority, setStatus, Status, Task } from "./model";
import { Repository } from "./repository";

export interface Change { file: TFile; before: string; after: string }
export interface Context { file: TFile; line: TaskLine }
export class TaskService {
  readonly daily: DailyNotes;
  private references: Map<string, Set<string>> | null = null;
  private referenceBuild: Promise<void> | null = null;
  private reconciled = "";
  private retentionReconciled = "";
  undoChanges: Change[] = [];
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
      this.undoChanges = []; this.changed();
      new Notice(failures.length ? `Undo preserved concurrent edits in: ${failures.join(", ")}` : "Organized changes undone. Created notes are preserved.");
    });
  }
  summarize(changes: Change[], title: string, detail = ""): void {
    this.undoChanges = changes;
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
    const taskFile = this.repo.file(this.repo.taskPath(task.id))!; const beforeTask = await this.repo.readText(taskFile);
    const next = await this.repo.update(task.id, current => ({ ...current, scheduled: date, daily_note_section_path: line.section,
      movement_history: current.scheduled === date ? current.movement_history : [...current.movement_history, event] }));
    changes.push({ file: taskFile, before: beforeTask, after: await this.repo.readText(taskFile) });
    await this.insert(target, next, task.time_tracking_started_at && kind === "forward" ? "/" : " ", false, changes);
    if (target.path !== context.file.path) {
      const current = await this.resolve(context);
      await this.edit(context.file, current.text, replaceTask(current.text, current.line, { marker: kind === "forward" ? (this.daily.date(context.file.path) ? ">" : " ") : "<" }), changes);
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
      await this.edit(occurrence.file, occurrence.text, after);
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
    this.changed();
  }
  async priority(context: Context, priority: Priority): Promise<void> {
    const { line } = await this.resolve(context); if (!line.id) throw new Error("Attach the task first.");
    await this.repo.update(line.id, t => ({ ...t, priority })); await this.clean(context);
    const text = await this.repo.readText(context.file);
    const priorities = new Map((await this.repo.list()).map(t => [t.id, t.priority]));
    await this.edit(context.file, text, sortTasks(text, line.line, this.repo.settings().sortScope, priorities)); this.changed();
  }
  async recurrence(id: string, context?: Context): Promise<void> {
    const today = localDate(); const changes: Change[] = []; const skipped: string[] = [];
    const file = this.repo.file(this.repo.taskPath(id))!; const before = await this.repo.readText(file);
    const task = await this.repo.update(id, t => {
      const periods = t.recurrence_periods.map(p => ({ ...p }));
      if (t.recurring) { const last = [...periods].reverse().find(p => p.stop === null); if (last) last.stop = today; }
      else periods.push({ start: today, stop: null });
      return { ...t, status: "open", recurring: !t.recurring, recurrence_periods: periods, daily_note_section_path: context?.line.section ?? t.daily_note_section_path };
    });
    changes.push({ file, before, after: await this.repo.readText(file) });
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
       // The [f] marker is a recurrence instruction, not an unfinished task to carry forward.
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
    let removed = 0; const failed: string[] = [];
    for (const task of await this.repo.list()) {
      if (task.recurring || !["completed", "canceled"].includes(task.status) || !task.closed_at || now - Date.parse(task.closed_at) < days * 86400000) continue;
      try {
        const occurrences = await this.repo.occurrences(task.id);
        for (const occurrence of occurrences) {
          let after = occurrence.text;
          for (const line of [...occurrence.tasks].sort((a, b) => b.line - a.line)) {
            const current = parseTasks(after).find(item => item.line === line.line);
            if (!current || current.id !== task.id || current.raw !== line.raw) throw new Error(`Changed occurrence in ${occurrence.file.path}`);
            after = replaceTask(after, current, { id: null, repeat: false });
          }
          await this.edit(occurrence.file, occurrence.text, after);
        }
        const taskFile = this.repo.file(this.repo.taskPath(task.id));
        if (!taskFile) throw new Error(`Task note missing for ${task.id}`);
        await this.repo.app.fileManager.trashFile(taskFile); removed++;
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
      const file = await this.repo.ensure(notePath);
      await this.insert(file, { ...task, daily_note_section_path: [] }, task.status === "completed" ? "x" : task.status === "canceled" ? "-" : task.time_tracking_started_at ? "/" : " ", false);
    }
    for (const removed of task.projects.filter(p => !projects.includes(p))) {
      const file = this.repo.file(removed);
      if (file) { const text = await this.repo.readText(file); try { await this.edit(file, text, removeUnique(text, id)); } catch { new Notice(`Could not safely unlink ${removed}; occurrence preserved for repair.`); } }
    }
    await this.repo.update(id, t => ({ ...t, projects })); this.changed();
  }
  async refs(id: string): Promise<string[]> {
    if (!this.references) {
      this.references = new Map();
      this.referenceBuild = (async () => { for (const file of this.repo.app.vault.getMarkdownFiles()) await this.index(file); })();
    }
    await this.referenceBuild; const task = await this.repo.read(id); const today = localDate();
    return [...(this.references.get(id) ?? [])].filter(p => this.repo.file(p) && (!task.recurring || !this.daily.date(p) || this.daily.date(p) === today))
      .sort((a, b) => Number(this.daily.date(b) === today) - Number(this.daily.date(a) === today) || a.localeCompare(b));
  }
  async index(file: TFile): Promise<void> {
    if (!this.references) return;
    this.forget(file.path);
    for (const task of parseTasks(await this.repo.readText(file))) if (task.id) {
      const refs = this.references.get(task.id) ?? new Set<string>(); refs.add(file.path); this.references.set(task.id, refs);
    }
  }
  hasReference(id: string | null, notePath: string): boolean { return id !== null && this.references?.get(id)?.has(notePath) === true; }
  forget(notePath: string): void { if (this.references) for (const refs of this.references.values()) refs.delete(notePath); }
  async convertTodos(file: TFile): Promise<void> {
    if (file.path.startsWith(`${this.repo.settings().taskFolder}/`)) throw new Error("Choose a regular note, not a task note.");
    const text = await this.repo.readText(file);
    const todos = parseTasks(text).filter(t => !t.id && t.marker === " " && t.title);
    if (!todos.length) { new Notice("No unchecked todos to convert in this note."); return; }
    const count = `${todos.length} unchecked todo${todos.length === 1 ? "" : "s"}`;
    if (!(await this.confirm(`Convert ${count} in ${file.path} into Organized tasks?`, "Convert todos", "Convert"))) return;
    const lines = text.split("\n");
    for (const todo of todos) {
      const task = await this.repo.create(todo.title);
      lines[todo.line] = taskText(todo, { id: task.id, repeat: false });
    }
    await this.edit(file, text, lines.join("\n"));
    this.changed(); new Notice(`Converted ${count} into Organized tasks.`);
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
    const file = this.repo.file(this.repo.taskPath(id)); if (!file) throw new Error("Task note is missing; relink or repair before deleting.");
    await this.repo.app.fileManager.trashFile(file);
    this.references = null; return true;
  }
  async marker(context: Context, marker: string): Promise<void> {
    const id = context.line.id; if (!id) return;
    if (marker === ">") await this.schedule(context, nextDate(localDate()), "forward");
    else if ([" ", "x", "X", "/", "-"].includes(marker)) await this.status(id, marker === "x" || marker === "X" ? "completed" : marker === "/" ? "in_progress" : marker === "-" ? "canceled" : "open", context);
    else if (marker === "*") { await this.repo.update(id, t => ({ ...t, starred: !t.starred })); this.changed(); }
    else if (marker === "f") await this.recurrence(id, context);
  }
}
export function report(error: unknown): void { new Notice(`Organized: ${error instanceof Error ? error.message : String(error)}`, 10000); }
export function byPriority(tasks: Task[]): Task[] { return [...tasks].sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)); }
