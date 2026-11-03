import { describe, expect, it } from "vitest";
import { newTask, taskFrom } from "../model";
import { describePreview, isDestructive, losesNote, normalizeRetire, ORGANIZED_KEYS, planNames, readableName, retirePreview, selectTasks, stripOrganized, type RetireOptions, type RetireScan } from "../retire";

const base: RetireOptions = { which: "all", olderThanDays: 7, lines: "plain", keep: "title", notes: "keep", yaml: "keep" };
const DAY = 86400000; const now = Date.parse("2026-03-10T12:00:00Z");
const task = (id: string, extra: Record<string, unknown> = {}) => ({ ...newTask(`Task ${id}`, id), ...extra });

describe("retire option rules", () => {
  it("switches combinations that cannot work", () => {
    expect(normalizeRetire({ ...base, yaml: "strip" })).toMatchObject({ yaml: "strip", notes: "rename" });
    expect(normalizeRetire({ ...base, yaml: "strip", notes: "keep" }).notes).toBe("rename");
    expect(normalizeRetire({ ...base, notes: "trash", yaml: "strip", lines: "link" })).toMatchObject({ notes: "trash", yaml: "keep", lines: "plain" });
    expect(normalizeRetire(base)).toEqual(base); expect(normalizeRetire({ ...base, olderThanDays: -3 }).olderThanDays).toBe(7); expect(normalizeRetire({ ...base, olderThanDays: 2.5 }).olderThanDays).toBe(7); expect(normalizeRetire({ ...base, olderThanDays: 0 }).olderThanDays).toBe(0);
    expect(losesNote(base)).toBe(false); expect(losesNote({ ...base, notes: "rename" })).toBe(false); expect(losesNote({ ...base, notes: "trash" })).toBe(true); expect(losesNote({ ...base, yaml: "strip" })).toBe(true);
    expect(isDestructive({ ...base, notes: "trash" })).toBe(true); expect(isDestructive({ ...base, lines: "link", notes: "rename" })).toBe(false);
  });
  it("selects every task, or only finished ones that are old enough and not recurring", () => {
    const closed = (days: number, extra: Record<string, unknown> = {}) => ({ status: "completed", closed_at: new Date(now - days * DAY).toISOString(), ...extra });
    const tasks = [task("old-done", closed(10)), task("fresh-done", closed(2)), task("old-canceled", { status: "canceled", closed_at: new Date(now - 9 * DAY).toISOString() }), task("recurring", closed(30, { recurring: true })), task("open-task"), task("no-date-x", { status: "completed", closed_at: null })] as ReturnType<typeof task>[];
    expect(selectTasks(tasks, base, now)).toHaveLength(6);
    expect(selectTasks(tasks, { ...base, which: "closed", olderThanDays: 7 }, now).map(t => t.id)).toEqual(["old-done", "old-canceled"]);
    expect(selectTasks(tasks, { ...base, which: "closed", olderThanDays: 0 }, now).map(t => t.id)).toEqual(["old-done", "fresh-done", "old-canceled"]);
  });
});

describe("readable file names", () => {
  it("reduces titles to names every platform accepts", () => {
    expect(readableName("Draft the Q1 review")).toBe("Draft the Q1 review"); expect(readableName("Fix [[Note]] and **bold** / path: x?")).toBe("Fix Note and bold path x");
    expect(readableName("CON")).toBe("CON (task)"); expect(readableName("nul.txt")).toBe("nul.txt (task)"); expect(readableName("com1")).toBe("com1 (task)"); expect(readableName("Console")).toBe("Console");
    expect(readableName("Ends with dots...")).toBe("Ends with dots"); expect(readableName("trailing   ")).toBe("trailing"); expect(readableName("???")).toBe("Untitled"); expect(readableName("")).toBe("Untitled");
    expect(readableName("x".repeat(300))).toHaveLength(100); expect(readableName("日本語のタスク 🎯")).toBe("日本語のタスク 🎯");
  });
  it("numbers duplicates and avoids existing files, ignoring case", () => {
    const plan = planNames([{ id: "a", title: "Plan" }, { id: "b", title: "plan" }, { id: "c", title: "Plan" }, { id: "d", title: "Other" }], "Tasks", ["Tasks/Other.md", "Tasks/abc.md"]);
    expect([...plan]).toEqual([["a", "Tasks/Plan.md"], ["b", "Tasks/plan 2.md"], ["c", "Tasks/Plan 3.md"], ["d", "Tasks/Other 2.md"]]);
    expect(planNames([{ id: "a", title: "A" }], "", []).get("a")).toBe("A.md"); expect([...planNames([], "Tasks", [])]).toEqual([]);
  });
});

