import { describe, expect, it } from "vitest";
import { moment } from "../moment";
import { newTask, setStatus, startPlanned, Task } from "../model";
import { blockAt, budgetUse, fillOf, dueStops, overlap, periodRange, projectUse, dueStarts, plannable, plannedNotWorked, plannedSeconds } from "../planning";

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
  it("starts the timer of a task still to do, recurring or not, whose block has begun and that nothing is timing", () => {
    const planned = [block("09:00", "10:00")];
    for (const kind of [{}, { recurring: true }, { status: "in_progress" as const }]) expect(dueStarts([task({ planned_sessions: planned, ...kind })], at("09:30")).map(d => d.block)).toEqual(planned);
    expect(dueStarts([task({ planned_sessions: planned })], at("08:00"))).toEqual([]);
    for (const other of [{ status: "completed" as const }, { converted_to: "N.md" }, { time_tracking_started_at: "2026-03-09T09:10:00.000Z" }]) {
      expect(dueStarts([task({ planned_sessions: planned, ...other })], at("09:30"))).toEqual([]);
    }
  });
  it("times a block from its start, never over time already worked, and starts a task once per block: stopped during the block, it stays stopped", () => {
    const planned = block("09:00", "10:00"); const started = startPlanned(task({ status: "completed", closed_at: "2026-03-01T00:00:00.000Z", planned_sessions: [planned] }), planned);
    expect(started).toMatchObject({ status: "in_progress", closed_at: null, auto_started_block: planned.start, time_tracking_started_at: planned.start });
    const after = startPlanned(task({ planned_sessions: [planned], work_sessions: [block("08:30", "09:20")] }), planned); expect(after.time_tracking_started_at).toBe(block("09:20", "09:20").start);
    // Stopped (or restarted and stopped again) during the block: that block does not start it again; the next one does.
    const stopped = setStatus(setStatus(setStatus(started, "open", new Date(at("09:20"))), "in_progress", new Date(at("09:30"))), "open", new Date(at("09:40")));
    expect(stopped.auto_started_block).toBe(planned.start); expect(dueStarts([stopped], at("09:50"))).toEqual([]);
    const next = block("11:00", "12:00"); expect(dueStarts([{ ...stopped, planned_sessions: [planned, next] }], at("11:30")).map(d => d.block)).toEqual([next]);
    // A timer the person started before any block, then stopped during one, also stays stopped there.
    const early = setStatus(setStatus(task({ planned_sessions: [planned] }), "in_progress", new Date(at("08:30"))), "open", new Date(at("09:15"))); expect(dueStarts([early], at("09:30"))).toEqual([]);
    expect(setStatus(task(), "open", new Date(at("09:30"))).auto_started_block).toBeNull();
  });
  it("stops a running timer where the planned time it ran in ends, however it was started, with back-to-back blocks as one", () => {
    const first = block("09:00", "10:00"); const planned = [first, block("10:00", "11:00"), block("14:00", "15:00")];
    const running = (from: string) => task({ planned_sessions: planned, time_tracking_started_at: new Date(at(from)).toISOString() });
    expect(dueStops([running("09:00")], at("10:30"))).toEqual([]); expect(dueStops([task({ planned_sessions: planned })], at("12:00"))).toEqual([]);
    expect(dueStops([running("09:00")], at("11:00"))).toEqual([{ task: running("09:00"), end: at("11:00") }]);
    // Noticed late (the phone slept), started before the block, or restarted inside it: it stops at the end all the same.
    expect(dueStops([running("09:30")], at("13:00"))[0].end).toBe(at("11:00")); expect(dueStops([running("08:15")], at("11:05"))[0].end).toBe(at("11:00"));
    // A timer started after the blocks it could belong to keeps running until the next one it runs into ends.
    expect(dueStops([running("12:00")], at("13:00"))).toEqual([]); expect(dueStops([running("12:00")], at("15:00"))[0].end).toBe(at("15:00"));
  });
  it("measures tracked plus planned time against a budget and extends the bar when over", () => {
    expect(budgetUse(task())).toBeNull();
    const base = { time_budget_seconds: 3600, time_tracked_seconds: 900, planned_sessions: [block("09:00", "09:30")] };
    expect(budgetUse(task(base), at("08:00"))).toEqual({ budget: 3600, tracked: 900, planned: 1800, left: 900, trackedPct: 25, plannedPct: 50, overPct: 0 });
    expect(budgetUse(task({ ...base, planned_sessions: [block("09:00", "09:45")] }), at("08:00"))).toMatchObject({ left: 0, trackedPct: 25, plannedPct: 75, overPct: 0 });
    expect(budgetUse(task({ ...base, planned_sessions: [block("09:00", "10:00")] }), at("08:00"))).toMatchObject({ left: -900, trackedPct: 20, plannedPct: 60, overPct: 20 });
    expect(budgetUse(task({ ...base, time_tracked_seconds: 5400, planned_sessions: [] }))).toMatchObject({ left: -1800, plannedPct: 0 })
    expect(budgetUse(task({ ...base, time_tracked_seconds: 5400, planned_sessions: [] }))!.overPct).toBeCloseTo(100 / 3);
    const running = task({ ...base, planned_sessions: [], time_tracking_started_at: new Date(at("09:00")).toISOString() });
    expect(budgetUse(running, at("09:10"))?.tracked).toBe(1500);
  });
  it("counts a minute that was both planned and worked once, as worked, in the task's budget and the project's", () => {
    // The case from a phone: planned 08:00-15:00, the timer started inside it at 10:50, now 11:00. The plan counts from now on; what went by unworked is not counted.
    const work = task({ planned_sessions: [block("08:00", "15:00")], time_budget_seconds: 8 * 3600, time_tracking_started_at: new Date(at("10:50")).toISOString(), projects: ["P.md"] });
    expect(budgetUse(work, at("11:00"))).toMatchObject({ tracked: 600, planned: 4 * 3600, left: 4 * 3600 - 600 });
    expect(projectUse([work], "P.md", "total", 8 * 3600, at("11:00"))).toMatchObject({ tracked: 600, planned: 4 * 3600 });
    expect(projectUse([work], "P.md", "day", 8 * 3600, at("11:00"))).toMatchObject({ tracked: 600, planned: 4 * 3600 });
    // Planned time that is ahead and was already worked (a session put there by hand) counts once; once the block is over only the work remains.
    const ahead = { ...work, time_tracking_started_at: null, work_sessions: [block("12:00", "13:00")], time_tracked_seconds: 3600 };
    expect(budgetUse(ahead, at("11:00"))).toMatchObject({ tracked: 3600, planned: 3 * 3600 }); expect(budgetUse(ahead, at("16:00"))).toMatchObject({ tracked: 3600, planned: 0 });
    // Worked past the plan's end and before it, in overlapping sessions: the plan is used up, the extra is worked time.
    expect(plannedNotWorked([block("09:00", "10:00")], [block("08:30", "09:20"), block("09:10", "09:40"), block("09:50", "11:00")])).toBe(600); expect(plannedNotWorked([block("09:00", "10:00")], [block("09:10", "09:40"), block("09:15", "09:30")])).toBe(1800);
    // Planned and not worked (ahead or skipped) still counts; work outside the plan does not reduce it; only the part inside a period counts.
    expect(plannedNotWorked([block("09:00", "10:00"), block("14:00", "15:00")], [block("11:00", "12:00")])).toBe(7200);
    expect(plannedNotWorked([block("09:00", "10:00")], [block("09:00", "09:30")], [at("09:15"), at("12:00")])).toBe(1800); expect(plannedNotWorked([block("09:00", "10:00")], [], [at("11:00"), at("12:00")])).toBe(0);
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
  describe("budget edge cases", () => {
    const L = (d: number, h: number, m = 0, mo = 2, y = 2026) => new Date(y, mo, d, h, m).toISOString();
    const span = (a: string, b: string) => ({ start: a, end: b });
    const P = "Projects/P.md";

    it("keeps the three shares in range and adding up to the used part of the bar, whatever the numbers", () => {
      for (const budget of [1, 60, 3600, 36000]) for (const tracked of [0, 1, 59, 3600, 40000]) for (const planned of [0, 1, 1800, 90000]) {
        const use = fillOf(budget, tracked, planned); const total = tracked + planned;
        for (const pct of [use.trackedPct, use.plannedPct, use.overPct]) { expect(pct).toBeGreaterThanOrEqual(0); expect(pct).toBeLessThanOrEqual(100); }
        expect(use.trackedPct + use.plannedPct + use.overPct).toBeCloseTo(100 * total / Math.max(budget, total), 9);
        expect(use.left).toBe(budget - total); expect(use.overPct > 0).toBe(total > budget);
      }
    });
    it("shows the overrun when tracked time alone passes the budget, and nothing planned inside the bar", () => {
      expect(fillOf(3600, 7200, 1800)).toMatchObject({ left: -5400, trackedPct: (3600 / 9000) * 100, plannedPct: 0 });
      expect(fillOf(3600, 3600, 0)).toMatchObject({ left: 0, trackedPct: 100, overPct: 0 });
      expect(fillOf(3600, 0, 0)).toMatchObject({ trackedPct: 0, plannedPct: 0, overPct: 0, left: 3600 });
    });
    it("ignores plans of a task that is done, canceled or has become a note", () => {
      const plans = [block("09:00", "10:00")];
      for (const other of [{ status: "completed" as const }, { status: "canceled" as const }, { converted_to: "N.md" }]) expect(budgetUse(task({ time_budget_seconds: 7200, planned_sessions: plans, ...other }))!.planned).toBe(0);
      expect(budgetUse(task({ time_budget_seconds: 7200, planned_sessions: plans, status: "in_progress" }), at("08:00"))!.planned).toBe(3600);
    });
    it("counts a running timer in the task budget, and a timer started in the future (clock skew) as nothing", () => {
      expect(budgetUse(task({ time_budget_seconds: 7200, time_tracking_started_at: new Date(at("09:00")).toISOString() }), at("09:30"))!.tracked).toBe(1800);
      expect(budgetUse(task({ time_budget_seconds: 7200, time_tracking_started_at: new Date(at("10:00")).toISOString() }), at("09:30"))!.tracked).toBe(0);
    });

    it("splits a session at midnight, month end and year end", () => {
      const midnight = [span(L(10, 23), L(11, 1))];
      expect(overlap(midnight, periodRange("day", new Date(2026, 2, 10, 12).getTime())!)).toBe(3600); expect(overlap(midnight, periodRange("day", new Date(2026, 2, 11, 12).getTime())!)).toBe(3600);
      const monthEnd = [span(L(31, 22), L(1, 2, 0, 3))];
      expect(overlap(monthEnd, periodRange("month", new Date(2026, 2, 15).getTime())!)).toBe(2 * 3600); expect(overlap(monthEnd, periodRange("month", new Date(2026, 3, 15).getTime())!)).toBe(2 * 3600);
      const yearEnd = [span(L(31, 23, 0, 11), L(1, 1, 0, 0, 2027))];
      expect(overlap(yearEnd, periodRange("month", new Date(2026, 11, 20).getTime())!)).toBe(3600); expect(overlap(yearEnd, periodRange("month", new Date(2027, 0, 5).getTime())!)).toBe(3600);
    });
    it("knows February in a leap year and the first and last instant of a period", () => {
      const [from, to] = periodRange("month", new Date(2028, 1, 10).getTime())!; expect(Math.round((to - from) / 86400000)).toBe(29);
      const [d0, d1] = periodRange("day", new Date(2026, 2, 10, 12).getTime())!;
      expect(overlap([span(new Date(d0).toISOString(), new Date(d1).toISOString())], [d0, d1])).toBe(86400); expect(overlap([span(new Date(d1).toISOString(), new Date(d1 + 1000).toISOString())], [d0, d1])).toBe(0);
    });
    it("starts the week on the day the Obsidian locale says", () => {
      const wed = new Date(2026, 2, 11, 12).getTime(); const saved = moment.localeData().firstDayOfWeek();
      try {
        moment.updateLocale("en", { week: { dow: 1, doy: 4 } }); expect(new Date(periodRange("week", wed)![0]).getDay()).toBe(1);
        moment.updateLocale("en", { week: { dow: 0, doy: 6 } }); expect(new Date(periodRange("week", wed)![0]).getDay()).toBe(0);
        moment.updateLocale("en", { week: { dow: 6, doy: 12 } }); expect(new Date(periodRange("week", wed)![0]).getDay()).toBe(6);
        // Sunday 00:00 belongs to the week that starts the previous Monday under a Monday start, and to the new week under a Sunday start.
        const sunday = new Date(2026, 2, 15, 0, 0).getTime(); moment.updateLocale("en", { week: { dow: 1, doy: 4 } }); const [mf, mt] = periodRange("week", sunday)!; expect(mf).toBe(new Date(2026, 2, 9).getTime()); expect(sunday < mt).toBe(true);
        moment.updateLocale("en", { week: { dow: 0, doy: 6 } }); expect(periodRange("week", sunday)![0]).toBe(sunday);
      } finally { moment.updateLocale("en", { week: { dow: saved, doy: saved === 1 ? 4 : 6 } }); }
    });

    it("clips a running timer that began before the period, and ignores one that has not begun", () => {
      const now = new Date(2026, 2, 11, 9, 0).getTime();
      const overnight = task({ projects: [P], time_tracking_started_at: L(10, 22) });
      expect(projectUse([overnight], P, "day", 36000, now).tracked).toBe(9 * 3600); expect(projectUse([overnight], P, "total", 36000, now).tracked).toBe(11 * 3600);
      expect(projectUse([task({ projects: [P], time_tracking_started_at: L(11, 12) })], P, "day", 36000, now).tracked).toBe(0);
    });
    it("counts planned blocks that are partly in the period, but never for done, canceled or converted tasks", () => {
      const now = new Date(2026, 2, 11, 9, 0).getTime();
      const plans = [span(L(11, 23, 30), L(12, 0, 30)), span(L(10, 23, 30), L(11, 0, 30))];
      // The block across the start of the day is over by 09:00, so only the half hour still ahead counts.
      expect(projectUse([task({ projects: [P], planned_sessions: plans })], P, "day", 36000, now).planned).toBe(1800);
      for (const other of [{ status: "completed" as const }, { status: "canceled" as const }, { converted_to: "N.md" }]) expect(projectUse([task({ projects: [P], planned_sessions: plans, ...other })], P, "day", 36000, now).planned).toBe(0);
    });
    it("counts worked time of done and canceled tasks, and of every task for a project that shares its name with another", () => {
      const now = new Date(2026, 2, 11, 18, 0).getTime(); const done = [span(L(11, 9), L(11, 10))];
      const tasks = [task({ id: "t1xxxxxx", projects: [P], status: "completed", work_sessions: done }), task({ id: "t2xxxxxx", projects: [P], status: "canceled", work_sessions: done }), task({ id: "t3xxxxxx", projects: ["Other/P.md"], work_sessions: done })];
      expect(projectUse(tasks, P, "day", 36000, now).tracked).toBe(7200); expect(projectUse(tasks, "Other/P.md", "day", 36000, now).tracked).toBe(3600);
    });
    it("uses tracked seconds without sessions only for the whole project, and survives a task that lists a project twice", () => {
      const now = new Date(2026, 2, 11, 18, 0).getTime(); const legacy = task({ projects: [P, P], time_tracked_seconds: 5000 });
      expect(projectUse([legacy], P, "total", 36000, now).tracked).toBe(5000); expect(projectUse([legacy], P, "week", 36000, now).tracked).toBe(0);
    });
    it("copes with a very large number of sessions and with sessions far in the past or future", () => {
      const now = new Date(2026, 2, 11, 12, 0).getTime(); const many = Array.from({ length: 500 }, (_v, n) => span(new Date(2020, 0, 1, 9, n % 50).toISOString(), new Date(2020, 0, 1, 9, (n % 50) + 1).toISOString()));
      const far = [span(L(1, 9, 0, 0, 2099), L(1, 10, 0, 0, 2099))];
      const t = task({ projects: [P], work_sessions: [...many, ...far], planned_sessions: far });
      expect(projectUse([t], P, "month", 36000, now)).toMatchObject({ tracked: 0, planned: 0 });
    });
  });
});
