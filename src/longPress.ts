import { Menu } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type Organized from "./main";
import { parseTasks } from "./codec";

/** The markers offered on a long press: only the ones that act (see the marker reference in the README), never formatting-only letters. */
export const LONG_PRESS_MARKERS: readonly (readonly [string, string])[] = [
  [" ", "Open"], ["x", "Done"], ["/", "In progress"], ["-", "Cancel"], [">", "Forward"], ["<", "Schedule"], ["!", "Priority"], ["*", "Star"],
  ["a", "Description"], ["s", "Sources"], ["j", "Projects"], ["r", "Recurring"], ["n", "Convert to note"], ["t", "Add time"],
];
/** Marker changes that mean "just tick it": on a plain todo they stay a plain edit, as with the native checkbox, instead of creating a task. */
const PLAIN_MARKERS = [" ", "x", "-"];
const HOLD_MS = 500;
/** How far a finger may drift before the press becomes a scroll. */
const SLOP = 10;
/** The click that follows a long press would otherwise tick the checkbox as well. */
const SWALLOW_MS = 600;
const TARGET = "input.task-list-item-checkbox, .organized-glyph";

/** Mobile only: long-pressing a todo's checkbox in a daily note offers the markers as a menu. Choosing one writes the same marker character a person would type, so everything downstream (pickers, status, linking) is the existing typed-marker path. */
export function longPressMenu(owner: Organized): Extension {
  return ViewPlugin.fromClass(class {
    private timer: number | undefined;
    private origin = { x: 0, y: 0 };
    private fired = false;
    private swallowUntil = 0;
    private readonly cleanups: (() => void)[] = [];
    constructor(readonly view: EditorView) {
      const on = (type: string, handler: (event: Event) => void, options: AddEventListenerOptions) => {
        view.dom.addEventListener(type, handler, options); this.cleanups.push(() => view.dom.removeEventListener(type, handler, options));
      };
      on("touchstart", event => this.start(event as TouchEvent), { passive: true, capture: true });
      on("touchmove", event => this.move(event as TouchEvent), { passive: true, capture: true });
      on("touchend", event => this.end(event), { capture: true });
      on("touchcancel", () => this.cancel(), { passive: true, capture: true });
      on("contextmenu", event => { if (this.target(event)) event.preventDefault(); }, { capture: true });
      on("click", event => { if (Date.now() < this.swallowUntil && this.target(event)) { event.preventDefault(); event.stopPropagation(); } }, { capture: true });
    }
    destroy(): void { this.cancel(); for (const cleanup of this.cleanups) cleanup(); }
    private target(event: Event): Element | null { return event.target instanceof Element ? event.target.closest(TARGET) : null; }
    private cancel(): void { window.clearTimeout(this.timer); this.timer = undefined; }
    private start(event: TouchEvent): void {
      this.cancel(); this.fired = false;
      const box = this.target(event); const touch = event.touches[0];
      // A second finger is a pinch, not a press.
      if (!box || event.touches.length !== 1) return;
      this.origin = { x: touch.clientX, y: touch.clientY };
      this.timer = window.setTimeout(() => { this.timer = undefined; this.fire(box); }, HOLD_MS);
    }
    private move(event: TouchEvent): void {
      if (this.timer === undefined) return;
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - this.origin.x, touch.clientY - this.origin.y) > SLOP) this.cancel();
    }
    private end(event: Event): void {
            this.cancel();
      if (this.fired && event.cancelable) event.preventDefault();
    }
    private fire(box: Element): void {
      const { view } = this;
      const pos = view.posAtDOM(box); const line = view.state.doc.lineAt(pos);
      const task = parseTasks(line.text)[0]; if (!task) return;
      const active = owner.activeEditor();
      if (!active || active.editor.getValue() !== view.state.doc.toString() || owner.service.daily.date(active.file.path) === null) return;
      this.fired = true; this.swallowUntil = Date.now() + SWALLOW_MS;
      const menu = new Menu();
      for (const [marker, label] of LONG_PRESS_MARKERS) {
        if (marker === task.marker) continue;
        // Applied after the sheet has gone, so a picker it opens does not fight it for focus.
        menu.addItem(item => item.setTitle(`[${marker === " " ? " " : marker}] ${label}`).onClick(() => { window.setTimeout(() => this.apply(line.from, line.text, marker), 0); }));
      }
      menu.showAtPosition(this.origin);
    }
    /** The line may have changed while the menu was open; then nothing is written. */
    private apply(from: number, text: string, marker: string): void {
      const { view } = this;
      if (from > view.state.doc.length) return;
      const line = view.state.doc.lineAt(from); if (line.from !== from || line.text !== text) return;
      const task = parseTasks(text)[0];
      const at = line.from + task.prefix.length;
      const plain = !task.id && PLAIN_MARKERS.includes(marker);
      view.dispatch({ changes: { from: at, to: at + 1, insert: marker }, selection: { anchor: line.to }, ...(plain ? {} : { userEvent: "input.type" }) });
    }
  });
}
