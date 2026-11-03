// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { stringifyYaml } from "./__mocks__/obsidian";
import { newTask } from "../model";

installObsidianDom();
const note = (id: string, title = "Hand made") => `---\n${stringifyYaml({ ...newTask(title, id) })}---\n\n`;

describe("task notes are named after the todo title", () => {
  it("uses the title, a counter for duplicates in any case, and keeps names unique across the whole vault", async () => {
    const h = harness(); await h.add("Projects/Plan.md", "a user note"); await h.add("Elsewhere/Budget 2.md", "another");
    const names = async (...titles: string[]) => { const out: string[] = []; for (const title of titles) out.push(h.repo.taskFile((await h.repo.create(title)).id)!.path); return out; };
    expect(await names("Write report", "Write report", "WRITE REPORT")).toEqual(["Tasks/Write report.md", "Tasks/Write report 2.md", "Tasks/WRITE REPORT 3.md"]);
    expect(await names("Plan", "Budget")).toEqual(["Tasks/Plan 2.md", "Tasks/Budget.md"]); expect(await names("Budget 2")).toEqual(["Tasks/Budget 2 2.md"]);
  });
  it("makes any title a valid name: illegal characters, reserved names, emoji, very long and empty titles", async () => {
    const h = harness(); const name = async (title: string) => h.repo.taskFile((await h.repo.create(title)).id)!.path;
    expect(await name("a/b: c*d?")).toBe("Tasks/a b c d.md"); expect(await name("CON")).toBe("Tasks/CON (task).md"); expect(await name("_")).toBe("Tasks/_.md");
    expect(await name("😀".repeat(150))).toBe(`Tasks/${"😀".repeat(100)}.md`); expect(await name("???")).toBe("Tasks/Untitled.md"); expect(await name("???")).toBe("Tasks/Untitled 2.md");
  });
  it("retries with the next counter when another note took the name meanwhile, and falls back to the id when the name is refused", async () => {
    const h = harness(); const real = h.raw.vault.create.getMockImplementation()!;
    h.raw.vault.create.mockImplementationOnce(async (p: string, text: string) => { await real(p, "someone else"); throw new Error("Exists"); });
    const first = await h.repo.create("Race"); expect(h.repo.taskFile(first.id)!.path).toBe("Tasks/Race 2.md"); expect(h.texts.get("Tasks/Race.md")).toBe("someone else");
    h.raw.vault.create.mockImplementation(async (p: string, text: string) => { if (!/\/[0-9a-f]{32}\.md$/.test(p)) throw new Error("bad name"); return real(p, text); });
    const refused = await h.repo.create("Refused"); expect(h.repo.taskFile(refused.id)!.path).toBe(`Tasks/${refused.id}.md`);
    h.raw.vault.create.mockImplementation(async () => { throw new Error("disk full"); }); await expect(h.repo.create("Nothing works")).rejects.toThrow("disk full");
  });
  it("renames the note when the title changes, keeps a counter that still fits, and leaves case-only and time-record notes alone", async () => {
    const h = harness(); const a = await h.repo.create("Plan"); const b = await h.repo.create("Plan"); const path = (id: string) => h.repo.taskFile(id)!.path;
    await h.service.title(b.id, "Plan"); expect(path(b.id)).toBe("Tasks/Plan 2.md"); await h.service.title(b.id, "PLAN"); expect(path(b.id)).toBe("Tasks/Plan 2.md");
    await h.service.title(a.id, "Roadmap"); expect(path(a.id)).toBe("Tasks/Roadmap.md"); expect((await h.repo.read(a.id)).title).toBe("Roadmap"); await h.service.title(a.id, "roadmap"); expect(path(a.id)).toBe("Tasks/Roadmap.md");
    await h.service.title(b.id, "Roadmap"); expect(path(b.id)).toBe("Tasks/Roadmap 2.md"); await h.service.title(a.id, "Plan"); expect(path(a.id)).toBe("Tasks/Plan.md");
    await h.repo.update(b.id, t => ({ ...t, converted_to: "Notes/Anything.md" })); await h.service.title(b.id, "Something else"); expect(path(b.id)).toBe("Tasks/Roadmap 2.md");
    h.raw.fileManager.renameFile.mockImplementationOnce(async () => { throw new Error("refused"); }); await h.service.title(a.id, "Fresh start"); expect(path(a.id)).toBe("Tasks/Plan.md"); expect((await h.repo.read(a.id)).title).toBe("Fresh start");
    await h.service.nameNote("missing1234"); // no task note: nothing to do
  });
  it("finds notes by the id in their frontmatter whatever they are called, old id-named notes included", async () => {
    const h = harness(); const idNamed = "a".repeat(32); const titled = "b".repeat(32);
    await h.add(`Tasks/${idNamed}.md`, note(idNamed, "Old style")); await h.add("Tasks/Whatever I called it.md", note(titled, "Titled"));
    expect(h.repo.taskFile(idNamed)!.path).toBe(`Tasks/${idNamed}.md`); expect(h.repo.taskFile(titled)).toBeNull(); // not indexed yet
    expect((await h.repo.read(titled)).title).toBe("Titled"); expect(h.repo.taskFile(titled)!.path).toBe("Tasks/Whatever I called it.md");
    await h.repo.update(titled, t => ({ ...t, priority: "high" })); expect((await h.repo.list()).map(t => t.title).sort()).toEqual(["Old style", "Titled"]);
    await h.add("Tasks/Late arrival.md", note("c".repeat(32), "Late")); await expect(h.repo.read("c".repeat(32))).rejects.toThrow("Missing task"); // looked at the notes a moment ago
    await h.repo.track(h.repo.file("Tasks/Late arrival.md")!); expect((await h.repo.read("c".repeat(32))).title).toBe("Late");
  });
  it("refuses to touch an id that two notes claim and says which notes", async () => {
    const h = harness(); const id = "d".repeat(32); await h.add("Tasks/Original.md", note(id, "Original")); await h.add("Tasks/Original 1.md", note(id, "Original")); await h.add("Tasks/Fine.md", note("e".repeat(32), "Fine"));
    await h.repo.reindex(); expect(h.repo.taskFile(id)).toBeNull();
    await expect(h.repo.read(id)).rejects.toThrow("Two notes claim task"); await expect(h.repo.update(id, t => t)).rejects.toThrow("Tasks/Original 1.md"); await expect(h.service.deleteTask(id)).rejects.toThrow("Two notes claim"); await expect(h.repo.exists(id)).rejects.toThrow("Two notes claim"); expect(await h.repo.exists("e".repeat(32))).toBe(true); expect(await h.repo.exists("nothing1234")).toBe(false);
    expect((await h.repo.list()).map(t => t.title)).toEqual(["Fine"]);
    h.repo.forgetPath("Tasks/Original 1.md"); h.files.delete("Tasks/Original 1.md"); expect(h.repo.taskFile(id)!.path).toBe("Tasks/Original.md");
  });
  it("keeps the lookup in step with renames, moves and deletes, and ignores notes outside the task folder", async () => {
    const h = harness(); const task = await h.repo.create("Moving"); const file = h.repo.taskFile(task.id)!;
    await h.repo.renameNote(file, "Tasks/Renamed by hand.md"); expect(h.repo.taskFile(task.id)).toBe(file); expect((await h.repo.read(task.id)).title).toBe("Moving");
    h.repo.moved("Tasks/Renamed by hand.md", Object.assign(file, { path: "Elsewhere/Out.md" })); expect(h.repo.taskFile(task.id)).toBeNull();
    h.repo.moved("Unknown.md", file); Object.assign(file, { path: "Tasks/Back.md" }); h.repo.moved("Elsewhere/Out.md", file); await h.repo.track(h.repo.file("Elsewhere/Out.md") ?? file);
    const outside: any = await h.add("Elsewhere/Task.md", note("f".repeat(32), "Outside")); await h.repo.track(outside); expect(h.repo.taskFile("f".repeat(32))).toBeNull();
    const broken: any = await h.add("Tasks/Broken.md", "no frontmatter at all"); await h.repo.track(broken); await h.repo.reindex(); expect(h.repo.taskFile("Broken")).toBe(broken);
    await h.repo.trashNote(broken); expect(h.repo.taskFile("Broken")).toBeNull();
    h.raw.vault.adapter.read.mockRejectedValueOnce(new Error("gone")); h.raw.vault.read.mockRejectedValueOnce(new Error("gone")); await h.repo.track(broken); await h.repo.reindex();
  });
  it("answers which tasks became a note by their frontmatter id, and which names are free", async () => {
    const h = harness(); const task = await h.repo.create("Converted"); await h.repo.update(task.id, t => ({ ...t, converted_to: "Notes/N.md" })); expect(h.repo.convertedTo("Notes/N.md")).toEqual([task.id]); expect(h.repo.convertedTo("Other.md")).toEqual([]);
    expect(h.repo.sourcePath(task.id)).toBe("Tasks/Converted.md"); expect(h.repo.sourcePath("nothing1234")).toBe("Tasks/nothing1234.md");
    const taken = h.repo.nameTaken(); expect(taken("Tasks/Converted.md")).toBe(true); expect(taken("Tasks/Free.md")).toBe(false); expect(h.repo.nameTaken(h.repo.taskFile(task.id)!)("Tasks/converted.md")).toBe(false);
  });
  it("keeps answering while the lookup is rebuilt, rebuilds once at a time, and lets what happened meanwhile win", async () => {
    const h = harness(); const stay = await h.repo.create("Stays"); const gone = await h.repo.create("Goes away"); const real = h.repo.readText.bind(h.repo);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
    vi.spyOn(h.repo, "readText").mockImplementation(async file => { if (!held) { held = true; await gate; } return real(file); });
    const first = h.repo.reindex(); expect(h.repo.reindex()).toBe(first); await Promise.resolve();
    expect(h.repo.taskFile(stay.id)!.path).toBe("Tasks/Stays.md"); // the old lookup serves until the new one is ready
    const fresh = await h.repo.create("Born meanwhile"); await h.repo.renameNote(h.repo.taskFile(stay.id)!, "Tasks/Moved meanwhile.md"); await h.repo.trashNote(h.repo.taskFile(gone.id)!);
    release(); await first;
    expect(h.repo.taskFile(fresh.id)!.path).toBe("Tasks/Born meanwhile.md"); expect(h.repo.taskFile(stay.id)!.path).toBe("Tasks/Moved meanwhile.md"); expect(h.repo.taskFile(gone.id)).toBeNull();
    await h.repo.reindex(); expect(h.repo.taskFile(fresh.id)!.path).toBe("Tasks/Born meanwhile.md"); // and a later rebuild is not blocked by the earlier one
  });
});
