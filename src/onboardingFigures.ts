import { setIcon } from "obsidian";
import { STATUS_ICONS } from "./model";

/**
 * Small illustrations for the onboarding card, drawn from the plugin's own interface elements instead of shipped as
 * screenshots: they follow the user's theme and font, add almost nothing to the plugin's size and cannot go stale the way
 * a picture does. They are decoration (aria-hidden, not interactive); the step's text carries the meaning.
 */
export type FigureId = "note" | "forward" | "card" | "keys" | "day";
/** Every figure id; the tests walk it so a new figure cannot ship undrawn. */
export const FIGURE_IDS: FigureId[] = ["note", "forward", "card", "keys", "day"];

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

function noteFigure(fig: HTMLElement): void {
  const note = fig.createDiv({ cls: "organized-welcome-fig-note" });
  line(note, "x", "Reply to Anna");
  line(note, " ", "Draft the Q1 review");
  line(note, " ", "Book the dentist");
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
}

const KEYS: [string, string][] = [["!", "Priority"], ["<", "Schedule"], ["/", "Start a timer"], ["*", "Favorite"], ["j", "Link projects"], ["n", "Make a note"]];
function keysFigure(fig: HTMLElement): void {
  const grid = fig.createDiv({ cls: "organized-welcome-fig-keys" });
  for (const [key, label] of KEYS) {
    const item = grid.createDiv({ cls: "organized-welcome-fig-key" });
    item.createSpan({ cls: "organized-welcome-fig-cap", text: `[${key}]` });
    item.createSpan({ text: label });
  }
}

/** Hours shown by the day figure, and its blocks as [title, start, end, status, lane, lanes]. */
const FIRST_HOUR = 9, LAST_HOUR = 13;
const BLOCKS: [string, number, number, "completed" | "in_progress", number, number][] = [
  ["Reply to Anna", 9, 9.75, "completed", 0, 1],
  ["Draft the Q1 review", 10, 11.5, "in_progress", 0, 2],
  ["Plan the Lisbon trip", 10.75, 12, "in_progress", 1, 2],
];
function dayFigure(fig: HTMLElement): void {
  const grid = fig.createDiv({ cls: "organized-welcome-fig-day" });
  const span = LAST_HOUR - FIRST_HOUR;
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour++) {
    const hourLine = grid.createDiv({ cls: "organized-welcome-fig-hour" });
    hourLine.setCssProps({ "--organized-at": String((hour - FIRST_HOUR) / span * 100) });
    hourLine.createSpan({ cls: "organized-welcome-fig-hour-label", text: `${String(hour).padStart(2, "0")}:00` });
  }
  for (const [title, start, end, status, lane, lanes] of BLOCKS) {
    const block = grid.createDiv({ cls: "organized-welcome-fig-block", attr: { "data-status": status } });
    block.setCssProps({ "--organized-top": String((start - FIRST_HOUR) / span * 100), "--organized-height": String((end - start) / span * 100), "--organized-lane": String(lane), "--organized-lanes": String(lanes) });
    block.createSpan({ cls: "organized-welcome-fig-block-title", text: title });
  }
}

const BUILDERS: Record<FigureId, (fig: HTMLElement) => void> = { note: noteFigure, forward: forwardFigure, card: cardFigure, keys: keysFigure, day: dayFigure };

/** Draw the illustration `id` into `parent`. */
export function renderFigure(parent: HTMLElement, id: FigureId): HTMLElement {
  if (!FIGURE_IDS.includes(id)) throw new Error(`Unknown onboarding figure "${id}".`);
  const fig = parent.createDiv({ cls: "organized-welcome-figure", attr: { "aria-hidden": "true", "data-figure": id } });
  BUILDERS[id](fig);
  return fig;
}
