import { setIcon } from "obsidian";
import { STATUS_ICONS } from "./model";
import { symbol } from "./render";
import { LONG_PRESS_MARKERS } from "./longPress";

/**
 * Small illustrations for the onboarding card, drawn from the plugin's own interface elements instead of shipped as
 * screenshots: they follow the user's theme and font, add almost nothing to the plugin's size and cannot go stale the way
 * a picture does. They are decoration (aria-hidden, not interactive); the step's text carries the meaning.
 */
export type FigureId = "settings" | "tabs" | "calendar" | "follow" | "forward" | "card" | "props" | "keys" | "commands" | "press" | "hotkey" | "devices" | "repairs";
/** Every figure id; the tests walk it so a new figure cannot ship undrawn. */
export const FIGURE_IDS: FigureId[] = ["settings", "tabs", "calendar", "follow", "forward", "card", "props", "keys", "commands", "press", "hotkey", "devices", "repairs"];

const box = (host: HTMLElement, marker: string): void => {
  const b = host.createSpan({ cls: "organized-welcome-fig-box", text: marker === "x" ? "" : marker.trim(), attr: { "data-marker": marker } });
  if (marker === "x") setIcon(b, STATUS_ICONS.completed);
};
const line = (host: HTMLElement, marker: string, text: string, cls = ""): HTMLElement => {
  const row = host.createDiv({ cls: `organized-welcome-fig-line ${cls}`.trim() });
  box(row, marker);
  row.createSpan({ text });
  return row;
};

/** The panel's four tabs, in order, with the icon each one has in the panel (the tabs there are icon-only). */
const TABS: [string, string, string][] = [["calendar", "Calendar", "Month, week and day, with the time you worked"], ["list-checks", "Task", "The todo you are on, in detail"], ["folder", "Projects", "Todos grouped by project"], ["star", "Favorites", "Everything you starred"]];
function tabsFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-tabs" });
  for (const [icon, name, role] of TABS) {
    const item = list.createDiv({ cls: "organized-welcome-fig-tab" });
    setIcon(item.createSpan({ cls: "organized-welcome-fig-tab-icon" }), icon);
    const words = item.createDiv({ cls: "organized-welcome-fig-tab-words" });
    words.createSpan({ cls: "organized-welcome-fig-tab-name", text: name });
    words.createSpan({ cls: "organized-welcome-fig-tab-role", text: role });
  }
}

function followFigure(fig: HTMLElement): void {
  const row = fig.createDiv({ cls: "organized-welcome-fig-days" });
  const note = row.createDiv({ cls: "organized-welcome-fig-note" });
  note.createDiv({ cls: "organized-welcome-fig-caption", text: "Your note" });
  line(note, " ", "Reply to Anna");
  line(note, " ", "Draft the Q1 review", "is-current").createSpan({ cls: "organized-welcome-fig-caret" });
  setIcon(row.createSpan({ cls: "organized-welcome-fig-arrow" }), "arrow-right");
  const panel = row.createDiv({ cls: "organized-welcome-fig-note" });
  panel.createDiv({ cls: "organized-welcome-fig-caption", text: "Task tab" });
  const card = panel.createDiv({ cls: "organized-list-card", attr: { "data-status": "open" } });
  const open = card.createDiv({ cls: "organized-list-open" });
  open.createDiv({ cls: "organized-list-title", text: "Draft the Q1 review" });
  open.createDiv({ cls: "organized-list-meta" }).createSpan({ cls: "organized-list-priority priority-high", text: "high" });
}

function forwardFigure(fig: HTMLElement): void {
  const days = fig.createDiv({ cls: "organized-welcome-fig-days" });
  const yesterday = days.createDiv({ cls: "organized-welcome-fig-note" });
  yesterday.createDiv({ cls: "organized-welcome-fig-caption", text: "Yesterday" });
  line(yesterday, "x", "Reply to Anna");
  line(yesterday, ">", "Draft the Q1 review", "is-forwarded");
  setIcon(days.createSpan({ cls: "organized-welcome-fig-arrow" }), "arrow-right");
  const today = days.createDiv({ cls: "organized-welcome-fig-note" });
  today.createDiv({ cls: "organized-welcome-fig-caption", text: "Today" });
  line(today, " ", "Draft the Q1 review");
}

