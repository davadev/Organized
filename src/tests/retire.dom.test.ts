// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";
import { ORGANIZED_KEYS, type RetireOptions } from "../retire";
import { writeNoteSection } from "../codec";
import { localDate } from "../model";

installObsidianDom();
const base: RetireOptions = { which: "all", olderThanDays: 7, lines: "plain", keep: "title", notes: "keep", yaml: "keep" };
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const backupOk = () => vi.fn(async (_files: { path: string; before: string }[], _extra: Record<string, unknown>) => "plugin/note-backups/retire-1.json");

async function setup() {
  const h = harness(true);
  const plan = await h.repo.create("Plan release"); const twin = await h.repo.create("Plan release"); const odd = await h.repo.create("Fix [[budget]]: a/b?");
  await h.repo.update(plan.id, t => ({ ...t, status: "completed", closed_at: ago(40), time_tracked_seconds: 5400, work_sessions: [{ start: new Date(2026, 0, 5, 9, 0).toISOString(), end: new Date(2026, 0, 5, 10, 0).toISOString() }] }));
  const planNote = h.repo.taskFile(plan.id)!;
  h.texts.set(planNote.path, writeNoteSection(writeNoteSection(h.texts.get(planNote.path)!, "Description", "Ship it."), "Sources", "https://a.b"));
  const first: any = await h.add("Daily/2026-01-05.md", `# Work\n  - [>] Plan release <!--organized:${plan.id}-->\n  - [ ] Plain todo\n`);
  const last: any = await h.add("Daily/2026-01-06.md", `- [x] Plan release <!--organized:${plan.id}-->\r\n- [ ] Plan release <!--organized:${twin.id}-->\r\n`);
  const project: any = await h.add("Tasks/Projects/Alpha.md", `## Open\n- [ ] Fix [[budget]]: a/b? <!--organized:${odd.id}-->\n`);
  return { h, plan, twin, odd, planNote, first, last, project };
}
const exists = (h: ReturnType<typeof harness>, path: string) => h.texts.has(path);

describe("retiring tasks", () => {
  it("unlinks todos and leaves task notes untouched by default, with a saved copy and an Undo", async () => {
    const { h, plan, twin, odd, first, last, project, planNote } = await setup(); const backup = backupOk(); const before = h.texts.get(planNote.path);
    await h.service.retireTasks(base, backup);
    expect(h.texts.get(first.path)).toBe("# Work\n  - [>] Plan release\n  - [ ] Plain todo\n"); expect(h.texts.get(last.path)).toBe("- [x] Plan release\r\n- [ ] Plan release\r\n"); expect(h.texts.get(project.path)).toBe("## Open\n- [ ] Fix [[budget]]: a/b?\n");
    expect(h.texts.get(planNote.path)).toBe(before); expect(exists(h, h.repo.taskFile(twin.id)!.path)).toBe(true); expect(exists(h, h.repo.taskFile(odd.id)!.path)).toBe(true);
    expect(backup).toHaveBeenCalledOnce(); expect(backup.mock.calls[0][0].map(f => f.path).sort()).toEqual([first.path, last.path, project.path].sort()); expect(backup.mock.calls[0][1]).toEqual({ renames: [] });
    const notice = Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("Tasks retired"))!; expect((notice.message as DocumentFragment).textContent).toContain("3 of 3 tasks retired · 4 todos unlinked");
    await h.service.undo(); expect(h.texts.get(first.path)).toContain(`organized:${plan.id}`); expect(h.texts.get(last.path)).toContain(`organized:${twin.id}`); expect(h.texts.get(project.path)).toContain(`organized:${odd.id}`);
  });
  it("renames task notes to their titles, links the todos and gives the names back on Undo", async () => {
    const { h, plan, twin, odd, first, last, planNote } = await setup(); const backup = backupOk();
    await h.service.retireTasks({ ...base, lines: "link", notes: "rename" }, backup);
    expect([...h.texts.keys()].filter(k => k.startsWith("Tasks/") && !k.includes("Projects")).sort()).toEqual(["Tasks/Fix budget a b.md", "Tasks/Plan release 2.md", "Tasks/Plan release.md"]);
    expect(h.texts.get(first.path)).toBe("# Work\n  - [>] [[Tasks/Plan release]]\n  - [ ] Plain todo\n"); expect(h.texts.get(last.path)).toBe("- [x] [[Tasks/Plan release]]\r\n- [ ] [[Tasks/Plan release 2]]\r\n");
    expect(h.raw.fileManager.generateMarkdownLink).toHaveBeenCalledWith(planNote, first.path, undefined, undefined); expect(planNote.path).toBe("Tasks/Plan release.md");
    expect(backup.mock.calls[0][1]).toEqual({ renames: [{ from: `Tasks/${plan.id}.md`, to: "Tasks/Plan release.md" }, { from: `Tasks/${twin.id}.md`, to: "Tasks/Plan release 2.md" }, { from: `Tasks/${odd.id}.md`, to: "Tasks/Fix budget a b.md" }] });
    await h.service.undo(); expect(planNote.path).toBe(h.repo.taskFile(plan.id)!.path); expect(h.texts.get(first.path)).toContain(`organized:${plan.id}`); expect(exists(h, h.repo.taskFile(twin.id)!.path)).toBe(true); expect(exists(h, "Tasks/Plan release.md")).toBe(false);
  });
  it("keeps the task note's own name behind a readable alias when it is not renamed", async () => {
    const { h, planNote, first, odd } = await setup(); await h.service.retireTasks({ ...base, lines: "link" }, backupOk());
    expect(h.raw.fileManager.generateMarkdownLink).toHaveBeenCalledWith(planNote, first.path, undefined, "Plan release"); expect(planNote.path).toBe(h.repo.taskFile(planNote.basename)!.path);
    expect(h.raw.fileManager.generateMarkdownLink).toHaveBeenCalledWith(h.repo.taskFile(odd.id), "Tasks/Projects/Alpha.md", undefined, "Fix budget : a/b?");
  });
  it("removes only Organized's properties, keeps the user's own, and keeps chosen text under the latest todo", async () => {
    const { h, planNote, first, last } = await setup(); h.texts.set(planNote.path, h.texts.get(planNote.path)!.replace("---\n\n", "tags:\n  - mine\n---\n\n"));
    await h.service.retireTasks({ ...base, yaml: "strip", keep: "all" }, backupOk());
    const renamed = "Tasks/Plan release.md"; expect(planNote.path).toBe(renamed);
    expect(h.texts.get(renamed)).toBe("---\ntags:\n  - mine\n---\n\nShip it.\n\n## Sources\nhttps://a.b\n");
    const text = h.texts.get(h.repo.file("Tasks/Plan release 2.md")!.path)!; expect(text).toBe(""); for (const key of ORGANIZED_KEYS) expect(h.texts.get(renamed)).not.toContain(`${key}:`);
    expect(h.texts.get(first.path)).toBe("# Work\n  - [>] Plan release\n  - [ ] Plain todo\n");
    expect(h.texts.get(last.path)).toBe("- [x] Plan release\r\n  > Ship it.\r\n  > **Sources**\r\n  > https://a.b\r\n  - Worked 2026-01-05: 09:00–10:00 (1h)\r\n  - Tracked 1h 30min\r\n- [ ] Plan release\r\n");
  });
});

