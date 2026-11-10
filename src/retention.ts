import { noteSection } from "./codec";
import { makeId, newTask, RetentionDetail, Task, WorkSession } from "./model";
import { formatMinutes } from "./sessions";

const pad = (n: number): string => String(n).padStart(2, "0");
const day = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minute = (iso: string): Date => { const d = new Date(iso); d.setSeconds(0, 0); return d; };
// Lines written by earlier versions say `1 h 20 min`; both spellings are read.
const WORKED = /^\s*[-*+] Worked (\d{4}-\d{2}-\d{2}): (.+?)(?: \(\d+ ?(?:h|min)(?: \d+ ?min)?\))?\s*$/;
/** `- Project: [[Tasks/Projects/Alpha]], [[Beta]]`: which projects the time above belongs to, so it still counts toward their budgets. */
const PROJECTS = /^\s*[-*+] Projects?: (.+?)\s*$/;
/** `- Tracked 1h 15min`: the whole time tracked, which can exceed the listed sessions when the task note only keeps the latest ones. */
const TRACKED = /^\s*[-*+] Tracked (?:(\d+) ?h)? ?(?:(\d+) ?min)?\s*$/;
const RANGE = /^(\d{2}):(\d{2})–(?:(\d{4}-\d{2}-\d{2}) )?(\d{2}):(\d{2})$/;

/** One plain list line per day: `- Worked 2026-03-02: 09:00–09:30, 10:00–10:20 (50 min)`. Readable in the note and parsed back by `parseWorked`. */
function workedLines(sessions: WorkSession[]): string[] {
  const byDay = new Map<string, string[]>(); const total = new Map<string, number>();
  for (const session of sessions) {
    const start = minute(session.start); const end = minute(session.end); const key = day(start);
    const range = `${clock(start)}–${day(end) === key ? "" : `${day(end)} `}${clock(end)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), range]); total.set(key, (total.get(key) ?? 0) + Math.round((end.getTime() - start.getTime()) / 60000));
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([key, ranges]) => `- Worked ${key}: ${ranges.join(", ")} (${formatMinutes(total.get(key)!)})`);
}
const quote = (text: string): string[] => text.replace(/<!--organized:[^>]*-->/g, "").replace(/\r/g, "").trim().split("\n").map(line => line.trim() ? `> ${line}` : ">");
/** The indented lines a retired task leaves under its checkbox: readable notes, never a reference back to the deleted task note. */
export function retiredLines(task: Task, source: string, detail: RetentionDetail, indent: string): string[] {
  const lines: string[] = []; const body = source.replace(/\r\n/g, "\n");
  if (detail === "title") return lines;
  const description = noteSection(body, "Description"); if (description) lines.push(...quote(description));
  if (detail === "all") {
    const sources = noteSection(body, "Sources"); if (sources) lines.push(...quote(`**Sources**\n${sources}`));
    const worked = workedLines(task.work_sessions); lines.push(...worked);
    // Time kept without its projects would drop out of their budgets, so the projects are kept with it (as links, which follow a renamed note).
    if (worked.length && task.projects.length) lines.push(`- ${task.projects.length === 1 ? "Project" : "Projects"}: ${task.projects.map(project => `[[${project.replace(/\.md$/, "")}]]`).join(", ")}`);
    if (task.time_tracked_seconds >= 60) lines.push(`- Tracked ${formatMinutes(Math.round(task.time_tracked_seconds / 60))}`);
  }
  return lines.map(line => `${indent}${line}`);
}
const TASK_LINE = /^(\s*)(?:[-+*]|\d+[.)]) \[[^\]]\] (.*)$/;
/** Time worked recorded by `retiredLines`, as stand-in tasks for the calendar: one per todo line that has `Worked` lines beneath it. */
export function parseWorked(text: string): Task[] {
  if (!text.includes("Worked ")) return [];
  const result: Task[] = []; let owner: { title: string; indent: number; sessions: WorkSession[]; projects: string[]; tracked: number } | null = null;
  const flush = () => { if (owner?.sessions.length) result.push({ ...newTask(owner.title, makeId()), status: "completed", work_sessions: owner.sessions, projects: owner.projects, time_tracked_seconds: Math.max(owner.tracked, owner.sessions.reduce((sum, session) => sum + (Date.parse(session.end) - Date.parse(session.start)) / 1000, 0)) }); owner = null; };
  for (const line of text.split("\n")) {
    const task = TASK_LINE.exec(line.replace(/\r$/, ""));
    if (task) { flush(); owner = { title: task[2].replace(/<!--organized:[^>]*-->/g, "").trim() || "Untitled todo", indent: task[1].length, sessions: [], projects: [], tracked: 0 }; continue; }
    const kept = PROJECTS.exec(line.replace(/\r$/, "")); if (kept && owner && line.length - line.trimStart().length > owner.indent) { owner.projects = [...new Set([...kept[1].matchAll(/\[\[([^\]|#]+)/g)].map(link => `${link[1].trim().replace(/\.md$/, "")}.md`))]; continue; }
    const tracked = TRACKED.exec(line.replace(/\r$/, "")); if (tracked && owner && (tracked[1] || tracked[2]) && line.length - line.trimStart().length > owner.indent) { owner.tracked = Number(tracked[1] ?? 0) * 3600 + Number(tracked[2] ?? 0) * 60; continue; }
    const worked = WORKED.exec(line); if (!worked || !owner || line.length - line.trimStart().length <= owner.indent) continue;
    for (const part of worked[2].split(", ")) {
      const range = RANGE.exec(part.trim()); if (!range) continue;
      const start = new Date(`${worked[1]}T${range[1]}:${range[2]}:00`); const end = new Date(`${range[3] ?? worked[1]}T${range[4]}:${range[5]}:00`);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) owner.sessions.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }
  flush();
  return result;
}