/** The icon buttons under a task's subtasks, with what each does. */
const SUBTASK_ACTIONS: [string, string][] = [["list-plus", "New subtask"], ["link", "Link a task"], ["corner-down-right", "Make it a subtask"]];
function cardFigure(fig: HTMLElement): void {
  const card = fig.createDiv({ cls: "organized-list-card", attr: { "data-status": "in_progress" } });
  const open = card.createDiv({ cls: "organized-list-open" });
  const head = open.createDiv({ cls: "organized-list-head" });
  head.createDiv({ cls: "organized-list-title", text: "Draft the Q1 review" });
  setIcon(head.createSpan({ cls: "organized-list-status", attr: { "data-status": "in_progress" } }), STATUS_ICONS.in_progress);
  const meta = open.createDiv({ cls: "organized-list-meta" });
  meta.createSpan({ cls: "organized-list-priority priority-high", text: "high" });
  meta.createSpan({ cls: "organized-list-date", text: "2026-03-04" });
  setIcon(meta.createSpan({ cls: "organized-list-star" }), "star");
  fig.createDiv({ cls: "organized-welcome-fig-add", text: "Add details…" });
  // The subtask buttons of the Task tab (they are icon-only there, so the card names them).
  const actions = fig.createDiv({ cls: "organized-welcome-fig-actions" });
  for (const [icon, label] of SUBTASK_ACTIONS) { const item = actions.createDiv({ cls: "organized-welcome-fig-action" }); setIcon(item.createSpan({ cls: "organized-welcome-fig-action-icon" }), icon); item.createSpan({ text: label }); }
}

const KEYS: [string, string][] = [["!", "Priority"], ["<", "Schedule"], ["/", "Start a timer"], ["t", "Log time worked"], ["*", "Favorite"], ["j", "Link projects"], ["n", "Make a note"], ["r", "Repeat"]];
function keysFigure(fig: HTMLElement): void {
  const grid = fig.createDiv({ cls: "organized-welcome-fig-keys" });
  for (const [key, label] of KEYS) {
    const item = grid.createDiv({ cls: "organized-welcome-fig-key" });
    item.createSpan({ cls: "organized-welcome-fig-cap", text: `[${key}]` });
    item.createSpan({ text: label });
  }
}

const SETTINGS_ROWS: [string, string][] = [["Daily-note folder", "Daily"], ["Filename format", "YYYY-MM-DD"], ["Daily-note template", "Templates/Daily.md"]];
function settingsFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-rows" });
  for (const [name, value] of SETTINGS_ROWS) {
    const row = list.createDiv({ cls: "organized-welcome-fig-row" });
    row.createSpan({ cls: "organized-welcome-fig-row-name", text: name });
    row.createSpan({ cls: "organized-welcome-fig-field", text: value });
  }
}

const MODES: [string, string][] = [["Month", "Switch between your daily notes"], ["Week", "The big picture: where your time went, by project"], ["Day", "The tasks you worked on that day, as blocks of time"]];
function calendarFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-rows" });
  for (const [mode, role] of MODES) {
    const row = list.createDiv({ cls: "organized-welcome-fig-row" });
    row.createSpan({ cls: "organized-welcome-fig-pill", text: mode });
    row.createSpan({ cls: "organized-welcome-fig-row-role", text: role });
  }
}

function propsFigure(fig: HTMLElement): void {
  const note = fig.createDiv({ cls: "organized-welcome-fig-note" });
  note.createDiv({ cls: "organized-welcome-fig-caption", text: "In your note" });
  const row = line(note, " ", "Draft the Q1 review");
  const props = row.createSpan({ cls: "organized-welcome-fig-props" });
  symbol(props, { icon: "flag", cls: "organized-priority-high", label: "Priority: high" });
  symbol(props, { icon: "star", cls: "organized-symbol-starred", label: "Starred" });
  symbol(props, { icon: "repeat", cls: "organized-symbol-recurring", label: "Recurring: on" });
  symbol(props, { icon: "timer", cls: "organized-symbol-muted", label: "Time tracked: 1h 13min", text: "1h 13min" });
}

