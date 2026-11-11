import { App, Component, Modal, Setting, SuggestModal } from "obsidian";
import { localDate, MAX_BUDGET_SECONDS, MAX_DAYS, path, PRIORITIES, Priority, Task, validDate, WorkSession } from "./model";
import { isoFromInput, kindOf, lengthOf, lengthOfSeconds, localInput, SessionKind, sessionProblem } from "./sessions";
import { cleanTags } from "./notes";
import { freePath, noteName } from "./names";
import { report, type DraftDay } from "./service";
import { rgbOf } from "./colors";
import { formatRule, presetRules, Rule, ruleLabel, Unit } from "./recurrence";
import { ClockSpan, MAX_TIMES, minutesOf, timeLabel, timesProblem } from "./plans";
import { moment } from "./moment";
import { BUDGET_KEYS, BudgetPeriod, budgetHours, MAX_BUDGET_HOURS, projectName, ProjectBudgets } from "./repository";
import { renderMarkdownLinks } from "./markdown";
import { ONBOARDING_STEPS, OnboardingStep } from "./onboarding";
import type { ReleaseNote } from "./whatsNew/releaseNotes";
import { renderShot } from "./whatsNew/renderShot";
import { renderFigure } from "./onboardingFigures";
import { describePreview, losesNote, normalizeRetire, retirePreview, type RetireOptions, type RetireScan } from "./retire";

/** Share the compact inspector surface with native modal chrome. */
function decorate(modal: Modal): void {
  modal.modalEl?.addClass("organized-modal-window");
  // Top-align the host so a mobile keyboard cannot cover the modal's actions.
  modal.containerEl?.addClass("organized-modal-host");
}

/** The automatic `- [ ] ` trigger offers an explicit escape hatch that links nothing. */
export const KEEP_AS_TODO = { keepAsTodo: true } as const;
export type TaskChoice = Task | string | typeof KEEP_AS_TODO;
export function isKeepAsTodo(value: TaskChoice): value is typeof KEEP_AS_TODO {
  return typeof value === "object" && value !== null && "keepAsTodo" in value && value.keepAsTodo === true;
}

