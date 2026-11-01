import { Component, ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import { moment } from "./moment";
import type Organized from "./main";
import { elapsed, localDate, PRIORITIES, STATUSES, Task } from "./model";
import { byPriority, report } from "./service";
import { DatePicker } from "./modals";
import { NoteSection, NOTE_SECTIONS, noteLoose, noteSection, TaskLine } from "./codec";
import { splitNote } from "./repository";
import { renderMarkdownLinks } from "./markdown";

export const VIEW_TYPE = "organized-inspector";
export type Tab = "Calendar" | "Task" | "Projects";
export class OrganizedInspectorView extends ItemView {
  tab: Tab = "Calendar";
  month = moment().startOf("month");
  selectedDate = localDate();
  selectedProject = "";
  origin = "Editor cursor";
  module = "";
  editingModule = "";
  editingTitle = false;
  referencesOpen = false;
  private renderId = 0;
  private scrolledModule = "";
  private markdown = this.addChild(new Component());
  constructor(leaf: WorkspaceLeaf, readonly owner: Organized) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Organized"; }
  getIcon(): string { return "calendar-check"; }
  onOpen(): Promise<void> { return this.render(); }
  onClose(): Promise<void> { this.renderId++; this.removeChild(this.markdown); this.contentEl.empty(); return Promise.resolve(); }
  async render(): Promise<void> {
    const generation = ++this.renderId; const host = this.contentEl;
    // A task refresh must never destroy an input the user is editing.
    if (host.contains(host.doc.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(host.doc.activeElement!.tagName)) return;
    this.removeChild(this.markdown);
    this.markdown = this.addChild(new Component());
    host.empty(); host.addClass("organized-view");
    const tabs = host.createDiv({ cls: "organized-tabs", attr: { role: "tablist", "aria-label": "Organized panels" } });
    for (const tab of ["Calendar", "Task", "Projects"] as const) {
      const b = tabs.createEl("button", { cls: "organized-tab", text: tab, attr: { role: "tab", "aria-selected": String(this.tab === tab) } });
      b.addEventListener("click", () => { this.tab = tab; this.module = ""; this.editingModule = ""; this.editingTitle = false; void this.render().catch(report); });
    }
    const panel = host.createDiv({ cls: "organized-panel", attr: { role: "tabpanel" } });
    if (this.tab === "Calendar") this.calendar(panel);
    else if (this.tab === "Task") await this.task(panel, generation);
    else await this.projects(panel, generation);
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
  section(host: HTMLElement, title: string, count: number): HTMLElement {
    const section = host.createDiv({ cls: "organized-section" }); const head = section.createDiv({ cls: "organized-section-head" });
    head.createEl("h3", { cls: "organized-section-title", text: title }); head.createSpan({ cls: "organized-count", text: String(count) });
    return section;
  }
  private statusDot(host: HTMLElement, task: Task): HTMLElement {
    return host.createSpan({ cls: "organized-status-dot", attr: { "data-status": task.status, "aria-hidden": "true" } });
  }
  private taskRow(host: HTMLElement, task: Task, action: () => Promise<unknown> | void): HTMLElement {
    const row = host.createDiv({ cls: "organized-list-card" });
    // A real button cannot contain links; this focusable card keeps both usable.
    const open = row.createDiv({ cls: "organized-list-open", attr: { role: "button", tabindex: "0" } });
    const activate = () => { try { const result = action(); if (result) void result.catch(report); } catch (error) { report(error); } };
    open.addEventListener("click", event => { if (!(event.target as HTMLElement).closest("a")) activate(); });
    open.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key) || (event.target as HTMLElement).closest("a")) return;
      event.preventDefault(); activate();
    });
    const title = open.createDiv({ cls: "organized-list-title" });
    void renderMarkdownLinks(this.app, task.title, title, this.owner.repo.taskPath(task.id), this.markdown).catch(report);
    const meta = open.createDiv({ cls: "organized-list-meta" }); this.statusDot(meta, task);
    meta.createSpan({ cls: "organized-list-status", text: task.status.replace(/_/g, " ") });
    if (task.priority !== "none") meta.createSpan({ cls: `organized-list-priority priority-${task.priority}`, text: task.priority });
    if (task.scheduled && this.owner.settings.showScheduledDate) meta.createSpan({ cls: "organized-list-date", text: task.scheduled });
    if (task.starred) { const star = meta.createSpan({ cls: "organized-list-star", attr: { "aria-label": "Favorite" } }); setIcon(star, "star"); }
    if (task.projects.length) {
      const chips = open.createDiv({ cls: "organized-chips" });
      for (const project of task.projects.slice(0, 2)) chips.createSpan({ cls: "organized-chip", text: project.replace(/\.md$/, "") });
      if (task.projects.length > 2) chips.createSpan({ cls: "organized-chip", text: `+${task.projects.length - 2}` });
    }
    return row;
  }
  private async moduleCard(host: HTMLElement, filePath: string, id: string, section: NoteSection, text: string): Promise<void> {
    const box = this.card(host, section, "file-text");
    if (this.editingModule === section) { this.inlineEditor(box, id, section, text); return; }
    if (text) await renderMarkdownLinks(this.app, text, box.createDiv({ cls: "organized-task-notes" }), filePath, this.markdown);
    // Only Description renders without text; other empty sections stay hidden.
    else box.createDiv({ cls: "organized-muted", text: "Add context, details or links." });
    this.button(box, `${text ? "Edit" : "Add"} ${section.toLowerCase()}`, () => { this.editingModule = section; this.module = section; return this.render(); });
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
    const lines = await this.owner.taskLines(source.file);
    if (generation !== this.renderId) return;
    const name = source.file.path.split("/").at(-1)!.replace(/\.md$/i, "");
    const list = this.section(host, name, lines.length);
    if (!lines.length) { list.createDiv({ cls: "organized-empty", text: "No tasks in this note yet." }); return; }
    for (const line of lines) {
      if (line.id) {
        try {
          const task = await this.owner.repo.read(line.id);
          if (generation !== this.renderId) return;
          this.taskRow(list, task, () => this.focusNoteTask(source.editor, source.file, line, task.id));
        } catch {
          if (generation !== this.renderId) return;
          this.noteTaskRow(list, source.file, source.editor, line, "Linked task unavailable");
        }
      } else this.noteTaskRow(list, source.file, source.editor, line, "Regular todo");
    }
  }
  private inlineEditor(host: HTMLElement, id: string, section: NoteSection, text: string): void {
    const field = host.createEl("textarea", { cls: "organized-inline-editor", attr: { "aria-label": section } }); field.value = text;
    // Actions sit above the field so a mobile keyboard cannot cover Save.
    const actions = host.createDiv({ cls: "organized-inline-actions" }); host.insertBefore(actions, field);
    this.button(actions, "Save", () => { field.blur(); this.editingModule = ""; return this.owner.run(() => this.owner.saveModule(id, section, field.value)); }).addClass("organized-save");
    this.button(actions, "Cancel", () => { field.blur(); this.editingModule = ""; return this.render(); });
    field.focus(); field.setSelectionRange(text.length, text.length); field.scrollIntoView({ block: "nearest" });
  }
  calendar(host: HTMLElement): void {
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
  async selectDay(date: string): Promise<void> {
    this.owner.assertWritable(); this.selectedDate = date;
    const file = await this.owner.service.daily.open(date);
    await this.owner.run(() => this.owner.service.reconcile(file)); await this.render();
  }
  async task(host: HTMLElement, generation: number): Promise<void> {
    const id = this.owner.selectedTaskId;
    if (!id) { await this.noteTasks(host, generation); return; }
    const task = await this.owner.repo.read(id);
    if (generation !== this.renderId) return;
    const hero = host.createDiv({ cls: "organized-task-hero" });
    const eyebrow = hero.createDiv({ cls: "organized-eyebrow" });
    this.statusDot(eyebrow, task); eyebrow.createSpan({ text: this.origin === "Editor cursor" ? "From editor" : "From projects" });
    if (this.origin !== "Editor cursor") this.button(hero, "Back to projects", () => { this.tab = "Projects"; return this.render(); }).addClass("organized-back");
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
    const status = toolbar.createDiv({ cls: "organized-status-field" }); this.statusDot(status, task);
    this.select(status, "Status", task.status, STATUSES, value => { if (STATUSES.includes(value as Task["status"])) void this.owner.run(() => this.owner.service.status(id, value as Task["status"], this.owner.context ?? undefined)); });
    const add = this.select(toolbar, "Add details", "", ["", "Priority", "Schedule", "Timer", "Recurring", "Projects", "Description", "Idea", "Question", "Sources", "Notes"], value => { this.module = value; this.editingModule = (NOTE_SECTIONS as readonly string[]).includes(value) ? value : ""; void this.render().catch(report); }); add.options[0].text = "Add details…"; add.addClass("organized-add-details");
    const file = this.owner.repo.file(this.owner.repo.taskPath(id))!; const body = splitNote(await this.owner.repo.readText(file)).body;
    const details = host.createDiv({ cls: "organized-task-details" });
    await this.moduleCard(details, file.path, id, "Description", noteSection(body, "Description"));
    if (task.priority !== "none" || this.module === "Priority") this.select(this.card(details, "Priority", "flag"), "Priority", task.priority, PRIORITIES, value => { void this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, priority: value as Task["priority"] })); this.owner.refresh(); }); });
    if (task.scheduled || this.module === "Schedule") this.button(this.card(details, "Schedule", "calendar"), task.scheduled ?? "Choose date", () => { new DatePicker(this.app, task.scheduled ?? localDate(), date => this.owner.run(() => this.owner.service.scheduleTask(id, date, this.owner.context ?? undefined))).open(); });
    if (task.time_tracking_started_at || task.time_tracked_seconds > 0 || this.module === "Timer") {
      const timer = this.card(details, "Timer", "timer"); timer.createDiv({ cls: "organized-timer-value", text: `${Math.floor(elapsed(task) / 60)} min${task.time_tracking_started_at ? " · running" : ""}` });
      this.button(timer, task.time_tracking_started_at ? "Stop timer" : "Start timer", () => this.owner.run(() => this.owner.service.status(id, task.time_tracking_started_at ? "open" : "in_progress", this.owner.context ?? undefined)));
    }
    if (task.recurring || task.recurrence_periods.length || this.module === "Recurring") {
      const recurring = this.card(details, "Recurring", "repeat");
      const toggle = this.button(recurring, task.recurring ? "On" : "Off", () => this.owner.run(() => this.owner.service.recurrence(id, this.owner.context?.line.id === id ? this.owner.context : undefined))); toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", "Recurring"); toggle.setAttribute("aria-checked", String(task.recurring));
      if (task.recurrence_periods.length) recurring.createDiv({ cls: "organized-muted", text: `${task.recurrence_periods[0].start} → ${task.recurring ? "active" : task.recurrence_periods[task.recurrence_periods.length - 1].stop}` });
    }
    if (task.projects.length || this.module === "Projects") {
      const projects = this.card(details, "Projects", "folder"); for (const project of task.projects) projects.createDiv({ text: project });
      this.button(projects, "Link projects or topics", () => this.owner.pickProjects(task));
    }
    const loose = noteLoose(body);
    for (const section of NOTE_SECTIONS) {
      if (section === "Description") continue;
      let text = noteSection(body, section);
      if (section === "Notes") text = `${text}\n${loose}`.trim();
      if (!text && this.module !== section) continue;
      await this.moduleCard(details, file.path, id, section, text);
    }
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
    this.button(actions, "Delete task", () => this.owner.deleteTask(id)).addClass("organized-danger");
  }
  async projects(host: HTMLElement, generation: number): Promise<void> {
    const tasks = byPriority(await this.owner.repo.list());
    if (generation !== this.renderId) return;
    const choose = (task: Task) => { this.owner.selectedTaskId = task.id; this.origin = "Projects / favorites"; this.tab = "Task"; this.module = ""; this.editingModule = ""; this.editingTitle = false; return this.render(); };
    const favorites = tasks.filter(t => t.starred && t.status !== "canceled");
    const favoriteSection = this.section(host, "Favorites", favorites.length);
    if (!favorites.length) favoriteSection.createDiv({ cls: "organized-empty", text: "No favorites yet. Use [*] on a task or star it in the Task tab." });
    for (const task of favorites) this.taskRow(favoriteSection, task, () => choose(task));
    const projects = [...new Set(tasks.flatMap(t => t.projects))];
    const projectSection = this.section(host, "Projects", projects.length);
    const field = projectSection.createDiv({ cls: "organized-field" });
    field.createEl("label", { cls: "organized-field-label", text: "Filter by project", attr: { for: "organized-project-filter" } });
    const picker = field.createEl("select", { cls: "organized-control", attr: { id: "organized-project-filter", "aria-label": "Choose project" } });
    picker.createEl("option", { text: "All projects", value: "" });
    for (const project of projects) picker.createEl("option", { text: project, value: project }); picker.value = this.selectedProject;
    picker.addEventListener("change", () => { this.selectedProject = picker.value; picker.blur(); void this.render().catch(report); });
    const shown = tasks.filter(t => t.status !== "canceled" && t.projects.length && (!this.selectedProject || t.projects.includes(this.selectedProject)));
    if (!shown.length) projectSection.createDiv({ cls: "organized-empty", text: this.selectedProject ? `No tasks linked to ${this.selectedProject}.` : "No project links yet. Use [b] on a task to link its project or topic note." });
    for (const task of shown) this.taskRow(projectSection, task, () => choose(task));
    const canceled = tasks.filter(t => t.status === "canceled");
    const canceledSection = this.section(host, "Canceled", canceled.length);
    if (!canceled.length) canceledSection.createDiv({ cls: "organized-empty", text: "No canceled tasks." });
    for (const task of canceled) {
      const row = this.taskRow(canceledSection, task, () => choose(task));
      const actions = row.createDiv({ cls: "organized-list-actions" });
      this.button(actions, "Restore", () => this.owner.run(() => this.owner.service.status(task.id, "open")));
    }
  }
}
