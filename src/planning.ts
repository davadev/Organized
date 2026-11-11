import { elapsed, Task, WorkSession } from "./model";
import { moment } from "./moment";
import { plansIn } from "./plans";
import { seconds } from "./sessions";

/** Total length of the time set aside for a task. */
export const plannedSeconds = (task: Task): number => task.planned_sessions.reduce((sum, block) => sum + seconds(block), 0);
const covers = (block: WorkSession, now: number): boolean => Date.parse(block.start) <= now && now < Date.parse(block.end);
/** How far around now the timer rules look for planned time: wide enough for a run of blocks through the night. */
const AROUND = 2 * 86400000;
/** The task's planned blocks near `now`, its own and those its repeating times make. */
const plansNear = (task: Task, now: number): WorkSession[] => plansIn(task, now - AROUND, now + AROUND, now, true);
/** The planned block that is under way at `now`, if any. */
export const blockAt = (task: Task, now: number): WorkSession | undefined => plansNear(task, now).find(block => covers(block, now));
/** Planned blocks only matter for a task that is still to be done and still has its own note. */
export const plannable = (task: Task): boolean => (task.status === "open" || task.status === "in_progress") && !task.converted_to;

/** Stretches of planned time: blocks that overlap or follow each other without a gap are one. */
function runsOf(plans: WorkSession[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const [s, e] of plans.map(b => [Date.parse(b.start), Date.parse(b.end)] as const).sort((a, b) => a[0] - b[0])) {
    const last = runs.at(-1); if (last && s <= last[1]) last[1] = Math.max(last[1], e); else runs.push([s, e]);
  }
  return runs;
}
/**
 * Whether the planned time the task was marked handled for (`auto_started_block`, see `setStatus`) is still under way: the claim was made in the stretch of planned time that covers `now`
 * (after the stretch before it ended). An instant, not a block: it holds when the block's times are edited, when its day is changed on its own, and when its repeating times are recomputed.
 */
export function claimHolds(task: Task, now: number): boolean {
  if (task.auto_started_block === null) return false;
  const claim = Date.parse(task.auto_started_block); const runs = runsOf(plansNear(task, now)); const at = runs.findIndex(([s, e]) => s <= now && now < e);
  return at >= 0 && claim >= (at > 0 ? runs[at - 1][1] : now - AROUND) && claim < runs[at][1];
}
/** Tasks still to do whose planned block has begun and whose timer is not running: their timer starts, recurring or not. Planned time starts its task once; a task the person stopped during it stays stopped (blocks back to back count as one). */
export function dueStarts(tasks: Task[], now: number): { task: Task; block: WorkSession }[] {
  return tasks.flatMap(task => {
    const block = blockAt(task, now);
    return block && !claimHolds(task, now) && plannable(task) && task.time_tracking_started_at === null ? [{ task, block: { start: block.start, end: block.end } }] : [];
  });
}
/**
 * Running timers whose planned time is over: a timer that ran in one of its task's planned blocks stops where that stretch of planned time ends, however and whenever it was started, also when
 * this is noticed only later. A timer that runs for planned time that was moved away or deleted stops now. `end` is when it stops; the time after it is not counted.
 */
export function dueStops(tasks: Task[], now: number): { task: Task; end: number }[] {
  return tasks.flatMap(task => {
    if (task.time_tracking_started_at === null) return [];
    const started = Date.parse(task.time_tracking_started_at);
    const ends = runsOf(plansNear(task, now)).filter(([s, e]) => s < now && e > started && e <= now).map(([, e]) => e);
    if (ends.length) return [{ task, end: Math.min(...ends) }];
    return task.auto_started_block !== null && !claimHolds(task, now) ? [{ task, end: now }] : [];
  });
}

