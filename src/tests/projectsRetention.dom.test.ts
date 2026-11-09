// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { localDate } from "../model";
import { Notice } from "./__mocks__/obsidian";
import { moveTask, parseTasks, sectionNamed, writeNoteSection } from "../codec";
import { projectTemplate } from "../repository";

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
    expect(projectTemplate("2026-03-04")).toBe("---\norganized_type: project\norganized_start: 2026-03-04\n---\n\n## Open\n\n## In progress\n\n## Ongoing\n\n## Done\n"); expect(projectTemplate()).toContain(`organized_start: ${localDate()}`);
  });
  it("marks linked, remembered and project-folder notes once, never task records or missing notes", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const task = await h.repo.create("Plan");
    await h.add("Linked.md", "linked"); await h.add("Known.md", "known"); await h.add(`${folder}/InFolder.md`, "in folder"); await h.add("Unrelated.md", "unrelated"); await h.add(`${folder}/Done.md`, projectTemplate());
    await h.repo.update(task.id, t => ({ ...t, projects: ["Linked.md", "Missing.md"] })); h.setSettings({ knownProjects: ["Known.md", h.repo.taskFile(task.id)!.path] });
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
    const file = h.repo.taskFile(task.id)!; h.texts.set(file.path, writeNoteSection(writeNoteSection(h.texts.get(file.path)!, "Description", "Ship it."), "Sources", "Dry run"));
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
    expect(text).toContain("    > Ship it.\n    > **Sources**\n    > Dry run\n    - Worked 2026-01-05: 09:00–10:00 (1h)\n    - Tracked 1h 30min\n  - [ ] Next");
  });
  it("picks the latest daily note whatever order the vault lists notes in", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: "description" }); const task = await h.repo.create("Order");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(40) })); const file = h.repo.taskFile(task.id)!; h.texts.set(file.path, writeNoteSection(h.texts.get(file.path)!, "Description", "why"));
    const loose: any = await h.add("Loose.md", `- [x] Order <!--organized:${task.id}-->`); const late: any = await h.add("Daily/2026-02-02.md", `- [x] Order <!--organized:${task.id}-->`); const early: any = await h.add("Daily/2026-02-01.md", `- [>] Order <!--organized:${task.id}-->`);
    await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any); expect(h.texts.get(late.path)).toContain("> why"); expect(h.texts.get(early.path)).not.toContain("> why"); expect(h.texts.get(loose.path)).not.toContain("> why");
  });
  it("falls back to a note outside the daily folder, keeps CRLF and numbered indentation", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: "description" }); const task = await h.repo.create("Solo");
    await h.repo.update(task.id, t => ({ ...t, status: "canceled", closed_at: ago(40) })); const file = h.repo.taskFile(task.id)!; h.texts.set(file.path, writeNoteSection(h.texts.get(file.path)!, "Description", "why"));
    const note: any = await h.add("Other.md", `10. [-] Solo <!--organized:${task.id}-->\r\nafter\r\n`); await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.texts.get(note.path)).toBe("10. [-] Solo\r\n    > why\r\nafter\r\n");
  });
  it("leaves the occurrence untouched and keeps the task note when the task note vanished before cleanup", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 1, autoForward: false, retentionDetail: "all" }); const task = await h.repo.create("Gone");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(5) })); const note: any = await h.add("N.md", `- [x] Gone <!--organized:${task.id}-->`);
    const real = h.repo.file.bind(h.repo); const goneNote = h.repo.taskFile(task.id)!.path; h.repo.file = ((p: string) => p === goneNote ? null : real(p)) as any; await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.texts.get(note.path)).toContain(task.id);
  });
});

describe("calendar reads retired time back from daily notes", () => {
  it("returns stand-in tasks inside the window, reads a note once and again after it changes", async () => {
    const h = harness(); const note: any = await h.add("Daily/2026-03-05.md", "- [x] Kept\n  - Worked 2026-03-02: 09:00–10:00 (1h)\n"); await h.add("Daily/2026-03-01.md", "- [x] Before\n  - Worked 2026-03-01: 09:00–10:00\n"); await h.add("Daily/2026-05-01.md", "- [x] Late\n  - Worked 2026-03-02: 09:00–10:00\n"); await h.add("Elsewhere.md", "- [x] X\n  - Worked 2026-03-02: 09:00–10:00\n");
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
    const busy = await setup(); const write = (await import("vitest")).vi.spyOn(busy.h.repo, "write").mockRejectedValue(Error("concurrent")); Notice.instances.length = 0; await busy.h.service.setPriority(busy.target.id, "high"); expect(write).toHaveBeenCalled(); expect(String(Notice.instances.at(-1)?.message)).toContain("could not be reordered"); expect((await busy.h.repo.read(busy.target.id)).priority).toBe("high");
    const away = await setup(); const other: any = await away.h.add("Other.md", "- [ ] Elsewhere"); await away.h.service.setPriority(away.target.id, "high", { file: other, line: { line: 0 } as any }); expect(away.h.texts.get(other.path)).toBe("- [ ] Elsewhere"); expect(away.order()).toEqual(["Low one", "Mid one", "Target"]);
    const gone = await setup(); await gone.h.service.setPriority((await gone.h.repo.create("Unlisted")).id, "low"); expect(gone.order()).toEqual(["Low one", "Mid one", "Target"]);
  });
});

