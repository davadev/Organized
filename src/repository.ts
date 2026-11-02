import { App, Editor, TFile, parseYaml, stringifyYaml } from "obsidian";
import { validColor } from "./colors";
import { localDate, makeId, newTask, object, path, Task, taskFrom, Settings, validDate } from "./model";
import { parseTasks, PROJECT_ONGOING, PROJECT_SECTIONS, TaskLine } from "./codec";

export function splitNote(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  return match ? { frontmatter: object(parseYaml(match[1])), body: text.slice(match[0].length) } : { frontmatter: {}, body: text };
}
/** Frontmatter that marks a note as a project note; the picker lists only these. */
export const PROJECT_KEY = "organized_type";
/** Optional `#rrggbb` colour of a project note, shown on its tasks in the side panel and the calendar. */
export const COLOR_KEY = "organized_color";
/** The day a project started, `YYYY-MM-DD`. Set automatically; an `organized_end` date is reserved for later and not used yet. */
export const START_KEY = "organized_start";
/** A start date as stored: `YYYY-MM-DD` text, or a Date when a YAML reader turned the bare date into one. */
const hasStart = (value: unknown): boolean => validDate(value) || (value instanceof Date && Number.isFinite(value.getTime()));
/** A new project note: frontmatter marking it, dating its start, and one heading per status that linked tasks move between. */
export function projectTemplate(today = localDate()): string {
  return `---\n${PROJECT_KEY}: project\n${START_KEY}: ${today}\n---\n\n## ${PROJECT_SECTIONS.open}\n\n## ${PROJECT_SECTIONS.in_progress}\n\n## ${PROJECT_ONGOING}\n\n## ${PROJECT_SECTIONS.completed}\n`;
}
export class Repository {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly app: App, readonly settings: () => Settings, readonly activeEditor: () => { file: TFile; editor: Editor } | null) {}
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(fn); this.tail = next; return next;
  }
  file(notePath: string): TFile | null { const file = this.app.vault.getAbstractFileByPath(notePath); return file instanceof TFile ? file : null; }
  /** Project notes live in a subfolder of the task folder; they are ordinary notes, not task records. */
  projectFolder(): string { return path(`${this.settings().taskFolder}/Projects`); }
  isTaskRecord(notePath: string): boolean { return notePath.startsWith(`${this.settings().taskFolder}/`) && !notePath.startsWith(`${this.projectFolder()}/`); }
  taskPath(id: string): string { return path(`${this.settings().taskFolder}/${id}.md`); }
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
    const task = newTask(title, makeId()); const notePath = this.taskPath(task.id);
    await this.folders(notePath);
    await this.app.vault.create(notePath, `---\n${stringifyYaml(task)}---\n\n`); return task;
  }
  async read(id: string): Promise<Task> {
    const file = this.file(this.taskPath(id)); if (!file) throw new Error(`Missing task ${id}. Use attach/create on the occurrence to repair or relink it.`);
    return taskFrom(splitNote(await this.readText(file)).frontmatter, id);
  }
  /** Every task note; one kept only for the time it tracked after becoming a standalone note is left out unless `withConverted`. */
  async list(withConverted = false): Promise<Task[]> {
    const files = this.app.vault.getMarkdownFiles().filter(f => this.isTaskRecord(f.path));
    const result: Task[] = [];
    for (const file of files) {
      try { const task = taskFrom(splitNote(await this.readText(file)).frontmatter, file.basename); if (withConverted || !task.converted_to) result.push(task); } catch { /* Invalid task notes remain available for manual repair, never overwritten. */ }
    }
    return result;
  }
  async update(id: string, mutate: (task: Task) => Task): Promise<Task> {
    const file = this.file(this.taskPath(id)); if (!file) throw new Error("Task note is missing; relink or repair before editing.");
    let result: Task | null = null;
    await this.app.fileManager.processFrontMatter(file, (raw: Record<string, unknown>) => {
      result = taskFrom(mutate(taskFrom(raw, id)), id); Object.assign(raw, result);
    });
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
      active.editor.setSelections(selection.map(s => ({ anchor: active.editor.offsetToPos(Math.min(after.length, active.editor.posToOffset(s.anchor))), head: active.editor.offsetToPos(Math.min(after.length, active.editor.posToOffset(s.head))) })));
    } else {
      await this.app.vault.process(file, current => { if (current !== before) throw new Error(`${file.path} changed concurrently; preserved. Retry the action.`); return after; });
    }
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
