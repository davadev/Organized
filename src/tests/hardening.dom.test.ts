// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { duplicateRepeats, parseTasks } from '../codec';
import { localDate, nextDate } from '../model';
import { DAILY } from '../recurrence';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); Notice.instances.length = 0; document.body.empty(); window.localStorage.clear(); });
async function loaded(role?: 'secondary' | 'mirror') {
  window.localStorage.clear(); if (role) window.localStorage.setItem('organized-device-role:Vault', role);
  vi.useFakeTimers(); const h = harness(); (h.app.workspace as any).layoutReady = false;
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload(); h.layout.forEach(fn => fn()); vi.useRealTimers(); await flush();
  return { h, plugin, command: (id: string) => (plugin as any).commands?.find((c: any) => c.id === id) };
}
const messages = () => Notice.instances.map(n => String(n.message));
const line = (id: string, marker = ' ', repeat = true) => `- [${marker}] Gym <!--organized:${id}-->${repeat ? ' <!--organized:repeat-->' : ''}`;

describe('duplicate recurring lines', () => {
  it('finds a repeat copy that says exactly what an earlier open one says, and nothing else', () => {
    const find = (text: string) => duplicateRepeats(parseTasks(text));
    expect(find(`${line('abcd1234')}\n${line('abcd1234')}\n${line('abcd1234')}`)).toEqual([1, 2]);
    expect(find(`${line('abcd1234')}\n${line('abcd1234', 'x')}`)).toEqual([]);
    expect(find(`${line('abcd1234')}\n${line('abcd1234').replace('Gym', 'Gym 2')}`)).toEqual([]);
    expect(find(`${line('abcd1234', ' ', false)}\n${line('abcd1234', ' ', false)}`)).toEqual([]);
    expect(find('- [ ] Plain\n- [ ] Plain')).toEqual([]);
    expect(find(`${line('abcd1234')}\n${line('abcd1234')}\n    ${line('efgh5678')}`)).toEqual([]);
  });
  it('are removed on request, leaving everything else, and the change can be undone', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Daily/x.md', `# Day\n${line('abcd1234')}\n- [ ] Mine\n${line('abcd1234')}\r\n`.replace('\r\n', '\n'));
    expect(await plugin.service.removeDuplicateRepeats(file)).toBe(1); expect(h.texts.get('Daily/x.md')).toBe(`# Day\n${line('abcd1234')}\n- [ ] Mine\n`);
    expect(await plugin.service.removeDuplicateRepeats(file)).toBe(0); await plugin.service.undo(); expect(h.texts.get('Daily/x.md')).toContain(`Mine\n${line('abcd1234')}`);
  });
  it('are announced once when a daily note holding them opens, and a clean or other note says nothing', async () => {
    const { h, plugin } = await loaded(); const date = localDate(); const path = plugin.service.daily.path(date);
    const file: any = await h.add(path, `${line('abcd1234')}\n${line('abcd1234')}\n${line('abcd1234')}\n`); const other: any = await h.add('Notes/a.md', `${line('abcd1234')}\n${line('abcd1234')}`); const clean: any = await h.add(plugin.service.daily.path(nextDate(date)), line('abcd1234'));
    vi.spyOn(plugin.service, 'reconcile').mockResolvedValue();
    for (const f of [file, file, other, clean]) h.events['file-open'].forEach(fn => fn(f)); h.events['file-open'].forEach(fn => fn(null)); await flush();
    expect(messages()).toEqual([expect.stringContaining('has 2 duplicate recurring lines')]);
    const single: any = await h.add(plugin.service.daily.path(nextDate(nextDate(date))), `${line('abcd1234')}\n${line('abcd1234')}`); h.events['file-open'].forEach(fn => fn(single)); await flush(); expect(messages().at(-1)).toContain('has 1 duplicate recurring line ');
    const gone: any = { path: plugin.service.daily.path(nextDate(nextDate(nextDate(date)))) }; h.events['file-open'].forEach(fn => fn(gone)); await flush(); expect(messages()).toHaveLength(2);
  });
  it('the command removes them, or says there are none', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Daily/y.md', `${line('abcd1234')}\n${line('abcd1234')}\n`);
    await (plugin as any).removeDuplicates(file); expect(h.texts.get('Daily/y.md')).toBe(`${line('abcd1234')}\n`);
    Notice.instances.length = 0; await (plugin as any).removeDuplicates(file); expect(messages()).toEqual(['No duplicate recurring lines in this note.']);
  });
});

