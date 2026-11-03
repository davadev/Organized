// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";
import { stringifyYaml } from "./__mocks__/obsidian";
import { newTask } from "../model";
import { parentIds, parseTasks, sameNesting } from "../codec";

installObsidianDom();
afterEach(() => { vi.restoreAllMocks(); });

/** A vault with a few task notes; `link(name)` is how a parent lists one. */
async function fixture() {
  const h = harness(); const make = async (title: string, patch: Record<string, unknown> = {}) => { const task = await h.repo.create(title); if (Object.keys(patch).length) await h.repo.update(task.id, t => ({ ...t, ...patch })); return task; };
  const parent = await make("Parent"); const a = await make("Sub A"); const b = await make("Sub B"); const other = await make("Other");
  const subtasks = async (id: string) => (await h.repo.read(id)).subtasks;
  const nest = (rows: [string, string | null][]) => new Map(rows);
  return { ...h, make, parent, a, b, other, subtasks, nest };
}

describe("subtask relations follow how todos are nested", () => {
  it("lists a todo under its parent when it is linked while nested, and again only once", async () => {
    const f = await fixture(); const text = `- [ ] Parent <!--organized:${f.parent.id}-->\n  - [ ] draft`; const file: any = await f.add("Daily.md", text);
    const context = { file, line: parseTasks(text)[1] }; await f.service.attach(context, f.a);
    expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]"]);
    expect(await f.service.syncSubtasks(new Map(), parentIds(await f.repo.readText(file)))).toBe(0);
  });
  it("moves a todo between parents when it is indented, outdented or moved, and drops it when its line goes", async () => {
    const f = await fixture(); const syncSubtasks = f.service.syncSubtasks.bind(f.service);
    expect(await syncSubtasks(f.nest([[f.a.id, null]]), f.nest([[f.a.id, f.parent.id]]))).toBe(1); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]"]);
    expect(await syncSubtasks(f.nest([[f.a.id, f.parent.id]]), f.nest([[f.a.id, f.other.id]]))).toBe(2); expect(await f.subtasks(f.parent.id)).toEqual([]); expect(await f.subtasks(f.other.id)).toEqual(["[[Sub A]]"]);
    expect(await syncSubtasks(f.nest([[f.a.id, f.other.id]]), f.nest([[f.a.id, null]]))).toBe(1); expect(await f.subtasks(f.other.id)).toEqual([]);
    await syncSubtasks(f.nest([]), f.nest([[f.a.id, f.parent.id], [f.b.id, f.parent.id]])); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]", "[[Sub B]]"]);
    expect(await syncSubtasks(f.nest([[f.a.id, f.parent.id]]), f.nest([]))).toBe(1); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub B]]"]);
    expect(await syncSubtasks(f.nest([[f.b.id, f.parent.id]]), f.nest([[f.b.id, f.parent.id]]))).toBe(0);
  });
  it("gives a task one parent, even when another list still holds it", async () => {
    const f = await fixture(); await f.repo.update(f.other.id, t => ({ ...t, subtasks: ["[[Sub A]]"] }));
    await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id]]));
    expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]"]); expect(await f.subtasks(f.other.id)).toEqual([]); expect((await f.repo.parentOf(f.a.id))!.id).toBe(f.parent.id);
  });
  it("ignores what cannot be a subtask: itself, its own ancestor, a recurring task, a missing or ambiguous note", async () => {
    const f = await fixture(); const sync = (child: string, parent: string) => f.service.syncSubtasks(new Map(), new Map([[child, parent]]));
    expect(await sync(f.a.id, f.a.id)).toBe(0); await sync(f.a.id, f.parent.id); await sync(f.b.id, f.a.id);
    expect(await sync(f.parent.id, f.b.id)).toBe(0); expect(await f.subtasks(f.b.id)).toEqual([]);
    const recurring = await f.make("Repeats", { recurring: true }); expect(await sync(recurring.id, f.parent.id)).toBe(0); expect(await sync(f.other.id, recurring.id)).toBe(0);
    expect(await sync("missing12345", f.parent.id)).toBe(0); expect(await sync(f.other.id, "missing12345")).toBe(0);
    const copy: any = await f.add("Tasks/Copy of other.md", f.texts.get(f.repo.taskFile(f.other.id)!.path)!); await f.repo.track(copy); expect(await sync(f.other.id, f.parent.id)).toBe(0);
    expect(await f.service.syncSubtasks(new Map([["missing12345", f.parent.id]]), new Map())).toBe(0); expect(await f.service.syncSubtasks(new Map([[f.a.id, "missing12345"]]), new Map())).toBe(0);
  });
  it("derives the nesting of a note from linked todos that occur once", () => {
    const text = `- [ ] Top <!--organized:aaaaaaaa-->\n  - [ ] Kid <!--organized:bbbbbbbb-->\n  - [ ] Plain\n- [ ] Twice <!--organized:cccccccc-->\n  - [ ] Under twice <!--organized:dddddddd-->\n- [ ] Twice <!--organized:cccccccc-->`;
    expect([...parentIds(text)]).toEqual([["aaaaaaaa", null], ["bbbbbbbb", "aaaaaaaa"], ["dddddddd", null]]);
    expect(sameNesting(new Map([["x", null]]), new Map())).toBe(true); expect(sameNesting(new Map([["x", "y"]]), new Map())).toBe(false);
  });
});

