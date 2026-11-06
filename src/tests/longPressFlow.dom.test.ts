// @vitest-environment happy-dom
// The long-press menu end to end: a real editor with the plugin's own extensions, the real Organized pipeline and the real repository,
// so a pick is judged by what lands in the note and in the task notes, across settings and kinds of todo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import Organized from '../main';
import { editorExtension } from '../render';
import { harness } from './harness';
import { Menu, Platform } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';

installObsidianDom();
afterEach(() => { vi.useRealTimers(); Platform.isMobile = false; Menu.last = null; });
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };

/** The editor Obsidian hands the plugin reads and writes the same document and caret as the view. */
function bind(editor: any, view: EditorView) {
  Object.assign(editor, {
    getValue: () => view.state.doc.toString(), getLine: (n: number) => view.state.doc.toString().split('\n')[n],
    setValue: (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    getCursor: () => { const line = view.state.doc.lineAt(view.state.selection.main.head); return { line: line.number - 1, ch: view.state.selection.main.head - line.from }; },
    // The plugin's own writes go through here and carry the `input.organized` user event.
    transaction: (spec: { changes: { from: Pos; to: Pos; text: string }[] }) => {
      const at = (p: Pos) => view.state.doc.line(p.line + 1).from + p.ch;
      view.dispatch({ changes: spec.changes.map(c => ({ from: at(c.from), to: at(c.to), insert: c.text })), userEvent: 'input.organized' });
    },
  });
}
interface Pos { line: number; ch: number }
async function session(doc: string, path = 'Daily/2026-01-01.md', settings: Record<string, unknown> = {}) {
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
const ID = 'abcd123456';
const linked = (marker = ' ') => `- [${marker}] Linked <!--organized:${ID}-->`;
async function withTask(marker = ' ', settings: Record<string, unknown> = {}, path?: string) {
  const s = await session(linked(marker), path, settings);
  // A task note with the id the line carries, so status changes have something to change.
  const task = await s.plugin.repo.create('Linked'); const doc = linked(marker).replace(ID, task.id);
  s.view.dispatch({ changes: { from: 0, to: s.view.state.doc.length, insert: doc } }); (s.h.texts as Map<string, string>).set('Daily/2026-01-01.md', doc);
  bind(s.h.setActive(s.h.repo.file('Daily/2026-01-01.md')!, doc), s.view);
  return { ...s, task };
}

describe('long-press menu through the real plugin', () => {
  it('completes, reopens and cancels a linked task, and the task note follows', async () => {
    const s = await withTask(); const read = () => s.plugin.repo.read(s.task.id);
    await (s.press(0, '[x] Done'))!.pick(); expect(s.text()).toContain('[x]'); expect((await read()).status).toBe('completed');
    await (s.press(0, '[ ] Open'))!.pick(); expect(s.text()).toContain('[ ]'); expect((await read()).status).toBe('open');
    await (s.press(0, '[-] Cancel'))!.pick(); expect(s.text()).toContain('[-]'); expect((await read()).status).toBe('canceled');
    s.done();
  });
  it('starts a timer from In progress and stops it again when the todo is reopened', async () => {
    const s = await withTask();
    await (s.press(0, '[/] In progress'))!.pick(); const running = await s.plugin.repo.read(s.task.id); expect(running.status).toBe('in_progress'); expect(running.time_tracking_started_at).toBeTruthy();
    await (s.press(0, '[ ] Open'))!.pick(); expect((await s.plugin.repo.read(s.task.id)).time_tracking_started_at).toBeFalsy();
    s.done();
  });
  it('ticks a plain todo without creating a task for Done, Open and Cancel', async () => {
    const s = await session('- [ ] Plain todo');
    await (s.press(0, '[x] Done'))!.pick(); expect(s.text()).toBe('- [x] Plain todo');
    await (s.press(0, '[-] Cancel'))!.pick(); expect(s.text()).toBe('- [-] Plain todo');
    await (s.press(0, '[ ] Open'))!.pick(); expect(s.text()).toBe('- [ ] Plain todo');
    expect(await s.plugin.repo.list()).toHaveLength(0); s.done();
  });
  it('turns a plain todo into a task when an acting marker is picked, as typing it would', async () => {
    const s = await session('- [ ] Plain todo'); const trigger = vi.spyOn(s.plugin, 'trigger').mockResolvedValue();
    await (s.press(0, '[*] Star'))!.pick();
    const tasks = await s.plugin.repo.list(); expect(tasks).toHaveLength(1); expect(tasks[0].title).toBe('Plain todo'); expect(trigger).toHaveBeenCalledOnce();
    expect(s.text()).toMatch(/^- \[\*\] Plain todo <!--organized:/); s.done();
  });
  it('opens the date picker for Schedule and the priority picker for Priority on a linked task', async () => {
    const s = await withTask(); const trigger = vi.spyOn(s.plugin, 'trigger').mockResolvedValue();
    await (s.press(0, '[<] Schedule'))!.pick(); expect(trigger).toHaveBeenLastCalledWith(expect.objectContaining({ line: expect.objectContaining({ marker: '<' }) }));
    await (s.press(0, '[!] Priority'))!.pick(); expect(trigger).toHaveBeenLastCalledWith(expect.objectContaining({ line: expect.objectContaining({ marker: '!' }) }));
    expect(trigger).toHaveBeenCalledTimes(2); s.done();
  });
  it('works on indented, numbered and starred list items, and turns an upper-case X into the lower-case one', async () => {
    for (const [doc, line, expected] of [
      ['- [ ] Parent\n    - [ ] Nested', 1, '- [ ] Parent\n    - [x] Nested'], ['1. [ ] Numbered', 0, '1. [x] Numbered'],
      ['* [ ] Starred bullet', 0, '* [x] Starred bullet'], ['+ [X] Upper', 0, '+ [x] Upper'],
    ] as const) {
      const s = await session(doc); const m = s.press(line, '[x] Done'); if (!m) throw new Error('no menu for ' + JSON.stringify(doc)); await m.pick(); expect(s.text()).toBe(expected); s.done();
    }
  });
  it('only touches the pressed todo in a note with several', async () => {
    const s = await session('# Day\n- [ ] One\n- [ ] Two\n\nprose [ ] not a todo\n- [ ] Three');
    await (s.press(2, '[x] Done'))!.pick();
    expect(s.text()).toBe('# Day\n- [ ] One\n- [x] Two\n\nprose [ ] not a todo\n- [ ] Three'); s.done();
  });
});

describe('long-press menu across settings', () => {
  it('stays silent when the setting is off, and starts again when it is switched back on', async () => {
    const s = await session('- [ ] Plain', undefined, { longPressMenu: false });
    expect(s.press(0, '[x] Done')).toBeNull(); expect(s.text()).toBe('- [ ] Plain');
    s.plugin.settings.longPressMenu = true; await (s.press(0, '[x] Done'))!.pick(); expect(s.text()).toBe('- [x] Plain'); s.done();
  });
  it('follows a custom daily folder and date format', async () => {
    const custom = { dailyFolder: 'Journal/Days', dailyFormat: 'YYYY/MM/DD' };
    const inside = await session('- [ ] Plain', 'Journal/Days/2026/01/01.md', custom); await (inside.press(0, '[x] Done'))!.pick(); expect(inside.text()).toBe('- [x] Plain'); inside.done();
    const old = await session('- [ ] Plain', 'Daily/2026-01-01.md', custom); expect(old.press(0, '[x] Done')).toBeNull(); old.done();
  });
  it('works for a daily folder at the vault root', async () => {
    const s = await session('- [ ] Plain', '2026-01-01.md', { dailyFolder: '' }); await (s.press(0, '[x] Done'))!.pick(); expect(s.text()).toBe('- [x] Plain'); s.done();
  });
  it('is not offered in a note that only looks like a daily note', async () => {
    for (const path of ['Daily/2026-13-45.md', 'Daily/sub/2026-01-01.md', 'Daily/2026-01-01.txt', 'Other/2026-01-01.md', 'Daily/notes.md']) {
      const s = await session('- [ ] Plain', path.endsWith('.txt') ? 'Daily/2026-01-01.md' : path); if (path.endsWith('.txt')) s.plugin.service.daily.date = () => null; expect(s.press(0, '[x] Done')).toBeNull(); s.done();
    }
  });
  it('is never registered on desktop', async () => {
    vi.useFakeTimers(); const h = harness();
    const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false }); await plugin.onload();
    Platform.isMobile = false; const before = (editorExtension(plugin) as unknown[]).length; Platform.isMobile = true; expect((editorExtension(plugin) as unknown[]).length).toBe(before + 1);
  });
});