describe("stripping Organized's properties", () => {
  it("knows every property of the task model", () => {
    expect(new Set(ORGANIZED_KEYS)).toEqual(new Set(Object.keys(taskFrom({ id: "abcdefgh12", title: "t" }, "abcdefgh12")))); expect(ORGANIZED_KEYS).toContain("work_sessions"); expect(ORGANIZED_KEYS).not.toContain("tags");
  });
  it("removes only Organized's properties and the block when nothing is left", () => {
    const keys = ORGANIZED_KEYS.map(k => `${k}: null`).join("\n");
    expect(stripOrganized(`---\n${keys}\n---\n\nThe text\n\n## Sources\nhttps://a.b\n`)).toBe("The text\n\n## Sources\nhttps://a.b\n");
    expect(stripOrganized(`---\n${keys}\ntags:\n  - mine\naliases: [Alt]\n---\n\nThe text\n`)).toBe("---\ntags:\n  - mine\naliases:\n  - Alt\n---\n\nThe text\n");
    expect(stripOrganized(`---\r\n${keys}\r\n---\r\n\r\nText\r\nmore\r\n`)).toBe("Text\r\nmore\r\n"); expect(stripOrganized(`---\r\n${keys}\r\ntags: [x]\r\n---\r\nText\r\n`)).toBe("---\r\ntags:\r\n  - x\r\n---\r\n\r\nText\r\n");
    expect(stripOrganized("No properties at all\n")).toBe("No properties at all\n"); expect(stripOrganized(`---\n${keys}\n---\n`)).toBe("");
  });
});

describe("retire preview", () => {
  const files = (...paths: string[]) => paths.map(path => ({ path }) as never);
  const scan: RetireScan = { tasks: [task("aaaaaaaa"), task("bbbbbbbb")], files: new Map([["aaaaaaaa", files("Daily/1.md", "Daily/2.md")], ["bbbbbbbb", files("Daily/2.md")]]), lines: new Map([["aaaaaaaa", 3], ["bbbbbbbb", 1]]) };
  it("counts what would change and describes it", () => {
    expect(retirePreview(scan, base, now)).toEqual({ tasks: 2, todos: 4, notes: 2, renamed: 0, stripped: 0, trashed: 0 });
    expect(retirePreview(scan, { ...base, yaml: "strip" }, now)).toEqual({ tasks: 2, todos: 4, notes: 2, renamed: 2, stripped: 2, trashed: 0 });
    expect(retirePreview(scan, { ...base, notes: "trash" }, now)).toMatchObject({ renamed: 0, trashed: 2 });
    expect(retirePreview({ tasks: [task("cccccccc")], files: new Map(), lines: new Map() }, base, now)).toEqual({ tasks: 1, todos: 0, notes: 0, renamed: 0, stripped: 0, trashed: 0 });
    expect(describePreview(retirePreview(scan, { ...base, yaml: "strip" }, now))).toBe("2 tasks · 4 todos in 2 notes unlinked · 2 task notes renamed to its title · 2 task notes stripped of properties.");
    expect(describePreview(retirePreview(scan, { ...base, notes: "trash" }, now))).toContain("2 task notes moved to Obsidian's trash");
    expect(describePreview(retirePreview({ tasks: [task("dddddddd")], files: new Map([["dddddddd", files("A.md")]]), lines: new Map([["dddddddd", 1]]) }, base, now))).toBe("1 task · 1 todo in 1 note unlinked.");
    expect(describePreview(retirePreview(scan, { ...base, which: "closed" }, now))).toBe("No tasks match. Nothing will change.");
  });
});