describe("links to task notes", () => {
  it("resolves a link by file name, case-insensitively, and not a stale or shared name", async () => {
    const f = await fixture(); expect(f.repo.fileOfLink("[[sub a]]")).toBe(f.repo.taskFile(f.a.id)); expect(f.repo.fileOfLink("[[Gone]]")).toBeNull();
    const one: any = await f.add("Tasks/Twin.md", `---\n${stringifyYaml({ ...newTask("Twin", "twin0001") })}---\n`); const two: any = await f.add("Tasks/twin.md", `---\n${stringifyYaml({ ...newTask("Twin", "twin0002") })}---\n`);
    await f.repo.track(one); await f.repo.track(two); expect(f.repo.fileOfLink("[[Twin]]")).toBeNull();
    await f.repo.renameNote(f.repo.taskFile(f.a.id)!, "Tasks/Renamed.md"); expect(f.repo.fileOfLink("[[Sub A]]")).toBeNull(); expect(f.repo.fileOfLink("[[Renamed]]")).toBe(f.repo.taskFile(f.a.id));
  });
  it("lists subtasks in order, leaving out stale links, recurring and invalid notes and repeats", async () => {
    const f = await fixture(); const recurring = await f.make("Repeats", { recurring: true }); const bad: any = await f.add("Tasks/Broken.md", "no properties"); await f.repo.track(bad);
    await f.repo.update(f.parent.id, t => ({ ...t, subtasks: ["[[Sub B]]", "[[Gone]]", "[[Repeats]]", "[[Broken]]", "[[Sub A]]", "[[sub b]]"] }));
    expect((await f.repo.subtasksOf(await f.repo.read(f.parent.id))).map(t => t.title)).toEqual(["Sub B", "Sub A"]); void recurring;
  });
  it("counts progress without canceled subtasks, and has none without subtasks", async () => {
    const f = await fixture(); const parent = () => f.repo.read(f.parent.id);
    expect(await f.repo.progress(await parent())).toBeNull();
    await f.repo.update(f.parent.id, t => ({ ...t, subtasks: ["[[Sub A]]", "[[Sub B]]", "[[Other]]"] }));
    expect(await f.repo.progress(await parent())).toEqual({ done: 0, total: 3 });
    await f.repo.update(f.a.id, t => ({ ...t, status: "completed" })); await f.repo.update(f.b.id, t => ({ ...t, status: "canceled" }));
    expect(await f.repo.progress(await parent())).toEqual({ done: 1, total: 2 });
    await f.repo.update(f.other.id, t => ({ ...t, status: "canceled" })); await f.repo.update(f.a.id, t => ({ ...t, status: "canceled" }));
    expect(await f.repo.progress(await parent())).toBeNull();
  });
  it("finds the parent of a task, and none for a task without a note", async () => {
    const f = await fixture(); await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id]]));
    expect((await f.repo.parentOf(f.a.id))!.id).toBe(f.parent.id); expect(await f.repo.parentOf(f.b.id)).toBeNull(); expect(await f.repo.parentOf("missing12345")).toBeNull();
  });
});