export class TaskPicker extends SuggestModal<TaskChoice> {
  readonly markdown = new Component();
  constructor(app: App, readonly tasks: Task[], readonly choose: (choice: TaskChoice) => Promise<void>, private readonly query = "", readonly allowTodo = false, readonly allowCreate = true) {
    super(app); this.markdown.load(); decorate(this); this.setPlaceholder("Find an existing task or create a new one"); this.inputEl.value = query;
  }
  /** Obsidian clears the search box while it opens the dialog, so what was typed into the todo before it opened (its first letter) is put back and the list filtered by it. */
  onOpen(): void {
    void super.onOpen(); const query = this.query; this.inputEl.value = query; this.inputEl.setSelectionRange(query.length, query.length); this.inputEl.dispatchEvent(new Event("input"));
  }
  onClose(): void { super.onClose(); this.markdown.unload(); }
  getSuggestions(query: string): TaskChoice[] {
    const q = query.trim(); const matches = this.tasks.filter(t => t.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
    return [...(this.allowTodo ? [KEEP_AS_TODO] : []), ...matches, ...(q && this.allowCreate ? [q] : [])];
  }
  renderSuggestion(value: TaskChoice, el: HTMLElement): void {
    el.addClass("organized-suggestion");
    if (isKeepAsTodo(value)) {
      el.addClass("organized-suggestion-keep");
      el.createDiv({ cls: "organized-suggestion-title", text: "Keep as regular todo" });
      el.createDiv({ cls: "organized-suggestion-meta", text: "Close without linking this line" });
    } else if (typeof value === "string") el.createDiv({ text: `Create new task: “${value}”` });
    else {
      const title = el.createDiv({ cls: "organized-suggestion-title" });
      void renderMarkdownLinks(this.app, value.title, title, "", this.markdown).catch(report);
      el.createDiv({ cls: "organized-suggestion-meta", text: `${(value.recurring && value.time_tracking_started_at ? "in_progress" : value.status).replace(/_/g, " ")} · ${value.priority}${value.scheduled ? ` · ${value.scheduled}` : ""}` });
    }
  }
  onChooseSuggestion(value: TaskChoice): void { void this.choose(value).catch(report); }
}
export class PriorityPicker extends SuggestModal<Priority> {
  constructor(app: App, readonly choose: (priority: Priority) => Promise<void>) { super(app); decorate(this); this.setPlaceholder("Choose priority"); }
  getSuggestions(query: string): Priority[] { return PRIORITIES.filter(p => p.includes(query.toLowerCase())); }
  renderSuggestion(value: Priority, el: HTMLElement): void { el.setText(value[0].toUpperCase() + value.slice(1)); }
  onChooseSuggestion(value: Priority): void { void this.choose(value).catch(report); }
}
const REPEAT_UNITS: [Unit, string][] = [["day", "days"], ["week", "weeks"], ["month", "months"], ["year", "years"]];
const PRESET_NAMES = { day: "Daily", weekdays: "Weekdays", week: "Weekly", month: "Monthly", year: "Yearly" };
const WEEKDAY_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Asks how a task repeats. The usual choices are one tap each; below them everything else is a form (every [3] [weeks], on which days) that reads back in plain words before it is saved. */
export class RecurrencePicker extends Modal {
  private picked = false;
  /** `cancelled` runs when the dialog closes without a choice, so a typed `[r]` can be put back. */
  /** `times` are the times of day the task is planned for on each day it repeats; `choose` gets them back with the rule (the rule null stops repeating and keeps them for later). */
  constructor(app: App, readonly today: string, readonly current: Rule | null, readonly choose: (rule: Rule | null, times: ClockSpan[]) => Promise<void>, readonly cancelled?: () => void, readonly times: ClockSpan[] = []) { super(app); decorate(this); }
  /** Reads the time rows (set up in `onOpen`): the times, or what is wrong with them. */
  private readTimes!: () => ClockSpan[] | string;
  private done(rule: Rule | null): void {
    // Stopping keeps the stored times as they were, whatever the rows say.
    const times = rule === null ? this.times : this.readTimes(); if (typeof times === "string") return;
    this.picked = true; this.close(); void this.choose(rule, times).catch(report);
  }
  onOpen(): void {
    this.titleEl.setText("Repeat"); this.contentEl.addClass("organized-modal");
    this.timesEditor();
    const presets = this.contentEl.createDiv({ cls: "organized-repeat-presets", attr: { role: "group", "aria-label": "Common repeats" } });
    const now = this.current ? formatRule(this.current) : "";
    for (const rule of presetRules(this.today)) {
      const b = presets.createEl("button", { cls: "organized-repeat-preset", text: PRESET_NAMES[rule.unit === "week" && rule.days.length > 1 ? "weekdays" : rule.unit], attr: { "aria-pressed": String(formatRule(rule) === now), title: ruleLabel(rule) } });
      b.addEventListener("click", () => this.done(rule));
    }
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Custom" });
    const start = this.current ?? presetRules(this.today)[2];
    const row = this.contentEl.createDiv({ cls: "organized-repeat-row" });
    row.createSpan({ cls: "organized-muted", text: "Every" });
    const every = row.createEl("input", { type: "number", attr: { min: "1", max: "999", step: "1", inputmode: "numeric", "aria-label": "Repeat every" } }); every.value = String(start.every);
    const unit = row.createEl("select", { attr: { "aria-label": "Repeat unit" } });
    for (const [value, plural] of REPEAT_UNITS) unit.createEl("option", { value, text: plural });
    unit.value = start.unit;
    const days = this.contentEl.createDiv({ cls: "organized-repeat-days", attr: { role: "group", "aria-label": "Repeat on" } });
    const chosen = new Set(start.days.length ? start.days : presetRules(this.today)[2].days);
    const chips = WEEKDAY_LETTERS.map((name, day) => { const c = days.createEl("button", { cls: "organized-repeat-day", text: name[0], attr: { "aria-pressed": "false", "aria-label": name, title: name } }); c.addEventListener("click", () => { if (chosen.has(day) && chosen.size > 1) chosen.delete(day); else chosen.add(day); paint(); }); return c; });
    const month = this.contentEl.createDiv({ cls: "organized-repeat-row" });
    month.createSpan({ cls: "organized-muted", text: "On" });
    const monthDay = month.createEl("select", { attr: { "aria-label": "Day of the month" } });
    for (let d = 1; d <= 31; d++) monthDay.createEl("option", { value: String(d), text: `Day ${d}` });
    monthDay.createEl("option", { value: "last", text: "Last day" });
    monthDay.value = String(start.monthDay ?? presetRules(this.today)[3].monthDay);
    const summary = this.contentEl.createDiv({ cls: "organized-modal-copy organized-repeat-summary", attr: { role: "status" } });
    const read = (): Rule | null => {
      const n = Number(every.value); if (!Number.isInteger(n) || n < 1 || n > 999) return null;
      const u = unit.value as Unit;
      return { every: n, unit: u, days: u === "week" ? [...chosen].sort((a, b) => a - b) : [], monthDay: u === "month" ? (monthDay.value === "last" ? "last" : Number(monthDay.value)) : null };
    };
    const paint = () => {
      const rule = read(); const u = unit.value;
      days.toggleClass("organized-hidden", u !== "week"); month.toggleClass("organized-hidden", u !== "month");
      chips.forEach((c, day) => c.setAttribute("aria-pressed", String(chosen.has(day))));
      summary.setText(rule ? ruleLabel(rule) : "Use a whole number from 1 to 999."); summary.toggleClass("organized-session-problem", !rule);
    };
    for (const control of [every, unit, monthDay]) control.addEventListener("input", paint);
    paint();
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Save").setCta().onClick(() => { const rule = read(); if (rule) this.done(rule); else paint(); }));
    if (this.current) actions.addButton(b => { b.setButtonText("Stop repeating").onClick(() => this.done(null)); b.buttonEl.addClass("mod-warning"); });
  }
  /** Rows of From and To times (optional): each day the task repeats, those times are planned for it, with no daily note needed. */
  private timesEditor(): void {
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Planned times (optional)" });
    const list = this.contentEl.createDiv({ cls: "organized-repeat-times", attr: { role: "group", "aria-label": "Planned times" } });
    const rows: { from: HTMLInputElement; to: HTMLInputElement }[] = [];
    const add = this.contentEl.createEl("button", { cls: "organized-repeat-add", text: "Add time" });
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    this.readTimes = () => {
      const times = rows.filter(r => r.from.value || r.to.value).map(r => ({ start: r.from.value, end: r.to.value })); const problem = timesProblem(times);
      note.setText(problem ?? (times.length ? times.map(timeLabel).join(", ") : "")); note.toggleClass("organized-session-problem", problem !== null);
      return problem ?? times;
    };
    const row = (time?: ClockSpan) => {
      const line = list.createDiv({ cls: "organized-repeat-time" }); const n = rows.length + 1;
      const from = line.createEl("input", { type: "time", attr: { "aria-label": `Time ${n} from` } }); const to = line.createEl("input", { type: "time", attr: { "aria-label": `Time ${n} to` } });
      from.value = time?.start ?? ""; to.value = time?.end ?? ""; const entry = { from, to }; rows.push(entry);
      for (const input of [from, to]) input.addEventListener("input", () => this.readTimes());
      const remove = line.createEl("button", { cls: "organized-repeat-remove", text: "×", attr: { "aria-label": `Remove time ${n}`, title: "Remove" } });
      remove.addEventListener("click", () => { line.remove(); rows.splice(rows.indexOf(entry), 1); add.disabled = false; this.readTimes(); });
      add.disabled = rows.length >= MAX_TIMES;
    };
    add.addEventListener("click", () => { row(); rows.at(-1)!.from.focus(); });
    for (const time of this.times) row(time);
    this.readTimes();
  }
  onClose(): void { this.contentEl.empty(); queueMicrotask(() => { if (!this.picked) this.cancelled?.(); }); }
}
/** What the Schedule dialog shows of a task (see `ScheduleModal`). */
export interface ScheduleSetup {
  title: string;
  /** Its days from today on: the blocks that have not begun (editable), those that have (shown, kept), and whether the day's note exists without its todo. */
  days: { date: string; blocks: WorkSession[]; locked: WorkSession[]; missing?: boolean }[];
  /** Days that are over; kept as they are. */
  earlier: string[];
  state: "open" | "closed" | "recurring";
  /** The day of the todo the dialog was opened from, shown highlighted. */
  highlight?: string;
  /** Planned time of all tasks on a day (seconds), and the other task one of these blocks overlaps, for each day's line. */
  load: (day: string, blocks: WorkSession[]) => { seconds: number; clash: string | null };
  /** The task budget measured with these blocks, or "" when it has none. */
  budget: (blocks: WorkSession[]) => string;
  save: (draft: DraftDay[]) => Promise<void>;
  /** Closed with nothing saved (a typed `<` is put back). */
  cancelled?: () => void;
  reopen?: () => void;
  repeat?: () => void;
  now?: () => number;
}
interface ScheduleRow { date: string; from?: string; times: ClockSpan[]; locked: WorkSession[]; missing: boolean; restore: boolean }
const DURATIONS: [string, number][] = [["30 m", 30], ["1 h", 60], ["2 h", 120], ["4 h", 240]];
const clockOf = (minutes: number): string => { const m = ((minutes % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
/** A time of day on a date as a block; an end at or before the start is the next morning. */
export function blockOn(date: string, time: ClockSpan): WorkSession {
  const start = isoFromInput(`${date}T${time.start}`)!; let end = isoFromInput(`${date}T${time.end}`)!;
  if (Date.parse(end) <= Date.parse(start)) end = new Date(new Date(end).setDate(new Date(end).getDate() + 1)).toISOString();
  return { start, end };
}
/** A day as people read it fast: Today, Tomorrow, else weekday and date (`Wed 18 Nov`). */
export function dayLabel(date: string, now = Date.now()): string {
  const today = new Date(now); const tomorrow = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  return date === localDate(today) ? "Today" : date === tomorrow ? "Tomorrow" : moment(date, "YYYY-MM-DD").format("ddd D MMM");
}
export const spanOf = (block: WorkSession): ClockSpan => ({ start: localInput(block.start).slice(11), end: localInput(block.end).slice(11) });
/**
 * The one place to plan a task: the days it is scheduled for, each with optional times. Changes are a draft until Save, which writes them as one change with one Undo;
 * closing with unsaved changes asks first. Blocks that have begun are shown and kept, never edited.
 */
export class ScheduleModal extends Modal {
  private rows: ScheduleRow[];
  private readonly initial: string;
  private settled = false;
  private list!: HTMLElement;
  private budgetLine!: HTMLElement;
  constructor(app: App, readonly setup: ScheduleSetup, draft?: ScheduleRow[]) {
    super(app); decorate(this);
    const start = setup.days.map(d => ({ date: d.date, from: d.date, times: d.blocks.map(spanOf), locked: d.locked, missing: d.missing === true, restore: false }));
    this.initial = JSON.stringify(start); this.rows = draft ?? start;
  }
  private get now(): number { return (this.setup.now ?? Date.now)(); }
  private get today(): string { return localDate(new Date(this.now)); }
  private dirty(): boolean { return JSON.stringify(this.rows) !== this.initial; }
  private label(date: string): string { return dayLabel(date, this.now); }
  onOpen(): void {
    this.titleEl.setText("Schedule"); this.contentEl.addClass("organized-modal", "organized-schedule");
    this.contentEl.createEl("p", { cls: "organized-modal-copy organized-schedule-task", text: this.setup.title });
    if (this.setup.state === "recurring") {
      this.contentEl.createEl("p", { cls: "organized-modal-copy", text: "This task repeats, so its planned times are set with its repeat rule." });
      new Setting(this.contentEl).addButton(b => b.setButtonText("Repeat settings…").setCta().onClick(() => { this.settled = true; this.close(); this.setup.repeat?.(); }));
      return;
    }
    if (this.setup.state === "closed") {
      this.contentEl.createEl("p", { cls: "organized-modal-copy", text: this.rows.length ? `Done. It was scheduled for ${this.rows.map(r => this.label(r.date)).join(", ")}.` : "Done, and not scheduled." });
      new Setting(this.contentEl).addButton(b => b.setButtonText("Reopen to schedule").setCta().onClick(() => { this.settled = true; this.close(); this.setup.reopen?.(); }));
      return;
    }
    this.quickAdd();
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Scheduled days" });
    this.list = this.contentEl.createDiv({ cls: "organized-schedule-days", attr: { role: "list", "aria-label": "Scheduled days" } });
    if (this.setup.earlier.length) {
      const fold = this.contentEl.createEl("details", { cls: "organized-schedule-earlier" }); fold.createEl("summary", { text: `Earlier (${this.setup.earlier.length})` });
      fold.createDiv({ cls: "organized-muted", text: this.setup.earlier.map(d => this.label(d)).join(", ") });
    }
    this.budgetLine = this.contentEl.createDiv({ cls: "organized-modal-copy organized-schedule-budget", attr: { role: "status" } });
    this.contentEl.createDiv({ cls: "organized-muted organized-schedule-hint", text: "The todo appears in each day's daily note (a later day's when its note is made)." });
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Save").setCta().onClick(() => this.save()));
    actions.addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
    if (this.rows.length || this.setup.earlier.length) actions.addButton(b => { b.setButtonText("Clear schedule").onClick(() => { this.settled = true; this.close(); void this.setup.save([]).catch(report); }); b.buttonEl.addClass("mod-warning"); });
    this.paint();
  }
  /** Today, Tomorrow and Next week add a day at once; a date with an optional time adds that. */
  private quickAdd(): void {
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Add a day" });
    const chips = this.contentEl.createDiv({ cls: "organized-repeat-presets organized-schedule-quick", attr: { role: "group", "aria-label": "Add a day" } });
    const base = new Date(this.now); const nextWeek = moment(this.now).add(1, "week").startOf("week").format("YYYY-MM-DD");
    for (const [name, date] of [["Today", this.today], ["Tomorrow", localDate(new Date(base.setDate(base.getDate() + 1)))], ["Next week", nextWeek]] as const) {
      const chip = chips.createEl("button", { cls: "organized-repeat-preset", text: name, attr: { "aria-label": `Add ${name.toLowerCase()}` } });
      chip.addEventListener("click", () => this.addDay(date));
    }
    if (!this.rows.length) chips.querySelector("button")!.addClass("organized-schedule-first");
    const row = this.contentEl.createDiv({ cls: "organized-datetime organized-schedule-add" });
    // Days that are over stay as they were (see Earlier): only today and later days are added.
    const date = row.createEl("input", { type: "date", attr: { "aria-label": "Day to add", min: this.today } }); date.value = this.today;
    const times = this.contentEl.createDiv({ cls: "organized-datetime organized-time-range" });
    const from = times.createEl("input", { type: "time", attr: { "aria-label": "From (optional)" } }); const to = times.createEl("input", { type: "time", attr: { "aria-label": "To (optional)" } });
    const lengths = this.contentEl.createDiv({ cls: "organized-schedule-durations", attr: { role: "group", "aria-label": "Length" } });
    for (const [name, minutes] of DURATIONS) {
      const chip = lengths.createEl("button", { cls: "organized-repeat-day", text: name, attr: { "aria-label": `Length ${name}` } });
      chip.addEventListener("click", () => { if (!from.value) from.value = this.freeSlot(date.value); to.value = clockOf(minutesOf(from.value)! + minutes); });
    }
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const add = this.contentEl.createEl("button", { cls: "organized-repeat-add mod-cta", text: "Add" });
    const submit = () => {
      if (!validDate(date.value)) { note.setText("Choose a valid date."); note.addClass("organized-session-problem"); return; }
      if (date.value < this.today) { note.setText("Pick today or a later day; days that are over stay as they were."); note.addClass("organized-session-problem"); return; }
      if (!from.value !== !to.value) { note.setText("Add both times, or neither for a day alone."); note.addClass("organized-session-problem"); return; }
      note.setText(""); note.removeClass("organized-session-problem");
      this.addDay(date.value, from.value ? { start: from.value, end: to.value } : undefined); from.value = ""; to.value = "";
    };
    add.addEventListener("click", submit);
    for (const input of [date, from, to]) input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
  }
  /** The next free half hour on a day for this task: from now on today, from 09:00 on a later day, after the times the day already has. */
  private freeSlot(date: string): string {
    const row = this.rows.find(r => r.date === date); const taken = [...(row?.times ?? []), ...(row?.locked.map(spanOf) ?? [])];
    const clock = new Date(this.now); let at = date === this.today ? Math.ceil((clock.getHours() * 60 + clock.getMinutes()) / 30) * 30 : 9 * 60;
    while (at < 1440 && taken.some(t => { const s = minutesOf(t.start)!, e = minutesOf(t.end)!; return at < (e > s ? e : 1440) && s < at + 60; })) at += 30;
    return clockOf(Math.min(at, 1410));
  }
  private addDay(date: string, time?: ClockSpan): void {
    let row = this.rows.find(r => r.date === date);
    if (!row) { row = { date, times: [], locked: [], missing: false, restore: false }; this.rows.push(row); }
    if (time) row.times.push(time);
    this.paint(date);
  }
  private problem(row: ScheduleRow): string | null { return timesProblem(row.times); }
  /** Draws the days, each with its times, and the budget line; `focus` is the day whose first control gets the focus. */
  private paint(focus?: string): void {
    this.rows.sort((a, b) => a.date.localeCompare(b.date)); this.list.empty();
    if (!this.rows.length) this.list.createDiv({ cls: "organized-muted organized-schedule-empty", text: "Not scheduled yet. Pick a day; a time is optional." });
    for (const row of this.rows) {
      const card = this.list.createDiv({ cls: "organized-schedule-day", attr: { role: "listitem" } }); card.toggleClass("organized-schedule-highlight", row.date === this.setup.highlight);
      const head = card.createDiv({ cls: "organized-schedule-head" });
      head.createSpan({ cls: "organized-schedule-label", text: this.label(row.date) });
      const day = head.createEl("input", { type: "date", attr: { "aria-label": `Day of ${this.label(row.date)}`, min: this.today } }); day.value = row.date;
      day.addEventListener("change", () => {
        if (!validDate(day.value) || day.value === row.date || day.value < this.today) { day.value = row.date; return; }
        const other = this.rows.find(r => r.date === day.value);
        // Onto a day that is already scheduled: the two become one.
        if (other) { other.times.push(...row.times); this.rows.splice(this.rows.indexOf(row), 1); } else row.date = day.value;
        this.paint(day.value);
      });
      const remove = head.createEl("button", { cls: "organized-repeat-remove", text: "×", attr: { "aria-label": `Remove ${this.label(row.date)}`, title: "Remove day" } });
      remove.addEventListener("click", () => { const at = this.rows.indexOf(row); this.rows.splice(at, 1); this.paint(this.rows[Math.min(at, this.rows.length - 1)]?.date); });
      const blocks = row.times.filter(t => minutesOf(t.start) !== null && minutesOf(t.end) !== null && t.start !== t.end).map(t => blockOn(row.date, t));
      const load = this.setup.load(row.date, [...blocks, ...row.locked]);
      const meta = card.createDiv({ cls: "organized-muted organized-schedule-meta" });
      meta.setText(`${row.times.length || row.locked.length ? "" : "Any time · "}${load.seconds ? `${lengthOfSeconds(load.seconds)} planned that day` : "Nothing else planned"}`);
      if (row.missing) {
        const missing = card.createDiv({ cls: "organized-schedule-missing" }); missing.createSpan({ text: row.restore ? "The todo goes back in the daily note." : "Not in the daily note. " });
        if (!row.restore) { const back = missing.createEl("button", { cls: "organized-repeat-add", text: "Add back" }); back.addEventListener("click", () => { row.restore = true; this.paint(row.date); }); }
      }
      for (const block of row.locked) card.createDiv({ cls: "organized-schedule-locked", text: `${timeLabel(spanOf(block))} · ${Date.parse(block.end) <= this.now ? "done" : "started"}` });
      const times = card.createDiv({ cls: "organized-repeat-times", attr: { role: "group", "aria-label": `Times on ${this.label(row.date)}` } });
      for (const time of row.times) {
        const line = times.createDiv({ cls: "organized-repeat-time" });
        const from = line.createEl("input", { type: "time", attr: { "aria-label": "From" } }); const to = line.createEl("input", { type: "time", attr: { "aria-label": "To" } }); from.value = time.start; to.value = time.end;
        from.addEventListener("input", () => { time.start = from.value; this.check(card, row); }); to.addEventListener("input", () => { time.end = to.value; this.check(card, row); });
        const drop = line.createEl("button", { cls: "organized-repeat-remove", text: "×", attr: { "aria-label": `Remove ${time.start}–${time.end}`, title: "Remove time" } });
        drop.addEventListener("click", () => { row.times.splice(row.times.indexOf(time), 1); this.paint(row.date); });
      }
      const more = card.createEl("button", { cls: "organized-repeat-add", text: "+ time", attr: { "aria-label": `Add a time on ${this.label(row.date)}` } }); more.disabled = row.times.length >= MAX_TIMES;
      more.addEventListener("click", () => { const start = this.freeSlot(row.date); row.times.push({ start, end: clockOf(minutesOf(start)! + 60) }); this.paint(row.date); });
      card.createDiv({ cls: "organized-modal-copy organized-session-note organized-schedule-note", attr: { role: "status" } });
      this.check(card, row, load.clash);
      if (row.date === focus) window.setTimeout(() => day.focus(), 0);
    }
    this.paintBudget();
  }
  /** What is wrong with a day's times, or a warning about them: past, or over another task's. */
  private check(card: HTMLElement, row: ScheduleRow, clash: string | null = null): boolean {
    const note = card.querySelector<HTMLElement>(".organized-schedule-note")!; const problem = this.problem(row);
    const past = !problem && row.times.some(t => Date.parse(blockOn(row.date, t).start) <= this.now);
    note.setText(problem ?? (clash ? `Overlaps “${clash}”.` : past ? "A time already past won't start a timer." : "")); note.toggleClass("organized-session-problem", problem !== null);
    if (!problem) this.paintBudget(); return problem === null;
  }
  private draft(): DraftDay[] {
    return this.rows.map(r => ({ date: r.date, ...(r.from && r.from !== r.date ? { from: r.from } : {}), blocks: r.times.map(t => blockOn(r.date, t)), ...(r.restore ? { restore: true } : {}) }));
  }
  private paintBudget(): void { if (this.rows.every(r => this.problem(r) === null)) this.budgetLine.setText(this.setup.budget(this.draft().flatMap(d => d.blocks))); }
  private save(): void {
    if (!this.rows.every(r => this.problem(r) === null)) { this.paint(); return; }
    if (this.rows.length + this.setup.earlier.length > MAX_DAYS) { this.budgetLine.setText(`A task can be scheduled for at most ${MAX_DAYS} days.`); return; }
    if (!this.dirty()) { this.close(); return; }
    this.settled = true; this.close(); void this.setup.save([...this.setup.earlier.map(date => ({ date, blocks: [] })), ...this.draft()]).catch(report);
  }
  onClose(): void {
    this.contentEl.empty(); if (this.settled) return; this.settled = true;
    if (this.setup.state !== "open" || !this.dirty()) { this.setup.cancelled?.(); return; }
    // Unsaved changes are never dropped without asking.
    const rows = this.rows;
    new ChoiceModal(this.app, "Discard changes?", "The schedule has changes that are not saved.", [
      { label: "Keep editing", run: () => new ScheduleModal(this.app, this.setup, rows).open() },
      { label: "Discard", run: () => this.setup.cancelled?.() },
    ], () => this.setup.cancelled?.()).open();
  }
}
/** A question with a few answers as buttons; closing it answers nothing. */
export class ChoiceModal extends Modal {
  private chosen = false;
  /** `dismissed` runs when it closes with no answer. */
  constructor(app: App, readonly heading: string, readonly message: string, readonly choices: { label: string; run: () => void }[], readonly dismissed?: () => void) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText(this.heading); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("p", { cls: "organized-modal-copy", text: this.message });
    const actions = new Setting(this.contentEl);
    for (const [n, choice] of this.choices.entries()) actions.addButton(b => { b.setButtonText(choice.label).onClick(() => { this.chosen = true; this.close(); choice.run(); }); if (n === 0) b.setCta(); });
  }
  onClose(): void { this.contentEl.empty(); if (!this.chosen) this.dismissed?.(); }
}
export class ConfirmModal extends Modal {
  private settled = false;
  constructor(app: App, readonly message: string, readonly done: (yes: boolean) => void, readonly heading = "Confirm task action", readonly confirmLabel = "Confirm") { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText(this.heading); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("p", { cls: "organized-modal-copy", text: this.message });
    new Setting(this.contentEl).addButton(b => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(b => { b.setButtonText(this.confirmLabel); if (this.confirmLabel === "Delete") b.buttonEl.addClass("mod-warning"); else b.setCta(); b.onClick(() => { this.settled = true; this.done(true); this.close(); }); });
  }
  onClose(): void { if (!this.settled) this.done(false); this.contentEl.empty(); }
}
export class ProjectPicker extends Modal {
  readonly selected: Set<string>;
  private unfit: () => void = () => undefined;
  constructor(app: App, readonly notes: string[], selected: string[], readonly save: (notes: string[]) => Promise<void>, readonly folder = "", readonly colorOf: (note: string) => string | null = () => null) { super(app); decorate(this); this.selected = new Set(selected); }
  onOpen(): void {
    this.titleEl.setText("Link projects or topics"); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Find or create a root note" });
    const search = this.contentEl.createEl("input", { type: "search", attr: { "aria-label": "Find or create project note", placeholder: "Find or create a root note" } });
    // The list is not every note: a person who linked a note with [[...]] or expected their own note here needs to know why it is missing.
    this.contentEl.createEl("p", { cls: "organized-muted organized-project-hint", text: `Only notes with the property organized_type: project are listed. To use an existing note, add that property to it; typing its name here creates a new note${this.folder ? ` in ${this.folder}` : ""}.` });
    const results = this.contentEl.createDiv({ cls: "organized-project-results" });
    const boxes = () => Array.from(results.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
    // Tab walks search, projects, Save links itself: the dialog's own focus order skipped Save on desktop. At either end the browser's own Tab leaves the dialog as usual.
    const tabFrom = (event: KeyboardEvent, at: HTMLElement) => {
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const order = [search, ...boxes(), saveButton!]; const next = order[order.indexOf(at) + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); next.focus(); }
    };
    const paint = () => {
      results.empty(); const query = search.value.trim();
      const notes = new Set([...this.notes, ...this.selected].filter(n => n.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
      if (query && !query.includes("/")) { try { notes.add(path(`${this.folder ? `${this.folder}/` : ""}${query.replace(/\.md$/, "")}.md`)); } catch { /* Invalid drafts cannot be selected. */ } }
      for (const note of notes) {
        const label = results.createEl("label", { cls: "organized-project-choice" });
        const input = label.createEl("input", { type: "checkbox" }); input.checked = this.selected.has(note);
        const color = this.colorOf(note); const dot = label.createSpan({ cls: "organized-project-dot", attr: { "aria-hidden": "true" } });
        if (color) { dot.setAttribute("data-project", ""); dot.setCssProps({ "--organized-chip-bg": rgbOf(color) }); }
        label.createSpan({ text: `${projectName(note, [...this.notes, ...this.selected])}${this.notes.includes(note) ? "" : " (create)"}` });
        const toggle = (on: boolean) => { input.checked = on; if (on) this.selected.add(note); else this.selected.delete(note); };
        input.addEventListener("change", () => toggle(input.checked));
        input.addEventListener("focus", () => input.scrollIntoView({ block: "nearest" }));
        input.addEventListener("keydown", event => {
          tabFrom(event, input); const at = boxes().indexOf(input);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (boxes()[at + (event.key === "ArrowDown" ? 1 : -1)] ?? (event.key === "ArrowUp" ? search : saveButton)!).focus(); }
          else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); toggle(!input.checked); }
        });
      }
    };
    const saveLinks = () => { this.close(); void this.save([...this.selected]).catch(report); };
    let saveButton: HTMLElement | null = null;
    search.addEventListener("input", paint); paint();
    search.addEventListener("keydown", event => {
      tabFrom(event, search);
      if (event.key === "ArrowDown") { event.preventDefault(); (boxes()[0] ?? saveButton)?.focus(); }
      else if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) { saveLinks(); return; }
        // Enter picks the best match, so a name can be typed and chosen without the mouse.
        const first = boxes()[0]; if (first) { if (!first.checked) first.click(); search.value = ""; paint(); }
      }
    });
    new Setting(this.contentEl).addButton(b => {
      b.setButtonText("Save links").setCta().onClick(saveLinks); saveButton = b.buttonEl;
      // The arrows lead on from the last project to Save, and back.
      b.buttonEl.addEventListener("keydown", event => { tabFrom(event, b.buttonEl); if (event.key === "ArrowUp") { event.preventDefault(); (boxes().at(-1) ?? search).focus(); } });
    });
    // The on-screen keyboard covers the bottom of the window without shrinking it; keep the list inside what is left so every project can be scrolled to.
    const viewport = window.visualViewport;
    if (viewport) {
      const fit = () => { const top = results.getBoundingClientRect().top - viewport.offsetTop; results.setCssProps({ "--organized-list-max": `${Math.max(120, Math.floor(viewport.height - top - 90))}px` }); };
      viewport.addEventListener("resize", fit); viewport.addEventListener("scroll", fit); fit();
      this.unfit = () => { viewport.removeEventListener("resize", fit); viewport.removeEventListener("scroll", fit); };
    }
    search.focus();
  }
  onClose(): void { this.unfit(); this.contentEl.empty(); }
}

export interface SessionEdit {
  heading: string; taskTitle: string; start: string; end: string;
  /** What the block is. An existing block keeps its kind; a new one (null) is worked or planned by its times, as the person types them. */
  kind: SessionKind | null;
  save: (session: WorkSession, kind: SessionKind) => Promise<void>; remove?: () => Promise<void>; openTask?: () => Promise<void>;
  /** For a planned block that is over: turns it into worked time. */
  logWorked?: () => Promise<void>;
}
/** Adds or edits one block of time, worked or planned: the task, a start and an end, with the length shown as you type. */
export class SessionModal extends Modal {
  constructor(app: App, readonly edit: SessionEdit, readonly now = () => Date.now()) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText(this.edit.heading); this.contentEl.addClass("organized-modal");
    this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-task", text: this.edit.taskTitle });
    // A date and a time side by side: one datetime-local field is wider than a phone's dialog and opens its picker over the form the moment it is focused.
    const field = (label: string, iso: string) => {
      this.contentEl.createEl("label", { cls: "organized-modal-label", text: label });
      const row = this.contentEl.createDiv({ cls: "organized-datetime" }); const [day, time] = localInput(iso).split("T");
      const date = row.createEl("input", { type: "date", attr: { "aria-label": `${label} date` } }); date.value = day;
      const clock = row.createEl("input", { type: "time", attr: { "aria-label": `${label} time` } }); clock.value = time;
      return { inputs: [date, clock], value: () => `${date.value}T${clock.value}` };
    };
    const start = field("Start", this.edit.start); const end = field("End", this.edit.end);
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const read = () => ({ start: isoFromInput(start.value()), end: isoFromInput(end.value()) });
    const kind = (): SessionKind => this.edit.kind ?? kindOf(read().end, this.now());
    const paint = () => {
      const { start: from, end: to } = read(); const problem = sessionProblem(from, to, this.now(), kind());
      note.setText(problem ?? `Length: ${lengthOf({ start: from!, end: to! })}${this.edit.kind ? "" : kind() === "planned" ? " · saved as planned time" : " · saved as time worked"}`); note.toggleClass("organized-session-problem", problem !== null);
    };
    for (const input of [...start.inputs, ...end.inputs]) input.addEventListener("input", paint);
    paint();
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Save").setCta().onClick(() => {
      const { start: from, end: to } = read(); const problem = sessionProblem(from, to, this.now(), kind()); if (problem) { paint(); return; }
      this.close(); void this.edit.save({ start: from!, end: to! }, kind()).catch(report);
    }));
    if (this.edit.logWorked) { const log = this.edit.logWorked; actions.addButton(b => b.setButtonText("Log as worked").onClick(() => { this.close(); void log().catch(report); })); }
    if (this.edit.openTask) { const open = this.edit.openTask; actions.addButton(b => b.setButtonText("Open task").onClick(() => { this.close(); void open().catch(report); })); }
    if (this.edit.remove) { const remove = this.edit.remove; actions.addButton(b => { b.setButtonText("Delete").onClick(() => { this.close(); void remove().catch(report); }); b.buttonEl.addClass("mod-warning"); }); }
  }
  onClose(): void { this.contentEl.empty(); }
}

