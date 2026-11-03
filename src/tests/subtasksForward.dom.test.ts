// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";
import { insertUnder, parseTasks } from "../codec";
import { localDate } from "../model";

installObsidianDom();
beforeEach(() => { Notice.instances.length = 0; });

const ORIGIN = "Daily/2020-01-01.md"; const TARGET = "Daily/2020-01-02.md";
/** Parent with an open kid (and a grandchild under it), a running kid, a done kid and a canceled kid, in an old daily note; an empty note for the next day. */
async function fixture() {
  const h = harness(); const make = async (title: string, patch: Record<string, unknown> = {}) => { const t = await h.repo.create(title); if (Object.keys(patch).length) await h.repo.update(t.id, x => ({ ...x, ...patch })); return t; };
  const parent = await make("Parent"); const open = await make("Open"); const grand = await make("Grand"); const running = await make("Running", { status: "in_progress", time_tracking_started_at: new Date(Date.now() - 600000).toISOString() });
  const done = await make("Done", { status: "completed" }); const dropped = await make("Dropped", { status: "canceled" });
  await h.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Open]]", "[[Running]]", "[[Done]]", "[[Dropped]]"] })); await h.repo.update(open.id, t => ({ ...t, subtasks: ["[[Grand]]"] }));
  const l = (m: string, t: { id: string; title: string }, indent = 0) => `${" ".repeat(indent)}- [${m}] ${t.title} <!--organized:${t.id}-->`;
  const text = ["# Work", l(" ", parent), l(" ", open, 2), l(" ", grand, 4), l("/", running, 2), l("x", done, 2), l("-", dropped, 2), "- [ ] Another"].join("\n");
  const origin: any = await h.add(ORIGIN, text); const target: any = await h.add(TARGET, "# Work\n");
  const ctx = () => ({ file: origin, line: parseTasks(h.texts.get(ORIGIN)!).find(t => t.id === parent.id)! });
  // One entry per todo: nesting level, marker (_ for open), title.
  const titles = (path: string) => parseTasks(h.texts.get(path)!).map(t => `${(t.raw.length - t.raw.trimStart().length) / 2}${t.marker === " " ? "_" : t.marker}:${t.title}`);
  return { ...h, make, parent, open, grand, running, done, dropped, origin, target, ctx, titles };
}

describe("forwarding or scheduling a parent takes its unfinished subtasks along", () => {
  it("forwards the parent and its open subtasks, nested, and leaves done and canceled ones behind as the record", async () => {
    const f = await fixture(); await f.service.schedule(f.ctx(), "2020-01-02", "forward");
    expect(f.titles(TARGET)).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1/:Running"]);
    expect(f.titles(ORIGIN)).toEqual(["0_:Another", "0>:Parent", "1>:Running", "1>:Open", "2>:Grand", "1x:Done", "1-:Dropped"]);
    for (const id of [f.parent.id, f.open.id, f.grand.id, f.running.id]) expect((await f.repo.read(id)).scheduled).toBe("2020-01-02");
    for (const id of [f.done.id, f.dropped.id]) expect((await f.repo.read(id)).scheduled).toBeNull();
    expect((await f.repo.read(f.running.id)).movement_history).toHaveLength(1); expect((await f.repo.read(f.running.id)).time_tracking_started_at).not.toBeNull();
    expect(Notice.instances.some(n => String(n.message.constructor === String ? n.message : "notice").length > 0)).toBe(true); expect(f.service.undoChanges.length).toBeGreaterThan(0);
    await f.service.undo(); expect(f.texts.get(TARGET)).toBe("# Work\n"); expect(f.titles(ORIGIN)).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1/:Running", "1x:Done", "1-:Dropped", "0_:Another"]); expect((await f.repo.read(f.open.id)).scheduled).toBeNull();
  });
  it("schedules with [<]: the origin lines turn into scheduled markers and the target gets the nested block", async () => {
    const f = await fixture(); await f.service.schedule(f.ctx(), "2020-01-02");
    expect(f.titles(ORIGIN).filter(t => t.includes("<"))).toEqual(["0<:Parent", "1<:Running", "1<:Open", "2<:Grand"]); expect(f.titles(TARGET)).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1_:Running"]);
  });
  it("does not move subtasks that were forwarded already or are recurring, and reports a subtask that cannot move", async () => {
    const f = await fixture(); const recurring = await f.make("Repeats", { recurring: true });
    f.texts.set(ORIGIN, f.texts.get(ORIGIN)!.replace(`  - [ ] Open <!--organized:${f.open.id}-->`, `  - [>] Open <!--organized:${f.open.id}-->`).replace("- [ ] Another", `  - [ ] Repeats <!--organized:${recurring.id}-->`));
    await f.repo.update(f.parent.id, t => ({ ...t, subtasks: [...t.subtasks, "[[Repeats]]"] })); await f.service.schedule(f.ctx(), "2020-01-02", "forward");
    expect(f.titles(TARGET)).toEqual(["0_:Parent", "1_:Grand", "1/:Running"]);
    const g = await fixture(); const real = g.service.schedule.bind(g.service); let calls = 0;
    g.service.schedule = (async (...args: Parameters<typeof real>) => { if (++calls === 3) throw new Error("conflict"); return real(...args); }) as typeof real;
    await g.service.schedule(g.ctx(), "2020-01-02", "forward"); expect(Notice.instances.some(n => String(n.message).includes("Could not move 1 subtask with “Parent”"))).toBe(true);
  });
  it("puts a subtask moved on its own under its parent when the target has the parent, and at the end of the section when not", async () => {
    const f = await fixture(); await f.service.schedule({ file: f.origin, line: parseTasks(f.texts.get(ORIGIN)!).find(t => t.id === f.open.id)! }, "2020-01-02", "forward", "manual", [], { cascade: false });
    expect(f.titles(TARGET)).toEqual(["0_:Open"]);
    await f.add("Daily/2020-01-03.md", `# Work\n- [ ] Parent <!--organized:${f.parent.id}-->\n  - note\n- [ ] After`);
    await f.service.schedule({ file: f.origin, line: parseTasks(f.texts.get(ORIGIN)!).find(t => t.id === f.running.id)! }, "2020-01-03", "forward");
    expect(f.texts.get("Daily/2020-01-03.md")).toBe(`# Work\n- [ ] Parent <!--organized:${f.parent.id}-->\n  - note\n  - [/] Running <!--organized:${f.running.id}-->\n- [ ] After`);
  });
  it("carries a grandchild under the nearest moved ancestor when the subtask between them is not moving", async () => {
    const f = await fixture(); await f.repo.update(f.open.id, t => ({ ...t, status: "completed" })); await f.service.schedule(f.ctx(), "2020-01-02", "forward");
    expect(f.titles(TARGET)).toEqual(["0_:Parent", "1_:Grand", "1/:Running"]);
  });
});

