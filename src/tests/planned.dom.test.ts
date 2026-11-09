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
  it('stores a time budget only while one is set', async () => {
    const { service, repo } = await fixture(); const task = await repo.create('Budget'); const file = repo.taskFile(task.id)!;
    expect(splitNote(await repo.readText(file)).frontmatter).not.toHaveProperty('time_budget_seconds');
    await service.setBudget(task.id, 7200); expect((await repo.read(task.id)).time_budget_seconds).toBe(7200); expect(splitNote(await repo.readText(file)).frontmatter).toHaveProperty('time_budget_seconds', 7200);
    await service.setBudget(task.id, null); expect((await repo.read(task.id)).time_budget_seconds).toBeNull(); expect(splitNote(await repo.readText(file)).frontmatter).not.toHaveProperty('time_budget_seconds');
    for (const bad of [0, -5, 1.5, '3600', 9999 * 3600 + 1, Number.NaN]) expect(taskFrom({ id: task.id, title: 'x', time_budget_seconds: bad }, task.id).time_budget_seconds).toBeNull();
  });
  describe('a start whose note write was lost is put right on the next pass', () => {
    async function started() {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 2, 4, 8, 0)); const f = await fixture(); const task = await f.repo.create('Subtask'); await f.service.addPlanned(task.id, block(9, 10));
      const note = f.service.daily.path(localDate(new Date(2026, 2, 4))); await f.add(note, `- [ ] Parent\n  - [ ] Subtask <!--organized:${task.id}-->`); return { ...f, task, note };
    }
    const at = (h: number, m = 0) => new Date(2026, 2, 4, h, m).getTime();
    it('when the write loses a race with the person typing', async () => {
      const { service, repo, task, note, texts } = await started(); const write = vi.spyOn(repo, 'write').mockRejectedValueOnce(new Error(`${note} changed concurrently; preserved. Retry the action.`));
      expect(await service.applyPlanning(at(9))).toEqual([]); expect(await repo.read(task.id)).toMatchObject({ status: 'in_progress', auto_started_block: iso(9) }); expect(texts.get(note)).toContain('[ ] Subtask');
      await service.applyPlanning(at(9, 1)); expect(texts.get(note)).toContain('  - [/] Subtask'); const text = texts.get(note); expect(write).toHaveBeenCalled();
      await service.applyPlanning(at(9, 2)); expect(texts.get(note)).toBe(text);
    });
    it('when an editor saves older text over it, and in every note that holds the todo', async () => {
      const { service, repo, task, note, texts, add } = await started(); const other = `${repo.projectFolder()}/Plan.md`; await add(other, `- [ ] Subtask <!--organized:${task.id}-->`);
      await service.applyPlanning(at(9)); texts.set(note, texts.get(note)!.replace('[/]', '[ ]')); texts.set(other, texts.get(other)!.replace('[/]', '[ ]'));
      await service.applyPlanning(at(9, 5)); expect(texts.get(note)).toContain('[/] Subtask'); expect(texts.get(other)).toContain('[/] Subtask');
    });
    it('survives a heal that is itself raced or finds a note whose line was removed', async () => {
      const { service, repo, task, note, texts, add } = await started(); const other = `${repo.projectFolder()}/Gone.md`; await add(other, `- [ ] Subtask <!--organized:${task.id}-->`);
      await service.applyPlanning(at(9)); await service.refs(task.id); texts.set(note, texts.get(note)!.replace('[/]', '[ ]')); texts.set(other, 'the line was removed');
      const write = vi.spyOn(repo, 'write').mockRejectedValueOnce(new Error('x changed concurrently; preserved.')); await service.applyPlanning(at(9, 1)); expect(texts.get(note)).toContain('[ ] Subtask');
      write.mockRejectedValueOnce(new Error('disk full')); await expect(service.applyPlanning(at(9, 2))).rejects.toThrow('disk full'); await service.applyPlanning(at(9, 3)); expect(texts.get(note)).toContain('[/] Subtask');
    });
    it('only for a start the plugin made: a status the person chose is never rewritten, and other write errors still surface', async () => {
      const { service, repo, task, note, texts } = await started(); await service.status(task.id, 'in_progress'); texts.set(note, texts.get(note)!.replace('[/]', '[ ]'));
      await service.applyPlanning(at(9, 5)); expect(texts.get(note)).toContain('[ ] Subtask');
      await repo.update(task.id, t => ({ ...t, status: 'open', time_tracking_started_at: null })); vi.spyOn(repo, 'write').mockRejectedValueOnce(new Error('disk full'));
      await expect(service.applyPlanning(at(9, 6))).rejects.toThrow('disk full');
    });
    it('keeps the marker when a started task is forwarded or linked to a project', async () => {
      const { service, repo, task } = await started(); await service.applyPlanning(at(9)); expect((await repo.read(task.id)).status).toBe('in_progress');
      const project = `${repo.projectFolder()}/Proj.md`; await service.projects(task.id, [project]); expect(await repo.readText(repo.file(project)!)).toContain('- [/] Subtask');
    });
  });
  describe('the todo line follows the status when it lives in an earlier daily note', () => {
    const day = (d: number) => localDate(new Date(2026, 2, d));
    async function setup() {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 2, 4, 8, 0)); const f = await fixture();
      const task = await f.repo.create('Old line'); await f.service.addPlanned(task.id, block(9, 10)); const path = (d: number) => f.service.daily.path(day(d));
      const put = (d: number, text: string) => f.add(path(d), text.split('ID').join(task.id)); const read = (d: number) => f.texts.get(path(d));
      return { ...f, task, put, read, path };
    }
    it('marks a line that only exists in an earlier note when the block begins, and clears it when the block ends', async () => {
      const { service, repo, task, put, read } = await setup(); await put(1, '- [ ] Other\n- [ ] Old line <!--organized:ID-->\n- [x] Done thing');
      await service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime()); expect((await repo.read(task.id)).status).toBe('in_progress'); expect(read(1)).toBe(`- [ ] Other\n- [/] Old line <!--organized:${task.id}-->\n- [x] Done thing`);
      await service.applyPlanning(new Date(2026, 2, 4, 10, 0).getTime()); expect(read(1)).toBe(`- [ ] Other\n- [ ] Old line <!--organized:${task.id}-->\n- [x] Done thing`);
    });
    it('follows a status chosen in the side panel too, without reordering the old note', async () => {
      const { service, task, put, read } = await setup(); await put(2, '- [ ] Old line <!--organized:ID-->\n- [ ] Next <!--organized:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-->');
      await service.status(task.id, 'completed'); expect(read(2)!.split('\n')[0]).toBe(`- [x] Old line <!--organized:${task.id}-->`);
      await service.status(task.id, 'in_progress'); expect(read(2)!.split('\n')[0]).toBe(`- [/] Old line <!--organized:${task.id}-->`);
    });
    it('leaves earlier notes alone when the task also has a line today, in a future note or in an undated note', async () => {
      for (const [where, put] of [['today', (p: any) => p.put(4, '- [ ] Old line <!--organized:ID-->')], ['future', (p: any) => p.put(9, '- [ ] Old line <!--organized:ID-->')], ['undated', (p: any) => p.add('Notes/Topic.md', `- [ ] Old line <!--organized:${p.task.id}-->`)]] as const) {
        const p: any = await setup(); await p.put(1, '- [ ] Old line <!--organized:ID-->'); await put(p);
        await p.service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime()); expect(p.read(1), where).toBe(`- [ ] Old line <!--organized:${p.task.id}-->`);
        const other = where === 'today' ? p.read(4) : where === 'future' ? p.read(9) : p.texts.get('Notes/Topic.md'); expect(other, where).toContain('- [/] Old line');
      }
    });
    it('keeps forwarded history lines and changes only the most recent earlier note', async () => {
      const { service, task, put, read } = await setup(); await put(3, '- [<] Old line <!--organized:ID-->\n- [ ] Old line <!--organized:ID-->'); await put(1, '- [>] Old line <!--organized:ID-->'); await put(2, '- [ ] Old line <!--organized:ID-->');
      await service.applyPlanning(new Date(2026, 2, 4, 9, 0).getTime());
      expect(read(1)).toContain('[>]'); expect(read(2)).toContain('- [ ] Old line'); expect(read(3)!.split('\n')).toEqual([`- [<] Old line <!--organized:${task.id}-->`, `- [/] Old line <!--organized:${task.id}-->`]);
    });
  });
});
