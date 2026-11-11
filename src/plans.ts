import type { Task, WorkSession } from "./model";
import { anchorOf, repeatsOn } from "./recurrence";

/** A time of day a recurring task is planned for, as local clock times (`HH:MM`). An end at or before the start is on the next day. */
export interface ClockSpan { start: string; end: string }
/** The most times one recurring task can repeat on a day. */
export const MAX_TIMES = 8;
/** The most days whose repeating time was replaced by that day's own blocks (see `recurrence_skips`). */
export const MAX_SKIPS = 60;
/** A planned block, marked when it comes from the task's repeating times rather than its own list. */
export type Plan = WorkSession & { repeating?: true };

const DAY = 86400000;
/** `8:00` or `08:00` as minutes after midnight; null when it is not a time. */
export function minutesOf(clock: unknown): number | null {
  const match = typeof clock === "string" ? /^(\d{1,2}):(\d{2})$/.exec(clock.trim()) : null; if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]); return h < 24 && m < 60 ? h * 60 + m : null;
}
const clockOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** A span as minutes after midnight, the end past 1440 when it runs into the next day. */
const span = (time: ClockSpan): [number, number] => { const s = minutesOf(time.start)!, e = minutesOf(time.end)!; return [s, e > s ? e : e + 1440]; };
/** Whether two times of day share a minute, also across midnight. */
export function clash(a: ClockSpan, b: ClockSpan): boolean {
  const [as, ae] = span(a), [bs, be] = span(b);
  return [-1440, 0, 1440].some(shift => as < be + shift && bs + shift < ae);
}
/** What is wrong with a list of times, or null. */
export function timesProblem(times: ClockSpan[]): string | null {
  if (times.some(t => minutesOf(t.start) === null || minutesOf(t.end) === null)) return "Add both times, or neither.";
  if (times.some(t => minutesOf(t.start) === minutesOf(t.end))) return "A time needs an end that differs from its start.";
  if (times.length > MAX_TIMES) return `At most ${MAX_TIMES} times a day.`;
  if (times.some((t, n) => times.slice(n + 1).some(o => clash(t, o)))) return "These times overlap; make them one.";
  return null;
}
/** Times as a note holds them, cleaned: written `HH:MM`, sorted, without the unreadable ones, those with no length, and any that overlaps one before it. */
export function timesFrom(value: unknown): ClockSpan[] {
  const kept: ClockSpan[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const s = minutesOf(item.start), e = minutesOf(item.end); if (s === null || e === null || s === e) continue;
    const time = { start: clockOf(s), end: clockOf(e) }; if (kept.length < MAX_TIMES && !kept.some(k => clash(k, time))) kept.push(time);
  }
  return kept.sort((a, b) => minutesOf(a.start)! - minutesOf(b.start)!);
}
/** `08:00–17:00`, with `(+1 day)` for a time that ends the next morning. */
export const timeLabel = (time: ClockSpan): string => `${time.start}–${time.end}${minutesOf(time.end)! <= minutesOf(time.start)! ? " (+1 day)" : ""}`;

const localDay = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const startOfDay = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/** The blocks of one day's repeating times, made absolute in local time (so a day of a clock change keeps its clock times). A start that does not exist that day becomes the next valid minute. */
function repeatingOn(task: Pick<Task, "recurrence_times">, day: string): Plan[] {
  const [y, m, d] = day.split("-").map(Number);
  return task.recurrence_times.flatMap(time => {
    const [s, e] = span(time); const start = new Date(y, m - 1, d, Math.floor(s / 60), s % 60); const end = new Date(y, m - 1, d + Math.floor(e / 1440), Math.floor((e % 1440) / 60), e % 60);
    return end > start ? [{ start: start.toISOString(), end: end.toISOString(), repeating: true as const }] : [];
  });
}
type Planning = Pick<Task, "planned_sessions" | "recurring" | "recurrence" | "recurrence_periods" | "created" | "recurrence_times" | "recurrence_skips">;
/**
 * Every block of planned time of a task that overlaps `[from, to)`: its own blocks, and the blocks its repeating times make on each day the rule falls on. Repeating blocks are shown and counted
 * from today on (one under way since last night included): past days keep only what was planned for them one by one and what was worked, and nothing needs a daily note. A day in `recurrence_skips` has
 * only its own blocks. Days are walked at most 400 at a time.
 */
