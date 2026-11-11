import { elapsed, Task, WorkSession } from "./model";
import { moment } from "./moment";
import { seconds } from "./sessions";

/** Total length of the time set aside for a task. */
export const plannedSeconds = (task: Task): number => task.planned_sessions.reduce((sum, block) => sum + seconds(block), 0);
const covers = (block: WorkSession, now: number): boolean => Date.parse(block.start) <= now && now < Date.parse(block.end);
/** The planned block that is under way at `now`, if any. */
export const blockAt = (task: Task, now: number): WorkSession | undefined => task.planned_sessions.find(block => covers(block, now));
/** Planned blocks only matter for a task that is still to be done and still has its own note. */
export const plannable = (task: Task): boolean => (task.status === "open" || task.status === "in_progress") && !task.converted_to;

/** Open tasks whose planned block has begun and that nothing is timing: they are set in progress, without a timer. Recurring tasks stay open. */
export function dueStarts(tasks: Task[], now: number): { task: Task; block: WorkSession }[] {
  return tasks.flatMap(task => {
    const block = blockAt(task, now);
    return block && block.start !== task.auto_started_block && task.status === "open" && !task.recurring && !task.converted_to && task.time_tracking_started_at === null ? [{ task, block }] : [];
  });
}
export interface DueEnd { task: Task; action: "reopen" | "release" | "move"; block?: WorkSession }
/**
 * Tasks this feature set in progress whose block is over. `reopen` puts the task back to open; `release` only ends the claim (the person changed the task or started a timer, so their status stays); `move` hands the claim to the next block when blocks run back to back.
 */
export function dueEnds(tasks: Task[], now: number): DueEnd[] {
  const ends: DueEnd[] = [];
  for (const task of tasks) {
    if (task.auto_started_block === null) continue;
    const current = blockAt(task, now);
    if (current?.start === task.auto_started_block) continue;
    if (task.status !== "in_progress" || task.time_tracking_started_at !== null) ends.push({ task, action: "release" });
    else ends.push(current ? { task, action: "move", block: current } : { task, action: "reopen" });
  }
  return ends;
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
/** A task's tracked plus planned time measured against its own budget, or null when it has none. */
export const budgetUse = (task: Task, now = Date.now()): BudgetUse | null => task.time_budget_seconds === null ? null : fillOf(task.time_budget_seconds, elapsed(task, now), plannable(task) ? plannedNotWorked(task.planned_sessions, workedSessions(task, now)) : 0);
/** The task's stored sessions plus its running timer up to `now`. */
const workedSessions = (task: Task, now: number): WorkSession[] => [...task.work_sessions, ...(task.time_tracking_started_at !== null && Date.parse(task.time_tracking_started_at) < now ? [{ start: task.time_tracking_started_at, end: new Date(now).toISOString() }] : [])];
/**
 * Seconds of planned time (inside `range`, when given) that the same task did not also work: a minute that was both planned and tracked (a timer run inside the block) is used once, as tracked, so a budget does not count it twice.
 * Planned time not worked still counts, whether it is still ahead or was skipped.
 */
export function plannedNotWorked(plans: WorkSession[], worked: WorkSession[], range: [number, number] | null = null): number {
  const spans = (sessions: WorkSession[]) => sessions.map(s => [Date.parse(s.start), Date.parse(s.end)] as const);
  let total = 0;
  for (const [start, end] of spans(plans)) {
    const from = range ? Math.max(start, range[0]) : start, to = range ? Math.min(end, range[1]) : end; if (to <= from) continue;
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
    const plans = plannable(task) ? task.planned_sessions : []; const worked = workedSessions(task, now);
    planned += plannedNotWorked(plans, worked, range);
    tracked += range ? overlap(worked, range) : elapsed(task, now);
  }
  return fillOf(budget, Math.floor(tracked), Math.floor(planned));
}
