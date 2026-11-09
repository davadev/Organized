// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness, sessionFields } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice, Modal } from './__mocks__/obsidian';
import { localDate, taskFrom } from '../model';
import { SessionModal } from '../modals';
import { kindOf } from '../sessions';
import { splitNote } from '../repository';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function fixture() {
  const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload(); owner.settings.startAtPlannedTime = true;
  return { ...h, owner, service: owner.service, repo: owner.repo };
}
const iso = (hour: number, minute = 0) => new Date(2026, 2, 4, hour, minute).toISOString();
const block = (from: number, to: number) => ({ start: iso(from), end: iso(to) });

describe('planned time', () => {
  it('keeps planned blocks apart from worked time and leaves tasks that plan nothing without extra keys', async () => {
    const { service, repo } = await fixture(); const task = await repo.create('Plan me'); const file = repo.taskFile(task.id)!;
    expect(splitNote(await repo.readText(file)).frontmatter).not.toHaveProperty('planned_sessions'); expect(splitNote(await repo.readText(file)).frontmatter).not.toHaveProperty('auto_started_block');
    await service.addPlanned(task.id, block(9, 10)); await service.addPlanned(task.id, block(14, 15));
    let saved = await repo.read(task.id); expect(saved.planned_sessions).toEqual([block(9, 10), block(14, 15)]); expect(saved.time_tracked_seconds).toBe(0); expect(saved.work_sessions).toEqual([]);
    await service.changePlanned(task.id, block(9, 10), block(9, 11)); expect((await repo.read(task.id)).planned_sessions[0]).toEqual(block(9, 11));
    await expect(service.changePlanned(task.id, block(1, 2), null)).rejects.toThrow('no longer exists');
    await service.changePlanned(task.id, block(14, 15), null); expect((await repo.read(task.id)).planned_sessions).toEqual([block(9, 11)]);
    await service.changePlanned(task.id, block(9, 11), null); saved = await repo.read(task.id); expect(saved.planned_sessions).toEqual([]);
    expect(splitNote(await repo.readText(file)).frontmatter).not.toHaveProperty('planned_sessions');
  });
  it('turns a finished plan into worked time', async () => {
    const { service, repo } = await fixture(); const task = await repo.create('Did it'); await service.addPlanned(task.id, block(9, 10));
    await expect(service.logPlanned(task.id, block(1, 2))).rejects.toThrow('no longer exists');
    await service.logPlanned(task.id, block(9, 10)); const saved = await repo.read(task.id); expect(saved.planned_sessions).toEqual([]); expect(saved.work_sessions).toEqual([block(9, 10)]); expect(saved.time_tracked_seconds).toBe(3600);
  });
  it('sanitises hand-edited planned blocks and the claim', () => {
    const raw = { id: 'abcdefgh', title: 'T', planned_sessions: [{ start: iso(11), end: iso(12) }, { start: iso(10), end: iso(9) }, { start: 5, end: iso(9) }, 'x'], auto_started_block: 'nonsense' };
    const task = taskFrom(raw, 'abcdefgh'); expect(task.planned_sessions).toEqual([block(11, 12)]); expect(task.auto_started_block).toBeNull();
    expect(taskFrom({ ...raw, planned_sessions: 'x', auto_started_block: iso(11) }, 'abcdefgh')).toMatchObject({ planned_sessions: [], auto_started_block: iso(11) });
  });
  it('sets a task in progress without a timer when its block begins, and back to open with a notice when it ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 2, 4, 8, 0)); const { service, repo, add } = await fixture(); const task = await repo.create('Focus'); await service.addPlanned(task.id, block(9, 10));
    const note = service.daily.path(localDate(new Date(2026, 2, 4))); await add(note, `- [ ] Focus <!--organized:${task.id}-->`);
    expect(await service.applyPlanning(new Date(2026, 2, 4, 8, 59).getTime())).toEqual([]); expect((await repo.read(task.id)).status).toBe('open');
    expect(await service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime())).toEqual([]);
    let saved = await repo.read(task.id); expect(saved).toMatchObject({ status: 'in_progress', time_tracking_started_at: null, auto_started_block: iso(9) }); expect(await repo.readText(repo.file(note)!)).toContain('- [/] Focus');
    expect(await service.applyPlanning(new Date(2026, 2, 4, 9, 30).getTime())).toEqual([]); expect((await repo.read(task.id)).status).toBe('in_progress');
    expect(await service.applyPlanning(new Date(2026, 2, 4, 10, 0).getTime())).toEqual(['Focus']);
    saved = await repo.read(task.id); expect(saved).toMatchObject({ status: 'open', auto_started_block: null, time_tracked_seconds: 0, work_sessions: [] }); expect(await repo.readText(repo.file(note)!)).toContain('- [ ] Focus');
    expect(splitNote(await repo.readText(repo.taskFile(task.id)!)).frontmatter).not.toHaveProperty('auto_started_block');
  });
  it('hands the claim to a back-to-back block and never undoes a status the person chose', async () => {
    const { service, repo } = await fixture(); const a = await repo.create('Back to back'); const b = await repo.create('Done early'); const c = await repo.create('Timed');
    for (const t of [a, b, c]) { await service.addPlanned(t.id, block(9, 10)); if (t === a) await service.addPlanned(t.id, block(10, 11)); }
    await service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime());
    await service.status(b.id, 'completed'); await service.status(c.id, 'in_progress');
    expect(await service.applyPlanning(new Date(2026, 2, 4, 10, 0).getTime())).toEqual([]);
    expect(await repo.read(a.id)).toMatchObject({ status: 'in_progress', auto_started_block: iso(10) }); expect(await repo.read(b.id)).toMatchObject({ status: 'completed', auto_started_block: null }); expect(await repo.read(c.id)).toMatchObject({ status: 'in_progress', auto_started_block: null });
    expect(await service.applyPlanning(new Date(2026, 2, 4, 11, 0).getTime())).toEqual(['Back to back']); expect((await repo.read(c.id)).status).toBe('in_progress');
    const released = await repo.create('Released'); await service.addPlanned(released.id, block(9, 10)); await service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime());
    await repo.update(released.id, t => ({ ...t, time_tracking_started_at: iso(9, 5) })); expect(await service.applyPlanning(new Date(2026, 2, 4, 10, 0).getTime())).toEqual([]); expect(await repo.read(released.id)).toMatchObject({ status: 'in_progress', auto_started_block: null });
  });
  it('checks for due blocks only when the setting is on, once a minute and when the app returns', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 2, 4, 9, 30)); const { owner, service, repo } = await fixture(); const task = await repo.create('Ticking'); await service.addPlanned(task.id, block(9, 10));
    owner.settings.startAtPlannedTime = false; owner.planningTick(); await flush(); expect((await repo.read(task.id)).status).toBe('open');
    owner.settings.startAtPlannedTime = true; owner.planningTick(); await flush(); expect((await repo.read(task.id)).status).toBe('in_progress');
    vi.setSystemTime(new Date(2026, 2, 4, 10, 1)); owner.planningTick(); await flush(); expect((await repo.read(task.id)).status).toBe('open'); expect(Notice.instances.at(-1)?.message).toContain('Planned time for “Ticking” is over');
    const second = await repo.create('Also'); const third = await repo.create('And also'); for (const t of [second, third]) await repo.update(t.id, x => ({ ...x, status: 'in_progress', auto_started_block: iso(9), planned_sessions: [block(9, 10)] }));
    owner.planningTick(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('over for 2 tasks'); (owner as any).unloaded = true; owner.planningTick(); await flush();
  });
  it('registers the minute check and the return-to-foreground catch-up once the layout is ready', async () => {
    vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); const tick = vi.spyOn(owner, 'planningTick').mockImplementation(() => undefined); await owner.onload(); expect(tick).not.toHaveBeenCalled(); for (const ready of [...h.layout]) ready();
    const before = tick.mock.calls.length; expect(before).toBe(1); vi.advanceTimersByTime(60000); expect(tick.mock.calls.length).toBe(before + 1);
    const found = (owner as any).domEvents.find((e: any) => e.type === 'visibilitychange'); expect(found.target).toBe(document); const visible = () => found.cb();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); visible(); expect(tick.mock.calls.length).toBe(before + 1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); visible(); expect(tick.mock.calls.length).toBe(before + 2);
  });
  it('decides from the times whether a new block is worked or planned, and offers to log a finished plan', async () => {
    const { app } = harness(); const now = new Date(2026, 2, 4, 12, 0).getTime(); const save = vi.fn(async () => undefined); const log = vi.fn(async () => undefined);
    const modal = new SessionModal(app, { heading: 'Add time', taskTitle: 'Plan', start: iso(15), end: iso(16), kind: null, save, logWorked: log }, () => now); modal.open();
    const note = () => modal.contentEl.querySelector('.organized-session-note')!; const buttons = () => Array.from(modal.contentEl.querySelectorAll('button')); expect(modal.contentEl.querySelector('select')).toBeNull();
    expect(note().textContent).toBe('Length: 1h · saved as planned time'); buttons().find(b => b.textContent === 'Save')!.click(); await flush(); expect(save).toHaveBeenCalledWith({ start: iso(15), end: iso(16) }, 'planned');
    const edit = new SessionModal(app, { heading: 'Add time', taskTitle: 'Plan', start: iso(15), end: iso(16), kind: null, save }, () => now); edit.open();
    const [from, end] = sessionFields(edit.contentEl); from.value = '2026-03-04T10:00'; end.value = '2026-03-04T11:00'; end.dispatchEvent(new Event('input')); expect(edit.contentEl.querySelector('.organized-session-note')!.textContent).toBe('Length: 1h · saved as time worked');
    expect(kindOf(null)).toBe('planned'); expect(kindOf(iso(12, 1), now)).toBe('worked'); expect(kindOf(iso(12, 2), now)).toBe('planned');
    const again = new SessionModal(app, { heading: 'Edit', taskTitle: 'Plan', start: iso(9), end: iso(10), kind: 'planned', save, logWorked: log }, () => now); again.open(); expect(again.contentEl.querySelector('.organized-session-note')!.textContent).toBe('Length: 1h');
    Array.from(again.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Log as worked')!.click(); await flush(); expect(log).toHaveBeenCalledOnce(); expect(Modal.instances.length).toBeGreaterThan(0);
  });
});
