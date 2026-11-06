// @vitest-environment happy-dom
// More long-press workflows through the real plugin: every acting marker on plain and linked todos, subtasks, odd note layouts and long notes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MARKERS, readingLongPress } from '../longPress';
import { parseTasks } from '../codec';
import Organized from '../main';
import { harness } from './harness';
import { Menu, Notice, Platform } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { flush, session, withTasks } from './longPressSession';

installObsidianDom();
afterEach(() => { vi.useRealTimers(); Platform.isMobile = false; Menu.last = null; });
const title = (marker: string) => `[${marker === ' ' ? '\u00a0' : marker}] ${LONG_PRESS_MARKERS.find(([m]) => m === marker)![1]}`;
const line = (marker: string, id: string, name = 'Task 1') => `- [${marker}] ${name} <!--organized:${id}-->`;

describe('every acting marker, picked from the menu', () => {
  const ACTING = ['<', '!', '>', '*', 'a', 's', 'j', 'r', 'n', 't', '+'];
  it('asks the same thing a typed marker asks, on a linked task', async () => {
    for (const marker of ACTING) {
      const s = await withTasks(1, ([id]) => line(' ', id)); const trigger = vi.spyOn(s.plugin, 'trigger').mockResolvedValue();
      await s.press(0, title(marker))!.pick();
      expect(trigger, marker).toHaveBeenCalledOnce(); expect(trigger.mock.calls[0][0].line.marker, marker).toBe(marker); expect(trigger.mock.calls[0][0].line.id).toBe(s.tasks[0].id);
      s.done();
    }
  });
  it('turns a plain todo into a linked task first, for every acting marker', async () => {
    for (const marker of ACTING) {
      const s = await session('- [ ] Plain todo'); const trigger = vi.spyOn(s.plugin, 'trigger').mockResolvedValue();
      await s.press(0, title(marker))!.pick();
      const tasks = await s.plugin.repo.list(); expect(tasks, marker).toHaveLength(1); expect(tasks[0].title).toBe('Plain todo');
      expect(trigger, marker).toHaveBeenCalledOnce(); expect(s.text()).toMatch(new RegExp(`^- \\[${marker.replace(/[*+]/g, '\\$&')}\\] Plain todo <!--organized:${tasks[0].id}-->$`)); s.done();
    }
  });
  it('opens the inspector on Description and Sources, and clears the marker afterwards', async () => {
    for (const [marker, section] of [['a', 'Description'], ['s', 'Sources']] as const) {
      const s = await withTasks(1, ([id]) => line(' ', id)); const open = vi.spyOn(s.plugin, 'openInspector').mockResolvedValue();
      await s.press(0, title(marker))!.pick(); expect(open).toHaveBeenCalledWith('Task', section); expect(s.text()).toBe(line(' ', s.tasks[0].id)); s.done();
    }
  });
  it('opens the project picker, the note conversion and the time dialog', async () => {
    const s = await withTasks(1, ([id]) => line(' ', id));
    const projects = vi.spyOn(s.plugin, 'pickProjects').mockReturnValue(); const note = vi.spyOn(s.plugin, 'convertToNote').mockReturnValue(); const time = vi.spyOn(s.plugin as any, 'addTime').mockReturnValue(undefined);
    await s.press(0, title('j'))!.pick(); expect(projects).toHaveBeenCalledOnce();
    await s.press(0, title('n'))!.pick(); expect(note).toHaveBeenCalledOnce();
    await s.press(0, title('t'))!.pick(); expect(time).toHaveBeenCalledOnce(); s.done();
  });
  it('stars a task and, because the current marker does nothing, needs another marker in between to unstar it', async () => {
    const s = await withTasks(1, ([id]) => line(' ', id));
    await s.press(0, title('*'))!.pick(); expect((await s.read(0)).starred).toBe(true);
    // A starred todo shows [*]; picking Star again is the ticked row and is a no-op.
    expect(s.text()).toContain('[*]'); expect(s.press(0, title('*'))).not.toBeNull(); Menu.last!.items.find(i => i.checked)!.click(); vi.runOnlyPendingTimers(); await flush(); expect((await s.read(0)).starred).toBe(true);
    await s.press(0, title(' '))!.pick(); await s.press(0, title('*'))!.pick(); expect((await s.read(0)).starred).toBe(false); s.done();
  });
  it('forwards a task to tomorrow', async () => {
    const s = await withTasks(1, ([id]) => line(' ', id)); await s.press(0, title('>'))!.pick();
    const task = await s.read(0); expect(task.scheduled).toBeTruthy(); expect(task.scheduled! > new Date().toISOString().slice(0, 10)).toBe(true); s.done();
  });
});

