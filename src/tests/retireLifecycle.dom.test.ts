// @vitest-environment happy-dom
// What happens to a task that carries the 0.1.4 metadata (repeat rule, planned blocks, budget, projects) when it is retired, by hand or by the retention setting.
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { OrganizedInspectorView } from "../view";
import { harness } from "./harness";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian";
import { localDate, nextDate } from "../model";
import { parseTasks } from "../codec";
import { parseRule } from "../recurrence";
import type { RetireOptions } from "../retire";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); Notice.instances.length = 0; });
const base: RetireOptions = { which: "all", olderThanDays: 7, lines: "plain", keep: "title", notes: "keep", yaml: "keep" };
const backup = () => vi.fn(async (_files: { path: string; before: string }[], _extra: Record<string, unknown>) => "plugin/note-backups/retire-1.json");
const copies = (text: string | undefined, id: string) => parseTasks(text ?? "").filter(t => t.id === id);
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

async function repeating(options: Partial<RetireOptions>) {
  const h = harness(true); const task = await h.repo.create("Gym"); await h.service.recurrence(task.id, parseRule("weekdays")!);
  await h.repo.update(task.id, t => ({ ...t, planned_sessions: [{ start: "2030-01-02T09:00:00.000Z", end: "2030-01-02T10:00:00.000Z" }], time_budget_seconds: 7200 }));
  const today: any = await h.add(`Daily/${localDate()}.md`, `- [ ] Gym <!--organized:${task.id}--> <!--organized:repeat-->\n`);
  const run = backup(); await h.service.retireTasks({ ...base, ...options }, run);
  const tomorrow: any = await h.add(`Daily/${nextDate(nextDate(localDate()))}.md`, ""); await h.service.onDailyCreated(tomorrow);
  return { h, task, today, tomorrow, run };
}

describe("a recurring task that is retired", () => {
  it("stops repeating when its note stays, so the next daily note does not bring the todo back", async () => {
    const { h, task, today, tomorrow, run } = await repeating({});
    expect(h.texts.get(today.path)).toBe("- [ ] Gym\n"); expect(copies(h.texts.get(tomorrow.path), task.id)).toHaveLength(0); expect(h.texts.get(tomorrow.path)).toBe("");
    const kept = await h.repo.read(task.id); expect(kept.recurring).toBe(false); expect(kept.recurrence).toBeNull(); expect(kept.recurrence_periods.every(p => p.stop === localDate())).toBe(true);
    expect(kept.planned_sessions).toHaveLength(1); expect(kept.time_budget_seconds).toBe(7200); // the note stays whole, so these stay in it
    expect(run.mock.calls[0][0].map(f => f.path)).toContain(h.repo.taskFile(task.id)!.path);
  });
  it("closes only the period that is still open, and keeps the earlier ones as they were", async () => {
    const h = harness(true); const task = await h.repo.create("Gym"); await h.service.recurrence(task.id, parseRule("every day")!); await h.service.recurrence(task.id, parseRule("every 3 weeks on thu")!);
    const periods = (await h.repo.read(task.id)).recurrence_periods; expect(periods.filter(p => p.stop === null)).toHaveLength(1); expect(periods.length).toBeGreaterThan(1);
    await h.add(`Daily/${localDate()}.md`, `- [ ] Gym <!--organized:${task.id}-->\n`); await h.service.retireTasks(base, backup());
    const after = (await h.repo.read(task.id)).recurrence_periods; expect(after.every(p => p.stop !== null)).toBe(true); expect(after.slice(0, -1)).toEqual(periods.slice(0, -1));
  });
  it("gives the repeat rule back on Undo, with the todo's id", async () => {
    const { h, task, today } = await repeating({}); await h.service.undo();
    const back = await h.repo.read(task.id); expect(back.recurring).toBe(true); expect(back.recurrence).toBe("weekdays"); expect(back.recurrence_periods.at(-1)!.stop).toBeNull(); expect(copies(h.texts.get(today.path), task.id)).toHaveLength(1);
  });
  it("stops with a renamed note, and with properties stripped or the note trashed, since nothing is left to repeat", async () => {
    for (const options of [{ notes: "rename" as const }, { yaml: "strip" as const, notes: "rename" as const }, { notes: "trash" as const }]) {
      const { h, task, today, tomorrow } = await repeating(options);
      expect(h.texts.get(today.path)).toBe("- [ ] Gym\n"); expect(copies(h.texts.get(tomorrow.path), task.id)).toHaveLength(0);
      if (options.yaml === "strip") expect(h.texts.get(h.repo.file("Gym.md")?.path ?? "Tasks/Gym.md")).not.toContain("recurrence");
    }
  });
  it("leaves a task that does not repeat alone: its note is not rewritten and not backed up", async () => {
    const h = harness(true); const task = await h.repo.create("Once"); const note = h.repo.taskFile(task.id)!; const before = h.texts.get(note.path);
    await h.add(`Daily/${localDate()}.md`, `- [ ] Once <!--organized:${task.id}-->\n`); const run = backup(); await h.service.retireTasks(base, run);
    expect(h.texts.get(note.path)).toBe(before); expect(run.mock.calls[0][0].map(f => f.path)).not.toContain(note.path);
  });
});