const BUDGET_ROWS: [BudgetPeriod, string][] = [["total", "Whole project"], ["day", "Per day"], ["week", "Per week"], ["month", "Per month"]];
/** Asks for a project's time budgets in hours, one per period; a blank field means no budget for that period. */
export class ProjectBudgetModal extends Modal {
  constructor(app: App, readonly project: string, readonly current: ProjectBudgets, readonly save: (budgets: ProjectBudgets) => Promise<void>) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText("Project budget"); this.contentEl.addClass("organized-modal");
    this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-task", text: this.project });
    this.contentEl.createDiv({ cls: "organized-modal-copy", text: `Hours, blank for none. Kept in the project note (${Object.values(BUDGET_KEYS).join(", ")}).` });
    const fields = new Map<BudgetPeriod, HTMLInputElement>();
    for (const [period, label] of BUDGET_ROWS) {
      this.contentEl.createEl("label", { cls: "organized-modal-label", text: label });
      const input = this.contentEl.createEl("input", { type: "number", attr: { min: "0", step: "any", inputmode: "decimal", "aria-label": `${label} budget in hours` } });
      const seconds = this.current[period]; input.value = seconds === null ? "" : String(budgetHours(seconds)); fields.set(period, input);
    }
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const read = (): ProjectBudgets | string => {
      const budgets: ProjectBudgets = { total: null, day: null, week: null, month: null };
      for (const [period, input] of fields) {
        if (input.value.trim() === "") continue;
        const hours = Number(input.value); if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_BUDGET_HOURS) return `Use hours above 0 and up to ${MAX_BUDGET_HOURS}, or leave a field blank.`;
        budgets[period] = Math.max(1, Math.round(hours * 3600));
      }
      return budgets;
    };
    const paint = () => { const value = read(); note.setText(typeof value === "string" ? value : ""); note.toggleClass("organized-session-problem", typeof value === "string"); };
    for (const input of fields.values()) input.addEventListener("input", paint);
    new Setting(this.contentEl).addButton(b => b.setButtonText("Save").setCta().onClick(() => {
      const value = read(); if (typeof value === "string") { paint(); return; }
      this.close(); void this.save(value).catch(report);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Asks how much time a task may take, in hours and minutes; the saved budget is `seconds`, null removes it. */
export class BudgetModal extends Modal {
  constructor(app: App, readonly taskTitle: string, readonly current: number | null, readonly save: (seconds: number | null) => Promise<void>) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText("Time budget"); this.contentEl.addClass("organized-modal");
    this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-task", text: this.taskTitle });
    const minutes = this.current === null ? 0 : Math.round(this.current / 60);
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Budget" });
    const row = this.contentEl.createDiv({ cls: "organized-datetime" });
    const hours = row.createEl("input", { type: "number", attr: { min: "0", step: "1", inputmode: "numeric", "aria-label": "Budget hours" } }); hours.value = String(Math.floor(minutes / 60));
    row.createSpan({ cls: "organized-muted", text: "h" });
    const mins = row.createEl("input", { type: "number", attr: { min: "0", max: "59", step: "1", inputmode: "numeric", "aria-label": "Budget minutes" } }); mins.value = String(minutes % 60);
    row.createSpan({ cls: "organized-muted", text: "min" });
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const read = (): number | string => {
      const h = Number(hours.value), m = Number(mins.value);
      if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return "Use whole hours and minutes (0 to 59).";
      const total = (h * 60 + m) * 60;
      return total <= 0 ? "Enter a budget longer than zero, or remove it." : total > MAX_BUDGET_SECONDS ? "The longest budget is 9999 hours." : total;
    };
    const paint = () => { const value = read(); note.setText(typeof value === "string" ? value : ""); note.toggleClass("organized-session-problem", typeof value === "string"); };
    for (const input of [hours, mins]) input.addEventListener("input", paint);
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Save").setCta().onClick(() => {
      const value = read(); if (typeof value === "string") { paint(); return; }
      this.close(); void this.save(value).catch(report);
    }));
    if (this.current !== null) actions.addButton(b => { b.setButtonText("Remove budget").onClick(() => { this.close(); void this.save(null).catch(report); }); b.buttonEl.addClass("mod-warning"); });
  }
  onClose(): void { this.contentEl.empty(); }
}