describe('missing recurring tasks on request', () => {
  const setup = async (role?: 'secondary' | 'mirror') => { const f = await loaded(role); const task = await f.plugin.repo.create('Gym'); await f.plugin.service.recurrence(task.id, DAILY); return { ...f, task }; };
  it('adds only what is missing from the date, today unless a later daily note is open', async () => {
    const { h, plugin, task } = await setup(); const today = localDate(); const path = plugin.service.daily.path(today);
    await h.add(path, '# Day\n'); await h.add('Notes/n.md', ''); await (plugin as any).addMissingRecurring();
    expect(parseTasks(h.texts.get(path)!).filter(t => t.id === task.id)).toHaveLength(1); expect(messages().at(-1)).toContain('Added 1 recurring task to'); expect(messages().at(-1)).toContain('Gym');
    await (plugin as any).addMissingRecurring(); expect(messages().at(-1)).toBe(`Nothing was missing from ${today}.`);
    const later = nextDate(today); const laterFile: any = await h.add(plugin.service.daily.path(later), ''); h.setActive(laterFile, ''); await (plugin as any).addMissingRecurring(); expect(messages().at(-1)).toContain(later);
    h.clearActive(); const notDaily: any = await h.add('Notes/m.md', ''); h.setActive(notDaily, ''); await (plugin as any).addMissingRecurring(); expect(messages().at(-1)).toBe(`Nothing was missing from ${today}.`);
    const past = plugin.service.daily.path('2020-01-01'); const pastFile: any = await h.add(past, ''); h.setActive(pastFile, ''); await (plugin as any).addMissingRecurring(); expect(h.texts.get(past)).toBe('');
  });
  it('is offered as commands that need a note, or fall back to today', async () => {
    const { h, plugin, task } = await setup(); const commands = (plugin as any).commands as any[]; const run = (id: string) => commands.find(c => c.id === id);
    const second = await plugin.repo.create('Read'); await plugin.service.recurrence(second.id, DAILY); await h.add(plugin.service.daily.path(localDate()), ''); run('add-recurring-today').callback(); await flush(); expect(messages().at(-1)).toContain('Added 2 recurring tasks to');
    const file: any = await h.add('Daily/z.md', `${line('abcd1234')}\n${line('abcd1234')}\n`); run('remove-duplicate-repeats').editorCallback({}, { file: null }); await flush(); expect(h.texts.get('Daily/z.md')).toBe(`${line('abcd1234')}\n${line('abcd1234')}\n`);
    run('remove-duplicate-repeats').editorCallback({}, { file }); await flush(); expect(h.texts.get('Daily/z.md')).toBe(`${line('abcd1234')}\n`); expect(task.title).toBe('Gym');
  });
  it('is refused on a mirror and allowed on a secondary device', async () => {
    const mirror = await setup('mirror'); await (mirror.plugin as any).addMissingRecurring(); expect(messages().at(-1)).toContain('mirror');
    Notice.instances.length = 0; const secondary = await setup('secondary'); await (secondary.plugin as any).addMissingRecurring(); expect(messages().at(-1)).toContain('Added 1');
  });
});

