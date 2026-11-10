import { vi } from "vitest";
import { TFile, TFolder, MarkdownView, stringifyYaml, parseYaml } from "./__mocks__/obsidian";
import type { App, Editor } from "obsidian";
import { DEFAULT_SETTINGS, Settings } from "../model";
import { Repository } from "../repository";
import { TaskService } from "../service";
import { splitNote } from "../repository";

/** `legacyNames`: new task notes are renamed to `<id>.md`, the layout notes had before they were named after their titles (for tests of upgrades and of Retire's rename). */
export function harness(legacyNames = false) {
  const texts = new Map<string, string>(); const files = new Map<string, TFile | TFolder>();
  const events: Record<string, ((...args: any[]) => unknown)[]> = {};
  const layout: (() => void)[] = [];
  let active: { editor: Editor; file: TFile } | null = null;
  const on = (name: string, fn: (...args: any[]) => unknown) => { (events[name] ??= []).push(fn); return { name, fn }; };
  const app = {
    vault: {
      getName: () => "Vault",
      configDir: ".obsidian",
      adapter: {
        exists: vi.fn(async (p: string) => texts.has(p) || files.has(p)),
        read: vi.fn(async (p: string) => { if (!texts.has(p)) throw new Error("Missing"); return texts.get(p)!; }),
        write: vi.fn(async (p: string, s: string) => { texts.set(p, s); }),
        rename: vi.fn(async (from: string, to: string) => { const data = texts.get(from); if (data === undefined) throw Error('Missing'); texts.set(to, data); texts.delete(from); }),
        process: vi.fn(async (p: string, fn: (s: string) => string) => { const next = fn(texts.get(p)!); texts.set(p, next); return next; }),
        mkdir: vi.fn(async (p: string) => { files.set(p, new TFolder(p)); }),
        remove: vi.fn(async (p: string) => { texts.delete(p); files.delete(p); }),
        list: vi.fn(async (p: string) => ({ files: [...texts.keys()].filter(k => k.startsWith(p + "/")), folders: [] })),
      },
      on,
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      getAllLoadedFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()].filter((f): f is TFile => f instanceof TFile && f.path.endsWith(".md")),
      read: vi.fn(async (file: TFile) => { if (!texts.has(file.path)) throw new Error("Missing"); return texts.get(file.path)!; }),
      create: vi.fn(async (p: string, text: string) => { if (files.has(p)) throw new Error("Exists"); const file = new TFile(p); files.set(p, file); texts.set(p, text); return file; }),
      createFolder: vi.fn(async (p: string) => { if (files.has(p)) throw new Error("Exists"); const f = new TFolder(p); files.set(p, f); return f; }),
      process: vi.fn(async (file: TFile, fn: (s: string) => string) => { const next = fn(texts.get(file.path)!); texts.set(file.path, next); return next; }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const { frontmatter, body } = splitNote(texts.get(file.path)!); fn(frontmatter); texts.set(file.path, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
      }),
      generateMarkdownLink: vi.fn((file: TFile, _from: string) => `[[${file.path.replace(/\.md$/, "")}]]`),
      renameFile: vi.fn(async (file: TFile, to: string) => {
        if (files.has(to)) throw new Error("Exists"); const text = texts.get(file.path)!; files.delete(file.path); texts.delete(file.path);
        file.path = to; file.name = to.split("/").pop()!; file.basename = file.name.replace(/\.md$/, ""); files.set(to, file); texts.set(to, text);
      }),
      trashFile: vi.fn(async (file: TFile) => { texts.delete(file.path); files.delete(file.path); }),
    },
    metadataCache: { on, getFileCache: (file: TFile) => ({ frontmatter: texts.has(file.path) ? splitNote(texts.get(file.path)!).frontmatter : undefined }) },
    workspace: {
      on, onLayoutReady: (fn: () => void) => layout.push(fn), getActiveFile: vi.fn(() => (active?.file ?? null) as any),
      getActiveViewOfType: vi.fn((type: unknown) => type === MarkdownView && active ? { file: active.file, editor: active.editor, getMode: () => 'source' } : null),
      getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
      getMostRecentLeaf: vi.fn(() => null as any), getRightLeaf: vi.fn(() => null as any), getLeavesOfType: vi.fn(() => [] as any[]), revealLeaf: vi.fn(async () => undefined),
    },
  };
  let settings: Settings = { ...DEFAULT_SETTINGS, displayProperties: [] };
  const repo = new Repository(app as unknown as App, () => settings, () => active as any);
  if (legacyNames) { const create = repo.create.bind(repo); repo.create = async (title: string) => { const task = await create(title); await repo.renameNote(repo.taskFile(task.id)!, repo.taskPath(task.id)); return task; }; }
  const changed = vi.fn(); const confirm = vi.fn(async () => true);
  const service = new TaskService(repo, changed, confirm);
  const add = async (p: string, text = "") => app.vault.create(p, text);
  return { app: app as unknown as App, raw: app, texts, files, repo, service, changed, confirm, add, events, layout,
    setSettings: (value: Partial<Settings>) => { settings = { ...settings, ...value }; },
    setActive: (file: TFile, text = texts.get(file.path)!) => { const editor = fakeEditor(text); active = { file: file as any, editor: editor as any }; return editor; },
    clearActive: () => { active = null; },
  };
}
export function fakeEditor(initial: string) {
  let value = initial; let cursor = { line: 0, ch: 0 }; let selections = [{ anchor: cursor, head: cursor }];
  const offset = (p: { line: number; ch: number }) => value.split("\n").slice(0, p.line).reduce((n, s) => n + s.length + 1, 0) + p.ch;
  const position = (n: number) => { const before = value.slice(0, n).split("\n"); return { line: before.length - 1, ch: before.at(-1)!.length }; };
  return {
    getValue: () => value, setValue: (text: string) => { value = text; },
    focus: vi.fn(),
    getLine: (n: number) => value.split("\n")[n],
    setSelection: (anchor: typeof cursor, head: typeof cursor) => { selections = [{ anchor, head }]; cursor = head; },
    getCursor: () => cursor, setCursor: (p: typeof cursor) => { cursor = p; selections = [{ anchor: p, head: p }]; },
    listSelections: () => selections, setSelections: vi.fn((s: typeof selections) => { selections = s; }),
    offsetToPos: position, posToOffset: offset,
    transaction: vi.fn((spec: { changes: { from: typeof cursor; to: typeof cursor; text: string }[] }) => {
      for (const c of spec.changes) value = value.slice(0, offset(c.from)) + c.text + value.slice(offset(c.to));
    }),
    replaceRange: (text: string, from: typeof cursor, to = from) => { value = value.slice(0, offset(from)) + text + value.slice(offset(to)); },
  };
}

/** The start and end fields of a time-worked dialog, each reading and writing the `YYYY-MM-DDTHH:mm` value its date and time inputs make together. */
export function sessionFields(root: HTMLElement): { value: string; dispatchEvent: (event: Event) => boolean; label: string }[] {
  const pair = (name: string) => { const date = root.querySelector<HTMLInputElement>(`input[aria-label="${name} date"]`)!, time = root.querySelector<HTMLInputElement>(`input[aria-label="${name} time"]`)!;
    return { get value() { return `${date.value}T${time.value}`; }, set value(v: string) { [date.value, time.value] = v.split("T"); }, dispatchEvent: (event: Event) => date.dispatchEvent(event) && time.dispatchEvent(new Event(event.type)), label: name }; };
  return [pair("Start"), pair("End")];
}
