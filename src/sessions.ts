import { MIN_SESSION_SECONDS, WorkSession } from "./model";

const pad = (n: number): string => String(n).padStart(2, "0");
/** An ISO instant as the local `YYYY-MM-DDTHH:mm` a datetime-local field takes. */
export function localInput(iso: string): string {
  const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A datetime-local value (local time) as an ISO instant, or null when it is not a valid date and time. */
export function isoFromInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00`); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export const MAX_SESSION_HOURS = 24;
export type SessionKind = "worked" | "planned";
/** What a new block is, from its times alone: one that has ended is time worked, one still to come (or under way) is planned. */
export const kindOf = (end: string | null, now = Date.now()): SessionKind => end !== null && Date.parse(end) <= now + 60000 ? "worked" : "planned";
/** Why a session cannot be saved, or null. Worked time cannot be in the future (a running timer records that); a planned block can be anywhere. */
export function sessionProblem(start: string | null, end: string | null, now = Date.now(), kind: SessionKind = "worked"): string | null {
  if (!start || !end) return "Enter both a start and an end.";
  const from = Date.parse(start); const to = Date.parse(end);
  if (to <= from) return "The end must be after the start.";
  if (to - from < MIN_SESSION_SECONDS * 1000) return "A session must be at least a minute long.";
  if (to - from > MAX_SESSION_HOURS * 3600000) return `A session can be at most ${MAX_SESSION_HOURS} hours; split longer work.`;
  if (kind === "worked" && to > now + 60000) return "Time cannot be logged in the future.";
  return null;
}
export const seconds = (session: WorkSession): number => Math.max(0, Math.round((Date.parse(session.end) - Date.parse(session.start)) / 1000));
/** `45 min`, `1h` or `1h 13min`: minutes written the short way once they pass an hour. */
export function formatMinutes(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}min` : ""}` : `${minutes} min`;
}
/** The same for a number of seconds, rounded to the minute. */
export function lengthOfSeconds(total: number): string { return formatMinutes(Math.round(total / 60)); }
export const lengthOf = (session: WorkSession): string => lengthOfSeconds(seconds(session));