describe("worked time kept under a retired todo", () => {
  const worked = async (h: ReturnType<typeof harness>, projects: string[]) => {
    const task = await h.repo.create("Plan release");
    await h.repo.update(task.id, t => ({ ...t, status: "completed", closed_at: ago(40), projects, work_sessions: [{ start: new Date(2026, 0, 5, 9, 0).toISOString(), end: new Date(2026, 0, 5, 10, 30).toISOString() }] }));
    const note: any = await h.add("Daily/2026-01-05.md", `- [x] Plan release <!--organized:${task.id}-->\n`); return { task, note };
  };
  it("carries the task's projects, written by the retention setting and read back by the calendar", async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: "all" }); const { note } = await worked(h, ["Tasks/Projects/Alpha.md", "Beta.md"]);
    await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.texts.get(note.path)).toBe("- [x] Plan release\n  - Worked 2026-01-05: 09:00–10:30 (1h 30min)\n  - Projects: [[Tasks/Projects/Alpha]], [[Beta]]\n");
    const found = await h.service.retiredWork("2026-01-01", "2026-01-31"); expect(found).toHaveLength(1); expect(found[0].task.projects).toEqual(["Tasks/Projects/Alpha.md", "Beta.md"]); expect(found[0].task.work_sessions).toHaveLength(1);
  });
  it("is written the same way by the Retire window, and not at all for a lesser detail or without projects", async () => {
    const h = harness(true); const { note, task } = await worked(h, ["Tasks/Projects/Alpha.md"]);
    await h.service.retireTasks({ ...base, keep: "all", notes: "trash" }, backup()); expect(h.texts.get(note.path)).toContain("  - Project: [[Tasks/Projects/Alpha]]");
    const h2 = harness(true); const second = await worked(h2, ["Tasks/Projects/Alpha.md"]); await h2.service.retireTasks({ ...base, keep: "description", notes: "trash" }, backup()); expect(h2.texts.get(second.note.path)).toBe("- [x] Plan release\n");
    const h3 = harness(true); const third = await worked(h3, []); await h3.service.retireTasks({ ...base, keep: "all", notes: "trash" }, backup()); expect(h3.texts.get(third.note.path)).not.toContain("Project"); expect(task.id).not.toBe(third.task.id);
  });
});