describe("project colours in frontmatter", () => {
  it("saves a colour as #rrggbb next to the marker, reads it back, validates, clears it and picks the first coloured project for a task", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const a: any = await h.add(`${folder}/A.md`, "---\ntags: [x]\n---\nbody"); await h.add(`${folder}/B.md`, projectTemplate()); await h.add(`${folder}/Bad.md`, "---\norganized_color: blue\n---\n");
    await h.service.setProjectColor(a.path, "#3B82F6"); expect(h.texts.get(a.path)).toContain("organized_color: '#3b82f6'"); expect(h.texts.get(a.path)).toContain("organized_type: project"); expect(h.texts.get(a.path)).toContain("tags"); expect(h.changed).toHaveBeenCalled();
    expect(h.repo.projectColor(a.path)).toBe("#3b82f6"); expect(h.repo.projectColor(`${folder}/B.md`)).toBeNull(); expect(h.repo.projectColor(`${folder}/Bad.md`)).toBeNull(); expect(h.repo.projectColor("Missing.md")).toBeNull();
    const task = { ...(await h.repo.create("T")), projects: [`${folder}/B.md`, a.path, `${folder}/Bad.md`] }; expect(h.repo.taskColor(task)).toBe("#3b82f6"); expect(h.repo.taskColor({ ...task, projects: [`${folder}/B.md`] })).toBeNull(); expect(h.repo.taskColor({ ...task, projects: [] })).toBeNull();
    await expect(h.service.setProjectColor(a.path, "blue")).rejects.toThrow("#3b82f6"); await expect(h.service.setProjectColor("Missing.md", "#000000")).rejects.toThrow("renamed or removed");
    await h.service.setProjectColor(a.path, null); expect(h.texts.get(a.path)).not.toContain("organized_color"); expect(h.repo.projectColor(a.path)).toBeNull();
    const plain: any = await h.add("Plain.md", "plain"); await h.service.setProjectColor(plain.path, "#000000"); expect(h.repo.isProjectNote(plain)).toBe(true);
  });
});

describe("manual sessions", () => {
  it("adds a session and counts it toward the total, edits it, deletes it and refuses a vanished one", async () => {
    const h = harness(); const task = await h.repo.create("Plan"); const at = (hh: number, mm = 0) => new Date(2026, 2, 4, hh, mm).toISOString(); const a = { start: at(9), end: at(10) }; const b = { start: at(11), end: at(11, 30) };
    await h.service.addSession(task.id, b); await h.service.addSession(task.id, a); let t = await h.repo.read(task.id); expect(t.work_sessions).toEqual([a, b]); expect(t.time_tracked_seconds).toBe(3600 + 1800); expect(h.changed).toHaveBeenCalled();
    await h.service.changeSession(task.id, a, { start: at(9), end: at(10, 30) }); t = await h.repo.read(task.id); expect(t.time_tracked_seconds).toBe(5400 + 1800); expect(t.work_sessions[0].end).toBe(at(10, 30));
    await h.service.changeSession(task.id, b, null); t = await h.repo.read(task.id); expect(t.work_sessions).toHaveLength(1); expect(t.time_tracked_seconds).toBe(5400);
    await expect(h.service.changeSession(task.id, b, null)).rejects.toThrow("no longer exists");
    await h.repo.update(task.id, x => ({ ...x, time_tracked_seconds: 10 })); await h.service.changeSession(task.id, { start: at(9), end: at(10, 30) }, null); expect((await h.repo.read(task.id)).time_tracked_seconds).toBe(0);
  });
});