export interface BudgetUse {
  budget: number; tracked: number; planned: number;
  /** Seconds still free; negative once tracked plus planned time passes the budget. */
  left: number;
  /** Share of the bar (0 to 100) taken by tracked time, planned time and the part beyond the budget; the three sum to 100 and, when over budget, the bar is the whole total rather than the budget. */
  trackedPct: number; plannedPct: number; overPct: number;
}
/** Tracked and planned seconds measured against a budget: tracked time that fits fills the bar first, planned time follows, and whatever passes the budget is the overrun. */
export function fillOf(budget: number, tracked: number, planned: number): BudgetUse {
  const total = tracked + planned, scale = Math.max(budget, total);
  const over = Math.max(0, total - budget), within = total - over;
  const trackedFit = Math.min(tracked, within);
  return { budget, tracked, planned, left: budget - total, trackedPct: 100 * trackedFit / scale, plannedPct: 100 * (within - trackedFit) / scale, overPct: 100 * over / scale };
}
/** A task's tracked plus planned time measured against its own budget, or null when it has none. A recurring task has none: its time repeats with no end, so only a day, week or month (a project's budget) can measure it. */
export const budgetUse = (task: Task, now = Date.now()): BudgetUse | null => task.time_budget_seconds === null || task.recurring ? null : fillOf(task.time_budget_seconds, elapsed(task, now), plannable(task) ? plannedNotWorked(task.planned_sessions, workedSessions(task, now), [now, Infinity]) : 0);
/** The task's stored sessions plus its running timer up to `now`. */
const workedSessions = (task: Task, now: number): WorkSession[] => [...task.work_sessions, ...(task.time_tracking_started_at !== null && Date.parse(task.time_tracking_started_at) < now ? [{ start: task.time_tracking_started_at, end: new Date(now).toISOString() }] : [])];
/**
 * Seconds of planned time (inside `range`, when given) that the same task did not also work: a minute that was both planned and tracked (a timer run inside the block) is used once, as tracked, so a budget does not count it twice.
 * Budgets pass a range that starts now: planned time that went by without being worked is not counted, so once a block is over only the time really worked remains.
 */
export function plannedNotWorked(plans: WorkSession[], worked: WorkSession[], range: [number, number] | null = null): number {
  const spans = (sessions: WorkSession[]) => sessions.map(s => [Date.parse(s.start), Date.parse(s.end)] as const);
  // Plans that overlap are one stretch of planned time: the same minute planned twice is still one minute.
  const merged: [number, number][] = [];
  for (const [start, end] of spans(plans).map(([s, e]) => [range ? Math.max(s, range[0]) : s, range ? Math.min(e, range[1]) : e] as const).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1); if (last && start <= last[1]) last[1] = Math.max(last[1], end); else merged.push([start, end]);
  }
  let total = 0;
  for (const [from, to] of merged) {
    let left = to - from, reached = from;
    for (const [s, e] of spans(worked).map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as const).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])) {
      const counted = Math.max(s, reached); if (e > counted) { left -= e - counted; reached = e; }
    }
    total += left;
  }
  return total / 1000;
}

/** The span a project budget covers: the whole project, or the current day, week or month. */
export type Period = "total" | "day" | "week" | "month";
export const PERIOD_LABELS: Record<Period, string> = { total: "all time", day: "today", week: "this week", month: "this month" };
/** Local-time start and end (ms) of the day, week (by the Obsidian locale, like the calendar) or month holding `now`; null for the whole project. */
export function periodRange(period: Period, now: number): [number, number] | null {
  if (period === "total") return null;
  const start = moment(now).startOf(period); return [start.valueOf(), start.clone().add(1, period).valueOf()];
}
/** Seconds of the sessions that fall inside a range (a session crossing its edge counts only for the part inside). */
export const overlap = (sessions: WorkSession[], range: [number, number]): number => sessions.reduce((sum, s) => sum + Math.max(0, Math.min(Date.parse(s.end), range[1]) - Math.max(Date.parse(s.start), range[0])), 0) / 1000;
/** Tracked plus planned time of every task in a project over a period, measured against one of the project's budgets. */
export function projectUse(tasks: Task[], project: string, period: Period, budget: number, now = Date.now()): BudgetUse {
  const range = periodRange(period, now); let tracked = 0, planned = 0;
  for (const task of tasks) {
    if (!task.projects.includes(project)) continue;
    // A period counts the repeating time in it; the whole project, which has no end, counts only blocks planned one by one.
    const ahead: [number, number] = [Math.max(range?.[0] ?? now, now), range?.[1] ?? Infinity];
    const plans = !plannable(task) ? [] : range ? plansIn(task, ahead[0], ahead[1], now) : task.planned_sessions; const worked = workedSessions(task, now);
    planned += plannedNotWorked(plans, worked, ahead);
    tracked += range ? overlap(worked, range) : elapsed(task, now);
  }
  return fillOf(budget, Math.floor(tracked), Math.floor(planned));
}
