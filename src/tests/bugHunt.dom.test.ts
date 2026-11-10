// @vitest-environment happy-dom
// Regression tests for the bugs the bug-hunt skill found in the 0.1.4 line. Each fails on the code before its fix.
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { saveRole } from '../device';
import { localDate, markerOf, newTask, setStatus } from '../model';
import { splitNote } from '../repository';

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
});
