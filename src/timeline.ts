import type { Task, WorkSession } from "./model";
import { plannable } from "./planning";
import { Plan, plansIn } from "./plans";

export interface Block { task: Task; startMin: number; endMin: number; running: boolean; /** Time set aside rather than worked. */ planned: boolean; lane: number; lanes: number; /** The stored session behind the block, unclipped; absent for a running timer. */ session?: WorkSession; /** A block of the task's repeating times, not one of its own. */ repeating?: boolean }
export const DEFAULT_HOURS: readonly [number, number] = [8, 18];

/** A block is drawn at least this tall (see `.organized-block`), so a shorter run still occupies this much of the grid and must not share a column with the next one. */
export const MIN_DRAWN_MINUTES = 36;
const drawnEnd = (block: Block): number => Math.max(block.endMin, block.startMin + MIN_DRAWN_MINUTES);
function minutesInto(ms: number, start: Date, end: Date): number {
  if (ms <= start.getTime()) return 0;
  if (ms >= end.getTime()) return 1440;
  const at = new Date(ms); return at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
}
/**
 * Overlapping blocks (as drawn, including the minimum height) share the width of the day: each gets a column and the number of columns in its group.
 * Time worked on a task (or its running timer) that overlaps the task's own planned block is drawn in that block's column, over it: the plan reads as an outline filled where it was worked, not as a second copy of the task beside it.
 * The column is kept for plan and work together, so an early start or a timer running past the plan's end neither collides with another block nor jumps to a new column.
 */
export function assignLanes(blocks: Block[]): Block[] {
  const inside = new Map<Block, Block>(); const own = new Map<Block, Block[]>();
  for (const block of blocks) {
    const plan = block.planned ? undefined : blocks.find(p => p.planned && p.task === block.task && p.startMin < block.endMin && block.startMin < p.endMin);
    if (plan) { inside.set(block, plan); own.set(plan, [...(own.get(plan) ?? []), block]); }
  }
  const startOf = (block: Block) => Math.min(block.startMin, ...(own.get(block) ?? []).map(b => b.startMin));
  const endOf = (block: Block) => Math.max(drawnEnd(block), ...(own.get(block) ?? []).map(drawnEnd));
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let group: Block[] = []; let groupEnd = -1; const laneEnds: number[] = [];
  const close = () => { for (const block of group) block.lanes = laneEnds.length; group = []; laneEnds.length = 0; };
  for (const block of [...sorted].filter(b => !inside.has(b)).sort((a, b) => startOf(a) - startOf(b))) {
    if (startOf(block) >= groupEnd) close();
    let lane = laneEnds.findIndex(end => end <= startOf(block)); if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = endOf(block); block.lane = lane; group.push(block); groupEnd = Math.max(groupEnd, endOf(block));
  }
  close();
  for (const [block, plan] of inside) { block.lane = plan.lane; block.lanes = plan.lanes; }
  return sorted;
}
/** Tracked and planned blocks of every task on one local day, with the running timer drawn up to `now`. Sessions that cross midnight appear on both days. */
export function blocksOn(tasks: Task[], date: string, now: number): Block[] {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day); const end = new Date(year, month - 1, day + 1);
  const blocks: Block[] = [];
  for (const task of tasks) {
    const running = task.time_tracking_started_at !== null;
    const sessions: { start: number; end: number; running: boolean; planned: boolean; session?: WorkSession; repeating?: boolean }[] = [...task.work_sessions.map(s => ({ start: Date.parse(s.start), end: Date.parse(s.end), running: false, planned: false, session: s })),
      ...(plannable(task) ? plansIn(task, start.getTime(), end.getTime(), now).map((s: Plan) => ({ start: Date.parse(s.start), end: Date.parse(s.end), running: false, planned: true, session: { start: s.start, end: s.end }, ...(s.repeating ? { repeating: true } : {}) })) : []),
      ...(running ? [{ start: Date.parse(task.time_tracking_started_at!), end: now, running: true, planned: false }] : [])];
    for (const session of sessions) {
      if (session.end <= start.getTime() || session.start >= end.getTime() || session.end <= session.start) continue;
      const startMin = minutesInto(session.start, start, end); const endMin = minutesInto(session.end, start, end);
      if (endMin > startMin) blocks.push({ task, startMin, endMin, running: session.running, planned: session.planned, lane: 0, lanes: 1, session: session.session, ...(session.repeating ? { repeating: true } : {}) });
    }
  }
  return assignLanes(blocks);
}
/** Whole hours to draw: the usual working day, widened when a block falls outside it. */
export function hourRange(blocks: Block[], [from, to]: readonly [number, number] = DEFAULT_HOURS): [number, number] {
  const first = blocks.length ? Math.min(from, Math.floor(Math.min(...blocks.map(b => b.startMin)) / 60)) : from;
  const last = blocks.length ? Math.max(to, Math.min(24, Math.ceil(Math.max(...blocks.map(drawnEnd)) / 60))) : to;
  return [first, last];
}