const COMMANDS = ["Convert unchecked todos to tasks", "Convert tasks in this note back to todos", "Retire tasks…"];
function commandsFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-rows" });
  for (const name of COMMANDS) {
    const row = list.createDiv({ cls: "organized-welcome-fig-row" });
    row.createSpan({ cls: "organized-welcome-fig-cap", text: "Organized" });
    row.createSpan({ cls: "organized-welcome-fig-row-role", text: name });
  }
}

/** The phone menu: the first rows of the real marker list, with the icons the menu has and the marker the todo has ticked. */
function pressFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-tabs" });
  for (const [marker, label, icon] of LONG_PRESS_MARKERS.slice(0, 6)) {
    const item = list.createDiv({ cls: "organized-welcome-fig-tab" });
    setIcon(item.createSpan({ cls: "organized-welcome-fig-tab-icon" }), icon);
    const words = item.createDiv({ cls: "organized-welcome-fig-tab-words" });
    words.createSpan({ cls: "organized-welcome-fig-tab-name", text: `[${marker === " " ? "\u00a0" : marker}] ${label}` });
    if (marker === " ") words.createSpan({ cls: "organized-welcome-fig-tab-role", text: "the marker it has now" });
  }
}

/** The command in the palette, and the key you give it in Settings → Hotkeys. */
function hotkeyFigure(fig: HTMLElement): void {
  const row = fig.createDiv({ cls: "organized-welcome-fig-rows" }).createDiv({ cls: "organized-welcome-fig-row" });
  row.createSpan({ cls: "organized-welcome-fig-cap", text: "Organized" });
  row.createSpan({ cls: "organized-welcome-fig-row-role", text: "Edit checkbox marker" });
  row.createSpan({ cls: "organized-welcome-fig-pill", text: "Alt + X" });
}

/** Says where in the interface the thing is, above the picture of it. */
const where = (fig: HTMLElement, path: string): void => { fig.createDiv({ cls: "organized-welcome-fig-caption", text: path }); };
/** A settings-style row: a name and the field it holds. */
const settingRow = (host: HTMLElement, name: string, value: string): void => {
  const row = host.createDiv({ cls: "organized-welcome-fig-row" });
  row.createSpan({ cls: "organized-welcome-fig-row-name", text: name });
  row.createSpan({ cls: "organized-welcome-fig-field", text: value });
};

function devicesFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-rows" });
  where(list, "Settings › Organized › This device");
  settingRow(list, "Role of this device", "Secondary");
  for (const [chip, role] of [["Main", "Edits and fills daily notes"], ["Secondary", "Edits, never creates daily notes"], ["Mirror", "View only"]]) {
    const row = list.createDiv({ cls: "organized-welcome-fig-row" });
    row.createSpan({ cls: "organized-welcome-fig-pill", text: chip });
    row.createSpan({ cls: "organized-welcome-fig-row-role", text: role });
  }
}
/** The two repair commands as they appear in the command palette. */
function repairsFigure(fig: HTMLElement): void {
  const list = fig.createDiv({ cls: "organized-welcome-fig-rows" });
  where(list, "Command palette (Ctrl/Cmd+P)");
  for (const name of ["Add missing recurring tasks to this daily note", "Remove duplicate recurring lines in this note"]) {
    const row = list.createDiv({ cls: "organized-welcome-fig-row" });
    row.createSpan({ cls: "organized-welcome-fig-cap", text: "Organized" });
    row.createSpan({ cls: "organized-welcome-fig-row-role", text: name });
  }
}

const BUILDERS: Record<FigureId, (fig: HTMLElement) => void> = { settings: settingsFigure, tabs: tabsFigure, calendar: calendarFigure, follow: followFigure, forward: forwardFigure, card: cardFigure, props: propsFigure, keys: keysFigure, commands: commandsFigure, press: pressFigure, hotkey: hotkeyFigure, devices: devicesFigure, repairs: repairsFigure };

/** Draw the illustration `id` into `parent`. */
export function renderFigure(parent: HTMLElement, id: FigureId): HTMLElement {
  if (!FIGURE_IDS.includes(id)) throw new Error(`Unknown onboarding figure "${id}".`);
  const fig = parent.createDiv({ cls: "organized-welcome-figure", attr: { "aria-hidden": "true", "data-figure": id } });
  BUILDERS[id](fig);
  return fig;
}
