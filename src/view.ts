import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import { moment } from "./moment";
import type Organized from "./main";
import { elapsed, localDate, PRIORITIES, STATUSES, Task } from "./model";
import { byPriority, report } from "./service";
import { DatePicker, TextModal } from "./modals";
import { splitNote } from "./repository";

export const VIEW_TYPE = "organized-inspector";
export type Tab = "Calendar" | "Task" | "Projects";
export class OrganizedInspectorView extends ItemView {
  tab: Tab = "Calendar";
  month = moment().startOf("month");
  selectedDate = localDate();
  selectedProject = "";
  origin = "Editor cursor";
  module = "";
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
      b.addEventListener("click", () => { this.tab = tab; void this.render().catch(report); });
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
    if (!id) { host.createEl("p", { text: "Place the cursor on a linked task, or choose one in the projects tab." }); return; }
    const task = await this.owner.repo.read(id);
    if (generation !== this.renderId) return;
    host.createDiv({ cls: "organized-eyebrow", text: this.origin === "Editor cursor" ? "From editor" : "From projects" });
    if (this.origin !== "Editor cursor") this.button(host, "Back to projects", () => { this.tab = "Projects"; return this.render(); });
    const header = host.createDiv({ cls: "organized-task-header" }); header.createEl("h2", { cls: "organized-task-title", text: task.title });
    this.iconButton(header, "Edit title", "pencil", () => { new TextModal(this.app, "Edit title", task.title, title => this.owner.run(() => this.owner.service.title(id, title)), false).open(); });
    const star = this.iconButton(header, "Favorite", "star", () => this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, starred: !t.starred })); this.owner.refresh(); })); star.setAttribute("aria-pressed", String(task.starred));
    const toolbar = host.createDiv({ cls: "organized-task-toolbar" });
    this.select(toolbar, "Status", task.status, STATUSES, value => { if (STATUSES.includes(value as Task["status"])) void this.owner.run(() => this.owner.service.status(id, value as Task["status"], this.owner.context ?? undefined)); });
    const add = this.select(toolbar, "Add details", "", ["", "Priority", "Schedule", "Timer", "Recurring", "Projects", "Information", "Idea", "Question", "Sources", "Notes"], value => { this.module = value; void this.render().catch(report); }); add.options[0].text = "Add details…";
    if (task.priority !== "none" || this.module === "Priority") this.select(this.card(host, "Priority", "flag"), "Priority", task.priority, PRIORITIES, value => { void this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, priority: value as Task["priority"] })); this.owner.refresh(); }); });
    if (task.scheduled || this.module === "Schedule") this.button(this.card(host, "Schedule", "calendar"), task.scheduled ?? "Choose date", () => { new DatePicker(this.app, task.scheduled ?? localDate(), date => this.owner.run(() => this.owner.service.scheduleTask(id, date, this.owner.context ?? undefined))).open(); });
    if (task.time_tracking_started_at || task.time_tracked_seconds > 0 || this.module === "Timer") {
      const timer = this.card(host, "Timer", "timer"); timer.createDiv({ cls: "organized-timer-value", text: `${Math.floor(elapsed(task) / 60)} min${task.time_tracking_started_at ? " · running" : ""}` });
      this.button(timer, task.time_tracking_started_at ? "Stop timer" : "Start timer", () => this.owner.run(() => this.owner.service.status(id, task.time_tracking_started_at ? "open" : "in_progress", this.owner.context ?? undefined)));
    }
    if (task.recurring || task.recurrence_periods.length || this.module === "Recurring") {
      const recurring = this.card(host, "Recurring", "repeat");
      const toggle = this.button(recurring, task.recurring ? "On" : "Off", () => this.owner.run(() => this.owner.service.recurrence(id, this.owner.context?.line.id === id ? this.owner.context : undefined))); toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", "Recurring"); toggle.setAttribute("aria-checked", String(task.recurring));
      if (task.recurrence_periods.length) recurring.createDiv({ cls: "organized-muted", text: `${task.recurrence_periods[0].start} → ${task.recurring ? "active" : task.recurrence_periods[task.recurrence_periods.length - 1].stop}` });
    }
    if (task.projects.length || this.module === "Projects") {
      const projects = this.card(host, "Projects", "folder"); for (const project of task.projects) projects.createDiv({ text: project });
      this.button(projects, "Link projects or topics", () => this.owner.pickProjects(task));
    }
    const file = this.owner.repo.file(this.owner.repo.taskPath(id))!; const body = splitNote(await this.owner.repo.readText(file)).body;
    const sections = ["Information", "Idea", "Question", "Sources", "Notes"];
    let loose = body; for (const section of sections) loose = loose.replace(new RegExp(`(^|\\n)## ${section}\\n[\\s\\S]*?(?=\\n## |$)`), "");
    for (const section of sections) {
      let text = new RegExp(`(?:^|\\n)## ${section}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body)?.[1].trim() ?? "";
      if (section === "Notes") text = `${text}\n${loose}`.trim();
      if (!text && this.module !== section) continue;
      const box = this.card(host, section, "file-text");
      if (text) await MarkdownRenderer.render(this.app, text, box.createDiv({ cls: "organized-task-notes" }), file.path, this.markdown);
      this.button(box, `${text ? "Edit" : "Add"} ${section.toLowerCase()}`, () => this.owner.editModule(id, section));
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
    this.button(host, "Open task note", () => this.app.workspace.getLeaf(false).openFile(file)).addClass("organized-note-link");
  }
  async projects(host: HTMLElement, generation: number): Promise<void> {
    host.createEl("h3", { text: "Favorites" }); const tasks = byPriority(await this.owner.repo.list());
    if (generation !== this.renderId) return;
    const select = (task: Task) => { this.owner.selectedTaskId = task.id; this.origin = "Projects / favorites"; this.tab = "Task"; this.module = ""; return this.render(); };
    for (const task of tasks.filter(t => t.starred && t.status !== "canceled")) this.button(host, `${task.title} · ${task.priority}`, () => select(task));
    host.createEl("h3", { text: "Projects" });
    const projects = [...new Set(tasks.flatMap(t => t.projects))];
    const picker = host.createEl("select", { attr: { "aria-label": "Choose project" } });
    picker.createEl("option", { text: "All projects", value: "" });
    for (const p of projects) picker.createEl("option", { text: p, value: p }); picker.value = this.selectedProject;
    picker.addEventListener("change", () => { this.selectedProject = picker.value; picker.blur(); void this.render().catch(report); });
    for (const task of tasks.filter(t => t.status !== "canceled" && t.projects.length && (!this.selectedProject || t.projects.includes(this.selectedProject)))) this.button(host, `${task.title} · ${task.priority}`, () => select(task));
    host.createEl("h3", { text: "Canceled tasks" });
    for (const task of tasks.filter(t => t.status === "canceled")) {
      const row = host.createDiv(); this.button(row, task.title, () => select(task));
      this.button(row, "Restore", () => this.owner.run(() => this.owner.service.status(task.id, "open")));
    }
  }
}
