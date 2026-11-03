// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
const backupOk = () => vi.fn(async (_extra: { renames: { from: string; to: string }[] }) => "plugin/note-backups/task-names-1.json");
const backupFiles = (h: ReturnType<typeof harness>) => [...h.texts.keys()].filter(k => k.includes("/note-backups/task-names-"));
async function loaded(legacy = true) {
  vi.useFakeTimers(); const h = harness(legacy);
  const plugin = new Organized(h.app, { id: "organized", name: "Organized", author: "davadev", version: "0.0.0", minAppVersion: "1.7.2", description: "", isDesktopOnly: false });
  await plugin.onload(); return { h, plugin };
}
const messageOf = (n: { message: unknown }) => n.message instanceof DocumentFragment ? n.message.textContent! : String(n.message);

describe("naming existing task notes after their titles", () => {
  it("renames id-named notes oldest first with counters, unique across the vault, and leaves everything else alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); const h = harness(true); await h.add("Projects/Budget.md", "a user note");
    const first = await h.repo.create("Plan"); vi.setSystemTime(Date.now() + 1000); const second = await h.repo.create("Plan"); const third = await h.repo.create("Budget"); const odd = await h.repo.create("Fix [[x]]: a/b?");
    const converted = await h.repo.create("Became a note"); await h.repo.update(converted.id, t => ({ ...t, converted_to: "Notes/N.md" }));
    const broken = await h.repo.create("Broken"); h.texts.set(`Tasks/${broken.id}.md`, "---\nid: [broken\n---\n");
    const newer = await h.repo.create("Newer"); h.texts.set(`Tasks/${newer.id}.md`, h.texts.get(`Tasks/${newer.id}.md`)!.replace("schema_version: 1", "schema_version: 2"));
    const copy = await h.repo.create("Copy"); await h.add("Tasks/Copy of it.md", h.texts.get(`Tasks/${copy.id}.md`)!); await h.add("Tasks/Readme.md", "not a task");
    const daily: any = await h.add("Daily/2026-01-01.md", `- [ ] Plan <!--organized:${first.id}-->\n`); const before = new Map(h.texts);
    const backup = backupOk(); const result = await h.service.migrateTaskNames(backup);
    const path = (id: string) => h.repo.taskFile(id)?.path;
    expect(path(first.id)).toBe("Tasks/Plan.md"); expect(path(second.id)).toBe("Tasks/Plan 2.md"); expect(path(third.id)).toBe("Tasks/Budget 2.md"); expect(path(odd.id)).toBe("Tasks/Fix x a b.md");
    expect(path(converted.id)).toBe(`Tasks/${converted.id}.md`); expect(h.texts.has(`Tasks/${broken.id}.md`)).toBe(true); expect(h.texts.has(`Tasks/${newer.id}.md`)).toBe(true); expect(h.texts.has(`Tasks/${copy.id}.md`)).toBe(true);
    expect(result.failed).toEqual([]); expect(result.renames.map(r => r.from).sort()).toEqual([first, second, third, odd].map(t => `Tasks/${t.id}.md`).sort());
    expect(h.texts.get(daily.path)).toBe(before.get(daily.path)); expect(h.texts.get("Tasks/Plan.md")).toBe(before.get(`Tasks/${first.id}.md`)); // only the name changed
    expect(backup).toHaveBeenCalledOnce(); expect(backup.mock.calls[0][0].renames).toEqual(expect.arrayContaining([{ from: `Tasks/${first.id}.md`, to: "Tasks/Plan.md" }, { from: `Tasks/${third.id}.md`, to: "Tasks/Budget 2.md" }]));
    backup.mockClear(); expect(await h.service.migrateTaskNames(backup)).toEqual({ renames: [], failed: [] }); expect(backup).not.toHaveBeenCalled(); // nothing id-named is left
  });
  it("renames nothing when the plan cannot be saved, and reports the notes that could not be renamed", async () => {
    const h = harness(true); const a = await h.repo.create("One"); const b = await h.repo.create("Two");
    await expect(h.service.migrateTaskNames(async () => { throw new Error("disk full"); })).rejects.toThrow("disk full"); expect(h.repo.taskFile(a.id)!.path).toBe(`Tasks/${a.id}.md`);
    h.raw.fileManager.renameFile.mockImplementationOnce(async () => { throw new Error("refused"); });
    const result = await h.service.migrateTaskNames(backupOk()); expect(result.failed).toHaveLength(1); expect(result.renames).toHaveLength(1);
    expect([a, b].filter(t => h.repo.taskFile(t.id)!.path === `Tasks/${t.id}.md`)).toHaveLength(1);
  });
  it("shows progress for a big vault", async () => {
    const h = harness(true); for (let i = 0; i < 55; i++) await h.repo.create(`Task ${i}`); Notice.instances.length = 0;
    const result = await h.service.migrateTaskNames(backupOk()); expect(result.renames).toHaveLength(55);
    const progress = Notice.instances.find(n => String(n.message).startsWith("Naming task notes")); expect(progress).toBeTruthy(); expect(String(progress!.message)).toContain("50 of 55");
  });
});

