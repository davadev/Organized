import { App, Component, Modal, Setting, SuggestModal } from "obsidian";
import { path, PRIORITIES, Priority, Task, validDate, WorkSession } from "./model";
import { isoFromInput, lengthOf, localInput, sessionProblem } from "./sessions";
import { report } from "./service";
import { renderMarkdownLinks } from "./markdown";

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
  constructor(app: App, readonly tasks: Task[], readonly choose: (choice: TaskChoice) => Promise<void>, query = "", readonly allowTodo = false, readonly allowCreate = true) {
    super(app); this.markdown.load(); decorate(this); this.setPlaceholder("Find an existing task or create a new one"); this.inputEl.value = query;
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
export class DatePicker extends Modal {
  constructor(app: App, readonly initial: string, readonly choose: (date: string) => Promise<void>) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText("Schedule task"); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Scheduled date" });
    const input = this.contentEl.createEl("input", { type: "date", attr: { "aria-label": "Scheduled date" } }); input.value = this.initial;
    new Setting(this.contentEl).addButton(b => b.setButtonText("Schedule").setCta().onClick(() => {
      if (!validDate(input.value)) { input.setCustomValidity("Choose a valid date."); input.reportValidity(); return; }
      this.close(); void this.choose(input.value).catch(report);
    }));
    input.focus();
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
  constructor(app: App, readonly notes: string[], selected: string[], readonly save: (notes: string[]) => Promise<void>, readonly folder = "") { super(app); decorate(this); this.selected = new Set(selected); }
  onOpen(): void {
    this.titleEl.setText("Link projects or topics"); this.contentEl.addClass("organized-modal");
    this.contentEl.createEl("label", { cls: "organized-modal-label", text: "Find or create a root note" });
    const search = this.contentEl.createEl("input", { type: "search", attr: { "aria-label": "Find or create project note", placeholder: "Find or create a root note" } });
    const results = this.contentEl.createDiv({ cls: "organized-project-results" });
    const paint = () => {
      results.empty(); const query = search.value.trim();
      const notes = new Set([...this.notes, ...this.selected].filter(n => n.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
      if (query && !query.includes("/")) { try { notes.add(path(`${this.folder ? `${this.folder}/` : ""}${query.replace(/\.md$/, "")}.md`)); } catch { /* Invalid drafts cannot be selected. */ } }
      for (const note of notes) {
        const label = results.createEl("label", { cls: "organized-project-choice" });
        const input = label.createEl("input", { type: "checkbox" }); input.checked = this.selected.has(note);
        label.createSpan({ text: `${note}${this.notes.includes(note) ? "" : " (create)"}` });
        input.addEventListener("change", () => { if (input.checked) this.selected.add(note); else this.selected.delete(note); });
      }
    };
    search.addEventListener("input", paint); paint();
    new Setting(this.contentEl).addButton(b => b.setButtonText("Save links").setCta().onClick(() => { this.close(); void this.save([...this.selected]).catch(report); }));
    search.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}

export interface SessionEdit {
  heading: string; taskTitle: string; start: string; end: string;
  save: (session: WorkSession) => Promise<void>; remove?: () => Promise<void>; openTask?: () => Promise<void>;
}
/** Adds or edits one block of time worked: the task, a start and an end, with the length shown as you type. */
export class SessionModal extends Modal {
  constructor(app: App, readonly edit: SessionEdit, readonly now = () => Date.now()) { super(app); decorate(this); }
  onOpen(): void {
    this.titleEl.setText(this.edit.heading); this.contentEl.addClass("organized-modal");
    this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-task", text: this.edit.taskTitle });
    const field = (label: string, iso: string) => {
      this.contentEl.createEl("label", { cls: "organized-modal-label", text: label });
      const input = this.contentEl.createEl("input", { type: "datetime-local", attr: { "aria-label": label } }); input.value = localInput(iso); return input;
    };
    const start = field("Start", this.edit.start); const end = field("End", this.edit.end);
    const note = this.contentEl.createDiv({ cls: "organized-modal-copy organized-session-note", attr: { role: "status" } });
    const read = () => ({ start: isoFromInput(start.value), end: isoFromInput(end.value) });
    const paint = () => {
      const { start: from, end: to } = read(); const problem = sessionProblem(from, to, this.now());
      note.setText(problem ?? `Length: ${lengthOf({ start: from!, end: to! })}`); note.toggleClass("organized-session-problem", problem !== null);
    };
    start.addEventListener("input", paint); end.addEventListener("input", paint); paint();
    const actions = new Setting(this.contentEl);
    actions.addButton(b => b.setButtonText("Save").setCta().onClick(() => {
      const { start: from, end: to } = read(); const problem = sessionProblem(from, to, this.now()); if (problem) { paint(); return; }
      this.close(); void this.edit.save({ start: from!, end: to! }).catch(report);
    }));
    if (this.edit.openTask) { const open = this.edit.openTask; actions.addButton(b => b.setButtonText("Open task").onClick(() => { this.close(); void open().catch(report); })); }
    if (this.edit.remove) { const remove = this.edit.remove; actions.addButton(b => { b.setButtonText("Delete").onClick(() => { this.close(); void remove().catch(report); }); b.buttonEl.addClass("mod-warning"); }); }
    start.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}
