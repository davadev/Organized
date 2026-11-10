import { inBatches } from "./batches";
import { App, Editor, normalizePath, TFile, parseYaml, stringifyYaml } from "obsidian";
import { validColor } from "./colors";
import { localDate, makeId, newTask, object, OPTIONAL_KEYS, path, Task, taskFrom, Settings, validDate, validId } from "./model";
import { freePath, readableName } from "./names";
import { parseTasks, PROJECT_ONGOING, PROJECT_SECTIONS, TaskLine } from "./codec";

export function splitNote(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  return match ? { frontmatter: object(parseYaml(match[1])), body: text.slice(match[0].length) } : { frontmatter: {}, body: text };
}
/** Frontmatter that marks a note as a project note; the picker lists only these. */
export const PROJECT_KEY = "organized_type";
/** Optional `#rrggbb` colour of a project note, shown on its tasks in the side panel and the calendar. */
export const COLOR_KEY = "organized_color";
/** A project note's name for display: the file name without folders or `.md`; the path (without `.md`) only when another listed project shares that name. */
export function projectName(notePath: string, among: readonly string[] = []): string {
  const name = (value: string) => value.replace(/^.*\//, "").replace(/\.md$/i, "");
  return among.filter(other => other !== notePath && name(other).toLowerCase() === name(notePath).toLowerCase()).length ? notePath.replace(/\.md$/i, "") : name(notePath);
}
/** Optional time budgets of a project note, in hours: one for the whole project and one each per day, week and month. */
export const BUDGET_KEYS = { total: "organized_budget", day: "organized_budget_daily", week: "organized_budget_weekly", month: "organized_budget_monthly" } as const;
export type BudgetPeriod = keyof typeof BUDGET_KEYS;
/** A project's budgets in seconds; a period without one is null. */
export type ProjectBudgets = Record<BudgetPeriod, number | null>;
/** The longest project budget, in hours. */
export const MAX_BUDGET_HOURS = 9999;
/** Hours as written in a note (a number above zero and within the limit) as whole seconds; anything else is no budget. */
export const budgetSeconds = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_BUDGET_HOURS ? Math.max(1, Math.round(value * 3600)) : null;
/** Seconds as the hours a note stores (up to 4 decimals, so even a budget of a few seconds survives the round trip). */
export const budgetHours = (seconds: number): number => Math.round(seconds / 3600 * 10000) / 10000;
/** The day a project started, `YYYY-MM-DD`. Set automatically; an `organized_end` date is reserved for later and not used yet. */
export const START_KEY = "organized_start";
/** A start date as stored: `YYYY-MM-DD` text, or a Date when a YAML reader turned the bare date into one. */
const isEmpty = (value: unknown): boolean => value === null || (Array.isArray(value) && !value.length);
/** A task as written to its note: without the optional properties that hold nothing. */
const withoutEmptyOptional = (task: Task): Record<string, unknown> => Object.fromEntries(Object.entries(task).filter(([key, value]) => !((OPTIONAL_KEYS as readonly string[]).includes(key) && isEmpty(value))));
const hasStart = (value: unknown): boolean => validDate(value) || (value instanceof Date && Number.isFinite(value.getTime()));
/** A new project note: frontmatter marking it, dating its start, and one heading per status that linked tasks move between. */
export function projectTemplate(today = localDate()): string {
  return `---\n${PROJECT_KEY}: project\n${START_KEY}: ${today}\n---\n\n## ${PROJECT_SECTIONS.open}\n\n## ${PROJECT_SECTIONS.in_progress}\n\n## ${PROJECT_ONGOING}\n\n## ${PROJECT_SECTIONS.completed}\n`;
}
export class Repository {
  private tail: Promise<unknown> = Promise.resolve();
  /** Told which task notes are left out of the list: copies that share an id, and notes with an id that cannot be read as a task. */
  onSkipped: ((copies: string[], broken: string[]) => void) | null = null;
  constructor(readonly app: App, readonly settings: () => Settings, readonly activeEditor: () => { file: TFile; editor: Editor } | null) {}
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(fn); this.tail = next; return next;
  }
  file(notePath: string): TFile | null { const file = this.app.vault.getAbstractFileByPath(notePath); return file instanceof TFile ? file : null; }
  /** Project notes live in a subfolder of the task folder; they are ordinary notes, not task records. */
  projectFolder(): string { return path(`${this.settings().taskFolder}/Projects`); }
  isTaskRecord(notePath: string): boolean { return notePath.startsWith(`${this.settings().taskFolder}/`) && !notePath.startsWith(`${this.projectFolder()}/`); }
  /** The name an id-named task note has (and the fallback when a title cannot be used as a file name); notes are otherwise named after their todo's title. */
  taskPath(id: string): string { return path(`${this.settings().taskFolder}/${id}.md`); }
  // The identity of a task note is the `id` in its frontmatter, not its file name. These maps are the id -> file lookup, kept up to date by
  // `create`, `list`, `reindex` and the vault events (see `track`, `moved`, `forgetPath`); the metadata cache is never trusted for it because it lags.
  private byId = new Map<string, Set<string>>();
  private idOfPath = new Map<string, string>();
  private indexedAt = 0;
  private reindexing: Promise<void> | null = null;
  /** Paths linked or unlinked while a rebuild was reading the notes; what happened meanwhile wins over what the rebuild read. */
  private touched: Set<string> | null = null;
  private static add(byId: Map<string, Set<string>>, idOfPath: Map<string, string>, notePath: string, id: string): void {
    Repository.remove(byId, idOfPath, notePath); idOfPath.set(notePath, id); const paths = byId.get(id) ?? new Set<string>(); paths.add(notePath); byId.set(id, paths);
  }
  private static remove(byId: Map<string, Set<string>>, idOfPath: Map<string, string>, notePath: string): void {
    const id = idOfPath.get(notePath); if (id === undefined) return;
    idOfPath.delete(notePath); const paths = byId.get(id); paths?.delete(notePath); if (paths?.size === 0) byId.delete(id);
  }
  /** Parsed properties of task notes by path, valid while the note's modified time and size are unchanged; a note this plugin writes, or a modify, rename or delete event, drops its entry. */
  private parsed = new Map<string, { stamp: string; frontmatter: Record<string, unknown> }>();
  /** The properties of a task note. The text is read and parsed only when the note changed since last time, so redrawing the panel does not read the whole task folder again. */
  async properties(file: TFile): Promise<Record<string, unknown>> {
    // Unsaved text in the editor is newer than the disk, so it is never cached.
    if (this.activeEditor()?.file.path === file.path) return splitNote(await this.readText(file)).frontmatter;
    // The stamp is taken before reading: a change during the read leaves a stamp that no longer matches, so the next call reads again.
    const stamp = `${file.stat.mtime}:${file.stat.size}`; const hit = this.parsed.get(file.path);
    if (hit?.stamp === stamp) return hit.frontmatter;
    const frontmatter = splitNote(await this.readText(file)).frontmatter; this.parsed.set(file.path, { stamp, frontmatter }); return frontmatter;
  }
  private link(notePath: string, id: string): void { if (this.idOfPath.get(notePath) !== id) this.names = null; this.touched?.add(notePath); Repository.add(this.byId, this.idOfPath, notePath, id); }
  private unlink(notePath: string): void { this.names = null; this.parsed.delete(notePath); this.touched?.add(notePath); Repository.remove(this.byId, this.idOfPath, notePath); }
  /** The id a note claims: its frontmatter `id` when that is a valid id, otherwise its file name (an invalid note then fails `taskFrom`, as before). */
  idOf(file: TFile, frontmatter: Record<string, unknown>): string { return validId(frontmatter.id) ? frontmatter.id : file.basename; }
  /** Rebuilds the id -> file lookup from the notes' own text. The old lookup stays usable until the new one is ready, so nothing is "missing" meanwhile. */
  reindex(): Promise<void> {
    this.reindexing ??= this.rebuild().finally(() => { this.reindexing = null; });
    return this.reindexing;
  }
  private async rebuild(): Promise<void> {
    const byId = new Map<string, Set<string>>(); const idOfPath = new Map<string, string>(); const touched = new Set<string>(); this.touched = touched; this.indexedAt = Date.now();
    try {
      const files = this.app.vault.getMarkdownFiles().filter(file => this.isTaskRecord(file.path));
      // An unreadable note claims nothing.
      const ids = await inBatches(files, async file => { try { return this.idOf(file, await this.properties(file)); } catch { return null; } });
      files.forEach((file, i) => { const id = ids[i]; if (id !== null) Repository.add(byId, idOfPath, file.path, id); });
      for (const notePath of touched) { Repository.remove(byId, idOfPath, notePath); const id = this.idOfPath.get(notePath); if (id !== undefined) Repository.add(byId, idOfPath, notePath, id); }
      this.byId = byId; this.idOfPath = idOfPath; this.names = null;
    } finally { this.touched = null; }
  }
  /** What one level of list indentation is in this vault: a tab or the configured number of spaces, as Obsidian's own Tab key writes it (a tab when the setting is absent, which is its default). */
  async indentUnit(): Promise<string> {
    try {
      const settings = object(JSON.parse(await this.app.vault.adapter.read(normalizePath(`${this.app.vault.configDir}/app.json`))));
      return settings.useTab === false ? " ".repeat(Number.isInteger(settings.tabSize) && Number(settings.tabSize) > 0 ? Number(settings.tabSize) : 4) : "\t";
    } catch { return "\t"; }
  }
  /** Task note paths by lower-case file name, built when a link is resolved and dropped whenever a note is linked, unlinked or swapped in. */
  private names: Map<string, string[]> | null = null;
  /** The link a parent's `subtasks` list holds for a task note: its file name, which is unique across the vault. */
  linkOf(file: TFile): string { return `[[${file.basename}]]`; }
  /** The task note a `[[Name]]` link points at; null when there is none (a stale link) or when two notes share the name. */
  fileOfLink(link: string): TFile | null {
    if (!this.names) { this.names = new Map(); for (const notePath of this.idOfPath.keys()) { const name = notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/i, "").toLowerCase(); this.names.set(name, [...(this.names.get(name) ?? []), notePath]); } }
    const paths = this.names.get(link.slice(2, -2).toLowerCase()); return paths?.length === 1 ? this.file(paths[0]) : null;
  }
  /** The subtasks of a task that can still be found, in the order of its list. Recurring tasks are never subtasks. */
  async subtasksOf(task: Task): Promise<Task[]> {
    const found: Task[] = [];
    for (const link of task.subtasks) {
      const file = this.fileOfLink(link); if (!file) continue;
      try { const properties = await this.properties(file); const child = taskFrom(properties, this.idOf(file, properties)); if (!child.recurring && !found.some(t => t.id === child.id)) found.push(child); } catch { /* A note that is not a valid task is not a subtask. */ }
    }
    return found;
  }
  /** How many of a task's subtasks are done out of those still counted (canceled ones are left out); null when there are none. */
  async progress(task: Task): Promise<{ done: number; total: number } | null> {
    const counted = (await this.subtasksOf(task)).filter(t => t.status !== "canceled");
    return counted.length ? { done: counted.filter(t => t.status === "completed").length, total: counted.length } : null;
  }
  /** The task this one is a subtask of, if any task's list links to its note. */
  async parentOf(id: string): Promise<Task | null> {
    const file = this.taskFile(id); if (!file) return null;
    return (await this.list()).find(t => t.subtasks.some(link => this.fileOfLink(link) === file)) ?? null;
  }
  /** Learns what one task note claims (after it was created, changed or synced in). */
  async track(file: TFile): Promise<void> {
    if (!this.isTaskRecord(file.path)) return;
    this.parsed.delete(file.path);
    try { this.link(file.path, this.idOf(file, await this.properties(file))); } catch { this.unlink(file.path); }
  }
  /** A note was renamed or moved: it keeps its id at the new path, and stops being a task note when it left the task folder. */
  moved(oldPath: string, file: TFile): void {
    const id = this.idOfPath.get(oldPath); this.unlink(oldPath); if (id !== undefined && this.isTaskRecord(file.path)) this.link(file.path, id);
  }
  forgetPath(notePath: string): void { this.unlink(notePath); }
  /** Renames a note through Obsidian (which keeps links to it working) and keeps the id lookup in step. */
  async renameNote(file: TFile, to: string): Promise<void> { const from = file.path; await this.app.fileManager.renameFile(file, to); this.moved(from, file); }
  async trashNote(file: TFile): Promise<void> { await this.app.fileManager.trashFile(file); this.forgetPath(file.path); }
  /** Every existing note that claims the id (more than one means a copy: the id is then ambiguous). Falls back to the id-named note for a lookup made before the first index. */
  private claimants(id: string): TFile[] {
    const indexed = [...(this.byId.get(id) ?? [])].flatMap(p => { const file = this.file(p); return file ? [file] : []; });
    if (indexed.length) return indexed;
    const legacy = this.file(this.taskPath(id)); return legacy ? [legacy] : [];
  }
  /** The task note of an id, or null when there is none or when two notes claim it. */
  taskFile(id: string): TFile | null { const found = this.claimants(id); return found.length === 1 ? found[0] : null; }
  /** Where the task note is, for resolving links written in its title; the id-named path when it cannot be found. */
  sourcePath(id: string): string { return this.taskFile(id)?.path ?? this.taskPath(id); }
  /** Every note claiming the id; looks once more at the notes' text when none is known yet (a note synced in, or a lookup before the first index). */
  private async lookup(id: string): Promise<TFile[]> {
    const found = this.claimants(id); if (found.length) return found;
    // A rebuild that is already running knows about notes this lookup cannot see yet: wait for it instead of reporting the task missing.
    if (this.reindexing) await this.reindexing; else if (Date.now() - this.indexedAt > 2000) await this.reindex();
    return this.claimants(id);
  }
  private ambiguous(id: string, found: TFile[]): Error { return new Error(`Two notes claim task ${id}: ${found.map(f => f.path).join(", ")}. Delete or change the id of one; neither was touched.`); }
  /** The task note of an id; says why when it cannot answer (missing, or claimed by two notes). */
  async resolve(id: string, action = "editing"): Promise<TFile> {
    const found = await this.lookup(id);
    if (found.length > 1) throw this.ambiguous(id, found);
    if (!found.length) throw new Error(`Task note is missing; relink or repair before ${action}.`);
    return found[0];
  }
  /** Whether a task note exists for the id; a note claimed twice is an error, not a "no". */
  async exists(id: string): Promise<boolean> {
    const found = await this.lookup(id); if (found.length > 1) throw this.ambiguous(id, found);
    return found.length === 1;
  }
  /** Whether a candidate task-note path is free: no other note in the vault, anywhere, has the same file name (any case), so `[[Name]]` stays unambiguous. */
  nameTaken(except: TFile | null = null): (candidate: string) => boolean {
    const names = new Set(this.app.vault.getMarkdownFiles().filter(f => f !== except).map(f => f.basename.toLowerCase()));
    return candidate => names.has(candidate.slice(candidate.lastIndexOf("/") + 1).replace(/\.md$/i, "").toLowerCase());
  }
  async readText(file: TFile): Promise<string> {
    const active = this.activeEditor(); return active?.file.path === file.path ? active.editor.getValue() : this.app.vault.read(file);
  }
  async folders(notePath: string): Promise<void> {
    const parts = notePath.split("/"); parts.pop(); let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); } catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
  }
  /** Project notes by frontmatter, answered from Obsidian's metadata cache so the picker reads no files. */
  isProjectNote(file: TFile): boolean { return this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROJECT_KEY] === "project"; }
  projectNotes(): string[] { return this.app.vault.getMarkdownFiles().filter(f => this.isProjectNote(f)).map(f => f.path); }
  /** The colour of a project note, from Obsidian's metadata cache; null when unset or not a valid `#rrggbb`. */
  projectColor(notePath: string): string | null {
    const file = this.file(notePath); const value: unknown = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[COLOR_KEY] : undefined;
    return validColor(value) ? value.toLowerCase() : null;
  }
  /** The budgets of a project note, from Obsidian's metadata cache; every period is null when unset or not a number of hours. */
  projectBudgets(notePath: string): ProjectBudgets {
    const file = this.file(notePath); const properties: Record<string, unknown> = (file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined) ?? {};
    return { total: budgetSeconds(properties[BUDGET_KEYS.total]), day: budgetSeconds(properties[BUDGET_KEYS.day]), week: budgetSeconds(properties[BUDGET_KEYS.week]), month: budgetSeconds(properties[BUDGET_KEYS.month]) };
  }
  /** Sets or clears (null) each budget of a project note, keeping every other property and marking the note as a project note. */
  async setProjectBudgets(file: TFile, budgets: ProjectBudgets): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => {
      raw[PROJECT_KEY] = "project"; if (!hasStart(raw[START_KEY])) raw[START_KEY] = localDate();
      for (const period of Object.keys(BUDGET_KEYS) as BudgetPeriod[]) { const seconds = budgets[period]; if (seconds === null) delete raw[BUDGET_KEYS[period]]; else raw[BUDGET_KEYS[period]] = budgetHours(seconds); }
    });
  }
  /** A task takes the colour of its first coloured project. */
  taskColor(task: Task): string | null {
    for (const project of task.projects) { const color = this.projectColor(project); if (color) return color; }
    return null;
  }
  /** Sets or clears a project's colour, keeping every other property and marking the note as a project note. */
  async setProjectColor(file: TFile, color: string | null): Promise<void> {
    if (color !== null && !validColor(color)) throw new Error("Use a colour such as #3b82f6.");
    await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => {
      raw[PROJECT_KEY] = "project"; if (!hasStart(raw[START_KEY])) raw[START_KEY] = localDate(); if (color === null) delete raw[COLOR_KEY]; else raw[COLOR_KEY] = color.toLowerCase();
    });
  }
  /** Adds the project marker to a note, keeping every other property; a note that already has it is not written. */
  /** Makes a note a project note and dates its start (today) unless it already has both; a note that has them is not written. */
  async markProject(file: TFile, today = localDate()): Promise<boolean> {
    const properties = splitNote(await this.readText(file)).frontmatter;
    if (properties[PROJECT_KEY] === "project" && hasStart(properties[START_KEY])) return false;
    await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => { raw[PROJECT_KEY] = "project"; if (!hasStart(raw[START_KEY])) raw[START_KEY] = today; });
    return true;
  }
  async ensure(notePath: string, content = ""): Promise<TFile> {
    notePath = path(notePath); const existing = this.file(notePath); if (existing) return existing;
    await this.folders(notePath);
    try { return await this.app.vault.create(notePath, content); } catch (error) { const concurrent = this.file(notePath); if (concurrent) return concurrent; throw error; }
  }
  async create(title: string): Promise<Task> {
    const task = newTask(title, makeId()); const content = `---\n${stringifyYaml(withoutEmptyOptional(task))}---\n\n`;
    // Named after the title; a clash from a note created in between gets the next counter, and a name the file system refuses falls back to the id.
    for (let attempt = 0; ; attempt++) {
      const notePath = attempt < 2 ? path(freePath(this.settings().taskFolder, readableName(title), this.nameTaken())) : this.taskPath(task.id);
      try { await this.folders(notePath); const file = await this.app.vault.create(notePath, content); this.link(file.path, task.id); return task; } catch (error) { if (attempt >= 2) throw error; }
    }
  }
  async read(id: string): Promise<Task> {
    const file = await this.resolve(id, "reading").catch((error: unknown) => { throw new Error(error instanceof Error && error.message.startsWith("Two notes") ? error.message : `Missing task ${id}. Use attach/create on the occurrence to repair or relink it.`); });
    return taskFrom(await this.properties(file), id);
  }
  /** Every task note; one kept only for the time it tracked after becoming a standalone note is left out unless `withConverted`. */
  async list(withConverted = false): Promise<Task[]> {
    const files = this.app.vault.getMarkdownFiles().filter(f => this.isTaskRecord(f.path));
    const read: { task: Task; file: TFile }[] = []; const claims = new Map<string, number>();
    const broken: string[] = [];
    const parsed = await inBatches(files, async file => {
      let frontmatter: Record<string, unknown> | null = null;
      try { frontmatter = await this.properties(file); const id = this.idOf(file, frontmatter); return { task: taskFrom(frontmatter, id), file }; } catch {
        // Invalid task notes remain available for manual repair, never overwritten. One that has an id looks like a task that broke; any other note in the folder is not reported.
        if (frontmatter && validId(frontmatter.id)) broken.push(file.path);
        return null;
      }
    });
    for (const entry of parsed) if (entry) { this.link(entry.file.path, entry.task.id); claims.set(entry.task.id, (claims.get(entry.task.id) ?? 0) + 1); read.push(entry); }
    // A copied note repeats its id: neither copy is listed until the person removes one.
    const copies = read.filter(({ task }) => claims.get(task.id)! > 1).map(({ file }) => file.path);
    if (copies.length || broken.length) this.onSkipped?.(copies, broken);
    return read.filter(({ task }) => claims.get(task.id) === 1 && (withConverted || !task.converted_to)).map(({ task }) => task);
  }
  async update(id: string, mutate: (task: Task) => Task): Promise<Task> {
    const file = await this.resolve(id);
    let result: Task | null = null;
    await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => {
      result = taskFrom(mutate(taskFrom(raw, id)), id); Object.assign(raw, result);
      // Object.assign never removes a key, and a task that plans nothing should not carry empty ones.
      for (const key of OPTIONAL_KEYS) if (isEmpty(result[key])) delete raw[key];
    });
    this.parsed.delete(file.path);
    if (!result) throw new Error("The frontmatter update did not complete."); return result;
  }
  async write(file: TFile, before: string, after: string): Promise<void> {
    if (before === after) return;
    const active = this.activeEditor();
    if (active?.file.path === file.path) {
      if (active.editor.getValue() !== before) throw new Error(`${file.path} changed concurrently; preserved. Retry the action.`);
      // A single minimal Editor transaction retains selection, cursor and undo.
      let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
      let end = before.length; let afterEnd = after.length;
      while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
      const selection = active.editor.listSelections();
      active.editor.transaction({ changes: [{ from: active.editor.offsetToPos(start), to: active.editor.offsetToPos(end), text: after.slice(start, afterEnd) }] }, "input.organized");
      // A todo that was re-sorted keeps the cursor: it follows the line by its hidden id instead of staying at the same offset.
      const beforeLines = before.split("\n"); const afterLines = after.split("\n");
      const follow = (pos: { line: number; ch: number }) => {
        const id = /organized:([a-z0-9]+)/.exec(beforeLines[pos.line])?.[1]; if (!id) return null;
        const mark = `organized:${id}`; const there = afterLines.flatMap((l, i) => l.includes(mark) ? [i] : []);
        return there.length === 1 && beforeLines.filter(l => l.includes(mark)).length === 1 ? { line: there[0], ch: Math.min(pos.ch, afterLines[there[0]].length) } : null;
      };
      const keep = (pos: { line: number; ch: number }) => follow(pos) ?? active.editor.offsetToPos(Math.min(after.length, active.editor.posToOffset(pos)));
      active.editor.setSelections(selection.map(s => ({ anchor: keep(s.anchor), head: keep(s.head) })));
    } else {
      await this.app.vault.process(file, current => { if (current !== before) throw new Error(`${file.path} changed concurrently; preserved. Retry the action.`); return after; });
    }
    this.parsed.delete(file.path);
  }
  /** Ids of task notes that remember `notePath` as the note they became (read from the metadata cache, so this is cheap enough for every rename). */
  convertedTo(notePath: string): string[] {
    return this.app.vault.getMarkdownFiles().filter(f => this.isTaskRecord(f.path) && this.app.metadataCache.getFileCache(f)?.frontmatter?.converted_to === notePath).map(f => this.idOf(f, object(this.app.metadataCache.getFileCache(f)?.frontmatter)));
  }
  async occurrences(id: string): Promise<{ file: TFile; text: string; tasks: TaskLine[] }[]> {
    const result: { file: TFile; text: string; tasks: TaskLine[] }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isTaskRecord(file.path)) continue;
      const text = await this.readText(file); const tasks = parseTasks(text).filter(t => t.id === id);
      if (tasks.length) result.push({ file, text, tasks });
    }
    return result;
  }
}
