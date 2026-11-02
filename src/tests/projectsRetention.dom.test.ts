// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { localDate } from "../model";
import { Notice } from "./__mocks__/obsidian";
import { writeNoteSection } from "../codec";
import { PROJECT_FRONTMATTER } from "../repository";

installObsidianDom();
beforeEach(() => { Notice.instances.length = 0; });
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const when = (m: number, d: number, h: number, min: number) => new Date(2026, m - 1, d, h, min).toISOString();

describe("project notes carry frontmatter", () => {
  it("creates new project notes with the marker, marks existing ones without losing properties and lists only marked notes", async () => {
    const h = harness(); const task = await h.repo.create("Plan");
    await h.add("Notes/Idea.md", "---\ntags: [x]\n---\nbody"); await h.add("Plain.md", "plain");
    await h.service.projects(task.id, [`${h.repo.projectFolder()}/Fresh.md`, "Notes/Idea.md"]);
    expect(h.texts.get(`${h.repo.projectFolder()}/Fresh.md`)).toContain("organized_type: project");
    expect(h.texts.get("Notes/Idea.md")).toContain("organized_type: project"); expect(h.texts.get("Notes/Idea.md")).toContain("tags"); expect(h.texts.get("Notes/Idea.md")).toContain("body");
    expect(h.repo.projectNotes().sort()).toEqual(["Notes/Idea.md", `${h.repo.projectFolder()}/Fresh.md`]);
    const file = h.repo.file("Notes/Idea.md")!; const writes = h.raw.fileManager.processFrontMatter.mock.calls.length; expect(await h.repo.markProject(file)).toBe(false); expect(h.raw.fileManager.processFrontMatter.mock.calls.length).toBe(writes);
    expect(PROJECT_FRONTMATTER).toBe("---\norganized_type: project\n---\n\n");
  });
  it("marks linked, remembered and project-folder notes once, never task records or missing notes", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const task = await h.repo.create("Plan");
    await h.add("Linked.md", "linked"); await h.add("Known.md", "known"); await h.add(`${folder}/InFolder.md`, "in folder"); await h.add("Unrelated.md", "unrelated"); await h.add(`${folder}/Done.md`, PROJECT_FRONTMATTER);
    await h.repo.update(task.id, t => ({ ...t, projects: ["Linked.md", "Missing.md"] })); h.setSettings({ knownProjects: ["Known.md", h.repo.taskPath(task.id)] });
    expect(await h.service.markProjects()).toBe(3); expect(h.repo.projectNotes().sort()).toEqual(["Known.md", "Linked.md", `${folder}/Done.md`, `${folder}/InFolder.md`]);
    expect(h.texts.get("Unrelated.md")).toBe("unrelated"); expect(await h.service.markProjects()).toBe(0);
    h.raw.fileManager.processFrontMatter.mockRejectedValueOnce(Error("locked")); await h.add("Linked2.md"); h.setSettings({ knownProjects: ["Linked2.md"] }); expect(await h.service.markProjects()).toBe(0);
  });
});

describe("retired tasks keep what the setting says", () => {
  const retire = async (detail: "title" | "description" | "all", forwarded = false) => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: detail });
    const task = await h.repo.create("Plan release");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(40), time_tracked_seconds: 5400, work_sessions: [{ start: when(1, 5, 9, 0), end: when(1, 5, 10, 0) }] }));
    const file = h.repo.file(h.repo.taskPath(task.id))!; h.texts.set(file.path, writeNoteSection(writeNoteSection(h.texts.get(file.path)!, "Description", "Ship it."), "Idea", "Dry run"));
    const first: any = await h.add("Daily/2026-01-05.md", `- [>] Plan release <!--organized:${task.id}-->`);
    const last: any = await h.add("Daily/2026-01-06.md", `# Work\n  - [x] Plan release <!--organized:${task.id}-->\n  - [ ] Next\n`);
    const crlf: any = await h.add("Other.md", `1. [x] Plan release <!--organized:${task.id}-->\r\nafter\r\n`);
    const today: any = await h.add(`Daily/${localDate()}.md`); await h.service.reconcile(today);
    return { h, task, first, last, crlf, forwarded };
  };
  it("title only leaves a plain checkbox", async () => {
    const { h, last, first } = await retire("title"); expect(h.texts.get(last.path)).toBe("# Work\n  - [x] Plan release\n  - [ ] Next\n"); expect(h.texts.get(first.path)).toBe("- [>] Plan release");
  });
  it("description is written once, under the latest daily note, indented into the list item", async () => {
    const { h, last, first, crlf } = await retire("description");
    expect(h.texts.get(last.path)).toBe("# Work\n  - [x] Plan release\n    > Ship it.\n  - [ ] Next\n"); expect(h.texts.get(first.path)).toBe("- [>] Plan release"); expect(h.texts.get(crlf.path)).toBe("1. [x] Plan release\r\nafter\r\n");
  });
  it("everything adds notes, days worked and the tracked total", async () => {
    const { h, last } = await retire("all"); const text = h.texts.get(last.path)!;
    expect(text).toContain("    > Ship it.\n    > **Idea**\n    > Dry run\n    - Worked 2026-01-05: 09:00–10:00 (1 h)\n    - Tracked 1 h 30 min\n  - [ ] Next");
  });
  it("picks the latest daily note whatever order the vault lists notes in", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: "description" }); const task = await h.repo.create("Order");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(40) })); const file = h.repo.file(h.repo.taskPath(task.id))!; h.texts.set(file.path, writeNoteSection(h.texts.get(file.path)!, "Description", "why"));
    const loose: any = await h.add("Loose.md", `- [x] Order <!--organized:${task.id}-->`); const late: any = await h.add("Daily/2026-02-02.md", `- [x] Order <!--organized:${task.id}-->`); const early: any = await h.add("Daily/2026-02-01.md", `- [>] Order <!--organized:${task.id}-->`);
    await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any); expect(h.texts.get(late.path)).toContain("> why"); expect(h.texts.get(early.path)).not.toContain("> why"); expect(h.texts.get(loose.path)).not.toContain("> why");
  });
  it("falls back to a note outside the daily folder, keeps CRLF and numbered indentation", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: "description" }); const task = await h.repo.create("Solo");
    await h.repo.update(task.id, t => ({ ...t, status: "canceled", closed_at: ago(40) })); const file = h.repo.file(h.repo.taskPath(task.id))!; h.texts.set(file.path, writeNoteSection(h.texts.get(file.path)!, "Description", "why"));
    const note: any = await h.add("Other.md", `10. [-] Solo <!--organized:${task.id}-->\r\nafter\r\n`); await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.texts.get(note.path)).toBe("10. [-] Solo\r\n    > why\r\nafter\r\n");
  });
  it("leaves the occurrence untouched and keeps the task note when the task note vanished before cleanup", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 1, autoForward: false, retentionDetail: "all" }); const task = await h.repo.create("Gone");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(5) })); const note: any = await h.add("N.md", `- [x] Gone <!--organized:${task.id}-->`);
    const real = h.repo.file.bind(h.repo); h.repo.file = ((p: string) => p === h.repo.taskPath(task.id) ? null : real(p)) as any; await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.texts.get(note.path)).toContain(task.id);
  });
});

