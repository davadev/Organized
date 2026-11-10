import { App, Component, Modal, Setting, SuggestModal } from "obsidian";
import { MAX_BUDGET_SECONDS, path, PRIORITIES, Priority, Task, validDate, WorkSession } from "./model";
import { isoFromInput, kindOf, lengthOf, localInput, SessionKind, sessionProblem } from "./sessions";
import { cleanTags } from "./notes";
import { freePath, noteName } from "./names";
import { report } from "./service";
import { rgbOf } from "./colors";
import { formatRule, presetRules, Rule, ruleLabel, Unit } from "./recurrence";
import { BUDGET_KEYS, BudgetPeriod, budgetHours, MAX_BUDGET_HOURS, projectName, ProjectBudgets } from "./repository";
import { renderMarkdownLinks } from "./markdown";
import { ONBOARDING_STEPS, OnboardingStep } from "./onboarding";
import type { ReleaseNote } from "./whatsNew/releaseNotes";
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
      el.createDiv({ cls: "organized-suggestion-meta", text: `${value.status.replace(/_/g, " ")} · ${value.priority}${value.scheduled ? ` · ${value.scheduled}` : ""}` });
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
  constructor(app: App, readonly today: string, readonly current: Rule | null, readonly choose: (rule: Rule | null) => Promise<void>, readonly cancelled?: () => void) { super(app); decorate(this); }
  private done(rule: Rule | null): void { this.picked = true; this.close(); void this.choose(rule).catch(report); }
  onOpen(): void {
    this.titleEl.setText("Repeat"); this.contentEl.addClass("organized-modal");
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
  onClose(): void { this.contentEl.empty(); queueMicrotask(() => { if (!this.picked) this.cancelled?.(); }); }
}
export class DatePicker extends Modal {
  /** `clear`, when given, adds a button that removes the date again. */
  constructor(app: App, readonly initial: string, readonly choose: (date: string) => Promise<void>, readonly clear?: () => Promise<void>) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText("Schedule task"); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Scheduled date" });
    const input = this.contentEl.createEl("input", { type: "date", attr: { "aria-label": "Scheduled date" } }); input.value = this.initial;
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Schedule").setCta().onClick(() => {
      if (!validDate(input.value)) { input.setCustomValidity("Choose a valid date."); input.reportValidity(); return; }
      this.close(); void this.choose(input.value).catch(report);
    }));
    if (this.clear) { const clear = this.clear; actions.addButton(b => b.setButtonText("Clear date").onClick(() => { this.close(); void clear().catch(report); })); }
  }
  onClose(): void { this.contentEl.empty(); }
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
          const at = boxes().indexOf(input);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (boxes()[at + (event.key === "ArrowDown" ? 1 : -1)] ?? (event.key === "ArrowUp" ? search : input)).focus(); }
          else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); toggle(!input.checked); }
        });
      }
    };
    const saveLinks = () => { this.close(); void this.save([...this.selected]).catch(report); };
    search.addEventListener("input", paint); paint();
    search.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); boxes()[0]?.focus(); }
      else if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) { saveLinks(); return; }
        // Enter picks the best match, so a name can be typed and chosen without the mouse.
        const first = boxes()[0]; if (first) { first.click(); search.value = ""; paint(); }
      }
    });
    new Setting(this.contentEl).addButton(b => b.setButtonText("Save links").setCta().onClick(saveLinks));
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
        budgets[period] = Math.round(hours * 3600);
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
