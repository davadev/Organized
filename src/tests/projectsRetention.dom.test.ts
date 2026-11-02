// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { localDate } from "../model";
import { Notice } from "./__mocks__/obsidian";
import { moveTask, sectionNamed, writeNoteSection } from "../codec";
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
    expect(projectTemplate("2026-03-04")).toBe("---\norganized_type: project\norganized_start: 2026-03-04\n---\n\n## Open\n\n## In progress\n\n## Done\n"); expect(projectTemplate()).toContain(`organized_start: ${localDate()}`);
  });
  it("marks linked, remembered and project-folder notes once, never task records or missing notes", async () => {
    const h = harness(); const folder = h.repo.projectFolder(); const task = await h.repo.create("Plan");
    await h.add("Linked.md", "linked"); await h.add("Known.md", "known"); await h.add(`${folder}/InFolder.md`, "in folder"); await h.add("Unrelated.md", "unrelated"); await h.add(`${folder}/Done.md`, projectTemplate());
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
