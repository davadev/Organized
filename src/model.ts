import { normalizePath } from "obsidian";

export const STATUSES = ["open", "in_progress", "completed", "canceled"] as const;
export const PRIORITIES = ["high", "medium", "low", "none"] as const;
export type Status = typeof STATUSES[number];
export type Priority = typeof PRIORITIES[number];
export interface Section { level: number; text: string; ordinal: number }
export interface Movement {
  id: string; kind: "schedule" | "reschedule" | "forward";
  source: "manual" | "automatic"; from: string; to: string; at: string;
}
export interface WorkSession { start: string; end: string }
/** Sessions are kept for the day/week views; the newest are kept so a task note cannot grow without bound. */
export const MAX_WORK_SESSIONS = 500;
/** Shorter timer runs still count toward tracked time but are not worth a block on the calendar. */
export const MIN_SESSION_SECONDS = 60;
/** Planned blocks (time set aside for later) are kept under the same cap as worked sessions. */
export const MAX_PLANNED_SESSIONS = 500;
/** Task properties written only while they hold something, so a task that never plans time carries no extra keys. */
/** The task panel cards that can be folded away. */
export const FOLDABLE_CARDS: readonly string[] = ["Description", "Subtasks", "Timer"];
export const OPTIONAL_KEYS = ["planned_sessions", "auto_started_block", "time_budget_seconds", "recurrence"] as const;
/** The longest time budget a task can hold (9999 hours); anything else in a note is ignored. */
export const MAX_BUDGET_SECONDS = 9999 * 3600;
export interface Task {
  schema_version: number; id: string; title: string; status: Status; priority: Priority;
  scheduled: string | null; created: string; time_tracked_seconds: number;
  time_tracking_started_at: string | null; recurring: boolean; closed_at: string | null;
  /** How the task repeats while `recurring` is on, in the one-line form `parseRule` reads (`weekdays`, `every 3 weeks on thu`). Empty means every day. */
  recurrence: string | null;
  recurrence_periods: { start: string; stop: string | null }[];
  starred: boolean; projects: string[]; movement_history: Movement[];
  daily_note_section_path: Section[]; work_sessions: WorkSession[];
  /** Blocks of time set aside for the future (or the past, as an estimate). They never count toward `time_tracked_seconds`. */
  planned_sessions: WorkSession[];
  /** Start of the planned block that set this task in progress by itself; lets that flip be undone without touching a status the person chose. */
  auto_started_block: string | null;
  /** Time the person allows for this task; tracked plus planned time is compared with it. Null when there is no budget. */
  time_budget_seconds: number | null;
  /** Path of the standalone note this task became. Set only when the task note is kept for the time it tracked; such a task has no todo line and is hidden from every list. */
  converted_to: string | null;
  /** Links to the task notes of this task's subtasks (`[[Name]]`), kept in step with the todos nested under it in the notes. */
  subtasks: string[];
}
/** One small icon per task status, shared by the panel and the onboarding card's figures. */
export const STATUS_ICONS: Record<Task["status"], string> = { open: "circle", in_progress: "play", completed: "check", canceled: "x" };
export const DISPLAY_PROPERTIES = ["status", "priority", "scheduled", "created", "time_tracked_seconds", "recurring", "starred", "projects", "movement_history", "subtasks", "sources", "description"] as const;
export type DisplayProperty = typeof DISPLAY_PROPERTIES[number];
/** What a retired task leaves in the note: its title only, plus its description, or everything worth keeping (description and time worked). */
export const RETENTION_DETAILS = ["title", "description", "all"] as const;
export type RetentionDetail = typeof RETENTION_DETAILS[number];
export interface Settings {
  taskFolder: string; dailyFolder: string; dailyFormat: string; autoForward: boolean;
  missingSection: "recreate" | "ask";
  sortScope: "list" | "section" | "first" | "none";
  displayProperties: DisplayProperty[];
  /** Where the rendered properties sit on a todo line: right after its text, or at the right edge of the line. */
  propertiesAlign: "text" | "right";
  showScheduledDate: boolean;
  /** On a phone or tablet, long-pressing a todo's checkbox in a daily note offers its markers. */
  longPressMenu: boolean;
  /** While Obsidian is open, a task is set in progress when a block planned for it begins and put back to open when the block ends. */
  startAtPlannedTime: boolean;
  taskRetentionDays: number;
  dailyTemplate: string;
  /** Where daily notes live: the folder, format and template of the Daily Notes (or Periodic Notes) plugin, or the three settings here. */
  dailySource: "plugin" | "custom";
  knownProjects: string[];
  collapsedHeadings: Record<string, string[]>;
  projectsMigrated: boolean;
  projectNotesMarked: boolean;
  projectStartsSet: boolean;
  retentionDetail: RetentionDetail;
  dayTasksCollapsed: boolean;
  /** Task panel cards the person folded away (Description, Subtasks, Timer); the choice holds for every task. */
  collapsedTaskSections: string[];
  hideDoneTasks: boolean;
  hideClosedProjects: boolean;
  noteFolder: string;
  /** The one-time onboarding card has been shown (or skipped). */
  onboardingSeen: boolean;
  /** The newest release whose What's new this device has been told about (empty until the plugin first runs). Per device. */
  lastSeenVersion: string;
  /** Show a short What's new once after an update. */
  showWhatsNew: boolean;
  /** Task notes written in the old layout (headings for Description and Notes) have been rewritten in the new one. */
  taskNotesMigrated: boolean;
  /** Task notes still named after their id were renamed after their todo's title (tried once; the command can run it again). */
  taskNoteNamesMigrated: boolean;
  subtaskNestingMigrated: boolean;
  subtaskIndentMigrated: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  taskFolder: "Tasks", dailyFolder: "Daily", dailyFormat: "YYYY-MM-DD", autoForward: true,
  missingSection: "recreate", sortScope: "list", displayProperties: [], propertiesAlign: "text", showScheduledDate: true, longPressMenu: true, startAtPlannedTime: false, taskRetentionDays: 0,
  lastSeenVersion: "", showWhatsNew: true, dailyTemplate: "", dailySource: "plugin", knownProjects: [], collapsedHeadings: {}, collapsedTaskSections: [], projectsMigrated: false, projectNotesMarked: false, projectStartsSet: false, retentionDetail: "title", dayTasksCollapsed: false, hideDoneTasks: false, hideClosedProjects: true, noteFolder: "", onboardingSeen: false, taskNotesMigrated: false, taskNoteNamesMigrated: false, subtaskNestingMigrated: false, subtaskIndentMigrated: false,
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function path(value: string, allowRoot = false): string {
  if (/^(?:[a-z]+:|[/\\])|[:*?"<>|#[\]]/i.test(value) || [...value].some(c => c.charCodeAt(0) < 32) || value.split(/[/\\]/).includes("..")) throw new Error("Use a relative vault path without parent traversal or reserved characters.");
  const result = normalizePath(value.trim());
  if ((!result || result === "/" || result === ".") && !allowRoot) throw new Error("A folder or note path is required.");
  return result === "/" || result === "." ? "" : result;
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return Number.isFinite(d.getTime()) && localDate(d) === value;
}
export function nextDate(value: string): string {
  const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + 1); return localDate(d);
}
export function validId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value); }
export function makeId(): string {
  // getRandomValues also works on older mobile WebViews without randomUUID.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []; }
function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
export function settingsFrom(value: unknown): Settings {
  const v = object(value); const s = { ...DEFAULT_SETTINGS };
  try { if (typeof v.taskFolder === "string") s.taskFolder = visibleFolder(v.taskFolder); } catch { /* Invalid persisted paths use safe defaults. */ }
  try { if (typeof v.dailyFolder === "string") s.dailyFolder = path(v.dailyFolder, true); } catch { /* Invalid persisted paths use safe defaults. */ }
  if (typeof v.dailyFormat === "string" && v.dailyFormat.includes("YYYY") && v.dailyFormat.includes("MM") && v.dailyFormat.includes("DD") && !/[\\:*?"<>|]/.test(v.dailyFormat) && !v.dailyFormat.includes("..")) s.dailyFormat = v.dailyFormat;
  // Saved settings from before this option keep the folder and format they have; only a fresh install follows the plugin.
  s.dailySource = member(v.dailySource, ["plugin", "custom"] as const, typeof v.dailyFolder === "string" || typeof v.dailyFormat === "string" ? "custom" : "plugin");
  s.autoForward = typeof v.autoForward === "boolean" ? v.autoForward : true;
  s.missingSection = member(v.missingSection, ["recreate", "ask"], "recreate");
  s.sortScope = member(v.sortScope, ["list", "section", "first", "none"], "list");
  // The old "notes" property showed the whole note; it became "description", so a saved choice carries over.
  s.displayProperties = [...new Set(strings(v.displayProperties).map(p => p === "notes" ? "description" : p).filter((p): p is DisplayProperty => DISPLAY_PROPERTIES.includes(p as DisplayProperty)))];
  s.propertiesAlign = member(v.propertiesAlign, ["text", "right"], "text");
  s.showScheduledDate = typeof v.showScheduledDate === "boolean" ? v.showScheduledDate : true;
  s.showWhatsNew = typeof v.showWhatsNew === "boolean" ? v.showWhatsNew : true;
  s.lastSeenVersion = typeof v.lastSeenVersion === "string" ? v.lastSeenVersion : "";
  s.longPressMenu = typeof v.longPressMenu === "boolean" ? v.longPressMenu : true;
  s.startAtPlannedTime = v.startAtPlannedTime === true;
  s.taskRetentionDays = Number.isInteger(v.taskRetentionDays) && Number(v.taskRetentionDays) >= 0 && Number(v.taskRetentionDays) <= 36500 ? Number(v.taskRetentionDays) : 0;
  try { if (typeof v.noteFolder === "string") s.noteFolder = path(v.noteFolder, true); } catch { /* An invalid remembered folder falls back to the vault root. */ }
  try { if (typeof v.dailyTemplate === "string" && v.dailyTemplate.trim()) { const template = path(v.dailyTemplate); if (template.endsWith(".md")) s.dailyTemplate = template; } } catch { /* Invalid persisted paths use safe defaults. */ }
  s.knownProjects = [...new Set(strings(v.knownProjects).filter(p => { try { return path(p) === p && p.endsWith(".md"); } catch { return false; } }))];
  s.projectsMigrated = v.projectsMigrated === true; s.projectNotesMarked = v.projectNotesMarked === true; s.projectStartsSet = v.projectStartsSet === true; s.retentionDetail = member(v.retentionDetail, RETENTION_DETAILS, "title"); s.dayTasksCollapsed = v.dayTasksCollapsed === true; s.hideDoneTasks = v.hideDoneTasks === true; s.hideClosedProjects = typeof v.hideClosedProjects === "boolean" ? v.hideClosedProjects : true; s.onboardingSeen = v.onboardingSeen === true; s.taskNotesMigrated = v.taskNotesMigrated === true; s.taskNoteNamesMigrated = v.taskNoteNamesMigrated === true; s.subtaskNestingMigrated = v.subtaskNestingMigrated === true; s.subtaskIndentMigrated = v.subtaskIndentMigrated === true;
  s.collapsedTaskSections = [...new Set(strings(v.collapsedTaskSections).filter(name => FOLDABLE_CARDS.includes(name)))];
  s.collapsedHeadings = {};
  for (const [notePath, keys] of Object.entries(object(v.collapsedHeadings))) { const kept = [...new Set(strings(keys))]; if (kept.length) s.collapsedHeadings[notePath] = kept; }
  return s;
}
/** A link to a task note as the parent's `subtasks` list writes it: `[[Name]]`, nothing else. */
export const isNoteLink = (value: string): boolean => /^\[\[[^[\]|#]+\]\]$/.test(value);
export function taskFrom(value: unknown, expectedId: string): Task {
  const v = object(value);
  if (v.schema_version !== undefined && v.schema_version !== 1) throw new Error("This task uses an unsupported schema; update Organized before editing it.");
  if (v.id !== expectedId || !validId(v.id) || typeof v.title !== "string" || !v.title.trim() || /[\r\n]/.test(v.title) || v.title.includes("<!--organized:")) throw new Error("Task frontmatter is missing or invalid. Open the task note to repair its id/title.");
  const periods = Array.isArray(v.recurrence_periods) ? v.recurrence_periods.map(object).filter(p => validDate(p.start) && (p.stop === null || validDate(p.stop))) : [];
  const history = Array.isArray(v.movement_history) ? v.movement_history.map(object).filter(m => typeof m.id === "string" && ["schedule", "reschedule", "forward"].includes(String(m.kind)) && ["manual", "automatic"].includes(String(m.source)) && typeof m.from === "string" && validDate(m.to) && typeof m.at === "string" && Number.isFinite(Date.parse(m.at))) : [];
  const sections = Array.isArray(v.daily_note_section_path) ? v.daily_note_section_path.map(object).filter(s => Number.isInteger(s.level) && Number(s.level) >= 1 && Number(s.level) <= 6 && typeof s.text === "string" && Number.isInteger(s.ordinal) && Number(s.ordinal) >= 0) : [];
  const sessionsOf = (value: unknown, cap: number): WorkSession[] => (Array.isArray(value) ? value.map(object) : []).flatMap(w => typeof w.start === "string" && typeof w.end === "string" && Date.parse(w.start) < Date.parse(w.end) ? [{ start: w.start, end: w.end }] : [])
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(-cap);
  const sessions = sessionsOf(v.work_sessions, MAX_WORK_SESSIONS);
  return {
    schema_version: 1, id: v.id, title: v.title.trim(), status: member(v.status, STATUSES, "open"), priority: member(v.priority, PRIORITIES, "none"),
    scheduled: validDate(v.scheduled) ? v.scheduled : null,
    created: typeof v.created === "string" && Number.isFinite(Date.parse(v.created)) ? v.created : "1970-01-01T00:00:00.000Z",
    time_tracked_seconds: typeof v.time_tracked_seconds === "number" && Number.isFinite(v.time_tracked_seconds) && v.time_tracked_seconds >= 0 ? v.time_tracked_seconds : 0,
    time_tracking_started_at: typeof v.time_tracking_started_at === "string" && Number.isFinite(Date.parse(v.time_tracking_started_at)) ? v.time_tracking_started_at : null,
    closed_at: typeof v.closed_at === "string" && Number.isFinite(Date.parse(v.closed_at)) ? v.closed_at : null,
    recurring: v.recurring === true, recurrence: typeof v.recurrence === "string" && v.recurrence.trim() ? v.recurrence.trim() : null, recurrence_periods: periods as unknown as Task["recurrence_periods"], starred: v.starred === true,
    projects: [...new Set(strings(v.projects).filter(p => { try { return path(p) === p && p.endsWith(".md"); } catch { return false; } }))],
    movement_history: history as unknown as Movement[], daily_note_section_path: sections as unknown as Section[], work_sessions: sessions,
    planned_sessions: sessionsOf(v.planned_sessions, MAX_PLANNED_SESSIONS),
    auto_started_block: typeof v.auto_started_block === "string" && Number.isFinite(Date.parse(v.auto_started_block)) ? v.auto_started_block : null,
    time_budget_seconds: Number.isInteger(v.time_budget_seconds) && Number(v.time_budget_seconds) > 0 && Number(v.time_budget_seconds) <= MAX_BUDGET_SECONDS ? Number(v.time_budget_seconds) : null,
    converted_to: typeof v.converted_to === "string" && v.converted_to.endsWith(".md") ? v.converted_to : null,
    subtasks: [...new Set(strings(v.subtasks).filter(isNoteLink))],
  };
}
export function visibleFolder(value: string): string {
  const folder = path(value);
  if (folder.split("/").some(p => p.startsWith("."))) throw new Error("Use a visible task folder, such as Tasks. Obsidian cannot edit hidden task notes through its frontmatter API.");
  return folder;
}
export function newTask(title: string, id: string, now = new Date()): Task {
  return taskFrom({ id, title, created: now.toISOString() }, id);
}
export function elapsed(task: Task, now = Date.now()): number {
  return task.time_tracked_seconds + (task.time_tracking_started_at ? Math.max(0, Math.floor((now - Date.parse(task.time_tracking_started_at)) / 1000)) : 0);
}
export function setStatus(task: Task, status: Status, now = new Date()): Task {
  // Any status change made through here is the person's (or a marker's), so a flip made by a planned block no longer applies.
  // A manual start ends the claim of a planned block; any other change keeps it, so a task the person put back is not started again by the block that is still under way (it is released when the block ends).
  const next = { ...task, status: task.recurring ? "open" as const : status, auto_started_block: status === "in_progress" ? null : task.auto_started_block };
  if (next.status === "completed" || next.status === "canceled") next.closed_at = task.status === next.status && task.closed_at ? task.closed_at : now.toISOString();
  else next.closed_at = null;
  if (status === "in_progress") next.time_tracking_started_at = task.time_tracking_started_at ?? now.toISOString();
  else {
    if (task.time_tracking_started_at && now.getTime() - Date.parse(task.time_tracking_started_at) >= MIN_SESSION_SECONDS * 1000) {
      next.work_sessions = [...task.work_sessions, { start: task.time_tracking_started_at, end: now.toISOString() }].slice(-MAX_WORK_SESSIONS);
    }
    next.time_tracked_seconds = elapsed(task, now.getTime()); next.time_tracking_started_at = null;
  }
  return next;
}
/** A planned block has begun: the task is in progress but nothing is timed, and the block is remembered so only this flip is undone. */
/** The checkbox marker a task shows. A recurring task keeps the status "open" while its timer runs, so the timer counts too. */
/** The status a todo's marker stands for; `[ ]` and every action marker mean open. */
export function statusOfMarker(marker: string): Status { return marker.toLowerCase() === "x" ? "completed" : marker === "-" ? "canceled" : marker === "/" ? "in_progress" : "open"; }
export function markerOf(task: Task): string { return task.status === "completed" ? "x" : task.status === "canceled" ? "-" : task.status === "in_progress" || task.time_tracking_started_at !== null ? "/" : " "; }
export function startPlanned(task: Task, block: WorkSession): Task {
  return { ...task, status: "in_progress", closed_at: null, auto_started_block: block.start };
}