describe('task notes that are left out of the list', () => {
  it('are named once: copies of one id, and notes that have an id but cannot be read', async () => {
    const { h, plugin } = await loaded(); const a = await plugin.repo.create('One'); const file = plugin.repo.taskFile(a.id)!;
    await h.add('Tasks/Copy of One.md', h.texts.get(file.path)!); await h.add('Tasks/Broken.md', '---\nid: zzzz1234\ntitle: ""\n---\n'); await h.add('Tasks/Plain note.md', '# Just a note\n');
    await plugin.repo.reindex(); await plugin.repo.list(); await plugin.repo.list();
    const told = messages().filter(m => m.includes('left out')); expect(told).toHaveLength(1); expect(told[0]).toContain('Copy of One.md'); expect(told[0]).toContain('Broken.md'); expect(told[0]).not.toContain('Plain note');
    Notice.instances.length = 0; await h.add('Tasks/Broken two.md', '---\nid: yyyy1234\ntitle: ""\n---\n'); await plugin.repo.list(); expect(messages().some(m => m.includes('Broken two.md'))).toBe(true);
  });
  it('say nothing when every task note reads', async () => {
    const { h, plugin } = await loaded(); await plugin.repo.create('One'); await h.add('Tasks/Plain note.md', '# Just a note\n'); await plugin.repo.list(); expect(messages().filter(m => m.includes('left out'))).toHaveLength(0);
  });
  it('are described by one part only when only one kind is present', async () => {
    const { h, plugin } = await loaded(); await h.add('Tasks/Broken.md', '---\nid: zzzz1234\ntitle: ""\n---\n'); await plugin.repo.list(); const text = messages().find(m => m.includes('left out'))!; expect(text).toContain('cannot be read as tasks'); expect(text).not.toContain('share a task id');
    Notice.instances.length = 0; const a = await plugin.repo.create('Two'); await h.add('Tasks/Copy.md', h.texts.get(plugin.repo.taskFile(a.id)!.path)!); await h.texts.delete('Tasks/Broken.md'); h.files.delete('Tasks/Broken.md'); await plugin.repo.reindex(); await plugin.repo.list(); expect(messages().find(m => m.includes('left out'))).toContain('share a task id');
  });
});

describe('a device that does not fill daily notes', () => {
  it('explains once per new daily note that it did not add the recurring tasks, only for today and later', async () => {
    for (const role of ['secondary', 'mirror'] as const) {
      Notice.instances.length = 0; const { h, plugin } = await loaded(role); const today = plugin.service.daily.path(localDate()); const file: any = await h.add(today, '');
      h.events.create.forEach(fn => fn(file)); h.events.create.forEach(fn => fn(file)); expect(messages()).toEqual([expect.stringContaining(`${role === 'mirror' ? 'a mirror' : 'secondary'}, so it did not add recurring tasks to ${today}`)]);
      const past: any = await h.add(plugin.service.daily.path('2020-01-01'), ''); const other: any = await h.add('Notes/z.md', ''); h.events.create.forEach(fn => { fn(past); fn(other); }); expect(messages()).toHaveLength(1);
    }
  });
});

describe('a new day while the app stays open', () => {
  it("carries forward when the open note is today's and the app comes back, but not for other notes, other roles or a hidden page", async () => {
    const { h, plugin } = await loaded(); const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); const wake = () => { const rec = (plugin as any).domEvents.filter((d: any) => d.type === 'visibilitychange'); rec.forEach((d: any) => d.cb()); };
    const today: any = await h.add(plugin.service.daily.path(localDate()), ''); const other: any = await h.add('Notes/n.md', '');
    wake(); await flush(); expect(reconcile).not.toHaveBeenCalled();
    h.setActive(other, ''); wake(); await flush(); expect(reconcile).not.toHaveBeenCalled();
    h.setActive(today, ''); wake(); await flush(); expect(reconcile).toHaveBeenCalledWith(today);
    reconcile.mockClear(); const secondary = await loaded('secondary'); const sr = vi.spyOn(secondary.plugin.service, 'reconcile').mockResolvedValue(); const t2: any = await secondary.h.add(secondary.plugin.service.daily.path(localDate()), ''); secondary.h.setActive(t2, ''); (secondary.plugin as any).domEvents.filter((d: any) => d.type === 'visibilitychange').forEach((d: any) => d.cb()); await flush(); expect(sr).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true }); wake(); await flush(); expect(reconcile).not.toHaveBeenCalled(); Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
