import { App, Modal, Setting, SuggestModal } from "obsidian";
import { path, PRIORITIES, Priority, Task, validDate } from "./model";
import { report } from "./service";

export class TaskPicker extends SuggestModal<Task | string> {
  constructor(app: App, readonly tasks: Task[], readonly choose: (choice: Task | string) => Promise<void>, query = "") {
    super(app); this.setPlaceholder("Find an existing task or create a new one"); this.inputEl.value = query;
  }
  getSuggestions(query: string): (Task | string)[] {
    const q = query.trim(); const matches = this.tasks.filter(t => t.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
    return q ? [...matches, q] : matches;
  }
  renderSuggestion(value: Task | string, el: HTMLElement): void {
    el.addClass("organized-suggestion");
    if (typeof value === "string") el.createDiv({ text: `Create new task: “${value}”` });
    else { el.createDiv({ text: value.title }); el.createDiv({ cls: "organized-muted", text: `${value.status} · ${value.priority} · ${value.scheduled ?? "unscheduled"} · ${value.id.slice(0, 8)}` }); }
  }
  onChooseSuggestion(value: Task | string): void { void this.choose(value).catch(report); }
}
export class PriorityPicker extends SuggestModal<Priority> {
  constructor(app: App, readonly choose: (priority: Priority) => Promise<void>) { super(app); this.setPlaceholder("Choose priority"); }
  getSuggestions(query: string): Priority[] { return PRIORITIES.filter(p => p.includes(query.toLowerCase())); }
  renderSuggestion(value: Priority, el: HTMLElement): void { el.setText(value[0].toUpperCase() + value.slice(1)); }
  onChooseSuggestion(value: Priority): void { void this.choose(value).catch(report); }
}
export class DatePicker extends Modal {
  constructor(app: App, readonly initial: string, readonly choose: (date: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Schedule task"); this.contentEl.addClass("organized-modal");
    const input = this.contentEl.createEl("input", { type: "date", attr: { "aria-label": "Scheduled date" } }); input.value = this.initial;
    new Setting(this.contentEl).addButton(b => b.setButtonText("Schedule").setCta().onClick(() => {
      if (!validDate(input.value)) { input.setCustomValidity("Choose a valid date."); input.reportValidity(); return; }
      this.close(); void this.choose(input.value).catch(report);
    }));
    input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}
export class TextModal extends Modal {
  constructor(app: App, readonly heading: string, readonly value: string, readonly save: (text: string) => Promise<void>, readonly multiline = true) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.heading); this.contentEl.addClass("organized-modal");
    const input = this.multiline ? this.contentEl.createEl("textarea") : this.contentEl.createEl("input", { type: "text" });
    input.setAttribute("aria-label", this.heading); input.value = this.value;
    new Setting(this.contentEl).addButton(b => b.setButtonText("Save").setCta().onClick(() => { this.close(); void this.save(input.value).catch(report); }));
    input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}
export class ConfirmModal extends Modal {
  private settled = false;
  constructor(app: App, readonly message: string, readonly done: (yes: boolean) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Confirm task action"); this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl).addButton(b => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(b => b.setButtonText("Confirm").setCta().onClick(() => { this.settled = true; this.done(true); this.close(); }));
  }
  onClose(): void { if (!this.settled) this.done(false); this.contentEl.empty(); }
}
export class ProjectPicker extends Modal {
  readonly selected: Set<string>;
  constructor(app: App, readonly notes: string[], selected: string[], readonly save: (notes: string[]) => Promise<void>) { super(app); this.selected = new Set(selected); }
  onOpen(): void {
    this.titleEl.setText("Link projects or topics"); this.contentEl.addClass("organized-modal");
    const search = this.contentEl.createEl("input", { type: "search", attr: { "aria-label": "Find or create project note", placeholder: "Find or create a root note" } });
    const results = this.contentEl.createDiv({ cls: "organized-project-results" });
    const paint = () => {
      results.empty(); const query = search.value.trim();
      const notes = new Set([...this.notes, ...this.selected].filter(n => n.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
      if (query && !query.includes("/")) { try { notes.add(`${path(query.replace(/\.md$/, ""))}.md`); } catch { /* Invalid drafts cannot be selected. */ } }
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
