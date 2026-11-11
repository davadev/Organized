// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { LONG_PRESS_MARKERS, longPressMenu, readingLongPress } from '../longPress';
import { editorExtension } from '../render';
import { Menu, Platform } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';

installObsidianDom();
afterEach(() => { vi.useRealTimers(); Platform.isMobile = false; Menu.last = null; });

const LINKED = '- [ ] Linked <!--organized:abcd1234-->';
function setup(doc = `plain text\n- [ ] Plain\n${LINKED}`, path = 'Daily/2026-01-01.md') {
  vi.useFakeTimers();
  const events: (string | undefined)[] = [];
  const state: { view: EditorView } = {} as never;
  const owner: any = {
    settings: { longPressMenu: true },
    activeEditor: () => ({ editor: { getValue: () => state.view.state.doc.toString() }, file: { path } }),
    service: { daily: { date: (p: string) => p.startsWith('Daily/') ? '2026-01-01' : null } },
  };
  const parent = document.createElement('div'); document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [longPressMenu(owner), EditorView.updateListener.of(u => u.transactions.forEach(t => events.push(t.annotation(Transaction.userEvent))))] }),
    parent,
  });
  state.view = view;
  // Stand-in for Live Preview's rendered checkbox. CodeMirror removes foreign nodes from its content, so it sits beside it and is mapped to its line.
  const at = new Map<Element, number>(); const real = view.posAtDOM.bind(view);
  view.posAtDOM = (node: Node, offset?: number) => at.get(node as Element) ?? real(node, offset);
  const boxFor = (line: number) => {
    const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'task-list-item-checkbox'; view.dom.appendChild(box); at.set(box, view.state.doc.line(line + 1).from); return box;
  };
  return { view, events, owner, boxFor, parent };
}
function touch(type: string, target: Element, x = 5, y = 5, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as any;
  event.touches = type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
  event.targetTouches = event.touches; event.changedTouches = event.touches;
  target.dispatchEvent(event); return event as Event;
}
const items = () => Menu.last!.items.map(i => i.title);
const hold = () => vi.advanceTimersByTime(500);

