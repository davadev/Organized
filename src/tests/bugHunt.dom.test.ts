// @vitest-environment happy-dom
// Regression tests for the bugs the bug-hunt skill found in the 0.1.4 line. Each fails on the code before its fix.
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { saveRole } from '../device';
import { parseTasks, writeNoteSection } from '../codec';
import { localDate, markerOf, newTask, setStatus } from '../model';
import { splitNote } from '../repository';
import { ProjectBudgetModal, ProjectPicker } from '../modals';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); document.body.empty(); Notice.instances.length = 0; });
async function loaded(role?: 'secondary') {
  window.localStorage.clear(); vi.useFakeTimers(); const h = harness(); if (role) saveRole(h.app, role); (h.app.workspace as any).layoutReady = false;
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload(); return { h, plugin };
}
const ready = async (h: ReturnType<typeof harness>) => { h.layout.forEach(fn => fn()); vi.useRealTimers(); await flush(); };
const emitCreate = (h: ReturnType<typeof harness>) => { const create = h.app.vault.create.bind(h.app.vault); (h.app.vault as any).create = async (p: string, t: string) => { const f = await create(p, t); h.events.create.forEach(fn => fn(f)); return f; }; };

describe('bug hunt regressions', () => {
  it('a secondary device is not told its note was left unfilled while "Add missing recurring tasks" fills it, but still is for any other new note', async () => {
    const { h, plugin } = await loaded('secondary'); await ready(h); emitCreate(h);
    const task = await plugin.repo.create('Gym'); await plugin.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'daily', recurrence_periods: [{ start: localDate(), stop: null }] }));
    await (plugin as any).addMissingRecurring(); await flush();
    expect(Notice.instances.map(n => n.message)).toEqual(['Added 1 recurring task to ' + localDate() + ': Gym.']);
    expect((plugin as any).catchingUp).toBeNull();
    await h.app.vault.create(plugin.service.daily.path('2999-01-01'), ''); await flush();
    expect(Notice.instances.at(-1)!.message).toContain('This device is secondary');
  });
  it('the marker follows a running timer even where the status stays open (a recurring task), in every place a marker is written', async () => {
    const running = setStatus({ ...newTask('R', 'abcdefgh'), recurring: true }, 'in_progress');
    expect(running.status).toBe('open'); expect(markerOf(running)).toBe('/');
    expect(markerOf(setStatus(running, 'open'))).toBe(' '); expect(markerOf({ ...running, status: 'completed' })).toBe('x'); expect(markerOf({ ...running, status: 'canceled' })).toBe('-');
    expect(markerOf({ ...newTask('P', 'abcdefgi'), status: 'in_progress' })).toBe('/'); expect(markerOf(newTask('O', 'abcdefgj'))).toBe(' ');
    const { h, plugin } = await loaded(); await ready(h); const task = await plugin.repo.create('Daily run'); const today = localDate();
    await plugin.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'daily', recurrence_periods: [{ start: today, stop: null }] }));
    await plugin.run(() => plugin.service.status(task.id, 'in_progress'));
    const note = await h.add(plugin.service.daily.path(today), `- [ ] Daily run <!--organized:${task.id}-->`);
    const context = { file: note, line: (await plugin.taskLines(note as any))[0] } as any;
    const sub = vi.spyOn(plugin as any, 'addSubtask').mockResolvedValue(undefined); h.app.workspace.getActiveFile = () => note as any; (plugin as any).lastNoteEditor = { editor: {}, file: note };
    await (plugin as any).addSubtaskFromMarker(await plugin.repo.read(task.id), context);
    expect(await plugin.repo.readText(note as any)).toContain('- [/] Daily run');
  });
  it('deferred startup work does nothing for a plugin that was disabled before the layout was ready', async () => {
    const { h, plugin } = await loaded(); const interval = vi.spyOn(window, 'setInterval'); const listener = vi.spyOn(document, 'addEventListener');
    plugin.onunload(); await ready(h);
    expect(interval).not.toHaveBeenCalled(); expect(listener.mock.calls.filter(c => c[0] === 'visibilitychange')).toHaveLength(0);
    const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); const note = await h.add(plugin.service.daily.path(localDate()), ''); h.app.workspace.getActiveFile = () => note as any;
    (plugin as any).newDay(); await flush(); expect(reconcile).not.toHaveBeenCalled();
  });
  it('a task the person put back during its planned block is not started again by that block, and is released when the block ends', async () => {
    const { h, plugin } = await loaded(); await ready(h); const { service, repo } = plugin; const task = await repo.create('Focus');
    const at = (hh: number, mm = 0) => new Date(2026, 2, 4, hh, mm).getTime(); const block = { start: new Date(at(9)).toISOString(), end: new Date(at(10)).toISOString() };
    await service.addPlanned(task.id, block); await service.applyPlanning(at(9));
    expect(await repo.read(task.id)).toMatchObject({ status: 'in_progress', auto_started_block: block.start });
    await service.status(task.id, 'open'); expect((await repo.read(task.id)).auto_started_block).toBe(block.start);
    await service.applyPlanning(at(9, 20)); await service.applyPlanning(at(9, 40)); expect((await repo.read(task.id)).status).toBe('open');
    expect(await service.applyPlanning(at(10))).toEqual([]); expect((await repo.read(task.id)).auto_started_block).toBeNull(); expect(splitNote(await repo.readText(repo.taskFile(task.id)!)).frontmatter).not.toHaveProperty('auto_started_block');
    await service.addPlanned(task.id, { start: new Date(at(11)).toISOString(), end: new Date(at(12)).toISOString() }); await service.applyPlanning(at(11, 5)); expect((await repo.read(task.id)).status).toBe('in_progress');
  });
  it('a todo line that cannot be written when a planned block ends is retried on the next pass, not left as [/] on an open task', async () => {
    const { h, plugin } = await loaded(); await ready(h); const { service, repo } = plugin; const task = await repo.create('Focus'); const at = (hh: number, mm = 0) => new Date(2026, 2, 4, hh, mm).getTime();
    await service.addPlanned(task.id, { start: new Date(at(9)).toISOString(), end: new Date(at(10)).toISOString() });
    const note = await h.add(service.daily.path(localDate()), `- [ ] Focus <!--organized:${task.id}-->`); await service.applyPlanning(at(9));
    expect(await repo.readText(note as any)).toContain('- [/] Focus');
    const write = repo.write.bind(repo); let failures = 1;
    vi.spyOn(repo, 'write').mockImplementation(async (file: any, before: string, after: string) => { if (file.path === note.path && failures-- > 0) throw new Error(`${file.path} changed concurrently; preserved. Retry the action.`); return write(file, before, after); });
    await expect(service.applyPlanning(at(10))).resolves.toEqual([]);
    expect(await repo.read(task.id)).toMatchObject({ status: 'in_progress', auto_started_block: new Date(at(9)).toISOString() }); expect(await repo.readText(note as any)).toContain('- [/] Focus');
    await expect(service.applyPlanning(at(10, 1))).resolves.toEqual(['Focus']);
    expect(await repo.read(task.id)).toMatchObject({ status: 'open', auto_started_block: null }); expect(await repo.readText(note as any)).toContain('- [ ] Focus');
    failures = 1; vi.spyOn(repo, 'write').mockImplementation(async () => { throw new Error('disk full'); });
    await service.addPlanned(task.id, { start: new Date(at(11)).toISOString(), end: new Date(at(12)).toISOString() }); vi.restoreAllMocks();
    await service.applyPlanning(at(11)); vi.spyOn(repo, 'write').mockRejectedValue(new Error('disk full')); await expect(service.applyPlanning(at(12))).rejects.toThrow('disk full');
  });
  it('a panel brought back to the foreground on a new day repaints, and not on the same day', async () => {
    const { h, plugin } = await loaded(); await ready(h); const refresh = vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined); const wake = () => (plugin as any).domEvents.filter((d: any) => d.type === 'visibilitychange').forEach((d: any) => d.cb());
    wake(); expect(refresh).not.toHaveBeenCalled();
    (plugin as any).paintedDay = '2000-01-01'; wake(); expect(refresh).toHaveBeenCalledOnce();
    wake(); expect(refresh).toHaveBeenCalledOnce();
  });
  it('a tiny project budget is kept as one second, not silently dropped, and Enter on an already picked best match keeps it picked', async () => {
    const h = harness(); const save = vi.fn().mockResolvedValue(undefined); const modal = new ProjectBudgetModal(h.app, 'P', { total: null, day: null, week: null, month: null }, save); modal.open();
    const fields = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); fields[0].value = '0.0001'; fields[0].dispatchEvent(new Event('input'));
    Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); await flush(); expect(save).toHaveBeenCalledWith({ total: 1, day: null, week: null, month: null });
    const picker = new ProjectPicker(h.app, ['Alpha.md', 'Beta.md'], ['Alpha.md'], vi.fn().mockResolvedValue(undefined)); picker.open();
    const search = picker.contentEl.querySelector('input[type=search]') as HTMLInputElement; search.value = 'alp'; search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); expect([...picker.selected]).toEqual(['Alpha.md']);
    search.value = 'bet'; search.dispatchEvent(new Event('input')); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); expect([...picker.selected].sort()).toEqual(['Alpha.md', 'Beta.md']);
  });
  it('an expired task that has no todo line anywhere is still cleaned up (its kept lines have nowhere to go)', async () => {
    const h = harness(); h.setSettings({ taskRetentionDays: 30, autoForward: false, retentionDetail: 'description' }); const task = await h.repo.create('Lonely');
    await h.repo.update(task.id, t => ({ ...t, status: 'completed', closed_at: new Date(Date.now() - 40 * 86400000).toISOString() })); const file = h.repo.taskFile(task.id)!; h.texts.set(file.path, writeNoteSection(h.texts.get(file.path)!, 'Description', 'why'));
    await h.service.reconcile(await h.add(`Daily/${localDate()}.md`) as any);
    expect(h.repo.taskFile(task.id) ?? null).toBeNull();
  });
  it('one task note that cannot be written does not keep the others from following a renamed note or project', async () => {
    const h = harness(); const a = await h.repo.create('A'); const b = await h.repo.create('B'); const c = await h.repo.create('C');
    for (const t of [a, b, c]) await h.repo.update(t.id, x => ({ ...x, projects: ['P/Old.md'], converted_to: 'N/Old.md' }));
    const update = h.repo.update.bind(h.repo); vi.spyOn(h.repo, 'update').mockImplementation(async (id: string, fn: any) => { if (id === a.id) throw new Error('locked'); return update(id, fn); });
    await expect(h.service.followProjectRename('P/Old.md', 'P/New.md')).rejects.toThrow(`1 task could not follow the renamed project (${a.id})`);
    expect((await h.repo.read(b.id)).projects).toEqual(['P/New.md']); expect((await h.repo.read(c.id)).projects).toEqual(['P/New.md']);
    await expect(h.service.followRename('N/Old.md', 'N/New.md')).rejects.toThrow('1 task could not follow the renamed note');
    expect((await h.repo.read(b.id)).converted_to).toBe('N/New.md'); expect((await h.repo.read(c.id)).converted_to).toBe('N/New.md');
  });
  it('taking a parent off its day leaves its subtask a visible todo there, not an indented code block', async () => {
    const { h, plugin } = await loaded(); await ready(h); const { service, repo } = plugin; const date = '2026-03-06';
    const parent = await repo.create('Parent'); await service.scheduleTask(parent.id, date); const child = await repo.create('Child'); await service.scheduleTask(child.id, date); await service.makeSubtask(parent.id, child.id);
    const path = service.daily.path(date); expect(h.texts.get(path)).toContain('\t- [ ] Child');
    await service.unschedule(parent.id);
    expect(h.texts.get(path)).not.toContain('Parent'); expect(h.texts.get(path)).toContain('\n- [ ] Child');
    expect(parseTasks(h.texts.get(path)!).map(t => t.id)).toEqual([child.id]);
  });
  it('deleting a parent task leaves its subtasks visible todos where they were, not nested under whatever precedes them or turned into code', async () => {
    const { h, plugin } = await loaded(); await ready(h); const { service, repo } = plugin; const date = '2026-03-06'; (service as any).confirm = async () => true;
    const before = await repo.create('Before'); await service.scheduleTask(before.id, date); const parent = await repo.create('Parent'); await service.scheduleTask(parent.id, date);
    const child = await repo.create('Child'); await service.scheduleTask(child.id, date); await service.makeSubtask(parent.id, child.id);
    const path = service.daily.path(date); expect(h.texts.get(path)).toContain('\t- [ ] Child');
    expect(await service.deleteTask(parent.id)).toBe(true);
    const tasks = parseTasks(h.texts.get(path)!); expect(tasks.map(t => t.title)).toEqual(['Before', 'Child']); expect(tasks[1].parent).toBeNull(); expect(h.texts.get(path)).toContain('\n- [ ] Child');
  });
});