describe("project sections and start date", () => {
  const lines = (text: string) => text.split("\n"); const started = (text: string, date = localDate()) => new RegExp(`organized_start: '?${date}'?`).test(text);
  it("links a task under the heading for its status and moves it as the status changes", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const note = `${folder}/Plan.md`; const a = await h.repo.create("Alpha"); const b = await h.repo.create("Beta");
    await h.service.projects(a.id, [note]); await h.service.projects(b.id, [note]);
    const read = () => h.texts.get(note)!; expect(read()).toContain("organized_type: project"); expect(started(read())).toBe(true);
    const under = (heading: string) => { const l = lines(read()); const at = l.indexOf(`## ${heading}`); const rest = l.slice(at + 1); const end = rest.findIndex(x => x.startsWith("## ")); return (end < 0 ? rest : rest.slice(0, end)).filter(x => x.trim()); };
    expect(under("Open").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [ ] Alpha", "- [ ] Beta"]); expect(under("Done")).toEqual([]);
    await h.service.status(a.id, "in_progress"); expect(under("In progress").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [/] Alpha"]); expect(under("Open").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [ ] Beta"]);
    await h.service.status(a.id, "completed"); expect(under("Done").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [x] Alpha"]); expect(under("In progress")).toEqual([]);
    await h.service.status(b.id, "canceled"); expect(under("Canceled").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [-] Beta"]); expect(under("Open")).toEqual([]);
    await h.service.status(a.id, "completed"); expect(under("Done")).toHaveLength(1); expect(read().match(/organized:/g)!.length).toBe(2);
    const done = await h.repo.create("Gamma"); await h.repo.update(done.id, t => ({ ...t, status: "completed" })); await h.service.projects(done.id, [note]); expect(under("Done").map(x => x.replace(/ <!--.*/, ""))).toEqual(["- [x] Alpha", "- [x] Gamma"]);
  });
  it("keeps recurring tasks under Ongoing, and moves a task there and back when recurrence is toggled", async () => {
    const h = harness(); const note: any = await h.add("Tasks/Projects/Routine.md", projectTemplate("2026-03-04")); const under = (heading: string) => { const l = h.texts.get(note.path)!.split("\n"); const rest = l.slice(l.indexOf(`## ${heading}`) + 1); const end = rest.findIndex(x => x.startsWith("## ")); return (end < 0 ? rest : rest.slice(0, end)).filter(x => x.trim()).map(x => x.replace(/ <!--.*/, "")); };
    const habit = await h.repo.create("Water plants"); await h.repo.update(habit.id, t => ({ ...t, recurring: true })); await h.service.projects(habit.id, [note.path]); expect(under("Ongoing")).toEqual(["- [ ] Water plants"]); expect(under("Open")).toEqual([]);
    await h.service.status(habit.id, "completed"); expect(under("Ongoing")).toEqual(["- [ ] Water plants"]); expect(under("Done")).toEqual([]);
    const task = await h.repo.create("Weekly review"); await h.service.projects(task.id, [note.path]); expect(under("Open")).toEqual(["- [ ] Weekly review"]);
    await h.service.recurrence(task.id); expect(under("Ongoing")).toEqual(["- [ ] Water plants", "- [ ] Weekly review"]); expect(under("Open")).toEqual([]);
    await h.service.recurrence(task.id); expect(under("Open")).toEqual(["- [ ] Weekly review"]); expect(under("Ongoing")).toEqual(["- [ ] Water plants"]);
    // A project line that was deleted by hand is skipped, not an error.
    const gone = await h.repo.create("Gone"); await h.service.projects(gone.id, [note.path]); h.texts.set(note.path, h.texts.get(note.path)!.replace(/- \[ \] Gone.*\n/, "")); await h.repo.update(gone.id, t => ({ ...t, projects: [...t.projects, "Missing project.md"] })); await h.service.recurrence(gone.id); expect(h.texts.get(note.path)).not.toContain("Gone");
  });
  it("uses the headings a note already has, at any level, and creates missing ones in an older note", async () => {
    const h = harness(); const task = await h.repo.create("Legacy"); const other = await h.repo.create("Other");
    const note: any = await h.add("Old project.md", `---\norganized_type: project\norganized_start: 2026-01-01\n---\nIntro text\n\n### done\n- [x] Old finished\n\n## Notes\nfree text\n`);
    await h.service.projects(task.id, [note.path]); await h.service.status(task.id, "completed");
    expect(h.texts.get(note.path)).toContain("### done\n- [x] Old finished\n- [x] Legacy <!--organized:" + task.id + "-->"); expect(h.texts.get(note.path)).not.toContain("## Done");
    await h.service.projects(other.id, [note.path]); const text = h.texts.get(note.path)!; expect(text).toContain("## Open"); expect(text.indexOf("## Open")).toBeGreaterThan(text.indexOf("free text")); expect(text).toContain("free text");
    await h.service.status(other.id, "in_progress"); expect(h.texts.get(note.path)).toContain("## In progress\n"); expect(h.texts.get(note.path)).toMatch(/## In progress\n+- \[\/\] Other/);
  });
  it("leaves daily notes and ambiguous project lines alone", async () => {
    const h = harness(); const task = await h.repo.create("Twice"); const note = `${h.repo.projectFolder()}/Dup.md`;
    const daily: any = await h.add(`Daily/${localDate()}.md`, `# Today\n- [ ] Twice <!--organized:${task.id}-->\n`); await h.add(note, `---\norganized_type: project\n---\n- [ ] Twice <!--organized:${task.id}-->\n- [ ] Twice <!--organized:${task.id}-->\n`);
    await h.service.status(task.id, "completed"); expect(h.texts.get(daily.path)).toBe(`# Today\n- [x] Twice <!--organized:${task.id}-->\n`); expect(h.texts.get(note)).not.toContain("## Done");
  });
  it("dates the start of projects that lack one, keeps an existing start and sets one when a colour is chosen", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const old: any = await h.add(`${folder}/Old.md`, `---\norganized_type: project\n---\nbody`); const dated: any = await h.add(`${folder}/Dated.md`, `---\norganized_type: project\norganized_start: 2025-05-05\n---\n`);
    const bare: any = await h.add(`${folder}/Bare.md`, "plain"); const bad: any = await h.add(`${folder}/Bad.md`, `---\norganized_type: project\norganized_start: soon\n---\n`);
    expect(await h.service.markProjects()).toBe(3); expect(started(h.texts.get(old.path)!)).toBe(true); expect(started(h.texts.get(dated.path)!, "2025-05-05")).toBe(true); expect(started(h.texts.get(bare.path)!)).toBe(true); expect(started(h.texts.get(bad.path)!)).toBe(true); expect(await h.service.markProjects()).toBe(0);
    const colored: any = await h.add("Colored.md", `---\norganized_type: project\n---\n`); await h.service.setProjectColor(colored.path, "#3b82f6"); expect(started(h.texts.get(colored.path)!)).toBe(true);
    // A YAML reader that turns a bare date into a Date still counts as a start; an invalid Date does not.
    const kept: Record<string, unknown> = { organized_start: new Date("2025-05-05") }; const lost: Record<string, unknown> = { organized_start: new Date(NaN) };
    h.raw.fileManager.processFrontMatter.mockImplementationOnce(async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => fn(kept)); await h.service.setProjectColor(dated.path, "#3b82f6");
    h.raw.fileManager.processFrontMatter.mockImplementationOnce(async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => fn(lost)); await h.service.setProjectColor(dated.path, "#3b82f6");
    expect(kept.organized_start).toBeInstanceOf(Date); expect((kept.organized_start as Date).getFullYear()).toBe(2025); expect(typeof lost.organized_start).toBe("string");
    await h.service.setProjectColor(dated.path, "#3b82f6"); expect(started(h.texts.get(dated.path)!, "2025-05-05")).toBe(true); expect(await h.repo.markProject(h.repo.file(dated.path)!, "2030-01-01")).toBe(false);
  });
  it("moves lines in text directly, keeping a line that is already in place and refusing missing or doubled ones", () => {
    const text = "## Open\n- [ ] A <!--organized:aaaaaaaa1-->\n\n## Done\n- [x] B <!--organized:bbbbbbbb1-->\n"; expect(moveTask(text, "aaaaaaaa1", "Open")).toBe(text);
    expect(moveTask(text, "aaaaaaaa1", "Done")).toBe("## Open\n\n## Done\n- [x] B <!--organized:bbbbbbbb1-->\n- [ ] A <!--organized:aaaaaaaa1-->\n"); expect(moveTask("- [ ] A <!--organized:aaaaaaaa1-->\r\n", "aaaaaaaa1", "Done")).toContain("## Done");
    expect(() => moveTask(text, "missing11", "Done")).toThrow("ambiguous"); expect(() => moveTask(text + "- [ ] A <!--organized:aaaaaaaa1-->\n", "aaaaaaaa1", "Done")).toThrow("ambiguous");
    expect(sectionNamed("## Open\n- [ ] x\n", "open")).toEqual([{ level: 2, text: "Open", ordinal: 0 }]); expect(sectionNamed("", "Done")).toEqual([{ level: 2, text: "Done", ordinal: 0 }]);
  });
  it("adds only the missing property: a start date without the project marker keeps its date", async () => {
    const h = harness(); const note: any = await h.add("Half.md", "---\norganized_start: 2024-02-02\n---\nbody"); expect(await h.repo.markProject(note, "2030-01-01")).toBe(true); expect(h.texts.get(note.path)).toContain("organized_type: project"); expect(h.texts.get(note.path)).toMatch(/organized_start: '?2024-02-02'?/); expect(h.texts.get(note.path)).not.toContain("2030");
  });
});

describe("standalone notes from tasks", () => {
  const setup = async (title = "Plan launch") => {
    const h = harness(); const task = await h.repo.create(title); const file = h.repo.taskFile(task.id)!;
    h.texts.set(file.path, writeNoteSection(writeNoteSection(h.texts.get(file.path)!, "Description", "Why we launch.\n\n## Plan\nSteps"), "Sources", "https://a.b"));
    const today: any = await h.add(`Daily/${localDate()}.md`, `# Work\n  - [ ] ${title} <!--organized:${task.id}-->\n  - [ ] Other\n`); const old: any = await h.add("Daily/2026-01-05.md", `- [>] ${title} <!--organized:${task.id}-->\n`);
    const project: any = await h.add("Tasks/Projects/Alpha.md", `## Open\n- [ ] ${title} <!--organized:${task.id}-->\n`);
    const context = { file: today, line: parseTasks(h.texts.get(today.path)!)[0] };
    return { h, task, file, today, old, project, context };
  };
  const options = { folder: "Notes", tags: ["idea"], template: null, clash: "new" as const };
  it("creates the note and leaves one link where the task was converted, removing every other copy and the task note", async () => {
    const { h, task, file, today, old, project, context } = await setup(); const made = await h.service.convertToNote(task.id, options, context);
    expect(made.path).toBe("Notes/Plan launch.md"); expect(h.texts.get(made.path)).toBe("---\ntags:\n  - idea\n---\n\nWhy we launch.\n\n## Plan\nSteps\n\n## Sources\nhttps://a.b\n");
    expect(h.texts.get(today.path)).toBe("# Work\n  - [[Notes/Plan launch]]\n  - [ ] Other\n"); expect(h.texts.get(old.path)).toBe(""); expect(h.texts.get(project.path)).toBe("## Open\n");
    expect(h.repo.file(file.path)).toBeNull(); expect(h.raw.fileManager.trashFile).toHaveBeenCalledWith(file); expect(h.changed).toHaveBeenCalled(); expect(h.raw.fileManager.generateMarkdownLink).toHaveBeenCalledWith(made, today.path);
  });
  it("keeps the task note, hidden, when the task tracked time: a running timer is logged first and the calendar still sees the sessions", async () => {
    const { h, task, file, context } = await setup(); const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();
    await h.repo.update(task.id, t => ({ ...t, status: "in_progress", time_tracking_started_at: minutesAgo(10), work_sessions: [{ start: minutesAgo(200), end: minutesAgo(180) }], time_tracked_seconds: 1200 }));
    const made = await h.service.convertToNote(task.id, options, context);
    expect(h.raw.fileManager.trashFile).not.toHaveBeenCalled(); expect(h.repo.file(file.path)).not.toBeNull();
    const kept = await h.repo.read(task.id); expect(kept.converted_to).toBe(made.path); expect(kept.time_tracking_started_at).toBeNull(); expect(kept.work_sessions).toHaveLength(2); expect(kept.status).toBe("open");
    expect((await h.repo.list()).map(t => t.id)).not.toContain(task.id); expect((await h.repo.list(true)).map(t => t.id)).toContain(task.id);
  });
  it("trashes the task note when only a sub-minute run exists", async () => {
    const { h, task, file, context } = await setup(); await h.repo.update(task.id, t => ({ ...t, status: "in_progress", time_tracking_started_at: new Date(Date.now() - 20000).toISOString() }));
    await h.service.convertToNote(task.id, options, context); expect(h.raw.fileManager.trashFile).toHaveBeenCalledWith(file);
  });
  it("works from the panel without a line: the latest daily note keeps the link", async () => {
    const { h, task, today, old } = await setup(); await h.service.convertToNote(task.id, { ...options, folder: "", tags: [] });
    expect(h.texts.get("Plan launch.md")).toContain("Why we launch."); expect(h.texts.get(today.path)).toContain("  - [[Plan launch]]"); expect(h.texts.get(old.path)).toBe("");
  });
  it("numbers the name or links the existing note when one of that name exists, never overwriting it", async () => {
    const { h, task, today, context } = await setup(); await h.add("Notes/Plan launch.md", "mine"); await h.add("Notes/Plan launch 2.md", "also mine");
    const made = await h.service.convertToNote(task.id, options, context); expect(made.path).toBe("Notes/Plan launch 3.md"); expect(h.texts.get("Notes/Plan launch.md")).toBe("mine"); expect(h.texts.get(today.path)).toContain("[[Notes/Plan launch 3]]");
    const second = await setup(); await second.h.add("Notes/Plan launch.md", "mine"); const linked = await second.h.service.convertToNote(second.task.id, { ...options, clash: "existing" }, second.context);
    expect(linked.path).toBe("Notes/Plan launch.md"); expect(second.h.texts.get("Notes/Plan launch.md")).toBe("mine"); expect(second.h.texts.get(second.today.path)).toContain("[[Notes/Plan launch]]"); expect(second.h.repo.file(second.file.path)).toBeNull();
    const third = await setup(); const fresh = await third.h.service.convertToNote(third.task.id, { ...options, clash: "existing" }, third.context); expect(fresh.path).toBe("Notes/Plan launch.md"); expect(third.h.texts.get(fresh.path)).toContain("Why we launch.");
  });
  it("applies a template, and refuses a missing template or a bad folder before changing anything", async () => {
    const { h, task, file, today, context } = await setup(); await h.add("Templates/Idea.md", "---\nstatus: draft\n---\n# {{title}}\n");
    const made = await h.service.convertToNote(task.id, { ...options, template: "Templates/Idea.md" }, context); expect(h.texts.get(made.path)).toContain("status: draft"); expect(h.texts.get(made.path)).toContain("# Plan launch\n\nWhy we launch.");
    const bad = await setup(); await expect(bad.h.service.convertToNote(bad.task.id, { ...options, template: "Templates/Missing.md" }, bad.context)).rejects.toThrow("not found"); await expect(bad.h.service.convertToNote(bad.task.id, { ...options, folder: "../up" }, bad.context)).rejects.toThrow("relative");
    expect(bad.h.files.has("Notes/Plan launch.md")).toBe(false); expect(bad.h.texts.get(bad.today.path)).toContain(bad.task.id); expect(bad.h.repo.file(bad.file.path)).toBeTruthy(); expect(file).toBeTruthy(); expect(today).toBeTruthy();
    await expect(h.service.convertToNote("missing1234", options)).rejects.toThrow();
    const gone = await setup(); const real = gone.h.repo.file.bind(gone.h.repo); const goneTaskPath = gone.h.repo.taskFile(gone.task.id)!.path; gone.h.repo.file = ((p: string) => p === goneTaskPath ? null : real(p)) as any; await expect(gone.h.service.convertToNote(gone.task.id, options)).rejects.toThrow("Task note is missing");
  });
  it("keeps numbered bullets and CRLF, converts a task that has no copies and stops before trashing when a copy cannot be edited", async () => {
    const h = harness(); const task = await h.repo.create("Numbered"); const file = h.repo.taskFile(task.id)!; const daily: any = await h.add(`Daily/${localDate()}.md`, `1. [ ] Numbered <!--organized:${task.id}-->\r\nnext\r\n`);
    await h.service.convertToNote(task.id, { ...options, tags: [] }); expect(h.texts.get(daily.path)).toBe("1. [[Notes/Numbered]]\r\nnext\r\n"); expect(h.repo.file(file.path)).toBeNull();
    const lone = await h.repo.create("Lonely"); await h.service.convertToNote(lone.id, { ...options, tags: [] }); expect(h.texts.get("Notes/Lonely.md")).toBe("");
    const busy = await setup("Busy"); vi.spyOn(busy.h.repo, "write").mockRejectedValue(Error("concurrent change")); await expect(busy.h.service.convertToNote(busy.task.id, options, busy.context)).rejects.toThrow("concurrent"); expect(busy.h.repo.file(busy.file.path)).toBeTruthy(); expect(busy.h.raw.fileManager.trashFile).not.toHaveBeenCalled();
  });
});

describe("sorting follows status and moves", () => {
  const titles = (text: string) => text.split("\n").filter(l => l.trim()).map(l => l.replace(/^\s*- \[.\] | <!--.*$/g, ""));
  it("lifts a task to the top when it starts, drops it when it is forwarded and re-sorts quietly when sorting is off", async () => {
    const h = harness(); const a = await h.repo.create("Alpha"); const b = await h.repo.create("Bravo"); const c = await h.repo.create("Charlie");
    await h.repo.update(a.id, t => ({ ...t, priority: "high" })); await h.repo.update(b.id, t => ({ ...t, priority: "medium" }));
    const note: any = await h.add(`Daily/${localDate()}.md`, `- [ ] Alpha <!--organized:${a.id}-->\n- [ ] Bravo <!--organized:${b.id}-->\n- [ ] Charlie <!--organized:${c.id}-->\n`);
    await h.service.status(c.id, "in_progress"); expect(titles(h.texts.get(note.path)!)).toEqual(["Charlie", "Alpha", "Bravo"]);
    await h.service.status(c.id, "open"); expect(titles(h.texts.get(note.path)!)).toEqual(["Alpha", "Bravo", "Charlie"]);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); const context = { file: note, line: parseTasks(h.texts.get(note.path)!)[0] };
    await h.service.schedule(context, localDate(tomorrow), "forward", "manual"); expect(titles(h.texts.get(note.path)!)).toEqual(["Bravo", "Charlie", "Alpha"]); expect(h.texts.get(note.path)).toContain(`- [>] Alpha`);
    h.setSettings({ sortScope: "none" }); await h.service.status(c.id, "in_progress"); expect(titles(h.texts.get(note.path)!)).toEqual(["Bravo", "Charlie", "Alpha"]);
  });
  it("leaves project notes in their status sections and survives a sort that cannot be written", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const a = await h.repo.create("Alpha"); const b = await h.repo.create("Bravo"); await h.service.projects(a.id, [`${folder}/P.md`]); await h.service.projects(b.id, [`${folder}/P.md`]);
    await h.service.status(b.id, "in_progress"); expect(h.texts.get(`${folder}/P.md`)).toMatch(/## In progress\n\n?- \[\/\] Bravo/);
    const note: any = await h.add(`Daily/${localDate()}.md`, `- [ ] Alpha <!--organized:${a.id}-->\n- [ ] Bravo <!--organized:${b.id}-->\n`); const real = h.repo.write.bind(h.repo); let calls = 0; vi.spyOn(h.repo, "write").mockImplementation(async (f, before, after) => { if (calls++ > 1) throw Error("concurrent"); return real(f, before, after); });
    await h.service.status(a.id, "in_progress"); expect(h.texts.get(note.path)).toContain("- [/] Alpha"); expect(note).toBeTruthy();
  });
});