describe("retiring: trash, selection, timers and failures", () => {
  it("moves task notes to the trash last, keeps what was chosen under the todo and offers no Undo", async () => {
    const { h, plan, first, last } = await setup(); await h.service.retireTasks({ ...base, notes: "trash", lines: "link", yaml: "strip", keep: "description" }, backupOk());
    expect(h.raw.fileManager.trashFile).toHaveBeenCalledTimes(3); expect([...h.texts.keys()].some(k => k.startsWith("Tasks/") && !k.includes("Projects"))).toBe(false);
    expect(h.texts.get(first.path)).toBe("# Work\n  - [>] Plan release\n  - [ ] Plain todo\n"); expect(h.texts.get(last.path)).toBe("- [x] Plan release\r\n  > Ship it.\r\n- [ ] Plan release\r\n");
    expect(h.service.undoChanges).toEqual([]); const message = String(Notice.instances.at(-1)!.message); expect(message).toContain("3 moved to Obsidian's trash"); expect(message).toContain("Undo is not offered");
    h.service.undoChanges.length = 0; await h.service.undo(); expect(h.texts.get(first.path)).not.toContain(plan.id);
  });
  it("covers only finished tasks old enough when asked, and every task including recurring and running ones otherwise", async () => {
    const { h, plan, twin, odd, first } = await setup(); await h.repo.update(odd.id, t => ({ ...t, recurring: true })); await h.repo.update(twin.id, t => ({ ...t, status: "in_progress", time_tracking_started_at: ago(1), time_tracked_seconds: 0 }));
    await h.service.retireTasks({ ...base, which: "closed", olderThanDays: 30 }, backupOk());
    expect(h.texts.get(first.path)).not.toContain(plan.id); expect(h.texts.get("Daily/2026-01-06.md")).toContain(`organized:${twin.id}`); expect(h.texts.get("Tasks/Projects/Alpha.md")).toContain(`organized:${odd.id}`);
    await h.service.retireTasks({ ...base, keep: "all", yaml: "strip" }, backupOk());
    expect(h.texts.get("Daily/2026-01-06.md")).not.toContain("organized:"); expect(h.texts.get("Tasks/Projects/Alpha.md")).not.toContain("organized:");
    expect(h.texts.get("Daily/2026-01-06.md")).toContain("- Tracked 24h"); expect(h.texts.get("Daily/2026-01-06.md")).toContain(`- Worked ${localDate()}`.slice(0, 9));
  });
  it("logs a running timer even when the task note is kept, and says so nowhere else", async () => {
    const { h, twin } = await setup(); await h.repo.update(twin.id, t => ({ ...t, status: "in_progress", time_tracking_started_at: ago(0.5), time_tracked_seconds: 0 }));
    const backup = backupOk(); await h.service.retireTasks(base, backup); const stopped = await h.repo.read(twin.id);
    expect(stopped.time_tracking_started_at).toBeNull(); expect(stopped.status).toBe("open"); expect(stopped.work_sessions).toHaveLength(1); expect(backup.mock.calls[0][0].some(f => f.path === h.repo.taskFile(twin.id)!.path)).toBe(true);
  });
  it("reports nothing to do, a failed backup, and a task whose note went missing, without touching the others", async () => {
    const { h, plan, twin, first, last } = await setup();
    await h.service.retireTasks({ ...base, which: "closed", olderThanDays: 3650 }, backupOk()); expect(Notice.instances.at(-1)?.message).toBe("No tasks match, so nothing was retired.");
    const original = h.texts.get(first.path); await expect(h.service.retireTasks(base, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full"); expect(h.texts.get(first.path)).toBe(original);
    const lookup = h.repo.file.bind(h.repo); const twinPath = h.repo.taskFile(twin.id)!.path; const spy = vi.spyOn(h.repo, "file").mockImplementation(p => p === twinPath ? null : lookup(p));
    await h.service.retireTasks(base, backupOk()); spy.mockRestore();
    const detail = (Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("left unchanged"))!.message as DocumentFragment).textContent!; expect(detail).toContain("2 of 3 tasks retired"); expect(detail).toContain("1 left unchanged (Plan release)");
    expect(h.texts.get(last.path)).toContain(`organized:${twin.id}`); expect(h.texts.get(first.path)).not.toContain(plan.id);
  });
  it("restores a task whose todos changed under it and puts a renamed note back, while the others go on", async () => {
    const { h, plan, twin, last, planNote } = await setup(); let thrown = false;
    const realEdit = h.service.edit.bind(h.service); const edit = vi.spyOn(h.service, "edit").mockImplementation(async (file, before, after, changes) => { if (!thrown && file.path === last.path) { thrown = true; throw new Error("changed"); } return realEdit(file, before, after, changes); });
    await h.service.retireTasks({ ...base, lines: "link", notes: "rename" }, backupOk()); edit.mockRestore();
    expect(planNote.path).toBe(h.repo.taskFile(plan.id)!.path); expect(h.texts.get(last.path)).toContain(`organized:${plan.id}`); expect(h.texts.get(last.path)).not.toContain(`organized:${twin.id}`); expect(exists(h, "Tasks/Plan release 2.md")).toBe(true);
    const detail = (Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("left unchanged"))!.message as DocumentFragment).textContent!; expect(detail).toContain("2 of 3 tasks retired"); expect(detail).toContain("1 left unchanged (Plan release)");
  });
  it("does not stop when a renamed note cannot get its name back, and says which names Undo could not restore", async () => {
    const { h, plan, planNote } = await setup(); await h.service.retireTasks({ ...base, notes: "rename" }, backupOk());
    h.files.set(`Tasks/${plan.id}.md`, planNote as never); await h.service.undo(); expect(String(Notice.instances.at(-1)!.message)).toContain("Undo preserved concurrent edits in");
  });
  it("leaves a task note in place when renaming fails, and survives a rename that cannot be taken back", async () => {
    const { h, plan, planNote } = await setup(); h.raw.fileManager.renameFile.mockRejectedValueOnce(new Error("locked"));
    await h.service.retireTasks({ ...base, notes: "rename" }, backupOk()); expect(planNote.path).toBe(h.repo.taskFile(plan.id)!.path); expect(h.texts.get("Daily/2026-01-05.md")).toContain(`organized:${plan.id}`);
    expect(String((Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("left unchanged"))!.message as DocumentFragment).textContent)).toContain("1 left unchanged");
    const failing = vi.spyOn(h.service, "edit").mockRejectedValue(new Error("locked too")); const rename = h.raw.fileManager.renameFile.getMockImplementation()!;
    h.raw.fileManager.renameFile.mockImplementation(async (file: any, to: string) => { if (file.path === "Tasks/Plan release.md") throw new Error("no way back"); return rename(file, to); });
    await h.service.retireTasks({ ...base, notes: "rename" }, backupOk()); failing.mockRestore();
    expect(planNote.path).toBe("Tasks/Plan release.md"); expect(h.texts.get("Daily/2026-01-05.md")).toContain(`organized:${plan.id}`);
  });
});