export function plansIn(task: Planning, from: number, to: number, now = Date.now(), past = false): Plan[] {
  const own: Plan[] = task.planned_sessions.filter(b => Date.parse(b.end) > from && Date.parse(b.start) < to);
  if (!task.recurring || !task.recurrence_times.length) return own;
  // The timer rules (`past`) look back over the days just gone, so a run of yesterday's time noticed only this morning still stops where it ended.
  const anchor = anchorOf(task); const today = past ? from : startOfDay(now); const repeating: Plan[] = [];
  // From the day before, so a block that began last night and runs past midnight is seen.
  for (let day = startOfDay(Math.max(from, today) - DAY), n = 0; day < to && n < 400; day = startOfDay(day + DAY * 1.5), n++) {
    const date = localDay(day); if (date < anchor || task.recurrence_skips.includes(date) || !repeatsOn(task, date)) continue;
    for (const block of repeatingOn(task, date)) if (Date.parse(block.end) > Math.max(from, today) && Date.parse(block.start) < to && !own.some(b => b.start === block.start && b.end === block.end)) repeating.push(block);
  }
  return [...own, ...repeating].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
/** The repeating blocks of one day, as plans (see `plansIn`). */
export function repeatingBlocks(task: Planning, day: string, now = Date.now()): Plan[] {
  const [y, m, d] = day.split("-").map(Number); const start = new Date(y, m - 1, d).getTime();
  return plansIn(task, start, new Date(y, m - 1, d + 1).getTime(), now).filter(b => b.repeating && localDay(Date.parse(b.start)) === day);
}
/** A plan as stored: just its times. */
export const stored = (plan: Plan): WorkSession => ({ start: plan.start, end: plan.end });
/** The block moved to `date` at the same local clock time, keeping its length. */
export function shiftTo(block: WorkSession, date: string): WorkSession {
  const start = new Date(block.start); const [y, m, d] = date.split("-").map(Number); const moved = new Date(y, m - 1, d, start.getHours(), start.getMinutes(), start.getSeconds());
  return { start: moved.toISOString(), end: new Date(moved.getTime() + Date.parse(block.end) - start.getTime()).toISOString() };
}
/** The parts of `block` no session in `worked` covers: what logging the block as worked may still add. */
export function unworkedParts(block: WorkSession, worked: WorkSession[]): WorkSession[] {
  const parts: WorkSession[] = []; let from = Date.parse(block.start); const to = Date.parse(block.end);
  for (const [s, e] of worked.map(w => [Date.parse(w.start), Date.parse(w.end)] as const).filter(([s, e]) => e > from && s < to).sort((a, b) => a[0] - b[0])) {
    if (s > from) parts.push({ start: new Date(from).toISOString(), end: new Date(s).toISOString() });
    from = Math.max(from, e);
  }
  if (to > from) parts.push({ start: new Date(from).toISOString(), end: new Date(to).toISOString() });
  return parts;
}
const clockAt = (iso: string): string => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** The planned times of a task on one day, as its todo in that day's note shows them (`10:00–11:00, 14:00–15:00`), or null with none. */
export function dayTimes(task: Pick<Task, "planned_sessions">, day: string): string | null {
  const times = task.planned_sessions.filter(b => localDay(Date.parse(b.start)) === day).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(b => `${clockAt(b.start)}–${clockAt(b.end)}`);
  return times.length ? times.join(", ") : null;
}
/** A planned block as a task note keeps it: `2026-11-18 10:00–11:00` in local time (an end at or before the start is the next day), or the exact times when that text cannot say it (seconds, more than a day, a clock change). */
export function plannedText(block: WorkSession): string | WorkSession {
  const text = `${localDay(Date.parse(block.start))} ${clockAt(block.start)}–${clockAt(block.end)}`; const back = plannedFrom(text);
  return back && back.start === block.start && back.end === block.end ? text : { start: block.start, end: block.end };
}
/** A planned block from a task note: the local text `plannedText` writes (a hyphen works as well as the dash), or null when it is not one. */
export function plannedFrom(value: string): WorkSession | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(value.trim()); if (!match) return null;
  const [y, m, d, sh, sm, eh, em] = match.slice(1).map(Number); if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const start = new Date(y, m - 1, d, sh, sm); if (start.getDate() !== d || start.getMonth() !== m - 1) return null;
  const sameDay = eh * 60 + em > sh * 60 + sm; const end = new Date(y, m - 1, sameDay ? d : d + 1, eh, em);
  return end > start ? { start: start.toISOString(), end: end.toISOString() } : null;
}