describe("project budgets in frontmatter", () => {
  it("reads hours from the project note, ignores anything else, and writes and clears them without touching other properties", async () => {
    const h = harness(); const folder = h.repo.projectFolder();
    const a: any = await h.add(`${folder}/A.md`, "---\ntags: [x]\norganized_color: '#3b82f6'\n---\nbody");
    await h.add(`${folder}/Bad.md`, "---\norganized_budget: ten\norganized_budget_daily: 0\norganized_budget_weekly: -2\norganized_budget_monthly: 10000\n---\n");
    expect(h.repo.projectBudgets(a.path)).toEqual({ total: null, day: null, week: null, month: null }); expect(h.repo.projectBudgets(`${folder}/Bad.md`)).toEqual({ total: null, day: null, week: null, month: null }); expect(h.repo.projectBudgets("Missing.md")).toEqual({ total: null, day: null, week: null, month: null });
    await h.service.setProjectBudgets(a.path, { total: 120 * 3600, day: 5400, week: 36000, month: null });
    expect(h.repo.projectBudgets(a.path)).toEqual({ total: 432000, day: 5400, week: 36000, month: null }); const text = h.texts.get(a.path)!;
    expect(text).toContain("organized_budget: 120"); expect(text).toContain("organized_budget_daily: 1.5"); expect(text).toContain("organized_budget_weekly: 10"); expect(text).not.toContain("organized_budget_monthly"); expect(text).toContain("tags"); expect(text).toContain("organized_color"); expect(text).toContain("organized_type: project"); expect(h.changed).toHaveBeenCalled();
    await h.service.setProjectBudgets(a.path, { total: null, day: null, week: null, month: null }); expect(h.texts.get(a.path)).not.toContain("organized_budget");
    await expect(h.service.setProjectBudgets("Missing.md", { total: 1, day: null, week: null, month: null })).rejects.toThrow("renamed or removed");
  });
});