describe('long-press marker menu', () => {
  it('only offers markers that act, never formatting-only letters', () => {
    expect(LONG_PRESS_MARKERS.map(([m]) => m).join('')).toBe(' x/-><!*asjrnt+');
  });
  it('is registered by the editor extension on mobile only', () => {
    const owner: any = { onEditorUpdate: () => undefined };
    expect((editorExtension(owner) as unknown[]).length).toBe(5);
    Platform.isMobile = true;
    expect((editorExtension(owner) as unknown[]).length).toBe(6);
  });
  it('opens the menu at the finger after a long press, with icons and the current marker ticked', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box, 40, 60); hold();
    expect(items()).toEqual(LONG_PRESS_MARKERS.map(([m, l]) => `[${m === ' ' ? '\u00a0' : m}] ${l}`));
    expect(Menu.last!.items.map(i => i.icon).every(Boolean)).toBe(true);
    expect(Menu.last!.items.filter(i => i.checked).map(i => i.title)).toEqual(['[\u00a0] Open']);
    expect(Menu.last!.at).toEqual({ x: 40, y: 60 });
    const end = touch('touchend', box); expect(end.defaultPrevented).toBe(true);
    view.destroy();
  });
  it('ticks the marker the todo has now', () => {
    const { view, boxFor } = setup('- [x] Done <!--organized:abcd1234-->'); const box = boxFor(0);
    touch('touchstart', box); hold();
    expect(Menu.last!.items.filter(i => i.checked).map(i => i.title)).toEqual(['[x] Done']);
    view.destroy();
  });
  it('does nothing for a short tap, a drift, a second finger, a cancel or a target that is not a checkbox', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box); vi.advanceTimersByTime(300); const end = touch('touchend', box); hold(); expect(Menu.last).toBeNull(); expect(end.defaultPrevented).toBe(false);
    touch('touchstart', box, 0, 0); touch('touchmove', box, 0, 30); hold(); expect(Menu.last).toBeNull();
    touch('touchstart', box, 0, 0); touch('touchmove', box, 3, 3); hold(); expect(Menu.last).not.toBeNull(); Menu.last = null;
    touch('touchstart', box, 0, 0, 2); hold(); expect(Menu.last).toBeNull();
    touch('touchstart', box); touch('touchcancel', box); hold(); expect(Menu.last).toBeNull();
    touch('touchmove', box, 0, 99); hold(); expect(Menu.last).toBeNull();
    touch('touchstart', view.contentDOM.querySelectorAll('.cm-line')[0]); hold(); expect(Menu.last).toBeNull();
    view.destroy();
  });
  it('ignores presses outside daily notes, on lines that are not todos and when the editor is not the active note', () => {
    const other = setup(undefined, 'Notes/Plain.md'); touch('touchstart', other.boxFor(2)); hold(); expect(Menu.last).toBeNull(); other.view.destroy();
    const prose = setup(); touch('touchstart', prose.boxFor(0)); hold(); expect(Menu.last).toBeNull();
    prose.owner.activeEditor = () => null; touch('touchstart', prose.boxFor(2)); hold(); expect(Menu.last).toBeNull();
    prose.owner.activeEditor = () => ({ editor: { getValue: () => 'another note' }, file: { path: 'Daily/2026-01-01.md' } }); touch('touchstart', prose.boxFor(2)); hold(); expect(Menu.last).toBeNull();
    prose.view.destroy();
  });
  it('swallows the click that follows a long press, and only for a short while', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    const click = () => { const e = new Event('click', { bubbles: true, cancelable: true }); box.dispatchEvent(e); return e.defaultPrevented; };
    expect(click()).toBe(false);
    touch('touchstart', box); hold(); expect(click()).toBe(true);
    const elsewhere = new Event('click', { bubbles: true, cancelable: true }); view.contentDOM.dispatchEvent(elsewhere); expect(elsewhere.defaultPrevented).toBe(false);
    Menu.last!.hide(); vi.advanceTimersByTime(700); expect(click()).toBe(false);
    view.destroy();
  });
  it('ignores the click that dismisses the menu by tapping outside it, and not later ones', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    const click = () => { const e = new Event('click', { bubbles: true, cancelable: true }); box.dispatchEvent(e); return e.defaultPrevented; };
    touch('touchstart', box); hold(); touch('touchend', box);
    vi.advanceTimersByTime(5000); expect(click()).toBe(true);
    Menu.last!.hide(); expect(click()).toBe(true);
    vi.advanceTimersByTime(700); expect(click()).toBe(false);
    view.destroy();
  });
  it('a menu that never reports closing cannot block the checkbox for good', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box); hold(); vi.advanceTimersByTime(61000);
    const e = new Event('click', { bubbles: true, cancelable: true }); box.dispatchEvent(e); expect(e.defaultPrevented).toBe(false);
    view.destroy();
  });
  it('keeps the native context menu away from a checkbox and leaves other targets alone', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    const own = new Event('contextmenu', { bubbles: true, cancelable: true }); box.dispatchEvent(own); expect(own.defaultPrevented).toBe(true);
    const other = new Event('contextmenu', { bubbles: true, cancelable: true }); view.contentDOM.dispatchEvent(other); expect(other.defaultPrevented).toBe(false);
    const text = new Event('click', { bubbles: true, cancelable: true }); document.body.dispatchEvent(text); expect(text.defaultPrevented).toBe(false);
    const node = document.createTextNode('x'); view.dom.appendChild(node); touch('touchstart', node as unknown as Element); hold(); expect(Menu.last).toBeNull();
    view.destroy();
  });
  it('a touch that ends without a long press, or cannot be cancelled, is left alone', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box); hold();
    const end = new Event('touchend', { bubbles: true, cancelable: false }); box.dispatchEvent(end); expect(end.defaultPrevented).toBe(false);
    view.destroy();
  });
  it('writes the chosen marker as typed input on a linked todo and puts the caret on the line', () => {
    const { view, events, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box); hold(); Menu.last!.items.find(i => i.title === '[x] Done')!.click();
    expect(view.state.doc.toString()).toContain('- [ ] Linked'); vi.runOnlyPendingTimers();
    expect(view.state.doc.line(3).text).toBe('- [x] Linked <!--organized:abcd1234-->');
    expect(events).toEqual(['input.type']); expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);
    view.destroy();
  });
  it('ticks a plain todo as a plain edit but lets an action marker act as typed', () => {
    const { view, events, boxFor } = setup(); const box = boxFor(1);
    touch('touchstart', box); hold(); Menu.last!.items.find(i => i.title === '[x] Done')!.click(); vi.runOnlyPendingTimers();
    expect(view.state.doc.line(2).text).toBe('- [x] Plain'); expect(events).toEqual([undefined]);
    touch('touchstart', box); hold(); Menu.last!.items.find(i => i.title === '[<] Schedule')!.click(); vi.runOnlyPendingTimers();
    expect(view.state.doc.line(2).text).toBe('- [<] Plain'); expect(events).toEqual([undefined, 'input.type']);
    view.destroy();
  });
  it('writes nothing when the line changed or went away while the menu was open', () => {
    const changed = setup(); touch('touchstart', changed.boxFor(2)); hold(); const pick = Menu.last!.items.find(i => i.title === '[x] Done')!;
    changed.view.dispatch({ changes: { from: 0, insert: 'inserted\n' } }); pick.click(); vi.runOnlyPendingTimers();
    expect(changed.view.state.doc.toString()).toBe(`inserted\nplain text\n- [ ] Plain\n${LINKED}`); changed.view.destroy();
    const gone = setup(); touch('touchstart', gone.boxFor(2)); hold(); const pickGone = Menu.last!.items.find(i => i.title === '[x] Done')!;
    gone.view.dispatch({ changes: { from: 0, to: gone.view.state.doc.length, insert: '' } }); pickGone.click(); vi.runOnlyPendingTimers();
    expect(gone.view.state.doc.toString()).toBe(''); gone.view.destroy();
    const moved = setup(); touch('touchstart', moved.boxFor(2)); hold(); const pickMoved = Menu.last!.items.find(i => i.title === '[x] Done')!;
    moved.view.dispatch({ changes: { from: 11, insert: 'x' } }); pickMoved.click(); vi.runOnlyPendingTimers(); expect(moved.view.state.doc.toString()).not.toContain('[x]'); moved.view.destroy();
  });
  it('does nothing when the setting is off, and choosing the marker the todo already has changes nothing', () => {
    const off = setup(); off.owner.settings.longPressMenu = false; touch('touchstart', off.boxFor(2)); hold(); expect(Menu.last).toBeNull(); off.view.destroy();
    const same = setup(); touch('touchstart', same.boxFor(2)); hold(); Menu.last!.items.find(i => i.checked)!.click(); vi.runOnlyPendingTimers();
    expect(same.view.state.doc.line(3).text).toBe(LINKED); expect(same.events).toEqual([]); same.view.destroy();
  });
  it('gives a short tick where the device can vibrate', () => {
    const vibrate = vi.fn(); (navigator as any).vibrate = vibrate;
    try { const { view, boxFor } = setup(); touch('touchstart', boxFor(2)); hold(); expect(vibrate).toHaveBeenCalledWith(10); view.destroy(); } finally { delete (navigator as any).vibrate; }
  });
  it('ignores a checkbox inside a rendered description, which is not the todo line it hangs under', () => {
    const { view, boxFor } = setup(); const inner = boxFor(2); const projection = document.createElement('span'); projection.className = 'organized-projection'; view.dom.appendChild(projection); projection.appendChild(inner);
    touch('touchstart', inner); hold(); expect(Menu.last).toBeNull(); view.destroy();
  });
  it('stops listening and clears a pending press when the editor is destroyed', () => {
    const { view, boxFor } = setup(); const box = boxFor(2);
    touch('touchstart', box); view.destroy(); hold(); expect(Menu.last).toBeNull();
    touch('touchstart', box); hold(); expect(Menu.last).toBeNull();
  });
});

