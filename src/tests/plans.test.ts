import { afterEach, describe, expect, it } from "vitest";
import { newTask, Task, taskFrom } from "../model";
import { clash, minutesOf, plansIn, repeatingBlocks, stored, timeLabel, timesFrom, timesProblem } from "../plans";
import { budgetUse, claimHolds, dueStarts, dueStops, projectUse } from "../planning";

const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).getTime();
const iso = (d: number, h: number, m = 0) => new Date(at(d, h, m)).toISOString();
const block = (d: number, from: number, to: number, toDay = d) => ({ start: iso(d, from), end: iso(toDay, to) });
// Repeats on weekdays from Monday 2 March 2026.
function weekdays(times: { start: string; end: string }[], extra: Partial<Task> = {}): Task {
  return { ...newTask("Work", "abcdefgh12", new Date(at(2, 7))), recurring: true, recurrence: "weekdays", recurrence_periods: [{ start: "2026-03-02", stop: null }], recurrence_times: times, ...extra };
}
const day = (n: number) => [at(n, 0), at(n + 1, 0)] as const;
const TZ = process.env.TZ;
afterEach(() => { process.env.TZ = TZ; });

describe("repeating times", () => {
  it("reads times of day forgivingly and says what is wrong with typed ones", () => {
    expect([minutesOf("8:05"), minutesOf("23:59"), minutesOf("24:00"), minutesOf("12:60"), minutesOf(" 07:30 "), minutesOf(8), minutesOf("8")]).toEqual([485, 1439, null, null, 450, null, null]);
    expect(timesFrom([{ start: "13:00", end: "17:00" }, { start: "8:00", end: "12:00" }, { start: "9:00", end: "10:00" }, { start: "10:00", end: "10:00" }, { start: "25:00", end: "26:00" }, "x", null, { start: 9 }])).toEqual([{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }]);
    expect(timesFrom("weekdays")).toEqual([]); expect(timesFrom(Array.from({ length: 10 }, (_, n) => ({ start: `${n}:00`, end: `${n}:30` })))).toHaveLength(8);
    expect(timesProblem([{ start: "08:00", end: "" }])).toBe("Add both times, or neither."); expect(timesProblem([{ start: "08:00", end: "08:00" }])).toBe("A time needs an end that differs from its start.");
    expect(timesProblem(Array.from({ length: 9 }, (_, n) => ({ start: `${10 + n}:00`, end: `${10 + n}:30` })))).toBe("At most 8 times a day.");
    expect(timesProblem([{ start: "08:00", end: "12:00" }, { start: "11:00", end: "13:00" }])).toBe("These times overlap; make them one."); expect(timesProblem([{ start: "08:00", end: "12:00" }, { start: "12:00", end: "13:00" }])).toBeNull();
    // Across midnight: a night shift into the next morning meets an early block.
    expect(clash({ start: "22:00", end: "02:00" }, { start: "01:00", end: "03:00" })).toBe(true); expect(clash({ start: "22:00", end: "02:00" }, { start: "02:00", end: "03:00" })).toBe(false);
    expect([timeLabel({ start: "08:00", end: "17:00" }), timeLabel({ start: "22:00", end: "02:00" })]).toEqual(["08:00–17:00", "22:00–02:00 (+1 day)"]);
  });
  it("keeps times and changed days in the task note, cleaned", () => {
    const task = taskFrom({ id: "abcdefgh12", title: "T", recurrence_times: [{ start: "9:00", end: "17:00" }], recurrence_skips: ["2026-03-04", "2026-03-03", "2026-03-04", "nope", 5] }, "abcdefgh12");
    expect([task.recurrence_times, task.recurrence_skips]).toEqual([[{ start: "09:00", end: "17:00" }], ["2026-03-03", "2026-03-04"]]);
    expect(taskFrom({ id: "abcdefgh12", title: "T", recurrence_skips: Array.from({ length: 70 }, (_, n) => `2026-01-${String(n % 28 + 1).padStart(2, "0")}`) }, "abcdefgh12").recurrence_skips).toHaveLength(28);
  });
  it("makes blocks on each day the rule falls on, from today on, with no daily note, next to the task's own blocks", () => {
    const now = at(4, 10); const task = weekdays([{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }], { planned_sessions: [block(3, 9, 10), block(5, 18, 19), block(6, 8, 12)] });
    const week = plansIn(task, at(2, 0), at(9, 0), now);
    // Monday and Tuesday are past: only their own block is left. Friday's own 08:00–12:00 is the repeating one, once. No weekend.
    expect(week.map(stored)).toEqual([block(3, 9, 10), block(4, 8, 12), block(4, 13, 17), block(5, 8, 12), block(5, 13, 17), block(5, 18, 19), block(6, 8, 12), block(6, 13, 17)]);
    expect(week.filter(b => b.repeating)).toHaveLength(5);
    expect(plansIn({ ...task, recurrence_skips: ["2026-03-05"] }, ...day(5), now).map(stored)).toEqual([block(5, 18, 19)]);
    expect(plansIn({ ...task, recurring: false }, ...day(4), now)).toEqual([]); expect(plansIn({ ...task, recurrence_times: [] }, ...day(5), now).map(stored)).toEqual([block(5, 18, 19)]);
    expect(plansIn({ ...task, recurrence_periods: [{ start: "2026-03-05", stop: null }] }, ...day(4), now)).toEqual([]);
    expect(repeatingBlocks(task, "2026-03-05", now).map(stored)).toEqual([block(5, 8, 12), block(5, 13, 17)]); expect(repeatingBlocks(task, "2026-03-03", now)).toEqual([]);
  });
  it("runs a night block into the next morning, and stops counting days after 400", () => {
    const night = { ...weekdays([{ start: "22:00", end: "02:00" }]), recurrence: "daily" };
    expect(plansIn(night, ...day(5), at(4, 10)).map(stored)).toEqual([block(4, 22, 2, 5), block(5, 22, 2, 6)]);
    expect(plansIn(night, at(4, 23), at(4, 23, 30), at(4, 23)).map(stored)).toEqual([block(4, 22, 2, 5)]);
    const years = plansIn(night, at(4, 0), at(4, 0) + 1000 * 86400000, at(4, 0)); expect(years.length).toBeGreaterThan(390); expect(years.length).toBeLessThanOrEqual(400);
  });
  it("keeps clock times on the days the clocks change", () => {
    process.env.TZ = "Europe/Prague";
    const early = { ...weekdays([{ start: "02:30", end: "03:00" }, { start: "08:00", end: "17:00" }]), recurrence: "daily" };
    // 29 March 2026: 02:00 jumps to 03:00, so 02:30–03:00 does not exist; the working day still runs 08:00–17:00 on the clock.
    const spring = repeatingBlocks(early, "2026-03-29", new Date(2026, 2, 29, 0).getTime());
    expect(spring.map(b => [new Date(b.start).getHours(), new Date(b.end).getHours()])).toEqual([[8, 17]]); expect(Date.parse(spring[0].end) - Date.parse(spring[0].start)).toBe(9 * 3600000);
    const autumn = repeatingBlocks(early, "2026-10-25", new Date(2026, 9, 25, 0).getTime()); expect(autumn.map(b => new Date(b.start).getHours())).toEqual([2, 8]);
  });
});