const NOW = new Date(2026, 2, 11, 15, 0, 0);
async function budgets() {
  vi.useFakeTimers(); vi.setSystemTime(NOW); const h = harness(); const owner = new Organized(h.app, { id: "organized", version: "0.0.0" } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  const project: any = await h.add(`${owner.repo.projectFolder()}/Alpha.md`, "---\norganized_type: project\norganized_budget: 10\norganized_budget_monthly: 10\norganized_budget_daily: 4\n---\n");
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 2, day, hour, minute).toISOString();
  const show = async (id: string) => { owner.selectedTaskId = id; view.tab = "Task"; await view.render(); await flush(); };
  const texts = () => Array.from(view.contentEl.querySelectorAll(".organized-budget-text")).map(l => l.textContent);
  return { h, owner, project, at, show, texts, view };
}
describe("project budgets after a task is retired", () => {
  const setup = async () => {
    const ctx = await budgets(); const { owner, project, at, h } = ctx;
    const old = await owner.repo.create("Done work"); await owner.repo.update(old.id, t => ({ ...t, status: "completed", closed_at: at(10, 12), projects: [project.path], time_tracked_seconds: 10800, work_sessions: [{ start: at(10, 9), end: at(10, 11) }, { start: at(11, 9), end: at(11, 10) }] }));
    const open = await owner.repo.create("Still going"); await owner.repo.update(open.id, t => ({ ...t, projects: [project.path], time_tracked_seconds: 3600, work_sessions: [{ start: at(11, 13), end: at(11, 14) }] }));
    const earlier: any = await h.add(owner.service.daily.path("2026-03-09"), `- [>] Done work <!--organized:${old.id}-->\n`);
    const note: any = await h.add(owner.service.daily.path("2026-03-10"), `- [x] Done work <!--organized:${old.id}-->\n`);
    return { ...ctx, old, open, note, earlier };
  };
  const ALL = ["4h tracked · 6h left of 10h", "2h tracked · 2h left of 4h", "4h tracked · 6h left of 10h"]; // all time, today, this month
  it("still counts the retired time: nothing in the bars changes when the task is retired with its time kept", async () => {
    const { owner, open, show, texts, old, note, earlier, h } = await setup(); await show(open.id); expect(texts()).toEqual(ALL);
    await owner.service.retireTasks({ ...base, which: "closed", olderThanDays: 0, keep: "all", notes: "trash" }, backup()); expect(owner.repo.taskFile(old.id)).toBeNull();
    // The time sits once, under the latest copy of the todo, so the forwarded copy does not count it twice.
    expect(h.texts.get(note.path)).toContain("Worked 2026-03-10: 09:00–11:00"); expect(h.texts.get(earlier.path)).toBe("- [>] Done work\n");
    note.stat.mtime += 1; // Obsidian updates a note's stat when it is written; the test vault does not, and the calendar's cache of retired time goes by it
    await show(open.id); expect(texts()).toEqual(ALL);
  });
  it("counts the retired time of the day, month and whole project separately, from the sessions' own dates", async () => {
    const { owner, open, show, texts, project, at } = await setup(); await owner.service.retireTasks({ ...base, which: "closed", olderThanDays: 0, keep: "all", notes: "trash" }, backup());
    await owner.repo.update(open.id, t => ({ ...t, work_sessions: [{ start: at(11, 13), end: at(11, 14) }, { start: new Date(2026, 1, 20, 9).toISOString(), end: new Date(2026, 1, 20, 10).toISOString() }], time_tracked_seconds: 7200 }));
    await show(open.id); expect(texts()).toEqual(["5h tracked · 5h left of 10h", "2h tracked · 2h left of 4h", "4h tracked · 6h left of 10h"]); expect(project.path).toContain("Alpha");
  });
  it("cannot count time that was kept without its project: an older note, or a project that is gone", async () => {
    const { owner, open, show, texts, h } = await setup(); await owner.service.retireTasks({ ...base, which: "closed", olderThanDays: 0, keep: "title", notes: "trash" }, backup());
    await h.add(owner.service.daily.path("2026-03-08"), "- [x] Old\n  - Worked 2026-03-08: 09:00–11:00 (2h)\n  - Tracked 2h\n"); await show(open.id);
    expect(texts()).toEqual(["1h tracked · 9h left of 10h", "1h tracked · 3h left of 4h", "1h tracked · 9h left of 10h"]);
  });
  it("reads the tracked total kept with the time, when it is more than the sessions listed", async () => {
    const { owner, open, show, texts, h, project } = await setup(); await owner.service.retireTasks({ ...base, which: "closed", olderThanDays: 0, keep: "title", notes: "trash" }, backup());
    await h.add(owner.service.daily.path("2026-03-08"), `- [x] Long\n  - Worked 2026-03-08: 09:00–10:00 (1h)\n  - Tracked 3h 30min\n  - Project: [[${project.path.replace(/\.md$/, "")}]]\n`); await show(open.id);
    expect(texts()[0]).toBe("4h 30min tracked · 5h 30min left of 10h");
  });
});
