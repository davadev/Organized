/**
 * Retiring tasks: the pure rules behind the Retire window (which tasks, which combinations of options are allowed, readable file names,
 * what the properties of a task note look like once Organized's own are removed). The engine that applies them is `retireTasks` in
 * `service.ts`.
 */
import type { TFile } from "obsidian";
import { stringifyYaml } from "obsidian";
import { newTask, type RetentionDetail, type Task } from "./model";
import { freePath, readableName } from "./names";
import { splitNote } from "./repository";

export interface RetireOptions {
  /** `closed` = completed or canceled for at least `olderThanDays` (what the automatic cleanup does); `all` = every task. */
  which: "all" | "closed";
  olderThanDays: number;
  /** What a todo in a note becomes: plain text, or a link to its task note. */
  lines: "plain" | "link";
  /** What stays under the todo when its task note is stripped or moved to the trash. */
  keep: RetentionDetail;
  notes: "keep" | "rename" | "trash";
  /** `strip` removes Organized's properties from the task note (it then needs its title as the file name). */
  yaml: "keep" | "strip";
}
/** Removing properties needs the title in the file name; a trashed note cannot be linked to or stripped. */
export function normalizeRetire(o: RetireOptions): RetireOptions {
  const next = { ...o, olderThanDays: Number.isInteger(o.olderThanDays) && o.olderThanDays >= 0 ? o.olderThanDays : 7 };
  if (next.notes === "trash") { next.yaml = "keep"; next.lines = "plain"; }
  else if (next.yaml === "strip") next.notes = "rename";
  return next;
}
/** Whether what the task note held is lost from the vault unless it is written under the todo (so the "keep" choice matters). */
export const losesNote = (o: RetireOptions): boolean => o.notes === "trash" || o.yaml === "strip";
/** Whether the task note is still there, with its properties, once the run is over. */
export const keepsNote = (o: RetireOptions): boolean => o.notes !== "trash" && o.yaml === "keep";
export const isDestructive = (o: RetireOptions): boolean => losesNote(o);
/** The tasks a retire run covers. Recurring and unfinished tasks are only covered by `all`. */
export function selectTasks(tasks: Task[], o: RetireOptions, now: number): Task[] {
  if (o.which === "all") return tasks;
  return tasks.filter(t => !t.recurring && ["completed", "canceled"].includes(t.status) && t.closed_at !== null && now - Date.parse(t.closed_at) >= o.olderThanDays * 86400000);
}
/** Target paths for renaming task notes to their titles. Names are unique case-insensitively, among the new names and the files that exist (Windows and macOS disks do not tell "Title" and "title" apart). */
export function planNames(tasks: { id: string; title: string }[], folder: string, existing: Iterable<string>): Map<string, string> {
  const taken = new Set([...existing].map(p => p.toLowerCase())); const plan = new Map<string, string>();
  for (const task of tasks) {
    const target = freePath(folder, readableName(task.title), candidate => taken.has(candidate.toLowerCase()));
    taken.add(target.toLowerCase()); plan.set(task.id, target);
  }
  return plan;
}
/** Organized's own properties, derived from the task model so a new field cannot be forgotten. */
export const ORGANIZED_KEYS: readonly string[] = Object.keys(newTask("title", "abcdefgh12"));
/** The note without Organized's properties. Properties the user added (tags, aliases, ...) stay; the `---` block goes only when nothing is left. */
export function stripOrganized(text: string): string {
  const { frontmatter, body } = splitNote(text);
  if (text === body) return text;
  const crlf = text.includes("\r\n");
  const rest = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !ORGANIZED_KEYS.includes(key)));
  const head = Object.keys(rest).length ? `---\n${stringifyYaml(rest)}---\n\n` : "";
  const result = `${head}${body.replace(/^(?:\r?\n)+/, "")}`;
  return crlf ? result.replace(/\r?\n/g, "\r\n") : result;
}
/** What the scan of the vault found: the tasks, and where their todos are. */
/** `unnamed`: ids of tasks whose note is still named after the id; notes already named after their title are not renamed. */
export interface RetireScan { tasks: Task[]; files: Map<string, TFile[]>; lines: Map<string, number>; unnamed: Set<string> }
/** `plans`, `budgets` and `rules`: how many of the chosen tasks hold planned blocks, a time budget or a repeat rule, which a retired task no longer has. */
export interface RetirePreview { tasks: number; todos: number; notes: number; renamed: number; stripped: number; trashed: number; plans: number; budgets: number; rules: number }
export function retirePreview(scan: RetireScan, raw: RetireOptions, now: number): RetirePreview {
  const o = normalizeRetire(raw); const chosen = selectTasks(scan.tasks, o, now);
  const touched = new Set<string>(); let todos = 0;
  for (const task of chosen) { todos += scan.lines.get(task.id) ?? 0; for (const file of scan.files.get(task.id) ?? []) touched.add(file.path); }
  return { tasks: chosen.length, todos, notes: touched.size, renamed: o.notes === "rename" ? chosen.filter(task => scan.unnamed.has(task.id)).length : 0, stripped: o.yaml === "strip" ? chosen.length : 0, trashed: o.notes === "trash" ? chosen.length : 0, plans: losesNote(o) ? chosen.filter(task => task.planned_sessions.length).length : 0, budgets: losesNote(o) ? chosen.filter(task => task.time_budget_seconds !== null).length : 0, rules: chosen.filter(task => task.recurring).length };
}
export const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;
export function describePreview(p: RetirePreview): string {
  if (!p.tasks) return "No tasks match. Nothing will change.";
  const parts = [plural(p.tasks, "task"), `${plural(p.todos, "todo")} in ${plural(p.notes, "note")} unlinked`];
  if (p.renamed) parts.push(`${plural(p.renamed, "task note")} renamed to its title`);
  if (p.stripped) parts.push(`${plural(p.stripped, "task note")} stripped of properties`);
  if (p.trashed) parts.push(`${plural(p.trashed, "task note")} moved to Obsidian's trash`);
  return `${parts.join(" · ")}.${leftBehind(p)}`;
}
/** What the chosen tasks hold that a todo cannot: said before anything is retired. Planned blocks and budgets are lost with the note (stripped or trashed); a repeat always ends, since nothing writes the todo into new daily notes any more. */
function leftBehind(p: RetirePreview): string {
  const lost = [p.plans ? `planned blocks of ${plural(p.plans, "task")}` : "", p.budgets ? `time budgets of ${plural(p.budgets, "task")}` : ""].filter(Boolean);
  return `${p.rules ? ` ${plural(p.rules, "recurring task")} will stop repeating.` : ""}${lost.length ? ` Not kept: ${lost.join(" and ")}.` : ""}`;
}