describe('long-press marker menu in Reading view', () => {
  function reading(raw: string, over: { id?: string | null; daily?: boolean; on?: boolean } = {}) {
    vi.useFakeTimers();
    const file: any = { path: over.daily === false ? 'Notes/Plain.md' : 'Daily/2026-01-01.md' };
    const owner: any = {
      settings: { longPressMenu: over.on ?? true },
      service: { daily: { date: (p: string) => p.startsWith('Daily/') ? '2026-01-01' : null }, clean: vi.fn().mockResolvedValue(undefined) },
      run: (fn: () => Promise<unknown>) => fn(), trigger: vi.fn().mockResolvedValue(undefined),
    };
    const task: any = { raw, line: 4, prefix: '- [', marker: raw[3], title: 'T', id: over.id === undefined ? 'abcd1234' : over.id };
    const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'task-list-item-checkbox'; document.body.appendChild(box);
    readingLongPress(owner, box, file, task);
    return { owner, file, task, box };
  }
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  it('writes the marker with the service and runs it for a linked todo, and swallows the click that follows', async () => {
    const { owner, file, task, box } = reading('- [ ] T');
    touch('touchstart', box, 7, 9); hold(); expect(Menu.last!.at).toEqual({ x: 7, y: 9 }); expect(Menu.last!.items).toHaveLength(LONG_PRESS_MARKERS.length - 1); expect(items().some(t => t.startsWith('[+]'))).toBe(false);
    const click = new Event('click', { bubbles: true, cancelable: true }); box.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
    Menu.last!.items.find(i => i.title === '[<] Schedule')!.click(); vi.runOnlyPendingTimers(); await flush();
    expect(owner.service.clean).toHaveBeenCalledWith({ file, line: task }, '<'); expect(owner.trigger).toHaveBeenCalledWith({ file, line: { ...task, marker: '<' } });
  });
  it('only ticks, reopens or cancels a plain todo, with no task created', async () => {
    const { owner, box } = reading('- [ ] T', { id: null });
    touch('touchstart', box); hold(); expect(items()).toEqual(['[\u00a0] Open', '[x] Done', '[-] Cancel']);
    Menu.last!.items.find(i => i.title === '[x] Done')!.click(); vi.runOnlyPendingTimers(); await flush();
    expect(owner.service.clean).toHaveBeenCalledWith(expect.anything(), 'x'); expect(owner.trigger).not.toHaveBeenCalled();
  });
  it('stays quiet outside daily notes and when the setting is off, and survives a failed write', async () => {
    const outside = reading('- [ ] T', { daily: false }); touch('touchstart', outside.box); hold(); expect(Menu.last).toBeNull();
    const off = reading('- [ ] T', { on: false }); touch('touchstart', off.box); hold(); expect(Menu.last).toBeNull();
    const failing = reading('- [ ] T'); failing.owner.service.clean.mockRejectedValue(new Error('Task context changed'));
    touch('touchstart', failing.box); hold(); Menu.last!.items.find(i => i.title === '[x] Done')!.click(); vi.runOnlyPendingTimers(); await flush();
    expect(failing.owner.trigger).not.toHaveBeenCalled();
  });
});
