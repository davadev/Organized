// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { OrganizedInspectorView } from "../view";
import { harness } from "./harness";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian";
import { localDate, type Status } from "../model";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); });

/** Parent with subtasks Open, Running, Done, Dropped (and Kid under Open), all shown in today's note. */
async function fixture(parentPatch: Record<string, unknown> = {}) {
  const h = harness(); const make = async (title: string, patch: Record<string, unknown> = {}) => { const t = await h.repo.create(title); if (Object.keys(patch).length) await h.repo.update(t.id, x => ({ ...x, ...patch })); return t; };
  const open = await make("Open"); const running = await make("Running", { status: "in_progress", time_tracking_started_at: new Date(Date.now() - 600000).toISOString() });
  const done = await make("Done", { status: "completed", closed_at: new Date().toISOString() }); const dropped = await make("Dropped", { status: "canceled", closed_at: new Date().toISOString() }); const kid = await make("Kid");
  const parent = await make("Parent", { subtasks: ["[[Open]]", "[[Running]]", "[[Done]]", "[[Dropped]]", ...("subtasks" in parentPatch ? [] : []) ], ...parentPatch });
  await h.repo.update(open.id, t => ({ ...t, subtasks: ["[[Kid]]"] }));
  const marker = (t: { status: Status }) => ({ completed: "x", canceled: "-", in_progress: "/" } as Record<string, string>)[t.status] ?? " ";
  const line = async (t: { id: string; title: string }) => `- [${marker(await h.repo.read(t.id))}] ${t.title} <!--organized:${t.id}-->`;
  const path = `Daily/${localDate()}.md`; const file: any = await h.add(path, (await Promise.all([parent, open, kid, running, done, dropped].map(line))).join("\n"));
  const status = async (t: { id: string }) => (await h.repo.read(t.id)).status; const text = () => h.texts.get(path)!;
  return { ...h, make, parent, open, running, done, dropped, kid, status, text, file };
}

describe("completing or canceling a parent cascades to open subtasks", () => {
  it("completes open and running subtasks (and theirs), leaves done and canceled alone, stops the timer and says so with Undo", async () => {
    const f = await fixture(); Notice.instances.length = 0; await f.service.status(f.parent.id, "completed");
    expect([await f.status(f.open), await f.status(f.running), await f.status(f.done), await f.status(f.dropped), await f.status(f.kid)]).toEqual(["completed", "completed", "completed", "canceled", "completed"]);
    const running = await f.repo.read(f.running.id); expect(running.time_tracking_started_at).toBeNull(); expect(running.work_sessions).toHaveLength(1);
    expect(f.text()).toContain(`- [x] Open <!--organized:${f.open.id}-->`); expect(f.text()).toContain(`- [-] Dropped <!--organized:${f.dropped.id}-->`);
    const notice = Notice.instances.at(-1)!; expect(notice.messageEl ?? notice.message).toBeTruthy(); expect(f.service.undoChanges.length).toBeGreaterThan(0);
    await f.service.undo(); expect([await f.status(f.open), await f.status(f.running), await f.status(f.kid)]).toEqual(["open", "in_progress", "open"]); expect((await f.repo.read(f.running.id)).time_tracking_started_at).not.toBeNull();
    expect(await f.status(f.parent)).toBe("completed"); expect(f.text()).toContain(`- [ ] Open <!--organized:${f.open.id}-->`);
  });
  it("cancels open and running subtasks, but never a done one", async () => {
    const f = await fixture(); await f.service.status(f.parent.id, "canceled");
    expect([await f.status(f.open), await f.status(f.running), await f.status(f.done), await f.status(f.dropped), await f.status(f.kid)]).toEqual(["canceled", "canceled", "completed", "canceled", "canceled"]);
  });
  it("does not cascade when reopening or starting a parent, or when the parent already had that status", async () => {
    const f = await fixture({ status: "completed" }); Notice.instances.length = 0; await f.service.status(f.parent.id, "open"); await f.service.status(f.parent.id, "in_progress");
    expect([await f.status(f.open), await f.status(f.running)]).toEqual(["open", "in_progress"]); expect(Notice.instances).toHaveLength(0);
    await f.service.status(f.parent.id, "completed"); await f.service.undo(); await f.service.status(f.parent.id, "completed"); expect(await f.status(f.open)).toBe("open");
  });
  it("does nothing special for a task without subtasks or a recurring parent", async () => {
    const f = await fixture({ recurring: true }); await f.service.status(f.parent.id, "completed"); expect(await f.status(f.open)).toBe("open");
    const loner = await f.make("Loner"); Notice.instances.length = 0; await f.service.status(loner.id, "completed"); expect(Notice.instances).toHaveLength(0);
  });
  it("copes with a subtask list that loops back, and counts each subtask once", async () => {
    const f = await fixture(); await f.repo.update(f.kid.id, t => ({ ...t, subtasks: ["[[Parent]]", "[[Open]]"] })); await f.service.status(f.parent.id, "completed");
    expect(await f.status(f.kid)).toBe("completed"); expect(f.service.undoChanges.filter(c => c.file === f.repo.taskFile(f.kid.id)!)).toHaveLength(1);
  });
  it("reaches a subtask below a done subtask, and not one below a canceled subtask", async () => {
    const f = await fixture(); const deep = await f.make("Deep"); const hidden = await f.make("Hidden");
    await f.repo.update(f.done.id, t => ({ ...t, subtasks: ["[[Deep]]"] })); await f.repo.update(f.dropped.id, t => ({ ...t, subtasks: ["[[Hidden]]"] }));
    await f.service.status(f.parent.id, "completed"); expect(await f.status(deep)).toBe("completed"); expect(await f.status(hidden)).toBe("open");
  });
});

describe("the Task tab offers to complete a parent whose subtasks are all done", () => {
  async function panel() {
    vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: "organized", version: "0.0.0" } as any); await owner.onload();
    const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    const parent = await owner.repo.create("Parent"); const kid = await owner.repo.create("Kid"); await owner.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Kid]]"] }));
    const show = async () => { owner.selectedTaskId = parent.id; view.tab = "Task"; await view.render(); await flush(); };
    return { owner, view, parent, kid, show, h };
  }
  it("shows the button only when every counted subtask is done and the parent is not", async () => {
    const f = await panel(); const button = () => f.view.contentEl.querySelector<HTMLButtonElement>(".organized-complete-parent");
    await f.show(); expect(button()).toBeNull(); await f.owner.repo.update(f.kid.id, t => ({ ...t, status: "completed" })); await f.show(); expect(button()).toBeTruthy();
    await f.owner.repo.update(f.parent.id, t => ({ ...t, recurring: true })); await f.show(); expect(button()).toBeNull();
    await f.owner.repo.update(f.parent.id, t => ({ ...t, recurring: false })); const text = `- [ ] Parent <!--organized:${f.parent.id}-->`; const note: any = await f.h.add("Daily.md", text);
    f.owner.context = { file: note, line: (await import("../codec")).parseTasks(text)[0] } as any; await f.show(); button()!.click(); await flush(); expect((await f.owner.repo.read(f.parent.id)).status).toBe("completed");
    await f.show(); expect(button()).toBeNull();
    await f.owner.repo.update(f.parent.id, t => ({ ...t, status: "open" })); f.owner.context = null; await f.show(); button()!.click(); await flush(); expect((await f.owner.repo.read(f.parent.id)).status).toBe("completed");
  });
});