describe("calendar reads retired time back from daily notes", () => {
  it("returns stand-in tasks inside the window, reads a note once and again after it changes", async () => {
    const h = harness(); const note: any = await h.add("Daily/2026-03-05.md", "- [x] Kept\n  - Worked 2026-03-02: 09:00–10:00 (1 h)\n"); await h.add("Daily/2026-03-01.md", "- [x] Before\n  - Worked 2026-03-01: 09:00–10:00\n"); await h.add("Daily/2026-05-01.md", "- [x] Late\n  - Worked 2026-03-02: 09:00–10:00\n"); await h.add("Elsewhere.md", "- [x] X\n  - Worked 2026-03-02: 09:00–10:00\n");
    const first = await h.service.retiredWork("2026-03-02", "2026-03-03"); expect(first.map(r => [r.task.title, r.path])).toEqual([["Kept", note.path]]);
    const reads = h.raw.vault.read.mock.calls.length; const again = await h.service.retiredWork("2026-03-02", "2026-03-03"); expect(again[0].task.id).toBe(first[0].task.id); expect(h.raw.vault.read.mock.calls.length).toBe(reads);
    h.texts.set(note.path, "- [x] Changed\n  - Worked 2026-03-02: 11:00–12:00\n"); note.stat = { mtime: 5, ctime: 0, size: 40 }; expect((await h.service.retiredWork("2026-03-02", "2026-03-03")).map(r => r.task.title)).toEqual(["Changed"]);
  });
});

describe("changing a priority from outside the note reorders its list", () => {
  const setup = async (sortScope: "list" | "none" = "list") => {
    const h = harness(); h.setSettings({ sortScope }); const low = await h.repo.create("Low one"); const mid = await h.repo.create("Mid one"); const target = await h.repo.create("Target");
    await h.repo.update(low.id, t => ({ ...t, priority: "low" })); await h.repo.update(mid.id, t => ({ ...t, priority: "medium" }));
    const note: any = await h.add("Daily/2026-03-04.md", `- [ ] Low one <!--organized:${low.id}-->\n- [ ] Mid one <!--organized:${mid.id}-->\n- [ ] Target <!--organized:${target.id}-->`);
    return { h, target, note, order: () => h.texts.get(note.path)!.split("\n").map(l => l.replace(/^- \[ \] | <!--.*$/g, "")) };
  };
  it("sorts the note the task sits in, with and without a known context", async () => {
    const one = await setup(); await one.h.service.setPriority(one.target.id, "high"); expect(one.order()).toEqual(["Target", "Mid one", "Low one"]); expect((await one.h.repo.read(one.target.id)).priority).toBe("high");
    const two = await setup(); const { parseTasks } = await import("../codec"); const context = { file: two.note, line: parseTasks(two.h.texts.get(two.note.path)!)[2] };
    await two.h.service.setPriority(two.target.id, "high", context); expect(two.order()).toEqual(["Target", "Mid one", "Low one"]); expect(two.h.changed).toHaveBeenCalled();
  });
  it("leaves the order alone when sorting is off, and survives a note that changed underneath", async () => {
    const off = await setup("none"); await off.h.service.setPriority(off.target.id, "high"); expect(off.order()).toEqual(["Low one", "Mid one", "Target"]); expect((await off.h.repo.read(off.target.id)).priority).toBe("high");
    const busy = await setup(); const write = (await import("vitest")).vi.spyOn(busy.h.repo, "write").mockRejectedValue(Error("concurrent")); await busy.h.service.setPriority(busy.target.id, "high"); expect(write).toHaveBeenCalled(); expect((await busy.h.repo.read(busy.target.id)).priority).toBe("high");
    const away = await setup(); const other: any = await away.h.add("Other.md", "- [ ] Elsewhere"); await away.h.service.setPriority(away.target.id, "high", { file: other, line: { line: 0 } as any }); expect(away.h.texts.get(other.path)).toBe("- [ ] Elsewhere"); expect(away.order()).toEqual(["Low one", "Mid one", "Target"]);
    const gone = await setup(); await gone.h.service.setPriority((await gone.h.repo.create("Unlisted")).id, "low"); expect(gone.order()).toEqual(["Low one", "Mid one", "Target"]);
  });
});