describe("scheduling from the panel and auto-forward move the family too", () => {
  it("schedules a parent without a todo line: open subtasks follow, each under its parent, done ones do not", async () => {
    const f = await fixture(); const target: any = await f.add("Daily/2020-01-06.md", ""); await f.service.scheduleTask(f.parent.id, "2020-01-06");
    expect(f.titles(target.path)).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1_:Running"]); expect((await f.repo.read(f.done.id)).scheduled).toBeNull();
    await f.service.scheduleTask(f.parent.id, "2020-01-06"); expect(f.titles(target.path)).toHaveLength(4);
    await f.repo.update(f.grand.id, t => ({ ...t, subtasks: ["[[Parent]]", "[[Open]]"] })); await f.service.scheduleTask(f.parent.id, "2020-01-07"); expect(f.titles("Daily/2020-01-07.md")).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1_:Running"]);
  });
  it("auto-forwards a parent block once, with no conflict for the subtasks that came along", async () => {
    const f = await fixture(); const today: any = await f.add(`Daily/${localDate()}.md`, "");
    await f.service.reconcile(today); expect(f.titles(today.path)).toEqual(["0_:Parent", "1_:Open", "2_:Grand", "1/:Running", "0_:Another"].filter(t => !t.includes("Another")));
    expect(Notice.instances.some(n => String(n.message).includes("conflict"))).toBe(false);
  });
});

describe("inserting under a todo", () => {
  it("adds the line after everything nested under the todo, keeps its indent and line endings, and says no when the todo is missing or twice", () => {
    const text = "- [ ] A <!--organized:aaaaaaaa-->\n  - note\n    - deeper\n- [ ] B";
    expect(insertUnder(text, "aaaaaaaa", "- [ ] New")).toBe("- [ ] A <!--organized:aaaaaaaa-->\n  - note\n    - deeper\n  - [ ] New\n- [ ] B");
    expect(insertUnder("  - [ ] A <!--organized:aaaaaaaa-->", "aaaaaaaa", "- [ ] New")).toBe("  - [ ] A <!--organized:aaaaaaaa-->\n    - [ ] New");
    expect(insertUnder("- [ ] A <!--organized:aaaaaaaa-->\r\n- [ ] B", "aaaaaaaa", "- [ ] New")).toBe("- [ ] A <!--organized:aaaaaaaa-->\r\n  - [ ] New\r\n- [ ] B");
    expect(insertUnder(text, "bbbbbbbb", "- [ ] New")).toBeNull(); expect(insertUnder(`${text}\n- [ ] A <!--organized:aaaaaaaa-->`, "aaaaaaaa", "- [ ] New")).toBeNull();
  });
});
