import type { Task, WorkSession } from "./model";
import { plannable } from "./planning";

export interface Block { task: Task; startMin: number; endMin: number; running: boolean; /** Time set aside rather than worked. */ planned: boolean; lane: number; lanes: number; /** The stored session behind the block, unclipped; absent for a running timer. */ session?: WorkSession }
export const DEFAULT_HOURS: readonly [number, number] = [8, 18];

/** A block is drawn at least this tall (see `.organized-block`), so a shorter run still occupies this much of the grid and must not share a column with the next one. */
export const MIN_DRAWN_MINUTES = 36;
const drawnEnd = (block: Block): number => Math.max(block.endMin, block.startMin + MIN_DRAWN_MINUTES);
function minutesInto(ms: number, start: Date, end: Date): number {
  if (ms <= start.getTime()) return 0;
  if (ms >= end.getTime()) return 1440;
  const at = new Date(ms); return at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
}
/** Overlapping blocks (as drawn, including the minimum height) share the width of the day: each gets a column and the number of columns in its group. */
export function assignLanes(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let group: Block[] = []; let groupEnd = -1; const laneEnds: number[] = [];
  const close = () => { for (const block of group) block.lanes = laneEnds.length; group = []; laneEnds.length = 0; };
  for (const block of sorted) {
    if (block.startMin >= groupEnd) close();
    let lane = laneEnds.findIndex(end => end <= block.startMin); if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = drawnEnd(block); block.lane = lane; group.push(block); groupEnd = Math.max(groupEnd, drawnEnd(block));
  }
  close();
  return sorted;
}
/** Tracked and planned blocks of every task on one local day, with the running timer drawn up to `now`. Sessions that cross midnight appear on both days. */
export function blocksOn(tasks: Task[], date: string, now: number): Block[] {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day); const end = new Date(year, month - 1, day + 1);
  const blocks: Block[] = [];
  for (const task of tasks) {
    const running = task.time_tracking_started_at !== null;
    const sessions: { start: number; end: number; running: boolean; planned: boolean; session?: WorkSession }[] = [...task.work_sessions.map(s => ({ start: Date.parse(s.start), end: Date.parse(s.end), running: false, planned: false, session: s })),
      ...(plannable(task) ? task.planned_sessions.map(s => ({ start: Date.parse(s.start), end: Date.parse(s.end), running: false, planned: true, session: s })) : []),
      ...(running ? [{ start: Date.parse(task.time_tracking_started_at!), end: now, running: true, planned: false }] : [])];
    for (const session of sessions) {
      if (session.end <= start.getTime() || session.start >= end.getTime() || session.end <= session.start) continue;
      const startMin = minutesInto(session.start, start, end); const endMin = minutesInto(session.end, start, end);
      if (endMin > startMin) blocks.push({ task, startMin, endMin, running: session.running, planned: session.planned, lane: 0, lanes: 1, session: session.session });
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