describe('[+] adds a subtask', () => {
  const rows = (text: string) => text.split('\n');
  it('inserts an empty indented todo under a linked task, restores its marker and opens the task picker for the new line', async () => {
    const s = await withTasks(1, ([id]) => `${line(' ', id)}\nafter`); const pick = vi.spyOn(s.plugin, 'pickTask').mockResolvedValue();
    await s.press(0, title('+'))!.pick();
    expect(rows(s.text())).toEqual([line(' ', s.tasks[0].id), '\t- [ ] ', 'after']); expect(pick).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, true); s.done();
  });
  it('gives the parent back its own marker whatever its status', async () => {
    for (const [from, status] of [['x', 'completed'], ['-', 'canceled'], ['/', 'in_progress'], [' ', 'open']] as const) {
      const s = await withTasks(1, ([id]) => line(from, id)); vi.spyOn(s.plugin, 'pickTask').mockResolvedValue();
      await s.plugin.service.status(s.tasks[0].id, status); await s.press(0, title('+'))!.pick();
      expect(rows(s.text())[0], from).toBe(line(from, s.tasks[0].id)); expect(rows(s.text())[1], from).toBe('\t- [ ] '); s.done();
    }
  });
  it('puts the new line after the todo\'s existing subtasks, one level deeper for a nested parent', async () => {
    const s = await withTasks(3, ([a, b, c]) => `${line(' ', a, 'Task 1')}\n    ${line(' ', b, 'Task 2')}\n    ${line(' ', c, 'Task 3')}\n- [ ] Sibling`); vi.spyOn(s.plugin, 'pickTask').mockResolvedValue();
    await s.press(0, title('+'))!.pick(); expect(rows(s.text()).map(r => r.replace(/ <!--.*$/, ''))).toEqual(['- [ ] Task 1', '    - [ ] Task 2', '    - [ ] Task 3', '\t- [ ] ', '- [ ] Sibling']);
    await s.press(1, title('+'))!.pick(); expect(rows(s.text())[2].startsWith('    \t- [ ] ')).toBe(true); s.done();
  });
  it('links a plain todo first, then adds the subtask', async () => {
    const s = await session('- [ ] Plain todo'); vi.spyOn(s.plugin, 'pickTask').mockResolvedValue();
    await s.press(0, title('+'))!.pick(); const tasks = await s.plugin.repo.list(); expect(tasks).toHaveLength(1); expect(rows(s.text())[0]).toBe(`- [ ] Plain todo <!--organized:${tasks[0].id}-->`); expect(rows(s.text())[1]).toBe('\t- [ ] '); s.done();
  });
  it('says so, and adds nothing, when the note it was typed in is no longer the open one', async () => {
    const s = await withTasks(1, ([id]) => line(' ', id)); const pick = vi.spyOn(s.plugin, 'pickTask').mockResolvedValue(); Notice.instances.length = 0;
    const other: any = await s.h.add('Daily/2026-01-02.md', line('+', s.tasks[0].id));
    await s.plugin.trigger({ file: other, line: parseTasks(line('+', s.tasks[0].id))[0] });
    expect(Notice.instances.at(-1)?.message).toContain('Open the note'); expect(pick).not.toHaveBeenCalled(); expect(rows(s.text())).toHaveLength(1); s.done();
  });
});

