import { Component, MarkdownPostProcessorContext, MarkdownRenderer, MarkdownRenderChild, Notice, setIcon } from "obsidian";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder, EditorState, Extension, Prec } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import type Organized from "./main";
import { noteSection, parseTasks } from "./codec";
import { DisplayProperty, elapsed, localDate, STATUS_ICONS, Task } from "./model";
import { projectName, splitNote } from "./repository";
import { rgbOf } from "./colors";
import { formatMinutes } from "./sessions";
import { report } from "./service";

export const GLYPHS: Record<string, string> = {
  "<": "Scheduled", ">": "Forwarded", "/": "In progress", "!": "Priority", i: "Description", I: "Idea", "?": "Question", "-": "Canceled", "*": "Star", '"': "Source", l: "Location", b: "Project", S: "Savings", p: "Pros", c: "Cons", f: "Recurring", a: "Description", j: "Project", e: "Idea", q: "Question", s: "Source", r: "Recurring", k: "Key", w: "Win", u: "Up", d: "Down", D: "Draft pull request", P: "Open pull request", M: "Merged pull request",
};
export function icon(host: HTMLElement, marker: string): void {
  const label = GLYPHS[marker]; if (!label) return;
  host.createSpan({ cls: "organized-glyph", attr: { "data-marker": marker, role: "img", "aria-label": label } });
}
/** Notes and sources render as Markdown blocks and need their own row; every other property is a short label that sits beside the title. */
export function hasRichProperties(owner: Organized): boolean { return owner.settings.displayProperties.some(p => p === "description" || p === "sources"); }
/** A property shown as a small symbol instead of `name: value`: an icon, a state class for its colour, a label for screen readers and, when the value matters, a short text. */
export interface Symbol { icon: string; cls: string; label: string; text?: string }
export function symbol(host: HTMLElement, compact: Symbol): void {
  const span = host.createSpan({ cls: `organized-property organized-symbol ${compact.cls}`, attr: { role: "img", "aria-label": compact.label } });
  setIcon(span.createSpan({ cls: "organized-symbol-icon", attr: { "aria-hidden": "true" } }), compact.icon);
  if (compact.text) span.createSpan({ cls: "organized-symbol-text", text: compact.text });
}
const STATUS_LABELS: Record<Task["status"], string> = { open: "open", in_progress: "in progress", completed: "completed", canceled: "canceled" };
/** The compact symbol for a displayed property, or null when there is nothing to show (no moves yet). */
export function symbolOf(property: Exclude<DisplayProperty, "scheduled" | "projects" | "description" | "sources">, task: Task): Symbol | null {
  const minutes = formatMinutes(Math.floor(elapsed(task) / 60));
  switch (property) {
    case "status": return { icon: STATUS_ICONS[task.status], cls: `organized-status-${task.status}`, label: `Status: ${STATUS_LABELS[task.status]}` };
    case "priority": return { icon: "flag", cls: `organized-priority-${task.priority}`, label: `Priority: ${task.priority}` };
    case "starred": return { icon: "star", cls: task.starred ? "organized-symbol-starred" : "organized-symbol-off", label: task.starred ? "Starred" : "Not starred" };
    case "recurring": return { icon: "repeat", cls: task.recurring ? "organized-symbol-recurring" : "organized-symbol-off", label: `Recurring: ${task.recurring ? "on" : "off"}` };
    case "time_tracked_seconds": return { icon: "timer", cls: task.time_tracking_started_at ? "organized-symbol-running" : "organized-symbol-muted", label: `Time tracked: ${minutes}${task.time_tracking_started_at ? ", running" : ""}`, text: minutes };
    case "created": { const day = localDate(new Date(task.created)); return { icon: "calendar", cls: "organized-symbol-muted", label: `Created ${day}`, text: day }; }
    case "movement_history": return task.movement_history.length ? { icon: "arrow-right", cls: "organized-symbol-muted", label: `Moved ${task.movement_history.length} time${task.movement_history.length === 1 ? "" : "s"}`, text: String(task.movement_history.length) } : null;
  }
}
/** The task's projects as links showing only the project name, in the project's colour (darker on a light theme, brighter on a dark one) when it has one. */
function projectLinks(owner: Organized, host: HTMLElement, task: Task): void {
  for (const project of task.projects) {
    const link = host.createEl("a", { text: projectName(project), cls: "organized-property organized-project-link", href: "#", attr: { "aria-label": `Open project ${projectName(project)}` } });
    const color = owner.repo.projectColor(project); if (color) { link.setAttribute("data-project", ""); link.setCssProps({ "--organized-chip-bg": rgbOf(color) }); }
    link.addEventListener("click", event => { event.preventDefault(); const file = owner.repo.file(project); if (file) void owner.app.workspace.getLeaf(false).openFile(file); else new Notice(`The project note ${project} no longer exists.`); });
  }
}
/** `live` turns false once a newer draw or a teardown owns `host`, so an older projection stops appending after its awaits. */
export async function projection(owner: Organized, host: HTMLElement, task: Task, component: Component, live: () => boolean = () => true): Promise<void> {
  host.addClass("organized-projection"); const selected = owner.settings.displayProperties;
  if (task.scheduled && owner.settings.showScheduledDate) {
    const scheduled = task.scheduled;
    const link = host.createEl("a", { text: scheduled, cls: "organized-date", href: "#", attr: { "aria-label": `Open daily note for ${scheduled}` } });
    link.addEventListener("click", event => { event.preventDefault(); void owner.run(() => owner.service.daily.open(scheduled)); });
  }
  for (const property of selected) {
    if (!live()) return;
    if (property === "scheduled") continue;
    if (property === "projects") { projectLinks(owner, host, task); continue; }
    if (property === "description" || property === "sources") {
      const file = owner.repo.taskFile(task.id); if (!file) continue;
      const body = splitNote(await owner.repo.readText(file)).body; if (!live()) return;
      const content = noteSection(body, property === "description" ? "Description" : "Sources");
      const block = host.createDiv({ cls: "organized-rich-property" }); await MarkdownRenderer.render(owner.app, content, block, file.path, component);
    } else {
      const compact = symbolOf(property, task); if (compact) symbol(host, compact);
    }
  }
}
export async function reading(owner: Organized, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
  const info = ctx.getSectionInfo(el); if (!info) return;
  const tasks = parseTasks(info.text).filter(t => t.line >= info.lineStart && t.line <= info.lineEnd);
  const items = Array.from(el.querySelectorAll<HTMLElement>("li.task-list-item"));
  for (let i = 0; i < Math.min(tasks.length, items.length); i++) {
    const task = tasks[i]; const item = items[i]; item.addClass("organized-task-line");
    if (task.marker === ">") item.addClass("organized-forwarded");
    const checkbox = item.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (checkbox && GLYPHS[task.marker]) { checkbox.addClass("organized-checkbox"); checkbox.dataset.organizedMarker = task.marker; }
    if (!task.id) continue;
    if (checkbox) checkbox.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      const file = owner.repo.file(ctx.sourcePath); if (!file || !task.id) return;
      const context = { file, line: task }; const status = task.marker.toLowerCase() === "x" ? "open" : "completed";
      void owner.run(async () => { await owner.service.clean(context, status === "completed" ? "x" : " "); await owner.service.status(task.id!, status, context); });
    }, { capture: true });
    const rich = hasRichProperties(owner); const host = rich ? item.createDiv({ cls: "organized-properties" }) : item.createSpan({ cls: "organized-properties" });
    // Beside the title, not after a nested list.
    const nested = rich ? null : item.querySelector(":scope > ul, :scope > ol"); if (nested) nested.before(host);
    const child = new ReadingProjection(host, owner, task.id); ctx.addChild(child); await child.draw();
  }
}
class ReadingProjection extends MarkdownRenderChild {
  private generation = 0;
  private markdown: Component | null = null;
  constructor(el: HTMLElement, readonly owner: Organized, readonly id: string) { super(el); }
  onload(): void {
    const update = () => { void this.draw().catch(report); };
    this.owner.projectionListeners.add(update); this.register(() => this.owner.projectionListeners.delete(update));
  }
  onunload(): void { this.generation++; }
  async draw(): Promise<void> {
    const generation = ++this.generation;
    try {
      const task = await this.owner.repo.read(this.id); if (generation !== this.generation) return;
      if (this.markdown) this.removeChild(this.markdown);
      this.markdown = this.addChild(new Component());
      this.containerEl.empty(); await projection(this.owner, this.containerEl, task, this.markdown, () => generation === this.generation);
    } catch { if (generation !== this.generation) return; this.containerEl.empty(); this.containerEl.createSpan({ cls: "organized-muted", text: "Missing/invalid task · use attach/create to repair" }); }
  }
}
const refreshEffect = StateEffect.define<null>();
class IconWidget extends WidgetType {
  constructor(readonly marker: string) { super(); }
  eq(other: IconWidget): boolean { return this.marker === other.marker; }
  toDOM(): HTMLElement { const host = createSpan(); icon(host, this.marker); return host; }
}
class PropertyWidget extends WidgetType {
  private component: Component | null = null;
  constructor(readonly owner: Organized, readonly id: string, readonly revision: number, readonly inline: boolean) { super(); }
  eq(other: PropertyWidget): boolean { return this.id === other.id && this.revision === other.revision && this.inline === other.inline; }
  toDOM(): HTMLElement {
    const host = this.inline ? createSpan() : createDiv(); const component = new Component(); this.component = component; component.load();
    let disposed = false; component.register(() => { disposed = true; });
    void this.owner.repo.read(this.id).then(async task => { if (!disposed) await projection(this.owner, host, task, component, () => !disposed); }).catch(() => { if (!disposed) host.setText("Missing task; repair via attach/create"); });
    return host;
  }
  destroy(): void { this.component?.unload(); this.component = null; }
  ignoreEvent(): boolean { return false; }
}
export function editorExtension(owner: Organized): Extension {
  // Block widgets require a direct state field. No note writes are possible here.
  const field = StateField.define<DecorationSet>({
    create: state => build(state, owner),
    update: (old, transaction) => transaction.docChanged || transaction.effects.some(e => e.is(refreshEffect)) ? build(transaction.state, owner) : old,
    provide: f => EditorView.decorations.from(f),
  });
  const icons = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    build(view: EditorView): DecorationSet {
      if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      const byLine = new Map(parseTasks(view.state.doc.toString()).map(task => [task.line, task]));
      for (let number = 1; number <= view.state.doc.lines; number++) {
        const line = view.state.doc.line(number);
        if (!line.text.includes("<!--organized:") && !byLine.has(number - 1)) continue;
        if (!view.visibleRanges.some(r => r.from <= line.to && r.to >= line.from)) continue;
        const task = byLine.get(number - 1);
        if (task) {
          const editing = view.state.selection.main.head >= line.from && view.state.selection.main.head <= line.to;
          if (!editing && task.marker === ">") builder.add(line.from, line.from, Decoration.line({ class: "organized-forwarded" }));
          if (!editing && GLYPHS[task.marker]) builder.add(line.from + task.prefix.length - 1, line.from + task.prefix.length + 2, Decoration.replace({ widget: new IconWidget(task.marker) }));
        }
        // Live Preview used to reveal the whole ID whenever its line had the
        // caret. Identity is implementation metadata, not editable preview UI.
        // Hidden on any line, not only valid task lines: while the marker is
        // being retyped ("[/]" -> "[]" -> "[>]") the line stops parsing as a task
        // and the ID would flash.
        for (const comment of line.text.matchAll(/<!--organized:(?:[a-zA-Z0-9_-]{8,80}|repeat)-->/g)) builder.add(line.from + comment.index, line.from + comment.index + comment[0].length, Decoration.replace({}));
      }
      return builder.finish();
    }
    update(update: ViewUpdate): void { if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(t => t.effects.some(e => e.is(refreshEffect)))) this.decorations = this.build(update.view); }
  }, { decorations: value => value.decorations, provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none) });
  return [field, icons, Prec.highest(keymap.of([{ key: "Enter", run: stepPastComments }])), EditorView.updateListener.of(update => owner.onEditorUpdate(update))];
}
const TRAILING_COMMENTS = /^(?:\s*<!--organized:(?:[a-zA-Z0-9_-]{8,80}|repeat)-->)+\s*$/;
/** The hidden ID comments sit after the visible text, so Enter at the visible end would split them onto the new line and orphan the task above. Step the caret past them first, then let the normal Enter (list continuation) run. */
export function stepPastComments(view: EditorView): boolean {
  const { main } = view.state.selection; if (!main.empty) return false;
  const line = view.state.doc.lineAt(main.head);
  if (main.head < line.to && TRAILING_COMMENTS.test(line.text.slice(main.head - line.from))) view.dispatch({ selection: { anchor: line.to } });
  return false;
}
function build(state: EditorState, owner: Organized): DecorationSet {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  const ranges = [];
  for (const task of parseTasks(state.doc.toString())) {
    if (!task.id) continue;
    const line = state.doc.line(task.line + 1);
    // The line being edited keeps its properties: hiding them there made the list jump with every click.
    // CodeMirror drops a block widget placed exactly at the end of a document
    // without a trailing newline; an inline widget there still renders.
    // Short properties sit to the right of the title; rich ones (notes, sources) get a block row below.
    const inline = !hasRichProperties(owner);
    ranges.push(Decoration.widget({ widget: new PropertyWidget(owner, task.id, owner.revision, inline), block: !inline && line.to < state.doc.length, side: 1 }).range(line.to));
  }
  return Decoration.set(ranges, true);
}
export function refreshEditor(view: EditorView): void { view.dispatch({ effects: refreshEffect.of(null) }); }