describe("the one-time migration at startup and the command", () => {
  it("runs once after the workspace is ready, announces it with Undo, saves the plan, and never again", async () => {
    const { h, plugin } = await loaded(); const a = await h.repo.create("Alpha"); vi.setSystemTime(Date.now() + 1000); const b = await h.repo.create("Alpha"); Notice.instances.length = 0;
    h.layout[0](); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(plugin.settings.taskNoteNamesMigrated).toBe(true); expect(plugin.repo.taskFile(a.id)!.path).toBe("Tasks/Alpha.md"); expect(plugin.repo.taskFile(b.id)!.path).toBe("Tasks/Alpha 2.md");
    const files = backupFiles(h); expect(files).toHaveLength(1); expect(JSON.parse(h.texts.get(files[0])!).renames).toHaveLength(2);
    const notice = Notice.instances.find(n => messageOf(n).includes("Task notes renamed"))!; expect(messageOf(notice)).toContain("2 task notes now carry the title"); expect(messageOf(notice)).toContain("Update Organized on your other devices");
    (notice.message as DocumentFragment).querySelector("button")!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(plugin.repo.taskFile(a.id)!.path).toBe(`Tasks/${a.id}.md`); expect((await plugin.repo.read(a.id)).title).toBe("Alpha");
    Notice.instances.length = 0; await plugin.migrateTaskNoteNames(); expect(Notice.instances).toHaveLength(0); expect(plugin.repo.taskFile(a.id)!.path).toBe(`Tasks/${a.id}.md`); // tried once: Undo is not undone by a restart
  });
  it("is quiet when there is nothing to do or writes are paused, and retries after a failed backup", async () => {
    const { h, plugin } = await loaded(); Notice.instances.length = 0;
    await plugin.migrateTaskNoteNames(); expect(plugin.settings.taskNoteNamesMigrated).toBe(true); expect(Notice.instances).toHaveLength(0);
    const a = await h.repo.create("Later"); plugin.settings.taskNoteNamesMigrated = false; plugin.safety.writable = false; await plugin.migrateTaskNoteNames(); expect(plugin.repo.taskFile(a.id)!.path).toBe(`Tasks/${a.id}.md`); expect(plugin.settings.taskNoteNamesMigrated).toBe(false); plugin.safety.writable = true;
    const failing = vi.spyOn(plugin.safety, "writeBackup").mockRejectedValueOnce(new Error("no space")); await plugin.migrateTaskNoteNames();
    expect(String(Notice.instances.at(-1)?.message)).toContain("nothing was changed"); expect(String(Notice.instances.at(-1)?.message)).toContain("no space"); expect(plugin.settings.taskNoteNamesMigrated).toBe(false);
    failing.mockRejectedValueOnce("plain failure"); await plugin.migrateTaskNoteNames(); expect(String(Notice.instances.at(-1)?.message)).toContain("plain failure"); failing.mockRestore();
    await plugin.migrateTaskNoteNames(); expect(plugin.settings.taskNoteNamesMigrated).toBe(true); expect(plugin.repo.taskFile(a.id)!.path).toBe("Tasks/Later.md");
  });
  it("names the notes that could not be renamed, and the command tries again", async () => {
    const { h, plugin } = await loaded(); const a = await h.repo.create("Stubborn"); vi.setSystemTime(Date.now() + 1000); const b = await h.repo.create("Fine");
    h.raw.fileManager.renameFile.mockImplementationOnce(async () => { throw new Error("refused"); }); Notice.instances.length = 0;
    await plugin.migrateTaskNoteNames(); const notice = Notice.instances.find(n => messageOf(n).includes("Task notes renamed"))!; expect(messageOf(notice)).toContain("1 task note now carry"); expect(messageOf(notice)).toContain("1 could not be renamed and keep their id (Stubborn)");
    expect(plugin.settings.taskNoteNamesMigrated).toBe(true); expect(plugin.repo.taskFile(a.id)!.path).toBe(`Tasks/${a.id}.md`);
    const command = (plugin as any).commands.find((c: any) => c.id === "rename-task-notes"); command.callback(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(plugin.repo.taskFile(a.id)!.path).toBe("Tasks/Stubborn.md"); expect(plugin.repo.taskFile(b.id)!.path).toBe("Tasks/Fine.md");
    Notice.instances.length = 0; command.callback(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush(); expect(String(Notice.instances.at(-1)?.message)).toBe("Every task note already carries its title.");
  });
});
