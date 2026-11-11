import { Component, ItemView, Platform, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import { moment } from "./moment";
import { rgbOf, softTint } from "./colors";
import type Organized from "./main";
import { elapsed, FOLDABLE_CARDS, localDate, PRIORITIES, Section, STATUS_ICONS, STATUSES, statusOfMarker, Task, WorkSession } from "./model";
import { byPriority, report } from "./service";
import { cells, HeatScale, MAX_CELLS, scaleFor, slider } from "./movement";
import { BudgetModal, ChoiceModal, dayLabel, ProjectBudgetModal, SessionModal, spanOf, TaskPicker } from "./modals";
import { timeLabel, unworkedParts } from "./plans";
import { formatMinutes, lengthOf, lengthOfSeconds, seconds, SessionKind } from "./sessions";
import { budgetUse, BudgetUse, PERIOD_LABELS, plannedSeconds, projectUse } from "./planning";
import { descendants, NoteSection, NOTE_SECTIONS, noteSection, parseTasks, TaskLine } from "./codec";
import { BUDGET_KEYS, BudgetPeriod, splitNote } from "./repository";
import { renderMarkdownLinks } from "./markdown";
import { blocksOn, hourRange } from "./timeline";
import { ruleLabel, taskRule } from "./recurrence";
import { MirrorError } from "./device";

const sameHeading = (a: Section, b: Section): boolean => a.level === b.level && a.text === b.text && a.ordinal === b.ordinal;
export const VIEW_TYPE = "organized-inspector";
export type Tab = "Calendar" | "Task" | "Projects" | "Favorites";
export const CALENDAR_MODES = ["Month", "Week", "Day"] as const;
export type CalendarMode = typeof CALENDAR_MODES[number];
const pad = (value: number): string => String(value).padStart(2, "0");
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.floor(minutes % 60))}`;
/** Rows drawn before a long list asks to be expanded. */
const LIST_LIMIT = 50;
/** The span the whole-project budget reads retired time from: every daily note there is. */
const RETIRED_FROM = "1970-01-01"; const RETIRED_TO = "2999-12-31";
export class OrganizedInspectorView extends ItemView {
  tab: Tab = "Calendar";
  calendarMode: CalendarMode = "Month";
  month = moment().startOf("month");
  selectedDate = localDate();
  selectedProject = "";
  origin = "Editor cursor";
  module = "";
  editingModule = "";
  editingTitle = false;
  referencesOpen = false;
  private renderId = 0;
  private placed = "";
  private sessionsOpen = false;
  private plannedOpen = false;
  /** A slim bar of tracked and planned time against the task's budget, with one line of words under it (the colour is never the only signal). Nothing is drawn without a budget. */
  private budgetBar(host: HTMLElement, use: BudgetUse, label = "Time budget", totals = true): void {
    if (label !== "Time budget") host.createDiv({ cls: "organized-budget-label", text: label });
    const minutes = (value: number) => formatMinutes(Math.floor(value / 60));
    const bar = host.createDiv({ cls: "organized-budget-bar", attr: { role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(use.budget), "aria-valuenow": String(use.tracked + use.planned) } });
    for (const [cls, pct] of [["tracked", use.trackedPct], ["planned", use.plannedPct], ["over", use.overPct]] as const) if (pct > 0) bar.createDiv({ cls: `organized-budget-${cls}` }).setCssProps({ "--organized-share": `${pct}%` });
    const parts = [...(totals ? [`${minutes(use.tracked)} tracked`, ...(use.planned ? [`${minutes(use.planned)} planned`] : [])] : []), use.left < 0 ? `${minutes(-use.left)} over budget` : `${minutes(use.left)} left of ${minutes(use.budget)}`];
    host.createDiv({ cls: use.left < 0 ? "organized-budget-text organized-budget-over-text" : "organized-budget-text", text: parts.join(" · ") });
  }
  private budgeted(project: string): boolean { return Object.values(this.owner.repo.projectBudgets(project)).some(seconds => seconds !== null); }
  private hasProjectBudget(task: Task): boolean { return task.projects.some(project => this.budgeted(project)); }
  /** One bar per budget set on the task's projects, each counting the time of every task in that project over the day, week, month or the whole project. */
  private async projectBars(host: HTMLElement, projects: string[]): Promise<void> {
    const budgeted = projects.filter(project => this.budgeted(project)); if (!budgeted.length) return;
    // Time kept under retired todos (see retention.ts) still counts toward the project it was worked for.
    const tasks = this.withDoneToday([...await this.owner.repo.list(true), ...(await this.owner.service.retiredWork(RETIRED_FROM, RETIRED_TO)).map(item => item.task)]); const now = Date.now();
    for (const project of budgeted) {
      const budgets = this.owner.repo.projectBudgets(project);
      for (const period of Object.keys(BUDGET_KEYS) as BudgetPeriod[]) { const budget = budgets[period]; if (budget !== null) this.budgetBar(host, projectUse(tasks, project, period, budget, now), `${this.projectLabel(project)} · ${PERIOD_LABELS[period]}`); }
    }
  }
  private expandedLists = new Set<string>();
  private scrolledModule = "";
  private doneToday = new Set<string>();
  /** Recurring tasks whose todo today is done or canceled: today's planned time is over for them (see `withDoneToday`). */
  private endedToday = new Set<string>();
  private markdown = this.addChild(new Component());
  constructor(leaf: WorkspaceLeaf, readonly owner: Organized) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Organized"; }
  getIcon(): string { return "calendar-check"; }
  onOpen(): Promise<void> {
    // On a phone the panel is a drawer over the note, so a keyboard the note left up only hides the panel.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.dismissKeyboard()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.dismissKeyboard()));
    this.contentEl.addEventListener("pointerdown", () => this.dismissKeyboard(), { capture: true });
    this.dismissKeyboard(); return this.render();
  }
  /** Puts away the note's keyboard while the panel is showing on a phone; an input in a dialog or in the panel itself is left alone. */
  dismissKeyboard(): void {
    const doc = this.contentEl.doc; if (!doc.body.hasClass("is-phone") || !this.contentEl.isShown()) return;
    const active = doc.activeElement; if (active instanceof HTMLElement && active.closest(".cm-editor") && !this.contentEl.contains(active)) active.blur();
  }
  onClose(): Promise<void> { this.renderId++; this.removeChild(this.markdown); this.contentEl.empty(); return Promise.resolve(); }
  async render(): Promise<void> {
    const host = this.contentEl;
    // A task refresh must never destroy an input the user is editing. It also must not bump the generation, or a render already in flight would abandon its own DOM.
    if (host.contains(host.doc.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(host.doc.activeElement!.tagName)) return;
    const generation = ++this.renderId;
    this.removeChild(this.markdown);
    this.markdown = this.addChild(new Component());
    host.empty(); host.addClass("organized-view");
    const tabs = host.createDiv({ cls: "organized-tabs", attr: { role: "tablist", "aria-label": "Organized panels" } });
    for (const [tab, icon] of [["Calendar", "calendar"], ["Task", "list-checks"], ["Projects", "folder"], ["Favorites", "star"]] as const) {
      const b = tabs.createEl("button", { cls: "organized-tab", attr: { type: "button", role: "tab", "aria-selected": String(this.tab === tab), "aria-label": tab, title: tab } });
      setIcon(b, icon);
      b.addEventListener("click", () => { this.tab = tab; this.module = ""; this.editingModule = ""; this.editingTitle = false; void this.render().catch(report); });
    }
    const panel = host.createDiv({ cls: "organized-panel", attr: { role: "tabpanel" } });
    if (this.tab === "Calendar") await this.calendar(panel, generation);
    else if (this.tab === "Task") await this.task(panel, generation);
    else if (this.tab === "Projects") await this.projects(panel, generation);
    else await this.favorites(panel, generation);
    // Switching tab or task starts at the top: the panel keeps its scroll offset across renders, so a long Day view left the new page scrolled past its tab bar.
    const place = this.tab === "Task" ? `Task:${this.owner.selectedTaskId}` : this.tab;
    if (generation === this.renderId && place !== this.placed) { this.placed = place; host.scrollTop = 0; }
  }
  button(host: HTMLElement, label: string, action: () => Promise<unknown> | void): HTMLButtonElement {
    const b = host.createEl("button", { cls: "organized-button", text: label, attr: { type: "button" } }); b.addEventListener("click", () => { try { const result = action(); if (result) void result.catch(report); } catch (error) { report(error); } }); return b;
  }
  iconButton(host: HTMLElement, label: string, icon: string, action: () => Promise<unknown> | void): HTMLButtonElement {
    const button = this.button(host, "", action); button.addClass("organized-icon-button"); button.setAttribute("aria-label", label); button.title = label; setIcon(button, icon); return button;
  }
  select(host: HTMLElement, label: string, value: string, options: readonly string[], change: (value: string) => void): HTMLSelectElement {
    const select = host.createEl("select", { cls: "organized-control", attr: { "aria-label": label } });
    for (const option of options) select.createEl("option", { value: option, text: option.replace(/_/g, " ") }); select.value = value;
    select.addEventListener("change", () => { select.blur(); change(select.value); }); return select;
  }
  /**
   * A titled card. Description, Subtasks and Timer fold: their header is a button with a chevron, the content sits in a body that is hidden when folded (the choice is remembered for every task), and `summary` stays readable under the header (always, or only while folded). The content host is returned either way; `actions` adds controls to the header row, next to the fold button.
   */
  card(host: HTMLElement, title: string, icon: string, options: { summary?: string; always?: boolean; actions?: (head: HTMLElement) => void } = {}): HTMLElement {
    const card = host.createDiv({ cls: "organized-card" }); const head = card.createDiv({ cls: "organized-card-head" });
    if (this.module === title) card.addClass("organized-selected-module");
    if (!FOLDABLE_CARDS.includes(title)) {
      setIcon(head.createSpan({ cls: "organized-card-icon", attr: { "aria-hidden": "true" } }), icon); head.createEl("h4", { cls: "organized-card-title", text: title });
      return card;
    }
    const folded = this.owner.settings.collapsedTaskSections.includes(title) && this.module !== title && this.editingModule !== title;
    const fold = head.createEl("button", { cls: "organized-button organized-card-fold", attr: { type: "button", "aria-expanded": String(!folded), "aria-label": `${folded ? "Expand" : "Collapse"} ${title}` } });
    setIcon(fold.createSpan({ cls: "organized-heading-chevron", attr: { "aria-hidden": "true" } }), folded ? "chevron-right" : "chevron-down");
    setIcon(fold.createSpan({ cls: "organized-card-icon", attr: { "aria-hidden": "true" } }), icon); fold.createSpan({ cls: "organized-card-title", text: title });
    fold.addEventListener("click", () => { if (this.editingModule === title) return; if (this.module === title) this.module = ""; this.owner.setTaskSectionCollapsed(title, !folded); void this.render().catch(report); });
    options.actions?.(head);
    if (options.summary && (options.always || folded)) card.createDiv({ cls: "organized-card-summary", text: options.summary });
    if (folded) card.setAttribute("data-collapsed", "true");
    return card.createDiv({ cls: "organized-card-body" });
  }
  section(host: HTMLElement, title: string, count: number, fold?: { collapsed: boolean; toggle: () => void }): HTMLElement {
    const section = host.createDiv({ cls: "organized-section" });
    if (!fold) {
      const head = section.createDiv({ cls: "organized-section-head" });
      head.createEl("h3", { cls: "organized-section-title", text: title }); head.createSpan({ cls: "organized-count", text: String(count) });
      return section;
    }
    // A heading cannot sit inside a button, so a foldable head is one button with a styled title.
    const head = section.createEl("button", { cls: "organized-section-head organized-section-fold", attr: { type: "button", "aria-expanded": String(!fold.collapsed) } });
    setIcon(head.createSpan({ cls: "organized-heading-chevron", attr: { "aria-hidden": "true" } }), fold.collapsed ? "chevron-right" : "chevron-down");
    head.createSpan({ cls: "organized-section-title", text: title }); head.createSpan({ cls: "organized-count", text: String(count) });
    head.addEventListener("click", fold.toggle);
    return section;
  }
  /** Recurring tasks stay open in frontmatter, so today's ticked occurrence is what shows them as done. */
  private async loadDoneToday(): Promise<void> {
    const note = this.owner.repo.file(this.owner.service.daily.path(localDate()));
    const lines = note ? parseTasks(await this.owner.repo.readText(note)).filter(t => t.id) : [];
    this.doneToday = new Set(lines.filter(t => t.marker.toLowerCase() === "x").map(t => t.id!)); this.endedToday = new Set(lines.filter(t => t.marker.toLowerCase() === "x" || t.marker === "-").map(t => t.id!));
  }
  /** Today's occurrence of a recurring task, so changing status from the inspector targets only today. */
  /** The todo line a change from the panel should write to: the one the cursor is on when it is this task's, else today's occurrence of a recurring task. Another task's line is never used. */
  private async contextFor(task: Task): Promise<{ file: TFile; line: TaskLine } | undefined> {
    return this.owner.context?.line.id === task.id ? this.owner.context : await this.owner.service.todayContext(task);
  }
  /** A recurring task keeps `status: open` (each day's todo holds that day's state), so the panel shows today's: done when today's todo is ticked, in progress while its timer runs. */
  /** Tasks as planned time sees them: a recurring task done today is done with today's repeating time (the same rule as `applyPlanning`). */
  private withDoneToday(tasks: Task[]): Task[] { const today = localDate(); return tasks.map(t => t.recurring && this.endedToday.has(t.id) ? { ...t, recurrence_skips: [...t.recurrence_skips, today] } : t); }
  private shownStatus(task: Task): Task["status"] { return !task.recurring || task.status !== "open" ? task.status : this.doneToday.has(task.id) ? "completed" : task.time_tracking_started_at ? "in_progress" : "open"; }
  private taskRow(host: HTMLElement, task: Task, action: () => Promise<unknown> | void): HTMLElement {
    const row = host.createDiv({ cls: "organized-list-card", attr: { "data-status": this.shownStatus(task) } }); 
    // A real button cannot contain links; this focusable card keeps both usable.
    const open = row.createDiv({ cls: "organized-list-open", attr: { role: "button", tabindex: "0" } });
    const activate = () => { try { const result = action(); if (result) void result.catch(report); } catch (error) { report(error); } };
    open.addEventListener("click", event => { if (!(event.target as HTMLElement).closest("a")) activate(); });
    open.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key) || (event.target as HTMLElement).closest("a")) return;
      event.preventDefault(); activate();
    });
    const head = open.createDiv({ cls: "organized-list-head" });
    const title = head.createDiv({ cls: "organized-list-title" });
    void renderMarkdownLinks(this.app, task.title, title, this.owner.repo.sourcePath(task.id), this.markdown).catch(report);
    // One small icon per status instead of a word keeps the card compact.
    const shown = this.shownStatus(task); const doneToday = task.recurring && shown === "completed";
    const label = doneToday ? "done · today" : shown.replace(/_/g, " ");
    const status = head.createSpan({ cls: "organized-list-status", attr: { "data-status": shown, role: "img", "aria-label": label, title: label } }); setIcon(status, doneToday ? "calendar-check" : STATUS_ICONS[shown]);
    if (task.priority !== "none" || (task.scheduled && this.owner.settings.showScheduledDate) || task.starred) {
      const meta = open.createDiv({ cls: "organized-list-meta" });
      if (task.priority !== "none") meta.createSpan({ cls: `organized-list-priority priority-${task.priority}`, text: task.priority });
      if (task.scheduled && this.owner.settings.showScheduledDate) meta.createSpan({ cls: "organized-list-date", text: `${task.scheduled}${task.scheduled_dates.length > 1 ? ` +${task.scheduled_dates.length - 1}` : ""}` });
      if (task.starred) { const star = meta.createSpan({ cls: "organized-list-star", attr: { "aria-label": "Favorite" } }); setIcon(star, "star"); }
    }
    if (task.projects.length) {
      const chips = open.createDiv({ cls: "organized-chips" });
      for (const project of task.projects.slice(0, 2)) this.projectChip(chips, project);
      if (task.projects.length > 2) chips.createSpan({ cls: "organized-chip", text: `+${task.projects.length - 2}` });
    }
    return row;
  }
  private async moduleCard(host: HTMLElement, filePath: string, id: string, section: NoteSection, text: string): Promise<void> {
    const box = this.card(host, section, "file-text", { summary: text.split("\n").map(line => line.trim()).find(line => line) ?? "Empty" });
    if (this.editingModule === section) { this.inlineEditor(box, id, section, text); return; }
    if (text) await renderMarkdownLinks(this.app, text, box.createDiv({ cls: "organized-task-notes" }), filePath, this.markdown);
    // Only Description renders without text; other empty sections stay hidden.
    const open = () => { this.editingModule = section; this.module = section; return this.render(); };
    if (text) { this.button(box, `Edit ${section.toLowerCase()}`, open); return; }
    const add = this.button(box, `Add ${section.toLowerCase()}…`, open); add.addClass("organized-add-module"); add.setAttribute("aria-label", `Add ${section.toLowerCase()}`); add.title = "Add context, details or links. Link a note with double square brackets.";
  }
  /** Moves the editor cursor off every task line, which is what switches the Task tab back to the note overview. */
  private async showNoteTasks(): Promise<void> {
    const source = this.owner.taskSourceEditor();
    if (source) {
      const text = source.editor.getValue(); const taskLines = new Set(parseTasks(text).map(t => t.line)); const lines = text.split("\n");
      const cursor = source.editor.getCursor().line; const free = (line: number) => !taskLines.has(line);
      const above = Array.from({ length: cursor + 1 }, (_, i) => cursor - i).filter(free);
      const target = above.find(line => /^ {0,3}#{1,6}(?:\s|$)/.test(lines[line])) ?? above[0] ?? Array.from({ length: lines.length - cursor }, (_, i) => cursor + i).find(free);
      if (target !== undefined) source.editor.setCursor({ line: target, ch: 0 });
    }
    this.owner.context = null; this.owner.selectedTaskId = null;
    this.module = ""; this.editingModule = ""; this.editingTitle = false;
    await this.render();
  }
  private async focusNoteTask(editor: Editor, file: TFile, line: TaskLine, selectedId: string | null): Promise<void> {
    const resolved = await this.owner.service.resolve({ file, line });
    editor.focus(); editor.setCursor({ line: resolved.line.line, ch: Math.max(0, resolved.line.raw.indexOf("] ") + 2) });
    this.owner.context = { file, line: resolved.line }; this.owner.selectedTaskId = selectedId && resolved.line.id === selectedId ? selectedId : null;
    this.origin = "Editor cursor"; this.module = ""; this.editingModule = ""; this.editingTitle = false;
    await this.render();
  }
  private noteTaskRow(host: HTMLElement, file: TFile, editor: Editor, line: TaskLine, label: string): HTMLElement {
    const row = host.createDiv({ cls: "organized-list-card" });
    const open = row.createDiv({ cls: "organized-list-open", attr: { role: "button", tabindex: "0" } });
    const focus = () => this.focusNoteTask(editor, file, line, null);
    open.addEventListener("click", event => { if (!(event.target as HTMLElement).closest("a")) void focus().catch(report); });
    open.addEventListener("keydown", event => { if (!["Enter", " "].includes(event.key) || (event.target as HTMLElement).closest("a")) return; event.preventDefault(); void focus().catch(report); });
    const title = open.createDiv({ cls: "organized-list-title" });
    void renderMarkdownLinks(this.app, line.title || "Untitled todo", title, file.path, this.markdown).catch(report);
    open.createDiv({ cls: "organized-list-meta", text: label });
    const actions = row.createDiv({ cls: "organized-list-actions" });
    this.button(actions, line.id ? "Repair/create task" : "Attach/create task", async () => {
      await this.focusNoteTask(editor, file, line, null);
      await this.owner.pickTask(editor, file);
    });
    return row;
  }
  private async noteTasks(host: HTMLElement, generation: number): Promise<void> {
    const source = this.owner.taskSourceEditor();
    if (!source) { host.createEl("p", { text: "Open a Markdown note to browse its tasks here." }); return; }
    const lines = await this.owner.taskLines(source.file); await this.loadDoneToday();
    // Read every linked task first: whether a line is done decides what is listed, and the headings' counts must match.
    const tasks = new Map<string, Task | null>(await Promise.all(lines.filter(line => line.id).map(async line => [line.id!, await this.owner.repo.read(line.id!).catch(() => null)] as const)));
    if (generation !== this.renderId) return;
    const hideDone = this.owner.settings.hideDoneTasks;
    // Done, scheduled (`<`) and forwarded (`>`) lines are finished business for this note; hiding them keeps the list to what is still to do.
    const isDone = (line: TaskLine) => { if (line.marker === "<" || line.marker === ">") return true; const task = line.id ? tasks.get(line.id) : null; return task ? this.shownStatus(task) === "completed" : line.marker.toLowerCase() === "x"; };
    // A finished todo stays while something nested under it is still to do, so the nesting never loses its parent.
    const visible = hideDone ? lines.filter(line => !isDone(line) || descendants(lines, line.line).some(child => !isDone(child))) : lines; const doneHidden = lines.length - visible.length;
    const nesting = (line: TaskLine) => { let levels = 0; for (let up = line.parent; up !== null; up = lines.find(l => l.line === up)?.parent ?? null) levels++; return levels; };
    const name = source.file.path.split("/").at(-1)!.replace(/\.md$/i, "");
    const list = this.section(host, name, visible.length); list.addClass("organized-grouped");
    const head = list.querySelector<HTMLElement>(".organized-section-head")!;
    const toggle = this.iconButton(head, hideDone ? "Show done and moved tasks" : "Hide done and moved tasks", hideDone ? "eye-off" : "eye", () => { this.owner.setHideDoneTasks(!hideDone); return this.render(); });
    toggle.setAttribute("aria-pressed", String(hideDone)); toggle.addClass("organized-hide-done"); head.insertBefore(toggle, head.querySelector(".organized-count"));
    if (!lines.length) { list.createDiv({ cls: "organized-empty", text: "No tasks in this note yet." }); return; }
    let shown: Section[] = []; let hidden = 0;
    for (const line of visible) {
      // Emit headings this line enters; a collapsed ancestor hides everything beneath it.
      let common = 0; while (common < shown.length && common < line.section.length && sameHeading(shown[common], line.section[common])) common++;
      if (common < hidden) hidden = 0;
      for (let depth = common; depth < line.section.length; depth++) {
        if (hidden) break;
        const key = JSON.stringify(line.section.slice(0, depth + 1));
        const collapsed = this.owner.settings.collapsedHeadings[source.file.path]?.includes(key) === true;
        this.headingRow(list, source.file.path, line.section[depth], depth, key, collapsed, visible.filter(l => JSON.stringify(l.section.slice(0, depth + 1)) === key).length);
        if (collapsed) hidden = depth + 1;
      }
      shown = line.section;
      if (hidden) continue;
      // Tasks sit one level inside the heading that owns them.
      const indent = (row: HTMLElement) => { row.addClass("organized-indented"); row.setCssProps({ "--organized-depth": String(line.section.length + nesting(line)) }); };
      const task = line.id ? tasks.get(line.id) : null;
      if (task) indent(this.taskRow(list, task, () => this.focusNoteTask(source.editor, source.file, line, task.id)));
      else indent(this.noteTaskRow(list, source.file, source.editor, line, line.id ? "Linked task unavailable" : "Regular todo"));
    }
    if (doneHidden) list.createDiv({ cls: "organized-empty", text: `${doneHidden} done or moved task${doneHidden === 1 ? "" : "s"} hidden.` });
  }
  /** Paints an element with the colour of the task's project; without a coloured project it stays gray (blocks) or neutral (cards). */
  private tint(el: HTMLElement, task: Task): void {
    const color = this.owner.repo.taskColor(task); if (!color) return;
    el.setAttribute("data-project", ""); el.setCssProps({ "--organized-project-rgb": softTint(color) });
  }
  /** One colour picker per project, folded away by default; the colour lives in the project note's frontmatter. */
  private colorPickers(host: HTMLElement, projects: string[]): void {
    const box = host.createEl("details", { cls: "organized-colors" }); box.createEl("summary", { text: "Project colors" });
    for (const project of projects) {
      const row = box.createDiv({ cls: "organized-color-row" }); const current = this.owner.repo.projectColor(project);
      const swatch = row.createEl("label", { cls: "organized-color-swatch" }); swatch.setCssProps({ "--organized-swatch": current ?? "#808080" });
      const input = swatch.createEl("input", { type: "color", cls: "organized-color-input", attr: { "aria-label": `Color of ${this.projectLabel(project)}` } }); input.value = current ?? "#808080";
      input.addEventListener("input", () => swatch.setCssProps({ "--organized-swatch": input.value }));
      row.createSpan({ cls: "organized-color-name", text: this.projectLabel(project) });
      input.addEventListener("change", () => { void this.owner.run(() => this.owner.service.setProjectColor(project, input.value)); });
      if (current) this.button(row, "Clear", () => this.owner.run(() => this.owner.service.setProjectColor(project, null))).addClass("organized-color-clear");
    }
  }
  /** One row per project with its time budgets in words and a button to change them; the budgets live in the project note's frontmatter. */
  private budgetEditors(host: HTMLElement, projects: string[]): void {
    const box = host.createEl("details", { cls: "organized-colors" }); box.createEl("summary", { text: "Project budgets" });
    for (const project of projects) {
      const row = box.createDiv({ cls: "organized-budget-row" }); row.createSpan({ cls: "organized-budget-name", text: this.projectLabel(project) });
      const budgets = this.owner.repo.projectBudgets(project);
      const set = (Object.keys(BUDGET_KEYS) as BudgetPeriod[]).filter(period => budgets[period] !== null);
      this.button(row, set.length ? "Edit budget" : "Set budget", () => new ProjectBudgetModal(this.app, this.projectLabel(project), budgets, next => this.owner.run(() => this.owner.service.setProjectBudgets(project, next))).open()).setAttribute("aria-label", `${set.length ? "Edit" : "Set"} budget of ${this.projectLabel(project)}`);
    }
  }
  /** Priority, schedule, recurrence and linked projects as small icon-led pills in one wrapping row, instead of a titled card each. */
  private propertyStrip(details: HTMLElement, task: Task): void {
    const id = task.id; const showPriority = task.priority !== "none" || this.module === "Priority"; const showSchedule = task.scheduled !== null || this.module === "Schedule";
    const showRecurring = task.recurring || task.recurrence_periods.length > 0 || this.module === "Recurring"; const showProjects = task.projects.length > 0 || this.module === "Projects";
    if (!showPriority && !showSchedule && !showRecurring && !showProjects) return;
    const strip = details.createDiv({ cls: "organized-prop-strip" });
    const pill = (host: HTMLElement, tag: "div" | "span", icon: string, label: string, module: string) => {
      const el = host.createEl(tag, { cls: "organized-prop", attr: { title: label } }); setIcon(el.createSpan({ cls: "organized-prop-icon", attr: { "aria-hidden": "true" } }), icon);
      if (this.module === module) el.addClass("organized-selected-module"); return el;
    };
    const action = (icon: string, label: string, text: string, module: string, run: () => Promise<unknown> | void): HTMLButtonElement => {
      const b = this.button(strip, "", run); b.addClass("organized-prop"); b.setAttribute("aria-label", label); b.title = label; setIcon(b.createSpan({ cls: "organized-prop-icon", attr: { "aria-hidden": "true" } }), icon); b.createSpan({ cls: "organized-prop-text", text });
      if (this.module === module) b.addClass("organized-selected-module"); return b;
    };
    if (showPriority) this.select(pill(strip, "div", "flag", "Priority", "Priority"), "Priority", task.priority, PRIORITIES, value => { void this.owner.run(async () => { await this.owner.service.setPriority(id, value as Task["priority"], this.owner.context?.line.id === id ? this.owner.context : undefined); this.owner.refresh(); }); });
    // The next day, and how many more: the dialog shows them all. The cursor's todo goes along only when it is this task's.
    const more = task.scheduled_dates.length > 1 ? ` +${task.scheduled_dates.length - 1}` : "";
    if (showSchedule) action("calendar", task.scheduled ? `Schedule: ${task.scheduled}${more}` : "Schedule", task.scheduled ? `${task.scheduled}${more}` : "Choose date", "Schedule", () => { void this.owner.pickSchedule(task, this.owner.context?.line.id === id ? this.owner.context : undefined).catch(report); });
    if (showRecurring) {
      const span = task.recurrence_periods.length ? `: ${task.recurrence_periods[0].start} → ${task.recurring ? "active" : task.recurrence_periods[task.recurrence_periods.length - 1].stop}` : "";
      const rule = task.recurring ? ruleLabel(taskRule(task)) : "Off";
      const toggle = action("repeat", "Recurring", rule, "Recurring", () => this.owner.pickRecurrence(task, this.owner.context?.line.id === id ? this.owner.context : undefined));
      toggle.title = `Recurring: ${rule}${span}`;
    }
    if (showProjects) {
      for (const project of task.projects) {
        const name = this.projectLabel(project); const note = this.owner.repo.file(project); const color = this.owner.repo.projectColor(project);
        const chip = note ? this.button(strip, "", () => this.app.workspace.getLeaf(false).openFile(note)) : strip.createSpan();
        chip.addClass("organized-prop", "organized-prop-project"); chip.setAttribute("aria-label", note ? `Open project ${name}` : `Project ${name}`); chip.title = name; chip.createSpan({ cls: "organized-prop-text", text: name });
        if (color) { chip.setAttribute("data-project", ""); chip.setCssProps({ "--organized-chip-bg": rgbOf(color) }); }
      }
      const link = this.iconButton(strip, "Link projects or topics", "plus", () => this.owner.pickProjects(task)); link.addClass("organized-prop");
      if (this.module === "Projects") link.addClass("organized-selected-module");
    }
  }
  /** The project's name as a small label, in the project's colour when it has one. */
  private projectChip(host: HTMLElement, project: string): void {
    const chip = host.createSpan({ cls: "organized-chip", text: this.projectLabel(project) }); const color = this.owner.repo.projectColor(project); if (!color) return;
    chip.setAttribute("data-project", ""); chip.setCssProps({ "--organized-chip-bg": rgbOf(color) });
  }
  /** Project notes in the project folder show by name; others keep their path. */
  private projectLabel(project: string): string {
    const folder = `${this.owner.repo.projectFolder()}/`;
    return (project.startsWith(folder) ? project.slice(folder.length) : project).replace(/\.md$/, "");
  }
  private headingRow(host: HTMLElement, notePath: string, heading: Section, depth: number, key: string, collapsed: boolean, count: number): void {
    const row = host.createEl("button", { cls: "organized-heading-row", attr: { type: "button", "aria-expanded": String(!collapsed) } });
    row.setCssProps({ "--organized-depth": String(depth) });
    setIcon(row.createSpan({ cls: "organized-heading-chevron", attr: { "aria-hidden": "true" } }), collapsed ? "chevron-right" : "chevron-down");
    row.createSpan({ cls: "organized-heading-text", text: heading.text || "Untitled heading" }); row.createSpan({ cls: "organized-count", text: String(count) });
    row.addEventListener("click", () => { this.owner.setHeadingCollapsed(notePath, key, !collapsed); void this.render().catch(report); });
  }
  private inlineEditor(host: HTMLElement, id: string, section: NoteSection, text: string): void {
    const field = host.createEl("textarea", { cls: "organized-inline-editor", attr: { "aria-label": section, placeholder: `Add ${section.toLowerCase()}…` } }); field.value = text;
    // Edits save themselves: shortly after typing stops and again when the field loses focus.
    let saved = text; let timer = 0; let pending: Promise<unknown> = Promise.resolve();
    const save = (): Promise<unknown> => {
      window.clearTimeout(timer); if (field.value === saved) return pending;
      const value = saved = field.value; pending = pending.then(() => this.owner.run(() => this.owner.saveModule(id, section, value))); return pending;
    };
    field.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void save(); }, 800); });
    field.addEventListener("keydown", event => { if (event.key === "Escape") field.blur(); });
    field.addEventListener("blur", () => { this.editingModule = ""; void save().then(() => this.render()).catch(report); });
    field.focus(); field.setSelectionRange(text.length, text.length); field.scrollIntoView({ block: "nearest" });
  }
  async calendar(host: HTMLElement, generation: number): Promise<void> {
    const modes = host.createDiv({ cls: "organized-seg", attr: { role: "group", "aria-label": "Calendar view" } });
    for (const mode of CALENDAR_MODES) {
      const b = modes.createEl("button", { cls: "organized-seg-button", text: mode, attr: { type: "button", "aria-pressed": String(this.calendarMode === mode) } });
      b.addEventListener("click", () => { this.calendarMode = mode; void this.render().catch(report); });
    }
    if (this.calendarMode === "Month") this.monthView(host);
    else if (this.calendarMode === "Week") await this.weekView(host, generation);
    else await this.dayView(host, generation);
  }
  private monthView(host: HTMLElement): void {
    const nav = host.createDiv({ cls: "organized-calendar-nav" });
    this.iconButton(nav, "Previous month", "chevron-left", () => { this.month.subtract(1, "month"); return this.render(); });
    nav.createEl("h3", { text: this.month.format("MMMM YYYY"), attr: { "aria-live": "polite" } });
    this.iconButton(nav, "Next month", "chevron-right", () => { this.month.add(1, "month"); return this.render(); });
    this.button(nav, "Today", () => { this.month = moment().startOf("month"); return this.selectDay(localDate()); }).addClass("organized-today-button");
    const grid = host.createDiv({ cls: "organized-calendar", attr: { role: "group", "aria-label": this.month.format("MMMM YYYY") } });
    const start = this.month.clone().startOf("week"); const later: [string, HTMLButtonElement][] = [];
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "organized-weekday", text: start.clone().add(i, "days").format("dd") });
    for (let i = 0; i < 42; i++) {
      const date = start.clone().add(i, "days"); const key = date.format("YYYY-MM-DD");
      const b = this.button(grid, date.format("D"), () => this.selectDay(key));
      b.addClass("organized-day");
      b.setAttribute("aria-label", date.format("dddd, LL")); b.setAttribute("aria-pressed", String(key === this.selectedDate));
      if (key === localDate()) b.setAttribute("aria-current", "date");
      if (date.month() !== this.month.month()) b.addClass("organized-muted");
      if (this.owner.repo.file(this.owner.service.daily.path(key))) b.addClass("organized-has-note"); else if (key >= localDate()) later.push([key, b]);
      b.addEventListener("keydown", event => {
        const shift = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
        if (shift) { event.preventDefault(); const buttons = grid.querySelectorAll("button"); const index = Math.max(0, Math.min(41, i + shift)); buttons[index].focus(); }
      });
    }
    const stats = host.createDiv({ cls: "organized-stats", text: "Task statistics loading…", attr: { "aria-live": "polite" } });
    void this.owner.repo.list().then(async tasks => {
      const today = this.owner.repo.file(this.owner.service.daily.path(localDate()));
      const completed = today ? (await this.owner.taskLines(today)).filter(t => t.marker.toLowerCase() === "x").length : 0;
      stats.empty();
      // A later day without its note yet is marked too when tasks are scheduled for it.
      for (const [key, b] of later) { const due = this.dueOn(tasks, key).length; if (due) { b.addClass("organized-has-note"); b.setAttribute("aria-label", `${b.getAttribute("aria-label")!}, ${due} scheduled`); } }
      for (const [value, label] of [[tasks.filter(t => ["open", "in_progress"].includes(t.status)).length, "Active"], [completed, "Done today"], [tasks.filter(t => t.time_tracking_started_at).length, "Timers"]]) {
        const stat = stats.createDiv({ cls: "organized-stat" }); stat.createEl("strong", { text: String(value) }); stat.createSpan({ text: String(label) });
      }
    }).catch(() => stats.setText("Task statistics unavailable"));
  }
  /** Navigation row shared by the week and day views: previous, title, next and Today. */
  private rangeNav(host: HTMLElement, title: string, previous: string, next: string, step: () => void, back: () => void, follow = false): void {
    const go = async (change: () => void) => { change(); if (follow) await this.openDay(); await this.render(); };
    const nav = host.createDiv({ cls: "organized-calendar-nav" });
    this.iconButton(nav, previous, "chevron-left", () => go(back));
    nav.createEl("h3", { text: title, attr: { "aria-live": "polite" } });
    this.iconButton(nav, next, "chevron-right", () => go(step));
    this.button(nav, "Today", () => go(() => { this.selectedDate = localDate(); })).addClass("organized-today-button");
  }
  /** A task that became a standalone note opens that note; any other opens in the Task tab. */
  private openCalendarTask(task: Task): Promise<void> { return task.converted_to ? this.openNote(task.converted_to) : this.openFromCalendar(task.id); }
  private openFromCalendar(id: string): Promise<void> {
    this.owner.selectedTaskId = id; this.origin = "Calendar"; this.tab = "Task"; this.module = ""; this.editingModule = ""; this.editingTitle = false;
    return this.render();
  }
  private async weekView(host: HTMLElement, generation: number): Promise<void> {
    const start = moment(this.selectedDate, "YYYY-MM-DD").startOf("week"); const end = start.clone().add(6, "days");
    this.rangeNav(host, `${start.format("MMM D")} – ${end.format("MMM D, YYYY")}`, "Previous week", "Next week",
      () => { this.selectedDate = moment(this.selectedDate, "YYYY-MM-DD").add(1, "week").format("YYYY-MM-DD"); },
      () => { this.selectedDate = moment(this.selectedDate, "YYYY-MM-DD").subtract(1, "week").format("YYYY-MM-DD"); });
    const tasks = await this.owner.repo.list(true); const now = Date.now(); await this.loadDoneToday();
    const days = Array.from({ length: 7 }, (_, i) => start.clone().add(i, "days"));
    const retired = (await this.owner.service.retiredWork(days[0].format("YYYY-MM-DD"), days[6].format("YYYY-MM-DD"))).map(item => item.task);
    const blocks = days.map(day => blocksOn(this.withDoneToday([...tasks, ...retired]), day.format("YYYY-MM-DD"), now)); const [from, to] = hourRange(blocks.flat());
    const counts = await Promise.all(days.map(async day => {
      const key = day.format("YYYY-MM-DD"); const note = this.owner.repo.file(this.owner.service.daily.path(key)); const lines = note ? await this.owner.taskLines(note) : [];
      // A later day without its note yet counts the tasks that will go in it, as the day view lists them.
      if (!note && key >= localDate(new Date(now))) return { done: 0, total: this.dueOn(tasks, key).length };
      return { done: lines.filter(line => line.marker.toLowerCase() === "x").length, total: lines.length };
    }));
    if (generation !== this.renderId) return;
    const week = host.createDiv({ cls: "organized-week", attr: { role: "group", "aria-label": `${start.format("LL")} to ${end.format("LL")}` } });
    days.forEach((day, i) => {
      const key = day.format("YYYY-MM-DD"); const { done, total } = counts[i];
      const row = week.createEl("button", { cls: "organized-week-row", attr: { type: "button", "aria-label": `${day.format("dddd, LL")}: ${done} of ${total} tasks done, ${blocks[i].length} tracked blocks` } });
      if (key === localDate()) row.setAttribute("aria-current", "date");
      if (key === this.selectedDate) row.setAttribute("aria-pressed", "true");
      const label = row.createDiv({ cls: "organized-week-label" }); label.createSpan({ cls: "organized-week-weekday", text: day.format("ddd") }); label.createSpan({ cls: "organized-week-date", text: day.format("D") });
      const track = row.createDiv({ cls: "organized-week-track" });
      for (const block of blocks[i]) {
        const left = (block.startMin - from * 60) / ((to - from) * 60) * 100; const width = (block.endMin - block.startMin) / ((to - from) * 60) * 100;
        const part = track.createSpan({ cls: "organized-week-block", attr: { "data-status": this.shownStatus(block.task) } }); this.tint(part, block.task); if (block.planned) part.setAttribute("data-planned", "true");
        part.setCssProps({ "--organized-start": String(left), "--organized-width": String(width) });
      }
      row.createSpan({ cls: "organized-week-count", text: total ? `${done}/${total}` : "–" });
      row.addEventListener("click", () => { this.selectedDate = key; this.calendarMode = "Day"; void this.render().catch(report); });
    });
  }
  /** Every recorded session (or planned block), newest first and grouped by day with the day's total, folded away by default because the list grows quickly. */
  /** The task's days from today on with their times, up to three; each opens the Schedule dialog. */
  private scheduleSummary(host: HTMLElement, task: Task): void {
    const now = Date.now(); const today = localDate(); const dayOf = (b: WorkSession) => localDate(new Date(b.start));
    const days = [...new Set([...task.scheduled_dates, ...task.planned_sessions.filter(b => Date.parse(b.end) > now).map(dayOf)])].filter(day => day >= today).sort();
    const open = () => { void this.owner.pickSchedule(task, this.owner.context?.line.id === task.id ? this.owner.context : undefined).catch(report); };
    const box = host.createDiv({ cls: "organized-schedule-summary", attr: { role: "group", "aria-label": "Schedule" } });
    for (const day of days.slice(0, 3)) {
      const times = task.planned_sessions.filter(b => dayOf(b) === day && Date.parse(b.end) > now).map(b => timeLabel(spanOf(b)));
      this.button(box, `${dayLabel(day, now)} · ${times.length ? times.join(", ") : "Any time"}`, open).addClass("organized-session");
    }
    this.button(box, days.length > 3 ? `${days.length - 3} more days · Schedule…` : days.length ? "Schedule…" : "Planned earlier · Schedule…", open).addClass("organized-session");
  }
  private sessionList(host: HTMLElement, task: Task, kind: SessionKind = "worked"): void {
    const blocks = kind === "planned" ? task.planned_sessions : task.work_sessions;
    const box = host.createEl("details", { cls: "organized-sessions" }); box.open = kind === "planned" ? this.plannedOpen : this.sessionsOpen;
    box.createEl("summary", { text: `${kind === "planned" ? "Planned blocks" : "Sessions"} (${blocks.length})` }); box.addEventListener("toggle", () => { if (kind === "planned") this.plannedOpen = box.open; else this.sessionsOpen = box.open; });
    const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const days = new Map<string, WorkSession[]>();
    for (const session of [...blocks].sort((a, b) => Date.parse(b.start) - Date.parse(a.start))) { const day = localDate(new Date(session.start)); days.set(day, [...(days.get(day) ?? []), session]); }
    for (const [day, sessions] of days) {
      box.createDiv({ cls: "organized-session-day", text: `${day} · ${lengthOfSeconds(sessions.reduce((sum, session) => sum + seconds(session), 0))}` });
      for (const session of sessions) this.button(box, `${clock(new Date(session.start))}–${clock(new Date(session.end))} · ${lengthOf(session)}`, () => this.editSession(task, session, day, kind)).addClass("organized-session-row");
    }
  }
  /** Adds a block of time to a task, or edits/deletes a recorded or planned one. A new block on a later day starts as a plan. */
  private async editSession(task: Task, session: WorkSession | null, date: string, kind: SessionKind | null, startAt?: string): Promise<void> {
    const at = (time: string) => new Date(`${date}T${time}:00`).toISOString();
    const start = session?.start ?? startAt ?? at("09:00"); const end = session?.end ?? (startAt ? new Date(Date.parse(startAt) + 3600000).toISOString() : at("10:00"));
    const type = kind; const service = this.owner.service;
    // Planned time is seen against the budgets it counts toward; the block being changed is replaced, not counted twice.
    const hint = await this.owner.budgetHint(task); const others = task.planned_sessions.filter(b => !(type === "planned" && session && b.start === session.start && b.end === session.end));
    new SessionModal(this.app, {
      budget: block => hint([...others, block]),
      heading: session ? (type === "planned" ? "Edit planned time" : "Edit time worked") : "Add time", taskTitle: task.title, start, end, kind: type,
      save: (next, saved) => this.owner.run(async () => {
        if (!session) await (saved === "planned" ? service.addPlanned(task.id, next) : service.addSession(task.id, next));
        else await (type === "planned" ? service.changePlanned(task.id, session, next) : service.changeSession(task.id, session, next));
      }).then(() => this.owner.planningTick()),
      remove: session ? () => this.owner.run(() => type === "planned" ? service.changePlanned(task.id, session, null) : service.changeSession(task.id, session, null)).then(() => this.owner.planningTick()) : undefined,
      openTask: session ? () => this.openCalendarTask(task) : undefined,
      logWorked: session && type === "planned" && this.loggable(task, session) ? () => this.owner.run(() => service.logPlanned(task.id, session)) : undefined,
    }).open();
  }
  /** A planned block that is over can be logged as worked while part of it was not worked already (a timer that ran in it counts). */
  private loggable(task: Task, session: WorkSession): boolean { return Date.parse(session.end) <= Date.now() && unworkedParts(session, task.work_sessions).length > 0; }
  /** A block of a recurring task's repeating times: change that day alone (the other days keep the times), or the times of every day. */
  private editRepeating(task: Task, session: WorkSession): void {
    // The day the block starts on, also when its morning part after midnight was tapped.
    const service = this.owner.service; const date = localDate(new Date(session.start));
    new ChoiceModal(this.app, "Change planned time", `“${task.title}” is planned at this time every day it repeats. Change only ${date}, or the times of every day?`, [
      { label: "This day", run: () => new SessionModal(this.app, {
        heading: "Edit planned time", taskTitle: task.title, start: session.start, end: session.end, kind: "planned",
        save: next => this.owner.run(() => service.editRepeatingDay(task.id, date, session, next)).then(() => this.owner.planningTick()),
        remove: () => this.owner.run(() => service.editRepeatingDay(task.id, date, session, null)).then(() => this.owner.planningTick()),
        openTask: () => this.openCalendarTask(task),
        logWorked: this.loggable(task, session) ? () => this.owner.run(async () => { await service.editRepeatingDay(task.id, date, session, session); await service.logPlanned(task.id, session); }) : undefined,
      }).open() },
      { label: "Every day", run: () => this.owner.pickRecurrence(task) },
    ]).open();
  }
  /** Picks a task, then asks to plan an hour from `start` (a spot tapped on the day grid). */
  private async planAt(start: string, date: string): Promise<void> {
    const tasks = (await this.owner.repo.list()).filter(t => t.status === "open" || t.status === "in_progress");
    new TaskPicker(this.app, tasks, async choice => { if (typeof choice === "object" && "id" in choice) await this.editSession(choice, null, date, null, start); }, "", false, false).open();
  }
  /** Picks an existing task, then asks for the time to log on it. */
  private async addTime(date: string): Promise<void> {
    const tasks = (await this.owner.repo.list()).filter(t => t.status !== "canceled");
    new TaskPicker(this.app, tasks, async choice => { if (typeof choice === "object" && "id" in choice) await this.editSession(choice, null, date, null); }, "", false, false).open();
  }
  private async openNote(notePath: string): Promise<void> {
    const note = this.owner.repo.file(notePath); if (!note) throw new Error("The note that kept this time was renamed or removed.");
    await this.app.workspace.getLeaf(false).openFile(note);
  }
  /** The tasks a day's note gets when it is made (see `onDailyCreated`). */
  private dueOn(tasks: Task[], date: string): Task[] { return tasks.filter(task => !task.recurring && task.converted_to === null && (task.status === "open" || task.status === "in_progress") && task.scheduled_dates.includes(date)); }
  private plainTaskRow(host: HTMLElement, line: TaskLine, path: string): void {
    const status = statusOfMarker(line.marker);
    const row = host.createDiv({ cls: "organized-list-card organized-day-task", attr: { "data-status": status } });
    const open = row.createDiv({ cls: "organized-list-open" });
    void renderMarkdownLinks(this.app, line.title || "Untitled todo", open.createDiv({ cls: "organized-list-title" }), path, this.markdown).catch(report);
    open.createDiv({ cls: "organized-list-meta", text: status === "completed" ? "Done" : "Regular todo" });
  }
  private async dayView(host: HTMLElement, generation: number): Promise<void> {
    const date = this.selectedDate; const day = moment(date, "YYYY-MM-DD");
    this.rangeNav(host, day.format("ddd, MMM D, YYYY"), "Previous day", "Next day",
      () => { this.selectedDate = day.clone().add(1, "day").format("YYYY-MM-DD"); }, () => { this.selectedDate = day.clone().subtract(1, "day").format("YYYY-MM-DD"); }, true);
    const tasks = await this.owner.repo.list(true); const now = Date.now(); await this.loadDoneToday();
    const retired = new Map((await this.owner.service.retiredWork(date, date)).map(item => [item.task.id, item]));
    const blocks = blocksOn(this.withDoneToday([...tasks, ...[...retired.values()].map(item => item.task)]), date, now);
    const note = this.owner.repo.file(this.owner.service.daily.path(date)); const lines = note ? await this.owner.taskLines(note) : [];
    const linked = new Map(tasks.map(task => [task.id, task]));
    if (generation !== this.renderId) return;
    const collapsed = this.owner.settings.dayTasksCollapsed;
    // A later day's note is made when its day comes; until then the tasks that will go in it (open and in progress, see `onDailyCreated`) are listed from their task notes.
    const due = note || date < localDate(new Date(now)) ? [] : this.dueOn(tasks, date);
    const list = this.section(host, "Tasks", note ? lines.length : due.length, { collapsed, toggle: () => { this.owner.setDayTasksCollapsed(!collapsed); void this.render().catch(report); } }); list.addClass("organized-grouped");
    if (!note) {
      for (const task of collapsed ? [] : due) this.taskRow(list, task, () => this.openFromCalendar(task.id)).addClass("organized-day-task");
      const empty = list.createDiv({ cls: "organized-empty", text: due.length ? "Their todos go in this day's daily note when it is made." : "There is no daily note for this day yet." });
      this.button(empty, "Create daily note", () => this.selectDay(date)).addClass("organized-note-link");
    } else if (!lines.length && !collapsed) list.createDiv({ cls: "organized-empty", text: "No tasks in this day's note." });
    for (const line of collapsed ? [] : lines) {
      const task = line.id ? linked.get(line.id) : undefined;
      if (task) this.taskRow(list, task, () => this.openFromCalendar(task.id)).addClass("organized-day-task");
      else this.plainTaskRow(list, line, note!.path);
    }
    const timeline = this.section(host, "Time", blocks.length);
    const timeHead = timeline.querySelector<HTMLElement>(".organized-section-head")!;
    const addTime = this.iconButton(timeHead, "Add time worked", "plus", () => this.addTime(date)); addTime.addClass("organized-head-action"); timeHead.insertBefore(addTime, timeHead.querySelector(".organized-count"));
    if (!blocks.length) timeline.createDiv({ cls: "organized-empty", text: "No time tracked or planned this day. Set a task In Progress to record it, or tap the grid to plan a block." });
    const [from, to] = hourRange(blocks); const span = (to - from) * 60;
    const grid = timeline.createDiv({ cls: "organized-day-grid" }); grid.setCssProps({ "--organized-hours": String(to - from) });
    // A tap on an empty spot plans an hour there (snapped to a quarter); a tap on a block is that block's own.
    grid.addEventListener("click", event => {
      const box = grid.getBoundingClientRect(); if ((event.target as HTMLElement).closest(".organized-block") || box.height <= 0) return;
      const minute = Math.min(1380, Math.floor((from * 60 + (event.clientY - box.top) / box.height * span) / 15) * 15);
      const [year, month, day] = date.split("-").map(Number); void this.planAt(new Date(year, month - 1, day, 0, minute).toISOString(), date).catch(report);
    });
    for (let hour = from; hour <= to; hour++) {
      const line = grid.createDiv({ cls: "organized-hour-line" }); line.setCssProps({ "--organized-at": String((hour - from) / (to - from) * 100) });
      line.createSpan({ cls: "organized-hour-label", text: `${pad(hour % 24)}:00` });
    }
    for (const block of blocks) {
      const title = block.task.title; const range = `${clock(block.startMin)}–${block.endMin >= 1440 ? "24:00" : clock(block.endMin)}`;
      const part = grid.createEl("button", { cls: "organized-block", attr: { type: "button", "data-status": this.shownStatus(block.task), "aria-label": `${title}, ${range}${block.running ? ", running" : block.planned ? ", planned" : ""}`, title: `${title} · ${range}` } });
      this.tint(part, block.task); if (block.planned) part.setAttribute("data-planned", "true");
      part.setCssProps({ "--organized-top": String((block.startMin - from * 60) / span * 100), "--organized-height": String((block.endMin - block.startMin) / span * 100), "--organized-lane": String(block.lane), "--organized-lanes": String(block.lanes) });
      const shown = this.shownStatus(block.task); setIcon(part.createSpan({ cls: "organized-block-status", attr: { "data-status": shown, "aria-hidden": "true" } }), STATUS_ICONS[shown]);
      part.createSpan({ cls: "organized-block-title", text: title }); if (block.endMin - block.startMin >= 30) part.createSpan({ cls: "organized-block-time", text: range });
      // A retired task has no task note: open the daily note that kept its time instead.
      const kept = retired.get(block.task.id);
      // A stored session opens for editing (with an Open task button); a running timer has nothing to edit yet.
      part.addEventListener("click", () => { if (block.repeating) { this.editRepeating(block.task, block.session!); return; } if (!kept && block.session) { void this.editSession(block.task, block.session, date, block.planned ? "planned" : "worked").catch(report); return; } void (kept ? this.openNote(kept.path) : this.openCalendarTask(block.task)).catch(report); });
    }
    const minutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    if (date === localDate() && minutes >= from * 60 && minutes <= to * 60) { const nowLine = grid.createDiv({ cls: "organized-now-line", attr: { "aria-hidden": "true" } }); nowLine.setCssProps({ "--organized-at": String((minutes - from * 60) / span * 100) }); }
  }
  /** Points the calendar at a day without writing anything; the caller repaints. */
  showDate(date: string): void { this.owner.pendingDay = null; this.selectedDate = date; this.month = moment(date, "YYYY-MM-DD").startOf("month"); }
  /** Opens the day's note when it exists, so the editor shows the day the panel does. A missing note is not created by paging. On a phone opening a note closes the side panel, which would end paging after one day, so the note opens once the panel is closed. */
  private async openDay(): Promise<void> {
    if (Platform.isMobile) { this.owner.pendingDay = this.selectedDate; return; }
    const file = this.owner.repo.file(this.owner.service.daily.path(this.selectedDate));
    if (file && this.app.workspace.getActiveFile()?.path !== file.path) await this.app.workspace.getLeaf(false).openFile(file);
  }
  async selectDay(date: string): Promise<void> {
    this.owner.assertWritable(); this.selectedDate = date;
    // A mirror shows the notes that exist and does not create the day's note, which the main device may already have.
    if (this.owner.role === "mirror" && !this.owner.repo.file(this.owner.service.daily.path(date))) { report(new MirrorError()); await this.render(); return; }
    const file = await this.owner.service.daily.open(date);
    if (this.owner.role === "main") await this.owner.run(() => this.owner.service.reconcile(file));
    await this.render();
  }
  async task(host: HTMLElement, generation: number): Promise<void> {
    const id = this.owner.selectedTaskId;
    if (!id) { await this.noteTasks(host, generation); return; }
    const task = await this.owner.repo.read(id); await this.loadDoneToday();
    if (generation !== this.renderId) return;
    const hero = host.createDiv({ cls: "organized-task-hero", attr: { "data-status": this.shownStatus(task) } });
    // One row: where the task was opened from, then the way back (or the note overview when opened from the editor).
    const eyebrow = hero.createDiv({ cls: "organized-eyebrow" });
    eyebrow.createSpan({ text: this.origin === "Editor cursor" ? "From editor" : this.origin === "Calendar" ? "From calendar" : this.origin === "Favorites" ? "From favorites" : "From projects" });
    if (this.origin === "Editor cursor") this.iconButton(eyebrow, "All tasks in this note", "list", () => this.showNoteTasks()).addClass("organized-note-overview");
    else this.button(eyebrow, this.origin === "Calendar" ? "Back to calendar" : this.origin === "Favorites" ? "Back to favorites" : "Back to projects", () => { this.tab = this.origin === "Calendar" ? "Calendar" : this.origin === "Favorites" ? "Favorites" : "Projects"; return this.render(); }).addClass("organized-back");
    const parent = await this.owner.repo.parentOf(id); if (generation !== this.renderId) return;
    if (parent) { const part = this.button(hero.createDiv({ cls: "organized-part-of" }), `Part of ${parent.title}`, () => this.openTask(parent)); part.setAttribute("aria-label", `Open parent task ${parent.title}`); }
    const header = hero.createDiv({ cls: "organized-task-header" });
    if (this.editingTitle) {
      const input = header.createEl("input", { cls: "organized-title-input", type: "text", attr: { "aria-label": "Task title" } }); input.value = task.title;
      const actions = header.createDiv({ cls: "organized-title-actions" });
      const save = this.button(actions, "Save", () => { input.blur(); this.editingTitle = false; return this.owner.run(() => this.owner.service.title(id, input.value)); }); save.addClass("organized-save");
      const cancel = this.button(actions, "Cancel", () => { input.blur(); this.editingTitle = false; return this.render(); });
      input.addEventListener("keydown", event => { if (event.key !== "Enter" && event.key !== "Escape") return; event.preventDefault(); (event.key === "Enter" ? save : cancel).click(); });
      input.focus(); input.select();
    } else {
      const title = header.createDiv({ cls: "organized-task-title", attr: { role: "heading", "aria-level": "2" } });
       void renderMarkdownLinks(this.app, task.title, title, this.owner.repo.sourcePath(id), this.markdown).catch(report);
      this.iconButton(header, "Edit title", "pencil", () => { this.editingTitle = true; return this.render(); });
    }
    const star = this.iconButton(header, "Favorite", "star", () => this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, starred: !t.starred })); this.owner.refresh(); })); star.setAttribute("aria-pressed", String(task.starred));
    const toolbar = hero.createDiv({ cls: "organized-task-toolbar" });
    const status = toolbar.createDiv({ cls: "organized-status-field" });
    const shown = this.shownStatus(task); setIcon(status.createSpan({ cls: "organized-status-icon", attr: { "data-status": shown, "aria-hidden": "true" } }), task.recurring && shown === "completed" ? "calendar-check" : STATUS_ICONS[shown]);
    const statusSelect = this.select(status, "Status", this.shownStatus(task), STATUSES, value => { if (STATUSES.includes(value as Task["status"])) void this.owner.run(async () => this.owner.service.status(id, value as Task["status"], await this.contextFor(task))); });
    if (task.recurring) statusSelect.options[STATUSES.indexOf("completed")].text = "done · today";
    const add = this.select(toolbar, "Add details", "", ["", "Priority", "Schedule", "Timer", "Recurring", "Projects", "Subtasks", "Description", "Sources"], value => { this.module = value; if (FOLDABLE_CARDS.includes(value) && this.owner.settings.collapsedTaskSections.includes(value)) this.owner.setTaskSectionCollapsed(value, false); this.editingModule = (NOTE_SECTIONS as readonly string[]).includes(value) ? value : ""; void this.render().catch(report); }); add.options[0].text = "Add details…"; add.addClass("organized-add-details");
    const file = await this.owner.repo.resolve(id, "showing the task"); const body = splitNote(await this.owner.repo.readText(file)).body;
    if (generation !== this.renderId) return;
    const details = host.createDiv({ cls: "organized-task-details" });
    this.propertyStrip(details, task);
    await this.moduleCard(details, file.path, id, "Description", noteSection(body, "Description"));
    await this.subtaskCard(details, task);
    const repeating = task.recurring && task.recurrence_times.length > 0;
    if (task.time_tracking_started_at || task.time_tracked_seconds > 0 || task.planned_sessions.length || repeating || (task.time_budget_seconds !== null && !task.recurring) || this.hasProjectBudget(task) || this.module === "Timer") {
      const planned = plannedSeconds(task); const running = task.time_tracking_started_at !== null;
      const summary = `${formatMinutes(Math.floor(elapsed(task) / 60))} tracked${running ? " · running" : ""}${planned ? ` · ${formatMinutes(Math.floor(planned / 60))} planned` : ""}`;
      const timer = this.card(details, "Timer", "timer", { summary, always: true, actions: head => {
        const actions = head.createDiv({ cls: "organized-card-actions" });
        this.iconButton(actions, running ? "Stop timer" : "Start timer", running ? "square" : "play", () => this.owner.run(async () => this.owner.service.status(id, running ? "open" : "in_progress", await this.contextFor(task)))).setAttribute("aria-pressed", String(running));
        this.iconButton(actions, "Add time", "plus", () => this.editSession(task, null, localDate(), null));
        // A recurring task's time has no end to measure against; its projects' day, week and month budgets do that.
        if (!task.recurring) this.iconButton(actions, task.time_budget_seconds === null ? "Set budget" : "Edit budget", "target", () => new BudgetModal(this.app, task.title, task.time_budget_seconds, seconds => this.owner.run(() => this.owner.service.setBudget(id, seconds))).open());
      } });
      const own = budgetUse(task); if (own) this.budgetBar(timer, own, "Time budget", false);
      await this.projectBars(timer, task.projects);
      if (task.work_sessions.length) this.sessionList(timer, task);
      if (repeating) this.button(timer, `${ruleLabel(taskRule(task))} · ${task.recurrence_times.map(timeLabel).join(", ")}`, () => this.owner.pickRecurrence(task, this.owner.context?.line.id === id ? this.owner.context : undefined)).addClass("organized-session-row", "organized-repeat-times-row");
      // One place to plan: a task's days and their times open the Schedule dialog. A recurring task's one-off blocks keep their own list (it has no days).
      if (task.recurring) { if (task.planned_sessions.length) this.sessionList(timer, task, "planned"); }
      else if (task.planned_sessions.length || task.scheduled_dates.length) this.scheduleSummary(timer, task);
    }
    const sources = noteSection(body, "Sources");
    if (sources || this.module === "Sources") await this.moduleCard(details, file.path, id, "Sources", sources);
    const scale = task.movement_history.length ? scaleFor(task, await this.owner.repo.list()) : null;
    if (generation !== this.renderId) return;
    const moduleKey = `${id}:${this.module}`;
    if (this.module && this.scrolledModule !== moduleKey) {
      this.scrolledModule = moduleKey; host.querySelector<HTMLElement>(".organized-selected-module")?.scrollIntoView({ block: "nearest" });
    }
    if (scale) this.movementStrip(host, task, scale);
    const references = host.createEl("details", { cls: "organized-disclosure" }); references.createEl("summary", { text: "References" }); references.open = this.referencesOpen;
    const refs = references.createDiv(); const load = async () => {
      refs.setText("Loading references…"); const paths = await this.owner.service.refs(id); if (generation !== this.renderId || !references.open) return;
      refs.empty(); if (!paths.length) refs.createDiv({ cls: "organized-muted", text: "No references found. Use attach/create to link this task." });
      for (const notePath of paths) this.button(refs, notePath, () => { const note = this.owner.repo.file(notePath); if (!note) throw new Error("Reference was renamed or removed."); return this.app.workspace.getLeaf(false).openFile(note); });
    };
    references.addEventListener("toggle", () => { this.referencesOpen = references.open; if (references.open) void load().catch(report); });
    if (this.referencesOpen) await load();
    const actions = host.createDiv({ cls: "organized-task-actions" });
    this.button(actions, "Open task note", () => this.app.workspace.getLeaf(false).openFile(file)).addClass("organized-note-link");
    this.button(actions, "Make standalone note", () => this.owner.convertToNote(task, this.owner.context?.line.id === id ? this.owner.context : undefined)).addClass("organized-note-link");
    this.button(actions, "Delete task", () => this.owner.deleteTask(id)).addClass("organized-danger");
  }
  /** Movement history as tiny squares (green to red against the user's usual forward count, accent for dates picked on purpose); a slider once there are too many. */
  private movementStrip(host: HTMLElement, task: Task, scale: HeatScale): void {
    const count = task.movement_history.length; const section = host.createDiv({ cls: "organized-moves" });
    const summary = `Moved ${count} time${count === 1 ? "" : "s"}`; section.createDiv({ cls: "organized-moves-summary", text: summary });
    if (count > MAX_CELLS) {
      const state = slider(task, scale); const track = section.createDiv({ cls: "organized-moves-slider", attr: { role: "img", "aria-label": `${summary}, ${Math.round(state.position)}% of the way to red` } });
      track.setCssProps({ "--organized-stop-1": `${state.stops[0]}%`, "--organized-stop-2": `${state.stops[1]}%`, "--organized-at": `${state.position}%` });
      track.createDiv({ cls: `organized-moves-marker${state.deliberate ? " is-deliberate" : ""}`, attr: { "data-heat": String(state.level) } });
    } else {
      const grid = section.createDiv({ cls: "organized-moves-grid", attr: { role: "img", "aria-label": summary } });
      for (const cell of cells(task, scale)) grid.createDiv({ cls: `organized-move${cell.deliberate ? " is-deliberate" : ""}`, attr: { "data-heat": String(cell.level), title: cell.label } });
    }
    const history = section.createEl("details", { cls: "organized-disclosure" }); history.createEl("summary", { text: "Details" });
    for (const event of task.movement_history) history.createDiv({ cls: "organized-muted", text: `${event.kind} · ${event.source} · ${event.from} → ${event.to} · ${event.at}` });
  }
  /** Opens a task from the Projects or Favorites tab; the origin decides which tab Back returns to. */
  /** Opens another task in the Task tab, keeping where the panel was opened from so Back still leads there. */
  private openTask(task: Task): Promise<void> {
    this.owner.selectedTaskId = task.id; this.tab = "Task"; this.module = ""; this.editingModule = ""; this.editingTitle = false; return this.render();
  }
  /** The subtasks of a task with how many are done, each with a toggle and a way in, and a button to add one under the todo in the open note. */
  private async subtaskCard(details: HTMLElement, task: Task): Promise<void> {
    const children = await this.owner.repo.subtasksOf(task); const parentTask = await this.owner.repo.parentOf(task.id); if (!children.length && !parentTask && this.module !== "Subtasks") return;
    const counted = children.filter(child => child.status !== "canceled"); const done = counted.filter(child => child.status === "completed").length;
    const card = this.card(details, "Subtasks", "list-checks", { summary: counted.length ? `${done} of ${counted.length} done` : "No subtasks" });
    if (counted.length) {
      card.createDiv({ cls: "organized-muted", text: `${done} of ${counted.length} done` });
      const bar = card.createDiv({ cls: "organized-progress", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(counted.length), "aria-valuenow": String(done), "aria-label": "Subtasks done" } });
      bar.createDiv({ cls: done === counted.length ? "organized-progress-bar organized-progress-complete" : "organized-progress-bar" }).setCssProps({ "--organized-progress": `${Math.round(100 * done / counted.length)}%` });
    }
    for (const child of children) {
      const row = card.createDiv({ cls: "organized-subtask", attr: { "data-status": child.status } });
      const toggle = row.createEl("button", { cls: "organized-subtask-toggle", attr: { "aria-label": child.status === "completed" ? `Reopen ${child.title}` : `Complete ${child.title}`, "aria-pressed": String(child.status === "completed") } }); setIcon(toggle, STATUS_ICONS[child.status]);
      toggle.addEventListener("click", () => { void this.owner.run(() => this.owner.service.status(child.id, child.status === "completed" ? "open" : "completed")).catch(report); });
      const open = row.createEl("button", { cls: "organized-subtask-title", text: child.title, attr: { "aria-label": `Open subtask ${child.title}` } });
      open.addEventListener("click", () => { void this.openTask(child).catch(report); });
      this.iconButton(row, `Remove ${child.title} from this task`, "unlink", () => this.owner.run(() => this.owner.service.detachSubtask(child.id))).addClass("organized-subtask-unlink");
    }
    // Every subtask is done but the parent is not: say so, and offer the step that is left.
    if (counted.length && done === counted.length && task.status !== "completed" && !task.recurring) this.button(card, "Complete parent", () => this.owner.run(() => this.owner.service.status(task.id, "completed", this.owner.context?.line.id === task.id ? this.owner.context : undefined))).addClass("organized-complete-parent");
    // Tasks that can take part in a relation with this one: open, not recurring, not this task, and not one of its subtasks or ancestors.
    const candidates = async (own: Task[]) => (await this.owner.repo.list()).filter(t => t.id !== task.id && !t.recurring && t.status !== "completed" && t.status !== "canceled" && !own.some(o => o.id === t.id));
    const pick = (title: string, tasks: Task[], choose: (picked: Task) => Promise<void>) => {
      const picker = new TaskPicker(this.app, tasks, async choice => { if (typeof choice === "object" && "id" in choice) await choose(choice); }, "", false, false); picker.setPlaceholder(title); picker.open();
    };
    // Compact icon buttons in one row: add a new subtask, link an existing task, and either make this a subtask of something or take it out of its parent.
    const actions = card.createDiv({ cls: "organized-subtask-actions" });
    this.iconButton(actions, "Add subtask", "list-plus", async () => {
      const source = this.owner.taskSourceEditor(); const lines = source ? parseTasks(source.editor.getValue()).filter(t => t.id === task.id) : [];
      if (!source || lines.length !== 1) throw new Error("Open the note that holds this todo once, then add the subtask.");
      source.editor.setCursor({ line: lines[0].line, ch: 0 }); await this.owner.addSubtask(source.editor, source.file);
    });
    this.iconButton(actions, "Link existing task…", "link", async () => pick("Choose a task to make a subtask of this one", await candidates(children), picked => this.owner.run(() => this.owner.service.makeSubtask(task.id, picked.id))));
    if (parentTask) this.iconButton(actions, "Remove from parent", "unlink", () => this.owner.run(() => this.owner.service.detachSubtask(task.id)));
    else this.iconButton(actions, "Make subtask of…", "corner-down-right", async () => pick("Choose the task this one belongs under", await candidates(children), picked => this.owner.run(() => this.owner.service.makeSubtask(picked.id, task.id))));
  }
  private chooseTask(task: Task, origin: "Projects" | "Favorites"): Promise<void> {
    this.owner.selectedTaskId = task.id; this.origin = origin; this.tab = "Task"; this.module = ""; this.editingModule = ""; this.editingTitle = false; return this.render();
  }
  async favorites(host: HTMLElement, generation: number): Promise<void> {
    const tasks = byPriority(await this.owner.repo.list()); await this.loadDoneToday();
    if (generation !== this.renderId) return;
    const favorites = tasks.filter(t => t.starred && t.status !== "canceled");
    const section = this.section(host, "Favorites", favorites.length);
    if (!favorites.length) section.createDiv({ cls: "organized-empty", text: "No favorites yet. Use [*] on a task or star it in the Task tab." });
    for (const task of favorites) this.taskRow(section, task, () => this.chooseTask(task, "Favorites"));
  }
  /** Draws a long list a page at a time: the first rows, then one button that shows the rest. */
  private limited(host: HTMLElement, tasks: Task[], key: string, draw: (task: Task) => void): void {
    const all = this.expandedLists.has(key);
    for (const task of all ? tasks : tasks.slice(0, LIST_LIMIT)) draw(task);
    if (!all && tasks.length > LIST_LIMIT) this.button(host, `Show all ${tasks.length}`, () => { this.expandedLists.add(key); return this.render(); }).addClass("organized-show-more");
  }
  async projects(host: HTMLElement, generation: number): Promise<void> {
    const tasks = byPriority(await this.owner.repo.list()); await this.loadDoneToday();
    if (generation !== this.renderId) return;
    const choose = (task: Task) => this.chooseTask(task, "Projects");
    const linked = tasks.flatMap(t => t.projects); this.owner.rememberProjects(linked);
    const projects = [...new Set([...this.owner.settings.knownProjects.filter(p => this.owner.repo.file(p)), ...linked])];
    const projectSection = this.section(host, "Projects", projects.length);
    const field = projectSection.createDiv({ cls: "organized-field" });
    field.createEl("label", { cls: "organized-field-label", text: "Filter by project", attr: { for: "organized-project-filter" } });
    const picker = field.createEl("select", { cls: "organized-control", attr: { id: "organized-project-filter", "aria-label": "Choose project" } });
    picker.createEl("option", { text: "All projects", value: "" });
    for (const project of projects) picker.createEl("option", { text: this.projectLabel(project), value: project }); picker.value = this.selectedProject;
    picker.addEventListener("change", () => { this.selectedProject = picker.value; picker.blur(); void this.render().catch(report); });
    if (projects.length) { this.colorPickers(projectSection, projects); this.budgetEditors(projectSection, projects); }
    // The chosen project's budgets, so its time is seen without opening one of its tasks.
    if (this.selectedProject) {
      const bars = projectSection.createDiv({ cls: "organized-project-bars" }); const note = this.owner.repo.file(this.selectedProject);
      if (note) this.button(bars, "Open project note", () => this.app.workspace.getLeaf(false).openFile(note)).addClass("organized-note-link");
      await this.projectBars(bars, [this.selectedProject]);
    }
    // The lists cover every task ever linked, so done and canceled ones are hidden unless asked for, and long lists stop at a page until expanded.
    const hide = this.owner.settings.hideClosedProjects;
    const head = projectSection.querySelector<HTMLElement>(".organized-section-head")!;
    const toggle = this.iconButton(head, hide ? "Show done and canceled tasks" : "Hide done and canceled tasks", hide ? "eye-off" : "eye", () => { this.owner.setHideClosedProjects(!hide); return this.render(); });
    toggle.setAttribute("aria-pressed", String(hide)); toggle.addClass("organized-hide-done"); head.insertBefore(toggle, head.querySelector(".organized-count"));
    const linkedTasks = tasks.filter(t => t.status !== "canceled" && t.projects.length && (!this.selectedProject || t.projects.includes(this.selectedProject)));
    const shown = hide ? linkedTasks.filter(t => this.shownStatus(t) !== "completed") : linkedTasks;
    // With a project chosen, its canceled tasks only; otherwise every canceled task, linked or not.
    const canceled = tasks.filter(t => t.status === "canceled" && (!this.selectedProject || t.projects.includes(this.selectedProject))); const hidden = linkedTasks.length - shown.length + (hide ? canceled.length : 0);
    if (!linkedTasks.length) projectSection.createDiv({ cls: "organized-empty", text: this.selectedProject ? `No tasks linked to ${this.projectLabel(this.selectedProject)}.` : "No project links yet. Use [j] on a task to link its project or topic note." });
    this.limited(projectSection, shown, "projects", task => { this.taskRow(projectSection, task, () => choose(task)); });
    if (hide && hidden) projectSection.createDiv({ cls: "organized-empty", text: `${hidden} done or canceled task${hidden === 1 ? "" : "s"} hidden.` });
    if (hide) return;
    const canceledSection = this.section(host, "Canceled", canceled.length);
    if (!canceled.length) canceledSection.createDiv({ cls: "organized-empty", text: "No canceled tasks." });
    this.limited(canceledSection, canceled, "canceled", task => {
      const row = this.taskRow(canceledSection, task, () => choose(task));
      const actions = row.createDiv({ cls: "organized-list-actions" });
      this.button(actions, "Restore", () => this.owner.run(() => this.owner.service.status(task.id, "open")));
    });
  }
}
