import { App, Editor, TFile, parseYaml, stringifyYaml } from "obsidian";
import { makeId, newTask, object, path, Task, taskFrom, Settings } from "./model";
import { parseTasks, TaskLine } from "./codec";

export function splitNote(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  return match ? { frontmatter: object(parseYaml(match[1])), body: text.slice(match[0].length) } : { frontmatter: {}, body: text };
}
export class Repository {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly app: App, readonly settings: () => Settings, readonly activeEditor: () => { file: TFile; editor: Editor } | null) {}
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(fn); this.tail = next; return next;
  }
  file(notePath: string): TFile | null { const file = this.app.vault.getAbstractFileByPath(notePath); return file instanceof TFile ? file : null; }
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
  async list(): Promise<Task[]> {
    const folder = `${this.settings().taskFolder}/`;
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder));
    const result: Task[] = [];
    for (const file of files) {
      try { result.push(taskFrom(splitNote(await this.readText(file)).frontmatter, file.basename)); } catch { /* Invalid task notes remain available for manual repair, never overwritten. */ }
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
      if (file.path.startsWith(`${this.settings().taskFolder}/`)) continue;
      const text = await this.readText(file); const tasks = parseTasks(text).filter(t => t.id === id);
      if (tasks.length) result.push({ file, text, tasks });
    }
    return result;
  }
}
