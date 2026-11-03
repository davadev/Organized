import { App, Component, Modal, Setting, SuggestModal } from "obsidian";
import { path, PRIORITIES, Priority, Task, validDate, WorkSession } from "./model";
import { isoFromInput, lengthOf, localInput, sessionProblem } from "./sessions";
import { cleanTags, freePath, noteName } from "./notes";
import { report } from "./service";
import { rgbOf } from "./colors";
import { projectName } from "./repository";
import { renderMarkdownLinks } from "./markdown";
import { ONBOARDING_STEPS, OnboardingStep } from "./onboarding";
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
  constructor(app: App, readonly notes: string[], selected: string[], readonly save: (notes: string[]) => Promise<void>, readonly folder = "", readonly colorOf: (note: string) => string | null = () => null) { super(app); decorate(this); this.selected = new Set(selected); }
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
        const color = this.colorOf(note); const dot = label.createSpan({ cls: "organized-project-dot", attr: { "aria-hidden": "true" } });
        if (color) { dot.setAttribute("data-project", ""); dot.setCssProps({ "--organized-chip-bg": rgbOf(color) }); }
        label.createSpan({ text: `${projectName(note, [...this.notes, ...this.selected])}${this.notes.includes(note) ? "" : " (create)"}` });
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
    // `like this` in a step text is shown as code.
    const copy = body.createEl("p", { cls: "organized-modal-copy organized-welcome-text" });
    step.text.split("`").forEach((part, i) => { if (i % 2) copy.createEl("code", { text: part }); else copy.appendText(part); });
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
