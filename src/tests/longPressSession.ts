// Shared set-up for the long-press tests that run through the real plugin: a real editor with the plugin's own extensions, the real Organized
// pipeline and the real repository, with the press simulated by touch events on a stand-in Live Preview checkbox.
import { vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import Organized from '../main';
import type { Task } from '../model';
import { editorExtension } from '../render';
import { harness } from './harness';
import { Menu, Platform } from './__mocks__/obsidian';

export const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };

/** The editor Obsidian hands the plugin reads and writes the same document and caret as the view. */
function bind(editor: any, view: EditorView) {
  Object.assign(editor, {
    getValue: () => view.state.doc.toString(), getLine: (n: number) => view.state.doc.toString().split('\n')[n],
    setValue: (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    getCursor: () => { const line = view.state.doc.lineAt(view.state.selection.main.head); return { line: line.number - 1, ch: view.state.selection.main.head - line.from }; },
    replaceRange: (text: string, from: Pos, to: Pos = from) => { const at = (p: Pos) => view.state.doc.line(p.line + 1).from + p.ch; view.dispatch({ changes: { from: at(from), to: at(to), insert: text }, userEvent: 'input.organized' }); },
    setCursor: (p: Pos) => view.dispatch({ selection: { anchor: view.state.doc.line(p.line + 1).from + p.ch } }),
    // The plugin's own writes go through here and carry the `input.organized` user event.
    transaction: (spec: { changes: { from: Pos; to: Pos; text: string }[] }) => {
      const at = (p: Pos) => view.state.doc.line(p.line + 1).from + p.ch;
      view.dispatch({ changes: spec.changes.map(c => ({ from: at(c.from), to: at(c.to), insert: c.text })), userEvent: 'input.organized' });
    },
  });
}
interface Pos { line: number; ch: number }
export async function session(doc: string, path = 'Daily/2026-01-01.md', settings: Record<string, unknown> = {}) {
  vi.useFakeTimers(); Platform.isMobile = true; Menu.last = null;
  const h = harness();
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload(); Object.assign(plugin.settings, settings); h.setSettings(settings as never);
  const file: any = await h.add(path, doc);
  const parent = document.createElement('div'); document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions: editorExtension(plugin) }), parent });
  const editor: any = h.setActive(file, doc);
  bind(editor, view);
  const at = new Map<Element, number>(); const real = view.posAtDOM.bind(view);
  view.posAtDOM = (node: Node, offset?: number) => at.get(node as Element) ?? real(node, offset);
  const press = (line: number, title: string) => {
    const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'task-list-item-checkbox'; view.dom.appendChild(box); at.set(box, view.state.doc.line(line + 1).from);
    const start = new Event('touchstart', { bubbles: true, cancelable: true }) as any; start.touches = start.targetTouches = start.changedTouches = [{ clientX: 1, clientY: 1 }];
    box.dispatchEvent(start); vi.advanceTimersByTime(500);
    const menu = Menu.last;
    return menu ? { pick: async () => { menu.items.find(i => i.title === title)!.click(); vi.runOnlyPendingTimers(); await flush(); } } : null;
  };
  const text = () => view.state.doc.toString();
  return { h, plugin, view, press, text, done: () => view.destroy() };
}
export const ID = 'abcd123456';
export const linked = (marker = ' ') => `- [${marker}] Linked <!--organized:${ID}-->`;
export async function withTask(marker = ' ', settings: Record<string, unknown> = {}, path?: string) {
  const s = await session(linked(marker), path, settings);
  // A task note with the id the line carries, so status changes have something to change.
  const task = await s.plugin.repo.create('Linked'); const doc = linked(marker).replace(ID, task.id);
  s.view.dispatch({ changes: { from: 0, to: s.view.state.doc.length, insert: doc } }); (s.h.texts as Map<string, string>).set('Daily/2026-01-01.md', doc);
  bind(s.h.setActive(s.h.repo.file('Daily/2026-01-01.md')!, doc), s.view);
  return { ...s, task };
}


/** A daily note holding linked todos: `build` gets the ids of `count` freshly created tasks (titles `Task 1`, `Task 2`, ...) and returns the note text. */
export async function withTasks(count: number, build: (ids: string[]) => string, settings: Record<string, unknown> = {}) {
  const s = await session('placeholder', undefined, settings);
  const tasks: Task[] = []; for (let i = 1; i <= count; i++) tasks.push(await s.plugin.repo.create(`Task ${i}`));
  const doc = build(tasks.map(t => t.id));
  s.view.dispatch({ changes: { from: 0, to: s.view.state.doc.length, insert: doc } }); (s.h.texts as Map<string, string>).set('Daily/2026-01-01.md', doc);
  bind(s.h.setActive(s.h.repo.file('Daily/2026-01-01.md')!, doc), s.view);
  return { ...s, tasks, read: (i: number) => s.plugin.repo.read(tasks[i].id) };
}
