import { Component, ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import { moment } from "./moment";
import { rgbOf, softTint } from "./colors";
import type Organized from "./main";
import { elapsed, localDate, PRIORITIES, Section, STATUS_ICONS, STATUSES, Task, WorkSession } from "./model";
import { byPriority, report } from "./service";
import { DatePicker, SessionModal, TaskPicker } from "./modals";
import { formatMinutes, lengthOf, lengthOfSeconds, seconds } from "./sessions";
import { NoteSection, NOTE_SECTIONS, noteSection, parseTasks, TaskLine } from "./codec";
import { splitNote } from "./repository";
import { renderMarkdownLinks } from "./markdown";
import { blocksOn, hourRange } from "./timeline";

const sameHeading = (a: Section, b: Section): boolean => a.level === b.level && a.text === b.text && a.ordinal === b.ordinal;
export const VIEW_TYPE = "organized-inspector";
export type Tab = "Calendar" | "Task" | "Projects" | "Favorites";
export const CALENDAR_MODES = ["Month", "Week", "Day"] as const;
export type CalendarMode = typeof CALENDAR_MODES[number];
const pad = (value: number): string => String(value).padStart(2, "0");
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.floor(minutes % 60))}`;
/** Rows drawn before a long list asks to be expanded. */
const LIST_LIMIT = 50;
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
  private expandedLists = new Set<string>();
  private scrolledModule = "";
  private doneToday = new Set<string>();
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
  card(host: HTMLElement, title: string, icon: string): HTMLElement {
    const card = host.createDiv({ cls: "organized-card" }); const head = card.createDiv({ cls: "organized-card-head" });
    setIcon(head.createSpan({ cls: "organized-card-icon", attr: { "aria-hidden": "true" } }), icon); head.createEl("h4", { cls: "organized-card-title", text: title });
    if (this.module === title) card.addClass("organized-selected-module"); return card;
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
    this.doneToday = new Set(note ? parseTasks(await this.owner.repo.readText(note)).filter(t => t.id && t.marker.toLowerCase() === "x").map(t => t.id!) : []);
  }
  /** Today's occurrence of a recurring task, so changing status from the inspector targets only today. */
  private async todayContext(id: string): Promise<{ file: TFile; line: TaskLine } | undefined> {
    const note = this.owner.repo.file(this.owner.service.daily.path(localDate())); if (!note) return undefined;
    const lines = parseTasks(await this.owner.repo.readText(note)).filter(t => t.id === id);
    return lines.length === 1 ? { file: note, line: lines[0] } : undefined;
  }
  private shownStatus(task: Task): Task["status"] { return task.recurring && task.status === "open" && this.doneToday.has(task.id) ? "completed" : task.status; }
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
    void renderMarkdownLinks(this.app, task.title, title, this.owner.repo.taskPath(task.id), this.markdown).catch(report);
    // One small icon per status instead of a word keeps the card compact.
    const shown = this.shownStatus(task); const doneToday = task.recurring && shown === "completed";
    const label = doneToday ? "done · today" : task.status.replace(/_/g, " ");
    const status = head.createSpan({ cls: "organized-list-status", attr: { "data-status": shown, role: "img", "aria-label": label, title: label } }); setIcon(status, doneToday ? "calendar-check" : STATUS_ICONS[task.status]);
    if (task.priority !== "none" || (task.scheduled && this.owner.settings.showScheduledDate) || task.starred) {
      const meta = open.createDiv({ cls: "organized-list-meta" });
      if (task.priority !== "none") meta.createSpan({ cls: `organized-list-priority priority-${task.priority}`, text: task.priority });
      if (task.scheduled && this.owner.settings.showScheduledDate) meta.createSpan({ cls: "organized-list-date", text: task.scheduled });
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
    const box = this.card(host, section, "file-text");
    if (this.editingModule === section) { this.inlineEditor(box, id, section, text); return; }
    if (text) await renderMarkdownLinks(this.app, text, box.createDiv({ cls: "organized-task-notes" }), filePath, this.markdown);
    // Only Description renders without text; other empty sections stay hidden.
    else box.createDiv({ cls: "organized-muted", text: "Add context, details or links. Write [[Note]] to link a note." });
    this.button(box, `${text ? "Edit" : "Add"} ${section.toLowerCase()}`, () => { this.editingModule = section; this.module = section; return this.render(); });
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
    const visible = hideDone ? lines.filter(line => !isDone(line)) : lines; const doneHidden = lines.length - visible.length;
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
      const indent = (row: HTMLElement) => { row.addClass("organized-indented"); row.setCssProps({ "--organized-depth": String(line.section.length) }); };
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
    const start = this.month.clone().startOf("week");
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "organized-weekday", text: start.clone().add(i, "days").format("dd") });
    for (let i = 0; i < 42; i++) {
      const date = start.clone().add(i, "days"); const key = date.format("YYYY-MM-DD");
      const b = this.button(grid, date.format("D"), () => this.selectDay(key));
      b.addClass("organized-day");
      b.setAttribute("aria-label", date.format("dddd, LL")); b.setAttribute("aria-pressed", String(key === this.selectedDate));
      if (key === localDate()) b.setAttribute("aria-current", "date");
      if (date.month() !== this.month.month()) b.addClass("organized-muted");
      if (this.owner.repo.file(this.owner.service.daily.path(key))) b.addClass("organized-has-note");
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
      for (const [value, label] of [[tasks.filter(t => ["open", "in_progress"].includes(t.status)).length, "Active"], [completed, "Done today"], [tasks.filter(t => t.time_tracking_started_at).length, "Timers"]]) {
        const stat = stats.createDiv({ cls: "organized-stat" }); stat.createEl("strong", { text: String(value) }); stat.createSpan({ text: String(label) });
      }
    }).catch(() => stats.setText("Task statistics unavailable"));
  }
  /** Navigation row shared by the week and day views: previous, title, next and Today. */
  private rangeNav(host: HTMLElement, title: string, previous: string, next: string, step: () => void, back: () => void): void {
    const nav = host.createDiv({ cls: "organized-calendar-nav" });
    this.iconButton(nav, previous, "chevron-left", () => { back(); return this.render(); });
    nav.createEl("h3", { text: title, attr: { "aria-live": "polite" } });
    this.iconButton(nav, next, "chevron-right", () => { step(); return this.render(); });
    this.button(nav, "Today", () => { this.selectedDate = localDate(); return this.render(); }).addClass("organized-today-button");
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
    const tasks = await this.owner.repo.list(true); const now = Date.now();
    const days = Array.from({ length: 7 }, (_, i) => start.clone().add(i, "days"));
    const retired = (await this.owner.service.retiredWork(days[0].format("YYYY-MM-DD"), days[6].format("YYYY-MM-DD"))).map(item => item.task);
    const blocks = days.map(day => blocksOn([...tasks, ...retired], day.format("YYYY-MM-DD"), now)); const [from, to] = hourRange(blocks.flat());
    const counts = await Promise.all(days.map(async day => {
      const note = this.owner.repo.file(this.owner.service.daily.path(day.format("YYYY-MM-DD"))); const lines = note ? await this.owner.taskLines(note) : [];
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
        const part = track.createSpan({ cls: "organized-week-block", attr: { "data-status": this.shownStatus(block.task) } }); this.tint(part, block.task);
        part.setCssProps({ "--organized-start": String(left), "--organized-width": String(width) });
      }
      row.createSpan({ cls: "organized-week-count", text: total ? `${done}/${total}` : "–" });
      row.addEventListener("click", () => { this.selectedDate = key; this.calendarMode = "Day"; void this.render().catch(report); });
    });
  }
  /** Every recorded session, newest first and grouped by day with the day's total, folded away by default because the list grows quickly. */
  private sessionList(host: HTMLElement, task: Task): void {
    const box = host.createEl("details", { cls: "organized-sessions" }); box.open = this.sessionsOpen;
    box.createEl("summary", { text: `Sessions (${task.work_sessions.length})` }); box.addEventListener("toggle", () => { this.sessionsOpen = box.open; });
    const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const days = new Map<string, WorkSession[]>();
    for (const session of [...task.work_sessions].sort((a, b) => Date.parse(b.start) - Date.parse(a.start))) { const day = localDate(new Date(session.start)); days.set(day, [...(days.get(day) ?? []), session]); }
    for (const [day, sessions] of days) {
      box.createDiv({ cls: "organized-session-day", text: `${day} · ${lengthOfSeconds(sessions.reduce((sum, session) => sum + seconds(session), 0))}` });
      for (const session of sessions) this.button(box, `${clock(new Date(session.start))}–${clock(new Date(session.end))} · ${lengthOf(session)}`, () => this.editSession(task, session, day)).addClass("organized-session-row");
    }
  }
  /** Adds a block of time to a task, or edits/deletes a recorded one. */
  private editSession(task: Task, session: WorkSession | null, date: string): void {
    const at = (time: string) => new Date(`${date}T${time}:00`).toISOString();
    new SessionModal(this.app, {
      heading: session ? "Edit time worked" : "Add time worked", taskTitle: task.title, start: session?.start ?? at("09:00"), end: session?.end ?? at("10:00"),
      save: next => this.owner.run(() => session ? this.owner.service.changeSession(task.id, session, next) : this.owner.service.addSession(task.id, next)),
      remove: session ? () => this.owner.run(() => this.owner.service.changeSession(task.id, session, null)) : undefined,
      openTask: session ? () => this.openCalendarTask(task) : undefined,
    }).open();
  }
  /** Picks an existing task, then asks for the time to log on it. */
  private async addTime(date: string): Promise<void> {
    const tasks = (await this.owner.repo.list()).filter(t => t.status !== "canceled");
    new TaskPicker(this.app, tasks, async choice => { if (typeof choice === "object" && "id" in choice) this.editSession(choice, null, date); }, "", false, false).open();
  }
  private async openNote(notePath: string): Promise<void> {
    const note = this.owner.repo.file(notePath); if (!note) throw new Error("The note that kept this time was renamed or removed.");
    await this.app.workspace.getLeaf(false).openFile(note);
  }
  private plainTaskRow(host: HTMLElement, line: TaskLine, path: string): void {
    const status = line.marker.toLowerCase() === "x" ? "completed" : line.marker === "-" ? "canceled" : line.marker === "/" ? "in_progress" : "open";
    const row = host.createDiv({ cls: "organized-list-card organized-day-task", attr: { "data-status": status } });
    const open = row.createDiv({ cls: "organized-list-open" });
    void renderMarkdownLinks(this.app, line.title || "Untitled todo", open.createDiv({ cls: "organized-list-title" }), path, this.markdown).catch(report);
    open.createDiv({ cls: "organized-list-meta", text: status === "completed" ? "Done" : "Regular todo" });
  }
  private async dayView(host: HTMLElement, generation: number): Promise<void> {
    const date = this.selectedDate; const day = moment(date, "YYYY-MM-DD");
    this.rangeNav(host, day.format("ddd, MMM D, YYYY"), "Previous day", "Next day",
      () => { this.selectedDate = day.clone().add(1, "day").format("YYYY-MM-DD"); }, () => { this.selectedDate = day.clone().subtract(1, "day").format("YYYY-MM-DD"); });
    const tasks = await this.owner.repo.list(true); const now = Date.now();
    const retired = new Map((await this.owner.service.retiredWork(date, date)).map(item => [item.task.id, item]));
    const blocks = blocksOn([...tasks, ...[...retired.values()].map(item => item.task)], date, now);
    const note = this.owner.repo.file(this.owner.service.daily.path(date)); const lines = note ? await this.owner.taskLines(note) : [];
    const linked = new Map(tasks.map(task => [task.id, task]));
    if (generation !== this.renderId) return;
    const collapsed = this.owner.settings.dayTasksCollapsed;
    const list = this.section(host, "Tasks", lines.length, { collapsed, toggle: () => { this.owner.setDayTasksCollapsed(!collapsed); void this.render().catch(report); } }); list.addClass("organized-grouped");
    if (!note) {
      const empty = list.createDiv({ cls: "organized-empty", text: "There is no daily note for this day yet." });
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
    if (!blocks.length) { timeline.createDiv({ cls: "organized-empty", text: "No tracked time this day. Set a task In Progress to record it." }); return; }
    const [from, to] = hourRange(blocks); const span = (to - from) * 60;
    const grid = timeline.createDiv({ cls: "organized-day-grid" }); grid.setCssProps({ "--organized-hours": String(to - from) });
    for (let hour = from; hour <= to; hour++) {
      const line = grid.createDiv({ cls: "organized-hour-line" }); line.setCssProps({ "--organized-at": String((hour - from) / (to - from) * 100) });
      line.createSpan({ cls: "organized-hour-label", text: `${pad(hour % 24)}:00` });
    }
    for (const block of blocks) {
      const title = block.task.title; const range = `${clock(block.startMin)}–${block.endMin >= 1440 ? "24:00" : clock(block.endMin)}`;
      const part = grid.createEl("button", { cls: "organized-block", attr: { type: "button", "data-status": this.shownStatus(block.task), "aria-label": `${title}, ${range}${block.running ? ", running" : ""}`, title: `${title} · ${range}` } });
      this.tint(part, block.task);
      part.setCssProps({ "--organized-top": String((block.startMin - from * 60) / span * 100), "--organized-height": String((block.endMin - block.startMin) / span * 100), "--organized-lane": String(block.lane), "--organized-lanes": String(block.lanes) });
      const shown = this.shownStatus(block.task); setIcon(part.createSpan({ cls: "organized-block-status", attr: { "data-status": shown, "aria-hidden": "true" } }), STATUS_ICONS[shown]);
      part.createSpan({ cls: "organized-block-title", text: title }); if (block.endMin - block.startMin >= 30) part.createSpan({ cls: "organized-block-time", text: range });
      // A retired task has no task note: open the daily note that kept its time instead.
      const kept = retired.get(block.task.id);
      // A stored session opens for editing (with an Open task button); a running timer has nothing to edit yet.
      part.addEventListener("click", () => { if (!kept && block.session) { this.editSession(block.task, block.session, date); return; } void (kept ? this.openNote(kept.path) : this.openCalendarTask(block.task)).catch(report); });
    }
    const minutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    if (date === localDate() && minutes >= from * 60 && minutes <= to * 60) { const nowLine = grid.createDiv({ cls: "organized-now-line", attr: { "aria-hidden": "true" } }); nowLine.setCssProps({ "--organized-at": String((minutes - from * 60) / span * 100) }); }
  }
  async selectDay(date: string): Promise<void> {
    this.owner.assertWritable(); this.selectedDate = date;
    const file = await this.owner.service.daily.open(date);
    await this.owner.run(() => this.owner.service.reconcile(file)); await this.render();
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
    const header = hero.createDiv({ cls: "organized-task-header" });
    if (this.editingTitle) {
      const input = header.createEl("input", { cls: "organized-title-input", type: "text", attr: { "aria-label": "Task title" } }); input.value = task.title;
      const actions = header.createDiv({ cls: "organized-title-actions" });
      this.button(actions, "Save", () => { input.blur(); this.editingTitle = false; return this.owner.run(() => this.owner.service.title(id, input.value)); }).addClass("organized-save");
      this.button(actions, "Cancel", () => { input.blur(); this.editingTitle = false; return this.render(); });
      input.focus(); input.select();
    } else {
      const title = header.createDiv({ cls: "organized-task-title", attr: { role: "heading", "aria-level": "2" } });
       void renderMarkdownLinks(this.app, task.title, title, this.owner.repo.taskPath(id), this.markdown).catch(report);
      this.iconButton(header, "Edit title", "pencil", () => { this.editingTitle = true; return this.render(); });
    }
    const star = this.iconButton(header, "Favorite", "star", () => this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, starred: !t.starred })); this.owner.refresh(); })); star.setAttribute("aria-pressed", String(task.starred));
    const toolbar = hero.createDiv({ cls: "organized-task-toolbar" });
    const status = toolbar.createDiv({ cls: "organized-status-field" });
    const shown = this.shownStatus(task); setIcon(status.createSpan({ cls: "organized-status-icon", attr: { "data-status": shown, "aria-hidden": "true" } }), task.recurring && shown === "completed" ? "calendar-check" : STATUS_ICONS[task.status]);
    const statusSelect = this.select(status, "Status", this.shownStatus(task), STATUSES, value => { if (STATUSES.includes(value as Task["status"])) void this.owner.run(async () => this.owner.service.status(id, value as Task["status"], this.owner.context?.line.id === id ? this.owner.context : task.recurring ? await this.todayContext(id) : undefined)); });
    if (task.recurring) statusSelect.options[STATUSES.indexOf("completed")].text = "done · today";
    const add = this.select(toolbar, "Add details", "", ["", "Priority", "Schedule", "Timer", "Recurring", "Projects", "Description", "Sources"], value => { this.module = value; this.editingModule = (NOTE_SECTIONS as readonly string[]).includes(value) ? value : ""; void this.render().catch(report); }); add.options[0].text = "Add details…"; add.addClass("organized-add-details");
    const file = this.owner.repo.file(this.owner.repo.taskPath(id))!; const body = splitNote(await this.owner.repo.readText(file)).body;
    if (generation !== this.renderId) return;
    const details = host.createDiv({ cls: "organized-task-details" });
    await this.moduleCard(details, file.path, id, "Description", noteSection(body, "Description"));
    if (task.priority !== "none" || this.module === "Priority") this.select(this.card(details, "Priority", "flag"), "Priority", task.priority, PRIORITIES, value => { void this.owner.run(async () => { await this.owner.service.setPriority(id, value as Task["priority"], this.owner.context?.line.id === id ? this.owner.context : undefined); this.owner.refresh(); }); });
    if (task.scheduled || this.module === "Schedule") this.button(this.card(details, "Schedule", "calendar"), task.scheduled ?? "Choose date", () => { new DatePicker(this.app, task.scheduled ?? localDate(), date => this.owner.run(() => this.owner.service.scheduleTask(id, date, this.owner.context ?? undefined))).open(); });
    if (task.time_tracking_started_at || task.time_tracked_seconds > 0 || this.module === "Timer") {
      const timer = this.card(details, "Timer", "timer"); const row = timer.createDiv({ cls: "organized-timer-row" });
      row.createDiv({ cls: "organized-timer-value", text: `${formatMinutes(Math.floor(elapsed(task) / 60))}${task.time_tracking_started_at ? " · running" : ""}` });
      this.button(row, task.time_tracking_started_at ? "Stop timer" : "Start timer", () => this.owner.run(() => this.owner.service.status(id, task.time_tracking_started_at ? "open" : "in_progress", this.owner.context ?? undefined)));
      this.button(row, "Add time", () => this.editSession(task, null, localDate()));
      if (task.work_sessions.length) this.sessionList(timer, task);
    }
    if (task.recurring || task.recurrence_periods.length || this.module === "Recurring") {
      const recurring = this.card(details, "Recurring", "repeat");
      const toggle = this.button(recurring, task.recurring ? "On" : "Off", () => this.owner.run(() => this.owner.service.recurrence(id, this.owner.context?.line.id === id ? this.owner.context : undefined))); toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", "Recurring"); toggle.setAttribute("aria-checked", String(task.recurring));
      if (task.recurrence_periods.length) recurring.createDiv({ cls: "organized-muted", text: `${task.recurrence_periods[0].start} → ${task.recurring ? "active" : task.recurrence_periods[task.recurrence_periods.length - 1].stop}` });
    }
    if (task.projects.length || this.module === "Projects") {
      const projects = this.card(details, "Projects", "folder"); for (const project of task.projects) projects.createDiv({ text: this.projectLabel(project) });
      this.button(projects, "Link projects or topics", () => this.owner.pickProjects(task));
    }
    const sources = noteSection(body, "Sources");
    if (sources || this.module === "Sources") await this.moduleCard(details, file.path, id, "Sources", sources);
    if (generation !== this.renderId) return;
    const moduleKey = `${id}:${this.module}`;
    if (this.module && this.scrolledModule !== moduleKey) {
      this.scrolledModule = moduleKey; host.querySelector<HTMLElement>(".organized-selected-module")?.scrollIntoView({ block: "nearest" });
    }
    if (task.movement_history.length) {
      const history = host.createEl("details", { cls: "organized-disclosure" }); history.createEl("summary", { text: "Movement history" });
      for (const event of task.movement_history) history.createDiv({ cls: "organized-muted", text: `${event.kind} · ${event.source} · ${event.from} → ${event.to} · ${event.at}` });
    }
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
  /** Opens a task from the Projects or Favorites tab; the origin decides which tab Back returns to. */
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
    if (projects.length) this.colorPickers(projectSection, projects);
    // The lists cover every task ever linked, so done and canceled ones are hidden unless asked for, and long lists stop at a page until expanded.
    const hide = this.owner.settings.hideClosedProjects;
    const head = projectSection.querySelector<HTMLElement>(".organized-section-head")!;
    const toggle = this.iconButton(head, hide ? "Show done and canceled tasks" : "Hide done and canceled tasks", hide ? "eye-off" : "eye", () => { this.owner.setHideClosedProjects(!hide); return this.render(); });
    toggle.setAttribute("aria-pressed", String(hide)); toggle.addClass("organized-hide-done"); head.insertBefore(toggle, head.querySelector(".organized-count"));
    const linkedTasks = tasks.filter(t => t.status !== "canceled" && t.projects.length && (!this.selectedProject || t.projects.includes(this.selectedProject)));
    const shown = hide ? linkedTasks.filter(t => this.shownStatus(t) !== "completed") : linkedTasks;
    const canceled = tasks.filter(t => t.status === "canceled"); const hidden = linkedTasks.length - shown.length + (hide ? canceled.length : 0);
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
