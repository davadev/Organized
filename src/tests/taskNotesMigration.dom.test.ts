// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { DataSafety } from "../safety";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
const OLD = "## Description\nWhy we do it.\n\n## Notes\nRemember the budget.\n\n## Sources\nhttps://example.com\n";
const NEW = "Why we do it.\n\nRemember the budget.\n\n## Sources\nhttps://example.com\n";
async function note(h: ReturnType<typeof harness>, title: string, body: string) {
  const task = await h.repo.create(title); const path = h.repo.taskFile(task.id)!.path;
  h.texts.set(path, h.texts.get(path)!.replace(/\n+$/, "\n\n") + body); return { task, path };
}
const backupFiles = (h: ReturnType<typeof harness>) => [...h.texts.keys()].filter(k => k.includes("/note-backups/"));
async function loaded() {
  vi.useFakeTimers(); const h = harness();
  const plugin = new Organized(h.app, { id: "organized", name: "Organized", author: "davadev", version: "0.0.0", minAppVersion: "1.7.2", description: "", isDesktopOnly: false });
  await plugin.onload(); return { h, plugin };
}

describe("migrating task notes to the new layout", () => {
  it("rewrites only real task notes in the old layout, saves their old text first and keeps the rest", async () => {
    const h = harness(); const a = await note(h, "Old", OLD); const b = await note(h, "Already new", NEW); const c = await note(h, "Notes only", "## Notes\nJust notes\n");
    h.texts.set("Tasks/Readme.md", "## Notes\nnot a task\n");
    const newer = await h.repo.create("Newer schema"); h.texts.set(h.repo.taskFile(newer.id)!.path, h.texts.get(h.repo.taskFile(newer.id)!.path)!.replace("schema_version: 1", "schema_version: 2") + OLD);
    const unreadable = await h.repo.create("Unreadable"); h.texts.set(h.repo.taskFile(unreadable.id)!.path, "---\nid: [broken\n---\n" + OLD);
    const backup = vi.fn(async (files: { path: string; before: string }[]) => { expect(files.map(f => f.path).sort()).toEqual([a.path, c.path].sort()); return "backup.json"; });
    const before = h.texts.get(b.path);
    const result = await h.service.migrateTaskBodies(backup);
    expect(result.failed).toEqual([]); expect(result.backupPath).toBe("backup.json"); expect(result.changes.map(c => c.file.path).sort()).toEqual([a.path, c.path].sort());
    expect(h.texts.get(a.path)!.endsWith(`\n\n${NEW}`)).toBe(true); expect(h.texts.get(c.path)!.endsWith("\n\nJust notes\n")).toBe(true);
    expect(h.texts.get(b.path)).toBe(before); expect(h.texts.get("Tasks/Readme.md")).toBe("## Notes\nnot a task\n"); expect(h.texts.get(h.repo.taskFile(newer.id)!.path)).toContain("schema_version: 2");
    expect((await h.repo.read(a.task.id)).title).toBe("Old"); expect(h.texts.get(a.path)).toContain(`id: ${a.task.id}`);
    // A second pass finds nothing to change and takes no backup.
    backup.mockClear(); expect(await h.service.migrateTaskBodies(backup)).toEqual({ changes: [], failed: [], backupPath: null }); expect(backup).not.toHaveBeenCalled();
  });
  it("changes nothing when the backup cannot be written, and reports notes that changed meanwhile", async () => {
    const h = harness(); const a = await note(h, "One", OLD); const b = await note(h, "Two", OLD); const original = h.texts.get(a.path);
    await expect(h.service.migrateTaskBodies(async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(h.texts.get(a.path)).toBe(original);
    const result = await h.service.migrateTaskBodies(async () => { h.texts.set(b.path, `${h.texts.get(b.path)}edited meanwhile\n`); return "b.json"; });
    expect(result.failed).toEqual([b.path]); expect(result.changes.map(c => c.file.path)).toEqual([a.path]); expect(h.texts.get(b.path)).toContain("edited meanwhile");
  });
  it("migrates once after the workspace is ready, announces it with Undo, and never again", async () => {
    const { h, plugin } = await loaded(); const a = await note(h, "Old", OLD); const old = h.texts.get(a.path)!; Notice.instances.length = 0;
    h.layout[0](); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(plugin.settings.taskNotesMigrated).toBe(true); expect(h.texts.get(a.path)!.endsWith(`\n\n${NEW}`)).toBe(true);
    const files = backupFiles(h); expect(files).toHaveLength(1); expect(JSON.parse(h.texts.get(files[0])!).files).toEqual([{ path: a.path, before: old }]);
    const notice = Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("Task notes updated"))!; const text = (notice.message as DocumentFragment).textContent!;
    expect(text).toContain("1 task note now keep the description"); expect(text).toContain("note-backups");
    (notice.message as DocumentFragment).querySelector("button")!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush(); expect(h.texts.get(a.path)).toBe(old);
    Notice.instances.length = 0; await plugin.migrateTaskNotes(); expect(Notice.instances).toHaveLength(0); expect(h.texts.get(a.path)).toBe(old); expect(backupFiles(h)).toHaveLength(1);
  });
  it("is quiet with nothing to do, paused writes or a failed backup, and retries when a note could not be updated", async () => {
    const { h, plugin } = await loaded(); Notice.instances.length = 0;
    await plugin.migrateTaskNotes(); expect(plugin.settings.taskNotesMigrated).toBe(true); expect(Notice.instances).toHaveLength(0);
    const a = await note(h, "Old", OLD); const old = h.texts.get(a.path)!; plugin.settings.taskNotesMigrated = false;
    plugin.safety.writable = false; await plugin.migrateTaskNotes(); expect(h.texts.get(a.path)).toBe(old); expect(plugin.settings.taskNotesMigrated).toBe(false); plugin.safety.writable = true;
    const failing = vi.spyOn(plugin.safety, "writeBackup").mockRejectedValueOnce(new Error("no space")); await plugin.migrateTaskNotes();
    expect(Notice.instances.at(-1)?.message).toContain("nothing was changed"); expect(Notice.instances.at(-1)?.message).toContain("no space"); expect(plugin.settings.taskNotesMigrated).toBe(false); expect(h.texts.get(a.path)).toBe(old);
    failing.mockRejectedValueOnce("plain failure"); await plugin.migrateTaskNotes(); expect(Notice.instances.at(-1)?.message).toContain("plain failure"); failing.mockRestore();
    const racing = vi.spyOn(plugin.safety, "writeBackup").mockImplementationOnce(async () => { h.texts.set(a.path, `${h.texts.get(a.path)}edit\n`); return "x.json"; });
    await plugin.migrateTaskNotes(); const last = Notice.instances.at(-1)!; expect((last.message as DocumentFragment).textContent).toContain("1 could not be updated and will be retried"); expect(plugin.settings.taskNotesMigrated).toBe(false); racing.mockRestore();
    await plugin.migrateTaskNotes(); expect(plugin.settings.taskNotesMigrated).toBe(true); expect(h.texts.get(a.path)).toContain("Remember the budget.");
  });
});

describe("note backups", () => {
  it("keeps the three newest of each kind apart from the settings backups", async () => {
    const h = harness(); const safety = new DataSafety(h.app.vault.adapter, "plugin", "0.1.0", vi.fn()); vi.useFakeTimers();
    const names: string[] = [];
    for (let i = 0; i < 4; i++) { vi.setSystemTime(1_000 + i); names.push(await safety.writeBackup("task-notes", [{ path: `n${i}.md`, before: String(i) }])); }
    vi.setSystemTime(9_000); const other = await safety.writeBackup("retire", []);
    const kept = backupFiles(h); expect(kept.sort()).toEqual([...names.slice(1), other].sort()); expect(JSON.parse(h.texts.get(names[3])!)).toMatchObject({ version: "0.1.0", kind: "task-notes", files: [{ path: "n3.md", before: "3" }] });
    expect(kept.every(k => k.startsWith("plugin/note-backups/"))).toBe(true); expect([...h.texts.keys()].some(k => k.includes("/backups/"))).toBe(false);
  });
});
