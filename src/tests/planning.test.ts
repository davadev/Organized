import { describe, expect, it } from "vitest";
import { newTask, setStatus, startPlanned, Task } from "../model";
import { blockAt, budgetUse, dueEnds, dueStarts, plannable, plannedSeconds } from "../planning";

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
});