describe("project budget setups", () => {
  const none = { total: null, day: null, week: null, month: null };
  it("reads hand-written notes: decimals, ints, quoted or odd values, a bare marker, and CRLF notes", async () => {
    const h = harness(); const f = h.repo.projectFolder();
    await h.add(`${f}/Dec.md`, "---\norganized_type: project\norganized_budget_weekly: 7.5\norganized_budget_daily: 0.25\n---\n");
    await h.add(`${f}/Str.md`, "---\norganized_budget: '10'\norganized_budget_weekly: \"5\"\n---\n");
    await h.add(`${f}/Odd.md`, "---\norganized_budget: .nan\norganized_budget_daily: .inf\norganized_budget_weekly: [1, 2]\norganized_budget_monthly: true\n---\n");
    await h.add(`${f}/Edge.md`, "---\norganized_budget: 9999\norganized_budget_daily: 9999.0001\norganized_budget_weekly: 0.0001\n---\n");
    await h.add(`${f}/Crlf.md`, "---\r\norganized_budget_monthly: 30\r\n---\r\nbody");
    await h.add(`${f}/NoFm.md`, "just text");
    expect(h.repo.projectBudgets(`${f}/Dec.md`)).toEqual({ ...none, week: 27000, day: 900 });
    expect(h.repo.projectBudgets(`${f}/Str.md`)).toEqual(none); expect(h.repo.projectBudgets(`${f}/Odd.md`)).toEqual(none);
    expect(h.repo.projectBudgets(`${f}/Edge.md`)).toEqual({ ...none, total: 9999 * 3600, week: 1 }); expect(h.repo.projectBudgets(`${f}/Crlf.md`)).toEqual({ ...none, month: 108000 }); expect(h.repo.projectBudgets(`${f}/NoFm.md`)).toEqual(none);
  });
  it("round-trips any budget through the note, even one of a few seconds or a fraction of an hour", async () => {
    const h = harness(); const f = h.repo.projectFolder(); const a: any = await h.add(`${f}/A.md`, "body only");
    for (const total of [4, 90, 1800, 5400, 3600 * 7 + 1260, 9999 * 3600]) {
      await h.service.setProjectBudgets(a.path, { total, day: total, week: null, month: null });
      const read = h.repo.projectBudgets(a.path); expect(Math.abs(read.total! - total)).toBeLessThanOrEqual(2); expect(read.day).toBe(read.total);
    }
    expect(h.texts.get(a.path)).toContain("organized_type: project"); expect(h.texts.get(a.path)).toContain("body only"); expect(h.texts.get(a.path)).toMatch(/organized_start: \d{4}-\d{2}-\d{2}/);
  });
  it("keeps an existing start date, other properties and the budgets it was not asked to change", async () => {
    const h = harness(); const f = h.repo.projectFolder(); const a: any = await h.add(`${f}/A.md`, "---\norganized_type: project\norganized_start: 2024-01-02\naliases: [Alpha]\norganized_budget_weekly: 10\n---\nbody");
    await h.service.setProjectBudgets(a.path, { ...none, day: 3600, week: 36000 }); const text = h.texts.get(a.path)!;
    expect(text).toContain("organized_start: 2024-01-02"); expect(text).toContain("aliases"); expect(text).toContain("organized_budget_weekly: 10"); expect(text).toContain("organized_budget_daily: 1");
    await h.service.setProjectBudgets(a.path, { ...none, day: 3600, week: 36000 }); expect(h.texts.get(a.path)).toBe(text);
  });
  it("keeps two projects of the same name in different folders apart", async () => {
    const h = harness(); await h.add("One/Site.md", "---\norganized_budget_daily: 1\n---\n"); await h.add("Two/Site.md", "---\norganized_budget_daily: 2\n---\n");
    expect(h.repo.projectBudgets("One/Site.md").day).toBe(3600); expect(h.repo.projectBudgets("Two/Site.md").day).toBe(7200);
  });
});
describe("task budget in the note", () => {
  it("is kept by other edits, ignored when invalid, and not written for new notes", async () => {
    const h = harness(); const task = await h.repo.create("Budgeted"); const file = h.repo.taskFile(task.id)!;
    await h.service.setBudget(task.id, 5400); await h.service.status(task.id, "in_progress"); await h.service.status(task.id, "open"); await h.service.setPriority(task.id, "high");
    expect((await h.repo.read(task.id)).time_budget_seconds).toBe(5400); expect(await h.repo.readText(file)).toContain("time_budget_seconds: 5400");
    await h.service.setBudget(task.id, 5400); await h.service.setBudget(task.id, 7200); expect((await h.repo.read(task.id)).time_budget_seconds).toBe(7200);
    const fresh = await h.repo.create("Fresh"); expect(await h.repo.readText(h.repo.taskFile(fresh.id)!)).not.toContain("time_budget_seconds");
  });
});
