import { Component, ItemView, MarkdownRenderer, Setting, WorkspaceLeaf } from "obsidian";
import { moment } from "./moment";
import type Organized from "./main";
import { elapsed, localDate, PRIORITIES, STATUSES, Task } from "./model";
import { byPriority, report } from "./service";
import { DatePicker } from "./modals";
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
  private renderId = 0;
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
      const b = tabs.createEl("button", { text: tab, attr: { role: "tab", "aria-selected": String(this.tab === tab) } });
      b.addEventListener("click", () => { this.tab = tab; void this.render().catch(report); });
    }
    const panel = host.createDiv({ cls: "organized-panel", attr: { role: "tabpanel" } });
    if (this.tab === "Calendar") this.calendar(panel);
    else if (this.tab === "Task") await this.task(panel, generation);
    else await this.projects(panel, generation);
  }
  button(host: HTMLElement, label: string, action: () => Promise<unknown> | void): HTMLButtonElement {
    const b = host.createEl("button", { text: label }); b.addEventListener("click", () => { try { const result = action(); if (result) void result.catch(report); } catch (error) { report(error); } }); return b;
  }
  calendar(host: HTMLElement): void {
    const nav = host.createDiv({ cls: "organized-calendar-nav" });
    this.button(nav, "Previous month", () => { this.month.subtract(1, "month"); return this.render(); });
    nav.createEl("h3", { text: this.month.format("MMMM YYYY"), attr: { "aria-live": "polite" } });
    this.button(nav, "Next month", () => { this.month.add(1, "month"); return this.render(); });
    this.button(host, "Today", () => { this.month = moment().startOf("month"); return this.selectDay(localDate()); });
    const grid = host.createDiv({ cls: "organized-calendar", attr: { role: "group", "aria-label": this.month.format("MMMM YYYY") } });
    const start = this.month.clone().startOf("week");
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "organized-weekday", text: start.clone().add(i, "days").format("dd") });
    for (let i = 0; i < 42; i++) {
      const date = start.clone().add(i, "days"); const key = date.format("YYYY-MM-DD");
      const b = this.button(grid, date.format("D"), () => this.selectDay(key));
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
      stats.setText(`${tasks.filter(t => ["open", "in_progress"].includes(t.status)).length} active · ${completed} completed today · ${tasks.filter(t => t.time_tracking_started_at).length} timers`);
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
    host.createDiv({ cls: "organized-muted", text: `${this.origin} · ${id}` });
    if (this.origin !== "Editor cursor") this.button(host, "Back to projects", () => { this.tab = "Projects"; return this.render(); });
    new Setting(host).setName("Title").addText(t => t.setValue(task.title).onChange(value => { t.inputEl.dataset.draft = value; t.inputEl.onblur = () => { if (value !== task.title) void this.owner.run(() => this.owner.service.title(id, value)); }; }));
    new Setting(host).setName("Status").addDropdown(d => { for (const s of STATUSES) d.addOption(s, s.replace(/_/g, " ")); d.setValue(task.status).onChange(value => { if (STATUSES.includes(value as Task["status"])) void this.owner.run(() => this.owner.service.status(id, value as Task["status"], this.owner.context ?? undefined)); }); });
    new Setting(host).setName("Priority").addDropdown(d => { for (const p of PRIORITIES) d.addOption(p, p); d.setValue(task.priority).onChange(value => { void this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, priority: value as Task["priority"] })); this.owner.refresh(); }); }); });
    this.button(host, `Schedule: ${task.scheduled ?? "none"}`, () => { new DatePicker(this.app, task.scheduled ?? localDate(), date => this.owner.run(() => this.owner.service.scheduleTask(id, date, this.owner.context ?? undefined))).open(); });
    new Setting(host).setName("Timer").setDesc(`${Math.floor(elapsed(task) / 60)} minutes${task.time_tracking_started_at ? " · running (wall-clock, persists across restarts)" : ""}`)
      .addButton(b => b.setButtonText(task.time_tracking_started_at ? "Stop timer" : "Start timer").onClick(() => { void this.owner.run(() => this.owner.service.status(id, task.time_tracking_started_at ? "open" : "in_progress", this.owner.context ?? undefined)); }));
    new Setting(host).setName("Recurring").setDesc("Include in current/future existing and newly created daily notes. Never creates daily notes.")
      .addToggle(t => t.setValue(task.recurring).onChange(() => { void this.owner.run(() => this.owner.service.recurrence(id, this.owner.context?.line.id === id ? this.owner.context : undefined)); }));
    new Setting(host).setName("Favorite").addToggle(t => t.setValue(task.starred).onChange(value => { void this.owner.run(async () => { await this.owner.repo.update(id, t => ({ ...t, starred: value })); this.owner.refresh(); }); }));
    this.button(host, "Link projects or topics", () => this.owner.pickProjects(task));
    host.createDiv({ text: task.projects.join(", ") || "No project links" });
    const file = this.owner.repo.file(this.owner.repo.taskPath(id))!; const body = splitNote(await this.owner.repo.readText(file)).body;
    this.button(host, "Open canonical task note", () => this.app.workspace.getLeaf(false).openFile(file));
    for (const section of ["Information", "Idea", "Question", "Sources"] as const) {
      const box = host.createDiv({ cls: "organized-task-module" }); box.createEl("h4", { text: section });
      this.button(box, `Edit ${section.toLowerCase()}`, () => this.owner.editModule(id, section));
      if (this.module === section) box.addClass("organized-selected-module");
    }
    host.querySelector<HTMLElement>(".organized-selected-module")?.scrollIntoView({ block: "nearest" });
    const notes = host.createDiv({ cls: "organized-task-notes" }); await MarkdownRenderer.render(this.app, body, notes, file.path, this.markdown);
    host.createEl("h4", { text: "Movement history" });
    for (const event of task.movement_history) host.createDiv({ cls: "organized-muted", text: `${event.kind} · ${event.source} · ${event.from} → ${event.to} · ${event.at}` });
    if (task.recurrence_periods.length) host.createDiv({ text: `Recurrence: ${task.recurrence_periods[0].start} → ${task.recurring ? "active" : task.recurrence_periods[task.recurrence_periods.length - 1].stop}` });
    host.createEl("h4", { text: "References" }); const refs = host.createDiv({ text: "Loading references…" });
    const paths = await this.owner.service.refs(id); if (generation !== this.renderId) return;
    refs.empty();
    if (!paths.length) refs.createDiv({ text: "No references found. Use attach/create to link this task." });
    for (const notePath of paths) this.button(refs, notePath, () => { const note = this.owner.repo.file(notePath); if (!note) throw new Error("Reference was renamed or removed."); return this.app.workspace.getLeaf(false).openFile(note); });
  }
  async projects(host: HTMLElement, generation: number): Promise<void> {
    host.createEl("h3", { text: "Favorites" }); const tasks = byPriority(await this.owner.repo.list());
    if (generation !== this.renderId) return;
    const select = (task: Task) => { this.owner.selectedTaskId = task.id; this.origin = "Projects / favorites"; this.tab = "Task"; return this.render(); };
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
