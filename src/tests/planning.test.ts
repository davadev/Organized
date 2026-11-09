import { describe, expect, it } from "vitest";
import { newTask, setStatus, startPlanned, Task } from "../model";
import { blockAt, budgetUse, dueEnds, overlap, periodRange, projectUse, dueStarts, plannable, plannedSeconds } from "../planning";

const at = (time: string) => new Date(`2026-03-09T${time}:00Z`).getTime();
const block = (from: string, to: string) => ({ start: new Date(at(from)).toISOString(), end: new Date(at(to)).toISOString() });
const task = (patch: Partial<Task> = {}): Task => ({ ...newTask("t", "t".padEnd(8, "x"), new Date("2026-01-01T00:00:00Z")), ...patch });

describe("planning", () => {
  it("adds up the planned time and finds the block under way (end is exclusive)", () => {
    const t = task({ planned_sessions: [block("09:00", "10:00"), block("14:00", "14:30")] });
    expect(plannedSeconds(t)).toBe(5400); expect(plannedSeconds(task())).toBe(0);
    expect(blockAt(t, at("09:00"))).toEqual(block("09:00", "10:00")); expect(blockAt(t, at("10:00"))).toBeUndefined(); expect(blockAt(t, at("08:59"))).toBeUndefined();
  });
  it("only plans for tasks still to do that have their own note", () => {
    expect(plannable(task())).toBe(true); expect(plannable(task({ status: "in_progress" }))).toBe(true);
    expect(plannable(task({ status: "completed" }))).toBe(false); expect(plannable(task({ status: "canceled" }))).toBe(false); expect(plannable(task({ converted_to: "N.md" }))).toBe(false);
  });
  it("starts open, untimed, non-recurring tasks whose block has begun", () => {
    const planned = [block("09:00", "10:00")];
    expect(dueStarts([task({ planned_sessions: planned })], at("09:30")).map(d => d.block)).toEqual(planned);
    expect(dueStarts([task({ planned_sessions: planned })], at("08:00"))).toEqual([]);
    for (const other of [{ status: "in_progress" as const }, { status: "completed" as const }, { recurring: true }, { converted_to: "N.md" }, { time_tracking_started_at: "2026-03-09T09:10:00.000Z" }]) {
      expect(dueStarts([task({ planned_sessions: planned, ...other })], at("09:30"))).toEqual([]);
    }
  });
  it("sets a task in progress without timing it, and any later status change drops the claim", () => {
    const started = startPlanned(task({ status: "completed", closed_at: "2026-03-01T00:00:00.000Z" }), block("09:00", "10:00"));
    expect(started).toMatchObject({ status: "in_progress", closed_at: null, auto_started_block: block("09:00", "10:00").start, time_tracking_started_at: null });
    expect(setStatus(started, "completed").auto_started_block).toBeNull(); expect(setStatus(started, "open").auto_started_block).toBeNull();
  });
  it("ends a claim: reopen when the block is over, release when the person changed the task, move to a back-to-back block", () => {
    const first = block("09:00", "10:00"); const planned = [first, block("10:00", "11:00")];
    const claimed = startPlanned(task({ planned_sessions: planned }), first);
    expect(dueEnds([claimed], at("09:30"))).toEqual([]); expect(dueEnds([task()], at("12:00"))).toEqual([]);
    expect(dueEnds([claimed], at("10:00"))).toEqual([{ task: claimed, action: "move", block: planned[1] }]);
    expect(dueEnds([claimed], at("11:00"))).toEqual([{ task: claimed, action: "reopen" }]);
    const done = { ...claimed, status: "completed" as const }; const timed = { ...claimed, time_tracking_started_at: "2026-03-09T09:40:00.000Z" };
    expect(dueEnds([done, timed], at("11:00"))).toEqual([{ task: done, action: "release" }, { task: timed, action: "release" }]);
  });
  it("measures tracked plus planned time against a budget and extends the bar when over", () => {
    expect(budgetUse(task())).toBeNull();
    const base = { time_budget_seconds: 3600, time_tracked_seconds: 900, planned_sessions: [block("09:00", "09:30")] };
    expect(budgetUse(task(base))).toEqual({ budget: 3600, tracked: 900, planned: 1800, left: 900, trackedPct: 25, plannedPct: 50, overPct: 0 });
    expect(budgetUse(task({ ...base, planned_sessions: [block("09:00", "09:45")] }))).toMatchObject({ left: 0, trackedPct: 25, plannedPct: 75, overPct: 0 });
    expect(budgetUse(task({ ...base, planned_sessions: [block("09:00", "10:00")] }))).toMatchObject({ left: -900, trackedPct: 20, plannedPct: 60, overPct: 20 });
    expect(budgetUse(task({ ...base, time_tracked_seconds: 5400, planned_sessions: [] }))).toMatchObject({ left: -1800, plannedPct: 0 })
    expect(budgetUse(task({ ...base, time_tracked_seconds: 5400, planned_sessions: [] }))!.overPct).toBeCloseTo(100 / 3);
    const running = task({ ...base, planned_sessions: [], time_tracking_started_at: new Date(at("09:00")).toISOString() });
    expect(budgetUse(running, at("09:10"))?.tracked).toBe(1500);
  });
  it("works out the day, week and month and counts only the part of a session inside them", () => {
    const now = new Date(2026, 2, 11, 15, 0).getTime();
    expect(periodRange("total", now)).toBeNull();
    expect(periodRange("day", now)).toEqual([new Date(2026, 2, 11).getTime(), new Date(2026, 2, 12).getTime()]);
    expect(periodRange("month", now)).toEqual([new Date(2026, 2, 1).getTime(), new Date(2026, 3, 1).getTime()]);
    const [from, to] = periodRange("week", now)!; expect(from <= now && now < to).toBe(true); expect(Math.round((to - from) / 3600000 / 24)).toBe(7);
    const day = periodRange("day", now)!; const across = [{ start: new Date(2026, 2, 10, 23, 0).toISOString(), end: new Date(2026, 2, 11, 1, 0).toISOString() }, { start: new Date(2026, 2, 9, 9).toISOString(), end: new Date(2026, 2, 9, 10).toISOString() }];
    expect(overlap(across, day)).toBe(3600); expect(overlap([], day)).toBe(0);
  });
  it("sums a project's time over every task linked to it, per period", () => {
    const now = new Date(2026, 2, 11, 15, 0).getTime(); const at2 = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).toISOString(); const P = "Projects/P.md";
    const a = task({ id: "aaaaaaaa", projects: [P], time_tracked_seconds: 7200, work_sessions: [{ start: at2(11, 9), end: at2(11, 10) }, { start: at2(2, 9), end: at2(2, 10) }], planned_sessions: [{ start: at2(11, 16), end: at2(11, 16, 30) }] });
    const b = task({ id: "bbbbbbbb", projects: [P, "Projects/Q.md"], status: "completed", time_tracked_seconds: 1800, work_sessions: [{ start: at2(11, 12), end: at2(11, 12, 30) }], planned_sessions: [{ start: at2(11, 17), end: at2(11, 18) }] });
    const c = task({ id: "cccccccc", projects: [P], time_tracking_started_at: at2(11, 14) });
    const other = task({ id: "dddddddd", projects: ["Projects/Q.md"], time_tracked_seconds: 99999, work_sessions: [{ start: at2(11, 1), end: at2(11, 2) }] });
    const future = task({ id: "eeeeeeee", projects: [P], time_tracking_started_at: at2(11, 16) });
    const tasks = [a, b, c, other, future];
    expect(projectUse(tasks, P, "day", 36000, now)).toMatchObject({ tracked: 3600 + 1800 + 3600, planned: 1800 });
    expect(projectUse(tasks, P, "total", 360000, now)).toMatchObject({ tracked: 7200 + 1800 + 3600, planned: 1800 });
    expect(projectUse(tasks, P, "month", 36000, now)).toMatchObject({ tracked: 3600 + 3600 + 1800 + 3600, planned: 1800 });
    expect(projectUse(tasks, "Projects/Q.md", "day", 3600, now)).toMatchObject({ tracked: 1800 + 3600, left: -1800 });
    expect(projectUse(tasks, "Projects/None.md", "day", 3600, now)).toMatchObject({ tracked: 0, planned: 0, left: 3600 });
  });
});
