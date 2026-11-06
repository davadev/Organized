import { Menu, TFile } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type Organized from "./main";
import { parseTasks, TaskLine } from "./codec";
import { report } from "./service";

/** The markers offered on a long press: only the ones that act (see the marker reference in the README), never formatting-only letters. Each has the icon its row shows. */
export const LONG_PRESS_MARKERS: readonly (readonly [marker: string, label: string, icon: string])[] = [
  [" ", "Open", "circle"], ["x", "Done", "check"], ["/", "In progress", "play"], ["-", "Cancel", "x"], [">", "Forward", "arrow-right"], ["<", "Schedule", "calendar"], ["!", "Priority", "flag"], ["*", "Star", "star"],
  ["a", "Description", "text"], ["s", "Sources", "link"], ["j", "Projects", "folder"], ["r", "Recurring", "repeat"], ["n", "Convert to note", "file-plus"], ["t", "Add time", "timer"],
];
/** Marker changes that mean "just tick it": on a plain todo they stay a plain edit, as with the native checkbox, instead of creating a task. */
const PLAIN_MARKERS = [" ", "x", "-"];
const HOLD_MS = 500;
/** How far a finger may drift before the press becomes a scroll. */
const SLOP = 10;
/** The click that follows a long press would otherwise tick the checkbox as well. */
const SWALLOW_MS = 600;
const TARGET = "input.task-list-item-checkbox, .organized-glyph";
interface Point { x: number; y: number }

/** Watches `host` for a long press on whatever `find` returns for an event. `press` opens the menu and says whether it did; then the trailing click is swallowed and Android gets a short tick. Returns the cleanup. */
export function watchLongPress(host: Element, find: (event: Event) => Element | null, press: (box: Element, at: Point) => boolean): () => void {
  let timer: number | undefined; let origin: Point = { x: 0, y: 0 }; let fired = false; let swallowUntil = 0;
  const cancel = () => { window.clearTimeout(timer); timer = undefined; };
  const listeners: [string, (event: Event) => void, AddEventListenerOptions][] = [
    ["touchstart", event => {
      cancel(); fired = false;
      const { touches } = event as TouchEvent; const box = find(event);
      // A second finger is a pinch, not a press.
      if (!box || touches.length !== 1) return;
      origin = { x: touches[0].clientX, y: touches[0].clientY };
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!press(box, origin)) return;
        fired = true; swallowUntil = Date.now() + SWALLOW_MS;
        // iOS has no vibration API.
        if ("vibrate" in navigator) navigator.vibrate(10);
      }, HOLD_MS);
    }, { passive: true, capture: true }],
    ["touchmove", event => {
      if (timer === undefined) return;
      const touch = (event as TouchEvent).touches[0];
      if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > SLOP) cancel();
    }, { passive: true, capture: true }],
    ["touchend", event => { cancel(); if (fired && event.cancelable) event.preventDefault(); }, { capture: true }],
    ["touchcancel", cancel, { passive: true, capture: true }],
    ["contextmenu", event => { if (find(event)) event.preventDefault(); }, { capture: true }],
    ["click", event => { if (Date.now() < swallowUntil && find(event)) { event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true }],
  ];
  for (const [type, handler, options] of listeners) host.addEventListener(type, handler, options);
  return () => { cancel(); for (const [type, handler, options] of listeners) host.removeEventListener(type, handler, options); };
}

/** The menu: the current marker is ticked and does nothing; a pick is applied after the sheet has gone, so a picker it opens does not fight it for focus. */
function showMarkerMenu(at: Point, current: string, allowed: readonly string[], pick: (marker: string) => void): void {
  const menu = new Menu();
  for (const [marker, label, icon] of LONG_PRESS_MARKERS) {
    if (!allowed.includes(marker)) continue;
    menu.addItem(item => item.setTitle(`[${marker === " " ? " " : marker}] ${label}`).setIcon(icon).setChecked(marker === current).onClick(() => { if (marker !== current) window.setTimeout(() => pick(marker), 0); }));
  }
  menu.showAtPosition(at);
}
const ALL_MARKERS = LONG_PRESS_MARKERS.map(([marker]) => marker);

/** Mobile only: long-pressing a todo's checkbox in a daily note offers the markers as a menu. Choosing one writes the same marker character a person would type, so everything downstream (pickers, status, linking) is the existing typed-marker path. */
export function longPressMenu(owner: Organized): Extension {
  return ViewPlugin.fromClass(class {
    private readonly stop: () => void;
    constructor(readonly view: EditorView) {
      this.stop = watchLongPress(view.dom, event => {
        const box = event.target instanceof Element ? event.target.closest(TARGET) : null;
        // A task list inside a rendered description is not the todo line it hangs under.
        return box?.closest(".organized-projection") ? null : box;
      }, (box, at) => this.open(box, at));
    }
    destroy(): void { this.stop(); }
    private open(box: Element, at: Point): boolean {
      const { view } = this;
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const task = parseTasks(line.text)[0]; if (!task || !owner.settings.longPressMenu) return false;
      const active = owner.activeEditor();
      if (!active || active.editor.getValue() !== view.state.doc.toString() || owner.service.daily.date(active.file.path) === null) return false;
      showMarkerMenu(at, task.marker, ALL_MARKERS, marker => this.apply(line.from, line.text, marker));
      return true;
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

/** The same menu on a Reading view checkbox. There is no typed input to lean on there, so the pick is written with the service and then run as the marker it is. A plain todo can only be ticked, reopened or canceled (typing anything else in Live Preview is what links it). */
export function readingLongPress(owner: Organized, box: HTMLElement, file: TFile, task: TaskLine): void {
  watchLongPress(box, () => box, (_box, at) => {
    if (!owner.settings.longPressMenu || owner.service.daily.date(file.path) === null) return false;
    showMarkerMenu(at, task.marker, task.id ? ALL_MARKERS : PLAIN_MARKERS, marker => {
      void (async () => {
        await owner.run(() => owner.service.clean({ file, line: task }, marker));
        if (task.id) await owner.trigger({ file, line: { ...task, marker } });
      })().catch(report);
    });
    return true;
  });
}