describe('long-press menu edge cases', () => {
  it('writes nothing when Organized has paused writes to protect newer settings', async () => {
    const s = await withTask(); (s.plugin as any).safety = { ...(s.plugin as any).safety, writable: false };
    await (s.press(0, '[x] Done'))!.pick(); expect((await s.plugin.repo.read(s.task.id)).status).toBe('open'); s.done();
  });
  it('does not stack a second action while a picker is already open', async () => {
    const s = await withTask(); (s.plugin as any).pickerOpen = true; const trigger = vi.spyOn(s.plugin, 'trigger').mockResolvedValue();
    await (s.press(0, '[<] Schedule'))!.pick(); expect(trigger).not.toHaveBeenCalled(); s.done();
  });
  it('a menu opened before the line changed writes nothing over the newer change', async () => {
    const s = await withTask(); const first = s.press(0, '[x] Done')!; const second = s.press(0, '[-] Cancel')!;
    await first.pick(); await second.pick(); expect(s.text()).toContain('[x]'); expect((await s.plugin.repo.read(s.task.id)).status).toBe('completed'); s.done();
  });
  it('keeps a title that contains marker-like text intact', async () => {
    const s = await session('- [ ] Fix [x] and [ ] rendering'); await (s.press(0, '[x] Done'))!.pick(); expect(s.text()).toBe('- [x] Fix [x] and [ ] rendering'); s.done();
  });
  it('leaves the note untouched when the menu is dismissed without a choice', async () => {
    const s = await session('- [ ] Plain'); expect(s.press(0, '[x] Done')).not.toBeNull(); vi.runOnlyPendingTimers(); await flush(); expect(s.text()).toBe('- [ ] Plain'); expect(await s.plugin.repo.list()).toHaveLength(0); s.done();
  });
  it('a todo with an empty title is only ticked, never turned into a task', async () => {
    const s = await session('- [ ]'); expect(s.press(0, '[x] Done')).toBeNull(); s.done();
  });
});