describe("linking tasks from the panel", () => {
  it("makes a task a subtask of another, once, and says why it cannot", async () => {
    const f = await fixture(); await f.service.makeSubtask(f.parent.id, f.a.id); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]"]);
    Notice.instances.length = 0; await f.service.makeSubtask(f.parent.id, f.a.id); expect(String(Notice.instances.at(-1)!.message)).toContain("already a subtask");
    await f.service.makeSubtask(f.other.id, f.a.id); expect(await f.subtasks(f.parent.id)).toEqual([]); expect(await f.subtasks(f.other.id)).toEqual(["[[Sub A]]"]);
    await expect(f.service.makeSubtask(f.a.id, f.a.id)).rejects.toThrow("cannot be a subtask of itself"); await expect(f.service.makeSubtask(f.a.id, f.other.id)).rejects.toThrow("cannot be a subtask of itself");
    const recurring = await f.make("Repeats", { recurring: true }); await expect(f.service.makeSubtask(f.parent.id, recurring.id)).rejects.toThrow("Recurring tasks cannot");
    await expect(f.service.makeSubtask(f.parent.id, "missing12345")).rejects.toThrow("could not be found");
  });
  it("takes a task out of its parent's list, and does nothing for one without a parent", async () => {
    const f = await fixture(); await f.service.makeSubtask(f.parent.id, f.a.id); await f.service.detachSubtask(f.a.id); expect(await f.subtasks(f.parent.id)).toEqual([]);
    await f.service.detachSubtask(f.a.id); await f.service.detachSubtask("missing12345");
  });
});

describe("keeping the lists right when tasks are renamed, deleted and repaired", () => {
  it("renames a subtask's link when its note is renamed after a new title", async () => {
    const f = await fixture(); await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id], [f.b.id, f.parent.id]]));
    await f.service.title(f.a.id, "Sub A renamed"); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A renamed]]", "[[Sub B]]"]);
    await f.service.title(f.other.id, "Other renamed"); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A renamed]]", "[[Sub B]]"]);
  });
  it("keeps the new name when the parent's list cannot be updated", async () => {
    const f = await fixture(); await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id]])); const real = f.repo.update.bind(f.repo);
    vi.spyOn(f.repo, "update").mockImplementation((id, change) => id === f.parent.id ? Promise.reject(new Error("busy")) : real(id, change));
    await f.service.title(f.a.id, "Still renamed"); expect(f.repo.taskFile(f.a.id)!.basename).toBe("Still renamed");
  });
  it("leaves the list alone when the note cannot be renamed", async () => {
    const f = await fixture(); await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id]])); f.raw.fileManager.renameFile.mockRejectedValueOnce(new Error("refused"));
    await f.service.title(f.a.id, "Refused"); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]"]);
  });
  it("removes a deleted subtask from its parent, and says which subtasks stay when a parent is deleted", async () => {
    const f = await fixture(); await f.service.syncSubtasks(new Map(), new Map([[f.a.id, f.parent.id], [f.b.id, f.parent.id]]));
    expect(await f.service.deleteTask(f.a.id)).toBe(true); expect(f.confirm).toHaveBeenLastCalledWith(expect.not.stringContaining("subtask"), expect.anything(), expect.anything());
    expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub B]]"]);
    expect(await f.service.deleteTask(f.parent.id)).toBe(true); expect(f.confirm).toHaveBeenLastCalledWith(expect.stringContaining("Its 1 subtask stay as separate tasks."), expect.anything(), expect.anything());
    expect((await f.repo.read(f.b.id)).title).toBe("Sub B");
  });
  it("repairs the lists of the todos in a note, drops stale links, and says when nothing was wrong", async () => {
    const f = await fixture(); const text = `- [ ] Parent <!--organized:${f.parent.id}-->\n  - [ ] A <!--organized:${f.a.id}-->\n  - [ ] B <!--organized:${f.b.id}-->`; const file: any = await f.add("Daily.md", text);
    await f.repo.update(f.parent.id, t => ({ ...t, subtasks: ["[[Gone]]"] })); Notice.instances.length = 0;
    await f.service.repairSubtasks(file); expect(await f.subtasks(f.parent.id)).toEqual(["[[Sub A]]", "[[Sub B]]"]); expect(String(Notice.instances.at(-1)!.message)).toContain("Repaired 3 subtask lists");
    await f.service.repairSubtasks(file); expect(String(Notice.instances.at(-1)!.message)).toContain("already in order");
  });
  it("links subtasks while converting a note's todos", async () => {
    const f = await fixture(); const file: any = await f.add("Plain.md", "- [ ] First\n  - [ ] Second\n  - [ ] Third"); f.confirm.mockResolvedValue(true);
    await f.service.convertTodos(file); const [first] = parseTasks(await f.repo.readText(file)); expect(await f.subtasks(first.id!)).toEqual(["[[Second]]", "[[Third]]"]);
  });
});