export interface NoteConversion {
  title: string; folders: string[]; folder: string; templates: string[]; exists: (path: string) => boolean;
  /** Set when the task has tracked time: the dialog says it stays on the calendar. */
  tracked?: string;
  convert: (options: { folder: string; tags: string[]; template: string | null; clash: "new" | "existing" }) => Promise<void>;
}
/** Asks where a todo's standalone note goes (folder, tags, template) and what to do when a note of that name already exists. */
export class NoteConversionModal extends Modal {
  constructor(app: App, readonly conversion: NoteConversion) { super(app); decorate(this); }
  onOpen(): void {
    const { conversion } = this; this.titleEl.setText("Make a standalone note"); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("p", { cls: "organized-modal-copy", text: `“${conversion.title}” becomes a note holding its description. A link to the note replaces the todo here, its other copies are removed and its task note moves to Obsidian's trash.${conversion.tracked ? ` The ${conversion.tracked} of tracked time stays on the calendar, so the task note is kept (hidden) instead.` : ""}` });
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Folder" });
    const folder = this.contentEl.createEl("input", { type: "text", attr: { "aria-label": "Folder", list: "organized-folder-options", placeholder: "Vault root" } }); folder.value = conversion.folder;
    const options = this.contentEl.createEl("datalist", { attr: { id: "organized-folder-options" } }); for (const name of conversion.folders) options.createEl("option", { value: name });
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Tags (optional)" });
    const tags = this.contentEl.createEl("input", { type: "text", attr: { "aria-label": "Tags", placeholder: "Separate with commas" } });
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Template (optional)" });
    const template = this.contentEl.createEl("select", { attr: { "aria-label": "Template" } }); template.createEl("option", { text: "No template", value: "" }); for (const file of conversion.templates) template.createEl("option", { text: file, value: file });
    const clashLabel = this.contentEl.createEl("label", { cls: "organized-modal-label", text: "A note with this name already exists" });
    const clash = this.contentEl.createEl("select", { attr: { "aria-label": "Existing note" } }); clash.createEl("option", { text: "Create a new note with a number", value: "new" }); clash.createEl("option", { text: "Link to the existing note", value: "existing" });
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const place = (): { path: string; taken: boolean } | null => {
      let dir: string; try { dir = path(folder.value, true); } catch { return null; }
      const wanted = freePath(dir, noteName(conversion.title), () => false); return { path: wanted, taken: conversion.exists(wanted) };
    };
    const paint = () => {
      const spot = place(); clashLabel.toggle(spot?.taken === true); clash.toggle(spot?.taken === true);
      if (!spot) note.setText("Use a relative vault folder without reserved characters.");
      else if (!spot.taken) note.setText(`Creates “${spot.path}”.`);
      else if (clash.value === "existing") note.setText(`Links to the existing “${spot.path}”; nothing new is created.`);
      else note.setText(`Creates “${freePath(spot.path.replace(/\/?[^/]*$/, ""), noteName(conversion.title), conversion.exists)}”.`);
      note.toggleClass("organized-session-problem", !spot);
    };
    for (const field of [folder, clash]) { field.addEventListener("input", paint); field.addEventListener("change", paint); } paint();
    new Setting(this.contentEl).addButton(b => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(b => b.setButtonText("Create note").setCta().onClick(() => {
        const spot = place(); if (!spot) { paint(); return; }
        this.close(); void conversion.convert({ folder: folder.value.trim(), tags: cleanTags(tags.value), template: template.value || null, clash: spot.taken && clash.value === "existing" ? "existing" : "new" }).catch(report);
      }));
    folder.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Writes `text` into `parent`; `like this` is shown as code. */
function codeText(parent: HTMLElement, text: string): void {
  text.split("`").forEach((part, i) => { if (i % 2) parent.createEl("code", { text: part }); else parent.appendText(part); });
}

/** The one-time onboarding card: a short stepper explaining the idea behind the plugin. `done` fires once, however it closes. */
export class OnboardingModal extends Modal {
  private index = 0;
  private settled = false;
  constructor(app: App, readonly done: () => void, readonly steps: OnboardingStep[] = ONBOARDING_STEPS) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText("Welcome to Organized"); this.contentEl.addClass("organized-modal");
    // Arrow keys step through the card; the buttons below do the same for touch.
    this.contentEl.addEventListener("keydown", event => { if (event.key === "ArrowRight") this.go(1); else if (event.key === "ArrowLeft") this.go(-1); });
    this.draw();
  }
  private go(delta: number): void { const next = this.index + delta; if (next < 0 || next >= this.steps.length) return; this.index = next; this.draw(); }
  private draw(): void {
    const step = this.steps[this.index]; const last = this.index === this.steps.length - 1; const el = this.contentEl;
    el.empty(); el.addClass("organized-onboarding");
    // The steps scroll inside their own area; the buttons stay in view on a short phone screen.
    const body = el.createDiv({ cls: "organized-welcome-body" });
    const progress = body.createDiv({ cls: "organized-welcome-progress", attr: { role: "img", "aria-label": `Step ${this.index + 1} of ${this.steps.length}` } });
    this.steps.forEach((_, i) => progress.createSpan({ cls: "organized-welcome-dot", attr: i === this.index ? { "aria-current": "step" } : {} }));
    body.createEl("h3", { cls: "organized-welcome-title", text: step.title });
    codeText(body.createEl("p", { cls: "organized-modal-copy organized-welcome-text" }), step.text);
    if (step.figure) renderFigure(body, step.figure);
    if (step.shot) renderShot(body, step.shot);
    const footer = new Setting(el);
    if (!last) footer.addButton(b => b.setButtonText("Skip").onClick(() => this.close()));
    if (this.index > 0) footer.addButton(b => b.setButtonText("Back").onClick(() => this.go(-1)));
    const primary: HTMLElement[] = [];
    footer.addButton(b => { b.setButtonText(last ? "Get started" : "Next"); b.setCta(); primary.push(b.buttonEl); b.onClick(() => { if (last) this.close(); else this.go(1); }); });
    primary[0].focus();
  }
  onClose(): void { this.contentEl.empty(); if (!this.settled) { this.settled = true; this.done(); } }
}

/** What changed in an update: one section per release (oldest first when several were skipped). `stop` fires for "Don't show again". */
export class WhatsNewModal extends Modal {
  constructor(app: App, readonly notes: ReleaseNote[], readonly stop: () => void) { super(app); decorate(this); }
  onOpen(): void {
    const el = this.contentEl; el.addClass("organized-modal"); el.addClass("organized-onboarding"); this.titleEl.setText("What's new in Organized");
    // Scrolls inside its own area, so the buttons stay in view on a short phone screen.
    const body = el.createDiv({ cls: "organized-welcome-body" });
    if (this.notes.length > 1) body.createEl("p", { cls: "organized-modal-copy", text: `You are catching up on ${this.notes.length} updates: ${this.notes.map(n => n.version).join(", then ")}.` });
    for (const note of this.notes) {
      body.createEl("h3", { cls: "organized-welcome-title", text: note.title });
      if (note.intro) body.createEl("p", { cls: "organized-modal-copy", text: note.intro });
      for (const item of note.items) {
        body.createEl("h4", { cls: "organized-whatsnew-item", text: item.title });
        codeText(body.createEl("p", { cls: "organized-modal-copy organized-welcome-text" }), item.text);
        if (item.figure) renderFigure(body, item.figure);
        if (item.shot) renderShot(body, item.shot);
      }
    }
    const footer = new Setting(el);
    footer.addButton(b => b.setButtonText("Don't show again").onClick(() => { this.stop(); this.close(); }));
    footer.addButton(b => { b.setButtonText("Got it"); b.setCta(); b.onClick(() => this.close()); b.buttonEl.focus(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

const CHOICES: Record<string, [string, string][]> = {
  which: [["closed", "Only completed or canceled tasks older than…"], ["all", "All tasks"]],
  lines: [["plain", "Plain todo (title only)"], ["link", "Link to the task note"]],
  keep: [["title", "Nothing"], ["description", "The description"], ["all", "Description, sources and time worked"]],
  notes: [["keep", "Keep where they are"], ["rename", "Rename to the todo title"], ["trash", "Move to Obsidian's trash"]],
  yaml: [["keep", "Keep all properties"], ["strip", "Remove Organized's properties (keep title and text)"]],
};
/**
 * The Retire window: how to leave Organized, or clean up finished tasks, in one pass. Every option is a plain choice; combinations that
 * cannot work are switched for you (removing properties needs the title as the file name, a trashed note cannot be linked to) and the
 * line at the bottom says what will happen before anything does.
 */
export class RetireModal extends Modal {
  constructor(app: App, readonly defaults: RetireOptions, readonly inspect: () => Promise<RetireScan>, readonly run: (options: RetireOptions) => Promise<void>) { super(app); decorate(this); }
  onOpen(): void {
    const el = this.contentEl; this.titleEl.setText("Retire tasks"); el.addClass("organized-modal");
    el.createEl("p", { cls: "organized-modal-copy", text: "Turn Organized's tasks back into ordinary Markdown. Nothing is deleted unless you choose the trash, and the old text is saved in the plugin folder first. Run this on one device and let sync settle." });
    const fields: Record<string, HTMLSelectElement> = {}; const labels: Record<string, HTMLElement> = {};
    const add = (key: Exclude<keyof RetireOptions, "olderThanDays">, label: string): void => {
      labels[key] = el.createEl("label", { cls: "organized-modal-label", text: label });
      const select = el.createEl("select", { attr: { "aria-label": label } }); for (const [value, text] of CHOICES[key]) select.createEl("option", { text, value });
      select.value = String(this.defaults[key]); fields[key] = select;
    };
    add("which", "Which tasks");
    labels.days = el.createEl("label", { cls: "organized-modal-label", text: "Older than (days)" });
    const days = el.createEl("input", { type: "number", attr: { "aria-label": "Older than (days)", min: "0", step: "1" } }); days.value = String(this.defaults.olderThanDays);
    add("lines", "Todos in your notes become"); add("notes", "Task notes"); add("yaml", "Properties of task notes"); add("keep", "Kept under the todo");
    const status = el.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    let scan: RetireScan | null = null; let go: HTMLButtonElement | null = null;
    const read = (): RetireOptions => normalizeRetire({ which: fields.which.value as RetireOptions["which"], olderThanDays: Number(days.value), lines: fields.lines.value as RetireOptions["lines"], keep: fields.keep.value as RetireOptions["keep"], notes: fields.notes.value as RetireOptions["notes"], yaml: fields.yaml.value as RetireOptions["yaml"] });
    const paint = (): void => {
      const o = read(); fields.notes.value = o.notes; fields.yaml.value = o.yaml; fields.lines.value = o.lines;
      days.toggle(o.which === "closed"); labels.days.toggle(o.which === "closed"); fields.keep.toggle(losesNote(o)); labels.keep.toggle(losesNote(o));
      // A trashed note cannot be stripped or linked to; removing properties needs the rename.
      for (const option of Array.from(fields.yaml.options)) option.disabled = o.notes === "trash" && option.value === "strip";
      for (const option of Array.from(fields.lines.options)) option.disabled = o.notes === "trash" && option.value === "link";
      for (const option of Array.from(fields.notes.options)) option.disabled = o.yaml === "strip" && option.value !== "rename";
      if (!scan) { status.setText("Reading your notes…"); return; }
      const preview = retirePreview(scan, o, Date.now());
      status.setText(`${describePreview(preview)}${o.yaml === "strip" ? " Status, dates and tracked time are lost unless you keep them under the todo." : ""}`); go?.toggleAttribute("disabled", !preview.tasks);
    };
    for (const field of [...Object.values(fields), days]) { field.addEventListener("change", paint); field.addEventListener("input", paint); }
    new Setting(el).addButton(b => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(b => { b.setButtonText("Retire").setCta(); go = b.buttonEl; b.buttonEl.setAttribute("disabled", "true"); b.onClick(() => { const o = read(); this.close(); void this.run(o).catch(report); }); });
    paint();
    void this.inspect().then(found => { scan = found; paint(); }).catch(error => { status.setText(`Could not read your notes: ${error instanceof Error ? error.message : String(error)}`); status.addClass("organized-session-problem"); });
  }
  onClose(): void { this.contentEl.empty(); }
}
