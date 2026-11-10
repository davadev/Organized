// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { loadRole, MIRROR_MESSAGE, saveRole } from '../device';
import { localDate, nextDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY } from '../recurrence';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); document.body.empty(); Notice.instances.length = 0; });
async function loaded(role?: 'secondary' | 'mirror') {
  window.localStorage.clear(); vi.useFakeTimers(); const h = harness(); if (role) saveRole(h.app, role); (h.app.workspace as any).layoutReady = false;
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload(); h.layout[0](); vi.useRealTimers(); await flush();
  return { h, plugin };
}
const tomorrow = () => nextDate(localDate());
const filled = async (h: ReturnType<typeof harness>) => { const path = `Daily/${tomorrow()}.md`; const file: any = await h.add(path, ''); vi.useFakeTimers({ toFake: ['setTimeout'] }); h.events.create.forEach(fn => fn(file)); await vi.advanceTimersByTimeAsync(2500); vi.useRealTimers(); await flush(); return h.texts.get(path)!; };

describe('device role', () => {
  it('is kept on this device only and reads back safely', () => {
    const h = harness(); expect(loadRole(h.app)).toBe('main'); saveRole(h.app, 'mirror'); expect(loadRole(h.app)).toBe('mirror'); saveRole(h.app, 'secondary'); expect(loadRole(h.app)).toBe('secondary');
    window.localStorage.setItem('organized-device-role:Vault', 'nonsense'); expect(loadRole(h.app)).toBe('main'); saveRole(h.app, 'main'); expect(loadRole(h.app)).toBe('main');
    saveRole(h.app, 'mirror'); const blocked = vi.spyOn(window.localStorage as any, 'getItem').mockImplementation(() => { throw Error('blocked'); }); expect(loadRole(h.app)).toBe('main'); blocked.mockRestore();
    const full = vi.spyOn(window.localStorage as any, 'setItem').mockImplementation(() => { throw Error('full'); }); expect(() => saveRole(h.app, 'secondary')).not.toThrow(); full.mockRestore(); const gone = vi.spyOn(window.localStorage as any, 'removeItem').mockImplementation(() => { throw Error('blocked'); }); expect(() => saveRole(h.app, 'main')).not.toThrow(); gone.mockRestore();
  });
  it('a main device fills a new daily note with its recurring tasks, a secondary or mirror device does not', async () => {
    for (const role of [undefined, 'secondary', 'mirror'] as const) {
      const { h, plugin } = await loaded(role); const task = await plugin.repo.create('Gym'); await plugin.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'daily', recurrence_periods: [{ start: localDate(), stop: null }] }));
      const text = await filled(h); expect(parseTasks(text).filter(t => t.id === task.id), String(role)).toHaveLength(role ? 0 : 1); plugin.onunload();
    }
  });
  it('a secondary device still changes tasks, but does not carry unfinished ones forward when a note opens', async () => {
    const { h, plugin } = await loaded('secondary'); const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); const file: any = await h.add('Daily/x.md', '');
    h.events['file-open'].forEach(fn => fn(file)); await flush(); expect(reconcile).not.toHaveBeenCalled();
    const task = await plugin.repo.create('Edit me'); const title = vi.spyOn(plugin.service, 'title').mockResolvedValue(); await plugin.run(() => plugin.service.title(task.id, 'New')); expect(title).toHaveBeenCalled(); expect(Notice.instances).toHaveLength(0);
    const main = await loaded(); const again = vi.spyOn(main.plugin.service, 'reconcile').mockResolvedValue(); main.h.events['file-open'].forEach(fn => fn(file)); await flush(); expect(again).toHaveBeenCalled();
  });
  it('a mirror device refuses every change with one notice, and says it only once in a short while', async () => {
    const { plugin } = await loaded('mirror'); const task = await plugin.repo.create('Look'); const title = vi.spyOn(plugin.service, 'title').mockResolvedValue();
    await plugin.run(() => plugin.service.title(task.id, 'Changed')); expect(title).not.toHaveBeenCalled(); expect(Notice.instances.map(n => n.message)).toEqual([`Organized: ${MIRROR_MESSAGE}`]);
    await plugin.run(() => plugin.service.title(task.id, 'Again')); expect(Notice.instances).toHaveLength(1);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6000); await plugin.run(() => plugin.service.title(task.id, 'Later')); vi.useRealTimers(); expect(Notice.instances).toHaveLength(2);
    await expect(plugin.trigger({ file: { path: 'Daily/x.md' } as any, line: { id: 'abcd1234', marker: 'x' } as any })).rejects.toThrow('mirror');
    expect(() => plugin.assertEditable()).toThrow('mirror'); expect(() => plugin.assertWritable()).not.toThrow();
  });
  it('background work does nothing on a mirror, and no planned block starts a task', async () => {
    const { plugin } = await loaded('mirror'); const work = vi.fn(async () => undefined); await plugin.runQuiet(work); expect(work).not.toHaveBeenCalled(); expect(Notice.instances).toHaveLength(0);
    const planning = vi.spyOn(plugin.service, 'applyPlanning').mockResolvedValue([]); plugin.settings.startAtPlannedTime = true; plugin.planningTick(); await flush(); expect(planning).not.toHaveBeenCalled();
    const main = await loaded(); const ran = vi.fn(async () => undefined); await main.plugin.runQuiet(ran); expect(ran).toHaveBeenCalled();
  });
  it('a mirror shows the days that have a note and does not create the one for a day that has none', async () => {
    const { h, plugin } = await loaded('mirror'); const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, plugin); leaf.view = view; document.body.appendChild(view.contentEl);
    const date = tomorrow(); const path = plugin.service.daily.path(date); await view.selectDay(date); expect(h.files.has(path)).toBe(false); expect(Notice.instances.at(-1)!.message).toContain('mirror');
    await h.add(path, '- [ ] Existing'); const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); await view.selectDay(date); expect(reconcile).not.toHaveBeenCalled();
    const main = await loaded(); const mainView = new OrganizedInspectorView({ app: main.h.app } as any, main.plugin); const mainReconcile = vi.spyOn(main.plugin.service, 'reconcile').mockResolvedValue(); await mainView.selectDay(tomorrow()); expect(main.h.files.has(main.plugin.service.daily.path(tomorrow()))).toBe(true); expect(mainReconcile).toHaveBeenCalled();
  });
});
