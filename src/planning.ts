import { elapsed, Task, WorkSession } from "./model";
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
    return block && task.status === "open" && !task.recurring && !task.converted_to && task.time_tracking_started_at === null ? [{ task, block }] : [];
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
/** Tracked plus planned time measured against a task's budget, or null when it has none. Tracked time that fits fills the bar first; planned time follows; whatever passes the budget is shown as the overrun. */
export function budgetUse(task: Task, now = Date.now()): BudgetUse | null {
  const budget = task.time_budget_seconds; if (budget === null) return null;
  const tracked = elapsed(task, now), planned = plannedSeconds(task), total = tracked + planned, scale = Math.max(budget, total);
  const over = Math.max(0, total - budget), within = total - over;
  const trackedFit = Math.min(tracked, within);
  return { budget, tracked, planned, left: budget - total, trackedPct: 100 * trackedFit / scale, plannedPct: 100 * (within - trackedFit) / scale, overPct: 100 * over / scale };
}