describe("timer and budgets with repeating times", () => {
  const working = () => weekdays([{ start: "08:00", end: "12:00" }, { start: "12:00", end: "17:00" }]);
  it("starts at the first block, runs through blocks back to back, and stops at the end of the day's run, also when noticed late", () => {
    const task = working(); expect(dueStarts([task], at(4, 8))).toEqual([{ task, block: block(4, 8, 12) }]); expect(dueStarts([task], at(7, 9))).toEqual([]);
    const running = { ...task, time_tracking_started_at: iso(4, 8), auto_started_block: iso(4, 8), status: "in_progress" as const };
    expect(dueStops([running], at(4, 12, 30))).toEqual([]); expect(claimHolds(running, at(4, 12, 30))).toBe(true);
    expect(dueStops([running], at(4, 18))).toEqual([{ task: running, end: at(4, 17) }]); expect(dueStops([running], at(5, 9))).toEqual([{ task: running, end: at(4, 17) }]);
  });
  it("keeps a claim through an edit of the times, but not into the next stretch of planned time", () => {
    const task = { ...working(), auto_started_block: iso(4, 8) };
    // The times were changed to start at 08:30 after the timer was stopped at 10:00: that stop still holds for today.
    expect(claimHolds({ ...task, recurrence_times: [{ start: "08:30", end: "17:00" }] }, at(4, 10))).toBe(true); expect(dueStarts([{ ...task, recurrence_times: [{ start: "08:30", end: "17:00" }] }], at(4, 10))).toEqual([]);
    // Tomorrow is planned time of its own; a claim from days ago, with nothing planned in between, is stale too.
    expect(claimHolds(task, at(5, 9))).toBe(false); expect(claimHolds({ ...task, recurrence: "every week on wed" }, at(11, 9))).toBe(false);
    expect(claimHolds({ ...task, auto_started_block: iso(4, 18) }, at(4, 10))).toBe(false); expect(claimHolds({ ...task, auto_started_block: null }, at(4, 10))).toBe(false);
  });
  it("counts repeating time in a project's day, week and month, not in the whole project, and gives a recurring task no budget of its own", () => {
    const task = { ...working(), projects: ["Projects/Job.md"], time_budget_seconds: 3600 }; const now = at(2, 7);
    expect(budgetUse(task, now)).toBeNull(); expect(budgetUse({ ...task, recurring: false }, now)).not.toBeNull();
    expect(projectUse([task], "Projects/Job.md", "week", 50 * 3600, now).planned).toBe(45 * 3600); expect(projectUse([task], "Projects/Job.md", "day", 9 * 3600, now).planned).toBe(9 * 3600);
    expect(projectUse([task], "Projects/Job.md", "week", 50 * 3600, at(4, 10)).planned).toBe(25 * 3600); expect(projectUse([task], "Projects/Job.md", "total", 3600, now).planned).toBe(0);
    expect(projectUse([{ ...task, recurrence_skips: ["2026-03-02"] }], "Projects/Job.md", "day", 9 * 3600, now).planned).toBe(0);
  });
});