describe("retiring: unusual notes", () => {
  const retired = (text: string) => Notice.instances.find(n => n.message instanceof DocumentFragment && n.message.textContent!.includes(text))?.message as DocumentFragment | undefined;
  it("handles a task with no todos, todos in ordinary notes, the same task twice in a note, and a single task", async () => {
    Notice.instances.length = 0; const h = harness(true); await h.repo.create("Lone task"); await h.repo.create("Twice here");
    await h.service.retireTasks({ ...base, yaml: "strip", keep: "all" }, backupOk());
    expect(h.repo.file("Tasks/Lone task.md")).not.toBeNull(); expect(retired("2 of 2 tasks retired · 0 todos unlinked")).toBeDefined();
    const h2 = harness(true); const only = await h2.repo.create("Only one"); const other = await h2.repo.create("Twice here");
    const meeting: any = await h2.add("Meetings/Standup.md", `- [ ] Only one <!--organized:${only.id}-->\n- [ ] Twice here <!--organized:${other.id}-->\n- [ ] Twice here <!--organized:${other.id}-->\n`);
    const archive: any = await h2.add("Archive.md", `- [ ] Twice here <!--organized:${other.id}-->\n`);
    await h2.repo.update(other.id, t => ({ ...t, time_tracked_seconds: 600 }));
    await h2.service.retireTasks({ ...base, notes: "trash", keep: "all" }, backupOk());
    // With no daily notes the last note found keeps the text; the same task twice in one note is unlinked both times.
    expect(h2.texts.get(meeting.path)).toBe("- [ ] Only one\n- [ ] Twice here\n- [ ] Twice here\n"); expect(h2.texts.get(archive.path)).toBe("- [ ] Twice here\n  - Tracked 10 min\n");
    expect(String(Notice.instances.at(-1)!.message)).toContain("2 of 2 tasks retired · 4 todos unlinked · 2 moved to Obsidian's trash");
    const h3 = harness(true); const solo = await h3.repo.create("Solo"); await h3.add("A.md", `- [ ] Solo <!--organized:${solo.id}-->\n`); await h3.service.retireTasks(base, backupOk());
    expect(retired("1 of 1 task retired · 1 todo unlinked")!.textContent).toContain("note-backups (retire-1.json)");
  });
  it("names up to three tasks that could not be retired", async () => {
    Notice.instances.length = 0; const h = harness(true); for (const title of ["One", "Two", "Three", "Four"]) await h.repo.create(title);
    const lookup = h.repo.file.bind(h.repo); const spy = vi.spyOn(h.repo, "file").mockImplementation(p => p.startsWith("Tasks/") ? null : lookup(p)); await h.service.retireTasks(base, backupOk()); spy.mockRestore();
    const text = retired("left unchanged")!.textContent!; expect(text).toContain("0 of 4 tasks retired"); expect(text).toContain("4 left unchanged (");
    expect(text.match(/\((.*?)\)/)![1].split(", ")).toHaveLength(3);
  });
  it("puts kept text under the latest daily note whichever order the notes are found in, and honours a given clock", async () => {
    const h = harness(true); const task = await h.repo.create("Dated"); await h.repo.update(task.id, t => ({ ...t, time_tracked_seconds: 600, status: "completed", closed_at: "2026-01-02T00:00:00.000Z" }));
    const late: any = await h.add("Daily/2026-02-01.md", `- [x] Dated <!--organized:${task.id}-->\n`); const early: any = await h.add("Daily/2026-01-01.md", `- [>] Dated <!--organized:${task.id}-->\n`);
    await h.service.retireTasks({ ...base, which: "closed", olderThanDays: 30, notes: "trash", keep: "all" }, backupOk(), Date.parse("2026-03-01T00:00:00Z"));
    expect(h.texts.get(late.path)).toBe("- [x] Dated\n  - Tracked 10 min\n"); expect(h.texts.get(early.path)).toBe("- [>] Dated\n");
  });
  it("copes with a todo that was removed from a note after the notes were read", async () => {
    const h = harness(true); const task = await h.repo.create("Vanishing"); const note: any = await h.add("Daily/2026-01-05.md", `- [ ] Vanishing <!--organized:${task.id}-->\n`);
    await h.service.retireTasks(base, async () => { h.texts.set(note.path, "emptied\n"); return "plugin/note-backups/retire-2.json"; });
    expect(h.texts.get(note.path)).toBe("emptied\n"); expect(Notice.instances.some(n => n.message instanceof DocumentFragment && n.message.textContent!.includes("1 of 1 task retired · 0 todos unlinked"))).toBe(true);
  });
});

