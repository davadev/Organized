import { Component, MarkdownPostProcessorContext, MarkdownRenderer, MarkdownRenderChild } from "obsidian";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder, EditorState, Extension } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import type Organized from "./main";
import { parseTasks } from "./codec";
import { elapsed, Task } from "./model";
import { splitNote } from "./repository";
import { report } from "./service";

export const GLYPHS: Record<string, string> = {
  "<": "Scheduled", ">": "Forwarded", "/": "In progress", "!": "Priority", i: "Information", I: "Idea", "?": "Question", "-": "Canceled", "*": "Star", '"': "Source", l: "Location", b: "Project", S: "Savings", p: "Pros", c: "Cons", f: "Recurring", k: "Key", w: "Win", u: "Up", d: "Down", D: "Draft pull request", P: "Open pull request", M: "Merged pull request",
};
export function icon(host: HTMLElement, marker: string): void {
  const label = GLYPHS[marker]; if (!label) return;
  host.createSpan({ cls: "organized-glyph", attr: { "data-marker": marker, role: "img", "aria-label": label } });
}
export async function projection(owner: Organized, host: HTMLElement, task: Task, component: Component): Promise<void> {
  host.addClass("organized-projection"); const selected = owner.settings.displayProperties;
  if (task.scheduled) {
    const scheduled = task.scheduled;
    const link = host.createEl("a", { text: scheduled, cls: "organized-date", href: "#", attr: { "aria-label": `Open daily note for ${scheduled}` } });
    link.addEventListener("click", event => { event.preventDefault(); void owner.service.daily.open(scheduled).catch(report); });
  }
  for (const property of selected) {
    if (property === "scheduled") continue;
    if (property === "notes" || property === "sources") {
      const file = owner.repo.file(owner.repo.taskPath(task.id)); if (!file) continue;
      const body = splitNote(await owner.repo.readText(file)).body;
      const content = property === "notes" ? body : /(?:^|\n)## Sources\n([\s\S]*?)(?=\n## |$)/.exec(body)?.[1] ?? "";
      const block = host.createDiv({ cls: "organized-rich-property" }); await MarkdownRenderer.render(owner.app, content, block, file.path, component);
    } else {
      const value = property === "time_tracked_seconds" ? `${Math.floor(elapsed(task) / 60)} min` : typeof task[property] === "object" ? JSON.stringify(task[property]) : String(task[property]);
      host.createSpan({ cls: "organized-property", text: `${property.replace(/_/g, " ")}: ${value}` });
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
    const host = item.createDiv({ cls: "organized-properties" });
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
      this.containerEl.empty(); await projection(this.owner, this.containerEl, task, this.markdown);
    } catch { this.containerEl.empty(); this.containerEl.createSpan({ cls: "organized-muted", text: "Missing/invalid task · use attach/create to repair" }); }
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
  constructor(readonly owner: Organized, readonly id: string, readonly revision: number) { super(); }
  eq(other: PropertyWidget): boolean { return this.id === other.id && this.revision === other.revision; }
  toDOM(): HTMLElement {
    const host = createDiv(); const component = new Component(); this.component = component; component.load();
    let disposed = false; component.register(() => { disposed = true; });
    void this.owner.repo.read(this.id).then(async task => { if (!disposed) await projection(this.owner, host, task, component); }).catch(() => { if (!disposed) host.setText("Missing task; repair via attach/create"); });
    return host;
  }
  destroy(): void { this.component?.unload(); this.component = null; }
  ignoreEvent(): boolean { return false; }
}
export function editorExtension(owner: Organized): Extension {
  // Block widgets require a direct state field. No note writes are possible here.
  const field = StateField.define<DecorationSet>({
    create: state => build(state, owner),
    update: (old, transaction) => transaction.docChanged || transaction.selection || transaction.effects.some(e => e.is(refreshEffect)) ? build(transaction.state, owner) : old,
    provide: f => EditorView.decorations.from(f),
  });
  const icons = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    build(view: EditorView): DecorationSet {
      if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      const tasks = parseTasks(view.state.doc.toString());
      for (const task of tasks) {
        const line = view.state.doc.line(task.line + 1);
        if (!view.visibleRanges.some(r => r.from <= line.to && r.to >= line.from) || (view.state.selection.main.head >= line.from && view.state.selection.main.head <= line.to)) continue;
        if (task.marker === ">") builder.add(line.from, line.from, Decoration.line({ class: "organized-forwarded" }));
        if (GLYPHS[task.marker]) builder.add(line.from + task.prefix.length - 1, line.from + task.prefix.length + 2, Decoration.replace({ widget: new IconWidget(task.marker) }));
      }
      return builder.finish();
    }
    update(update: ViewUpdate): void { if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(t => t.effects.some(e => e.is(refreshEffect)))) this.decorations = this.build(update.view); }
  }, { decorations: value => value.decorations });
  return [field, icons, EditorView.updateListener.of(update => owner.onEditorUpdate(update))];
}
function build(state: EditorState, owner: Organized): DecorationSet {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  const ranges = [];
  for (const task of parseTasks(state.doc.toString())) {
    if (!task.id) continue;
    const line = state.doc.line(task.line + 1);
    if (state.selection.main.head >= line.from && state.selection.main.head <= line.to) continue;
    ranges.push(Decoration.widget({ widget: new PropertyWidget(owner, task.id, owner.revision), block: true, side: 1 }).range(line.to));
  }
  return Decoration.set(ranges, true);
}
export function refreshEditor(view: EditorView): void { view.dispatch({ effects: refreshEffect.of(null) }); }