describe('subtasks and several todos', () => {
  it('changes a nested linked subtask without touching its parent or siblings', async () => {
    const s = await withTasks(3, ([a, b, c]) => `${line(' ', a, 'Task 1')}\n    ${line(' ', b, 'Task 2')}\n    ${line(' ', c, 'Task 3')}`);
    await s.press(1, title('x'))!.pick();
    expect((await s.read(1)).status).toBe('completed'); expect((await s.read(0)).status).toBe('open'); expect((await s.read(2)).status).toBe('open');
    expect(s.text().split('\n').map(l => /\[(.)\]/.exec(l)![1])).toEqual([' ', 'x', ' ']); s.done();
  });
  it('works on a tab-indented subtask', async () => {
    const s = await withTasks(2, ([a, b]) => `${line(' ', a, 'Task 1')}\n\t${line(' ', b, 'Task 2')}`);
    await s.press(1, title('x'))!.pick(); expect((await s.read(1)).status).toBe('completed'); expect(s.text().split('\n')[1].startsWith('\t- [x]')).toBe(true); s.done();
  });
  it('presses the right todo among identical plain lines', async () => {
    const s = await session('- [ ] Same\n- [ ] Same\n- [ ] Same'); await s.press(1, title('x'))!.pick(); expect(s.text()).toBe('- [ ] Same\n- [x] Same\n- [ ] Same'); s.done();
  });
  it('mixes plain and linked todos in one note', async () => {
    const s = await withTasks(1, ([id]) => `- [ ] Plain first\n${line(' ', id)}\n- [ ] Plain last`);
    await s.press(0, title('x'))!.pick(); await s.press(1, title('x'))!.pick(); await s.press(2, title('-'))!.pick();
    expect(s.text().split('\n').map(l => /\[(.)\]/.exec(l)![1])).toEqual(['x', 'x', '-']); expect((await s.read(0)).status).toBe('completed'); expect(await s.plugin.repo.list()).toHaveLength(1); s.done();
  });
  it('lets a run of picks on different todos each take effect', async () => {
    const s = await withTasks(3, ([a, b, c]) => [a, b, c].map((id, i) => line(' ', id, `Task ${i + 1}`)).join('\n'));
    await s.press(0, title('x'))!.pick(); await s.press(1, title('/'))!.pick(); await s.press(2, title('-'))!.pick();
    expect([(await s.read(0)).status, (await s.read(1)).status, (await s.read(2)).status]).toEqual(['completed', 'in_progress', 'canceled']); s.done();
  });
});

describe('odd note layouts', () => {
  it('finds todos below YAML front matter and under headings', async () => {
    const s = await session('---\ntags: [daily]\n---\n# Morning\n\n- [ ] Stretch\n\n## Work\n- [ ] Email'); await s.press(8, title('x'))!.pick();
    expect(s.text()).toBe('---\ntags: [daily]\n---\n# Morning\n\n- [ ] Stretch\n\n## Work\n- [x] Email'); s.done();
  });
  it('offers no menu for a checkbox in a code block, a quote or a line that is not a list item', async () => {
    const s = await session('```\n- [ ] in code\n```\n\n> - [ ] quoted\n\n[ ] bare brackets');
    for (const n of [1, 4, 6]) { expect(s.press(n, title('x'))).toBeNull(); } expect(s.text()).toContain('- [ ] in code'); s.done();
  });
  it('keeps emoji, wiki-links and tags in the title intact', async () => {
    const title0 = '- [ ] Call 🧑‍⚕️ about [[Plan]] #health **now**'; const s = await session(title0); await s.press(0, title('x'))!.pick(); expect(s.text()).toBe(title0.replace('[ ]', '[x]')); s.done();
  });
  it('handles a todo that is the last line without a trailing newline, and an empty-title neighbour', async () => {
    const s = await session('- [ ] \n- [ ] Last'); await s.press(1, title('x'))!.pick(); expect(s.text()).toBe('- [ ] \n- [x] Last'); s.done();
  });
  it('finds the right line in a long note', async () => {
    const doc = Array.from({ length: 800 }, (_, i) => `- [ ] Item ${i}`).join('\n'); const s = await session(doc);
    await s.press(799, title('x'))!.pick(); const rows = s.text().split('\n'); expect(rows[799]).toBe('- [x] Item 799'); expect(rows.filter(r => r.includes('[x]'))).toHaveLength(1);
    await s.press(0, title('-'))!.pick(); expect(s.text().split('\n')[0]).toBe('- [-] Item 0'); s.done();
  });
});

describe('a menu that stays open while things change', () => {
  it('still applies the pick after the setting is switched off, because the person already chose to open it', async () => {
    const s = await session('- [ ] Plain'); const press = s.press(0, title('x'))!; s.plugin.settings.longPressMenu = false; await press.pick(); expect(s.text()).toBe('- [x] Plain'); s.done();
  });
  it('writes nothing when the note is edited above the todo before choosing', async () => {
    const s = await session('- [ ] Plain'); const press = s.press(0, title('x'))!;
    s.view.dispatch({ changes: { from: 0, insert: 'new line\n' } }); await press.pick(); expect(s.text()).toBe('new line\n- [ ] Plain'); s.done();
  });
  it('writes nothing when the todo was already changed to the chosen marker by hand', async () => {
    const s = await session('- [ ] Plain'); const press = s.press(0, title('x'))!;
    s.view.dispatch({ changes: { from: 3, to: 4, insert: 'x' } }); await press.pick(); expect(s.text()).toBe('- [x] Plain'); s.done();
  });
  it('can open the menu again on the same todo straight after a pick', async () => {
    const s = await session('- [ ] Plain'); await s.press(0, title('x'))!.pick(); const again = s.press(0, title('-')); expect(again).not.toBeNull();
    expect(Menu.last!.items.filter(i => i.checked).map(i => i.title)).toEqual(['[x] Done']); await again!.pick(); expect(s.text()).toBe('- [-] Plain'); s.done();
  });
});

describe('Reading view through the real service', () => {
  async function reading(doc: (id: string) => string, path = 'Daily/2026-01-01.md') {
    vi.useFakeTimers(); Platform.isMobile = true; Menu.last = null;
    const h = harness(); const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
    await plugin.onload(); const task = await plugin.repo.create('Task 1'); const file: any = await h.add(path, doc(task.id));
    const parsed = parseTasks(doc(task.id))[0]; const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'task-list-item-checkbox'; document.body.appendChild(box);
    readingLongPress(plugin, box, file, parsed);
    const press = async (label: string) => {
      const start = new Event('touchstart', { bubbles: true, cancelable: true }) as any; start.touches = start.targetTouches = start.changedTouches = [{ clientX: 1, clientY: 1 }];
      box.dispatchEvent(start); vi.advanceTimersByTime(500); Menu.last!.items.find(i => i.title === label)!.click(); vi.runOnlyPendingTimers(); await flush();
    };
    return { plugin, task, h, file, press };
  }
  it('completes a linked task and writes the marker into the note', async () => {
    const r = await reading(id => line(' ', id)); await r.press(title('x'));
    expect((await r.plugin.repo.read(r.task.id)).status).toBe('completed'); expect(r.h.texts.get(r.file.path)).toBe(line('x', r.task.id)); r.plugin.onunload();
  });
  it('ticks a plain todo in the note without creating a task', async () => {
    const r = await reading(() => '- [ ] Plain'); await r.press(title('x'));
    expect(r.h.texts.get(r.file.path)).toBe('- [x] Plain'); expect(await r.plugin.repo.list()).toHaveLength(1); r.plugin.onunload();
  });
  it('still finds a linked todo by its id when the note shifted since the page was rendered', async () => {
    const r = await reading(id => line(' ', id)); r.h.texts.set(r.file.path, '# moved\n' + r.h.texts.get(r.file.path)); await r.press(title('x'));
    expect(r.h.texts.get(r.file.path)).toBe('# moved\n' + line('x', r.task.id)); r.plugin.onunload();
  });
  it('writes nothing for a plain todo whose line moved since the page was rendered, and reports it', async () => {
    const r = await reading(() => '- [ ] Plain'); r.h.texts.set(r.file.path, '# moved\n- [ ] Plain'); Notice.instances.length = 0; await r.press(title('x'));
    expect(r.h.texts.get(r.file.path)).toBe('# moved\n- [ ] Plain'); expect(Notice.instances.at(-1)?.message).toContain('Task context changed'); r.plugin.onunload();
  });
});
