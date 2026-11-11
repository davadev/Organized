// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Modal, Notice } from './__mocks__/obsidian';
import { ChoiceModal, ScheduleModal, ScheduleSetup } from '../modals';
import { MAX_DAYS, nextDay, settleDays, taskFrom } from '../model';
import { parseTasks } from '../codec';
import { splitNote } from '../repository';
import { parseRule } from '../recurrence';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; Modal.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.empty(); });
const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).getTime();
const iso = (d: number, h: number, m = 0) => new Date(at(d, h, m)).toISOString();
const block = (d: number, from: number, to: number) => ({ start: iso(d, from), end: iso(d, to) });
const day = (d: number) => `2026-03-${String(d).padStart(2, '0')}`;
const text = (n: Notice | undefined) => (n?.message as unknown as HTMLElement)?.textContent ?? String(n?.message);
async function fixture(time = at(4, 7)) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(time)); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  return { ...h, owner, service: owner.service, repo: owner.repo, note: (d: number) => owner.service.daily.path(day(d)) };
}
const ids = (t: string | undefined) => parseTasks(t ?? '').map(l => [l.marker, l.title]);

describe('scheduled days in the task note', () => {
  it('reads every day a note holds, with its scheduled date, and shows the task under the first day from today on', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at(4, 7)));
    const task = taskFrom({ id: 'abcdefgh12', title: 'T', scheduled: '2026-03-01', scheduled_dates: ['2026-03-09', 'nope', '2026-03-06', '2026-03-06', 7] }, 'abcdefgh12');
    expect([task.scheduled_dates, task.scheduled]).toEqual([['2026-03-01', '2026-03-06', '2026-03-09'], '2026-03-06']);
    expect(nextDay(['2026-03-01', '2026-03-02'], '2026-03-04')).toBe('2026-03-02'); expect(nextDay([], '2026-03-04')).toBeNull();
    const many = taskFrom({ id: 'abcdefgh12', title: 'T', scheduled_dates: Array.from({ length: 70 }, (_, n) => new Date(2026, 0, n + 1).toISOString().slice(0, 10)) }, 'abcdefgh12');
    expect(many.scheduled_dates).toHaveLength(MAX_DAYS); expect(taskFrom({ id: 'abcdefgh12', title: 'T' }, 'abcdefgh12')).toMatchObject({ scheduled: null, scheduled_dates: [] });
  });
  it('a change of the one date moves the day it replaces, clearing it clears every day, and a change of the days gives the date again', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at(4, 7)));
    const before = taskFrom({ id: 'abcdefgh12', title: 'T', scheduled_dates: ['2026-03-05', '2026-03-09'] }, 'abcdefgh12');
    expect(settleDays(before, { ...before, scheduled: '2026-03-06' }).scheduled_dates).toEqual(['2026-03-06', '2026-03-09']);
    expect(settleDays(before, { ...before, scheduled: null })).toMatchObject({ scheduled: null, scheduled_dates: [] });
    expect(settleDays(before, { ...before, scheduled_dates: ['2026-03-09', 'x', '2026-03-09'] })).toMatchObject({ scheduled: '2026-03-09', scheduled_dates: ['2026-03-09'] });
    expect(settleDays(before, { ...before, title: 'U' })).toEqual({ ...before, title: 'U' });
  });
  it('writes the list only for more than one day, so a note with one day is what older versions write', async () => {
    const { repo, texts } = await fixture(); const task = await repo.create('Days'); const yaml = () => splitNote(texts.get(repo.taskFile(task.id)!.path)!).frontmatter;
    await repo.update(task.id, t => ({ ...t, scheduled_dates: ['2026-03-05'] })); expect([yaml().scheduled, yaml().scheduled_dates]).toEqual(['2026-03-05', undefined]);
    await repo.update(task.id, t => ({ ...t, scheduled_dates: ['2026-03-05', '2026-03-07'] })); expect([yaml().scheduled, yaml().scheduled_dates]).toEqual(['2026-03-05', ['2026-03-05', '2026-03-07']]);
  });
});

describe('saving a schedule', () => {
  it('adds days: the todo goes in the notes that exist, a later day without a note waits for it, and the todo left behind says it was scheduled away', async () => {
    const { service, repo, add, texts, note, owner } = await fixture(); const task = await repo.create('Report'); const child = await repo.create('Draft');
    const inbox: any = await add('Inbox.md', `- [ ] Report <!--organized:${task.id}-->\n  - [ ] Draft <!--organized:${child.id}-->`); await service.repairSubtasks(inbox);
    const context = { file: inbox, line: parseTasks(texts.get('Inbox.md')!)[0] };
    await service.saveSchedule(task.id, [{ date: day(4), blocks: [block(4, 9, 10)] }, { date: day(6), blocks: [block(6, 14, 15), block(6, 14, 15)] }], context);
    expect(await repo.read(task.id)).toMatchObject({ scheduled: day(4), scheduled_dates: [day(4), day(6)], planned_sessions: [block(4, 9, 10), block(6, 14, 15)] });
    expect((await repo.read(task.id)).movement_history.map(m => [m.kind, m.from, m.to])).toEqual([['schedule', 'Inbox.md', day(4)]]);
    expect(ids(texts.get(note(4)))).toEqual([[' ', 'Report'], [' ', 'Draft']]); expect(texts.has(note(6))).toBe(false); expect(texts.get('Inbox.md')).toContain('- [<] Report');
    expect(text(Notice.instances.at(-1))).toContain(`“Report” is scheduled for ${day(4)}, ${day(6)} · 2h planned.`);
    // The note of a later day, made when its day comes (or by hand, or by another plugin), gets the todo then.
    await add(note(6), '# Day'); await owner.service.onDailyCreated(owner.repo.file(note(6))!); expect(ids(texts.get(note(6)))).toEqual([[' ', 'Report']]);
  });
  it('moves a day with its todo, its blocks and the subtasks scheduled for it; removes a day; and clearing gives the todo its own marker back', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Move'); const child = await repo.create('Part'); const done = await repo.create('Gone');
    await repo.update(task.id, t => ({ ...t, subtasks: ['[[Part]]', '[[Gone]]'] })); await repo.update(done.id, t => ({ ...t, status: 'completed' }));
    for (const d of [5, 6, 7]) await add(note(d), '');
    const inbox: any = await add('Inbox.md', `- [ ] Move <!--organized:${task.id}-->`); const context = { file: inbox, line: parseTasks(texts.get('Inbox.md')!)[0] };
    await service.saveSchedule(task.id, [{ date: day(5), blocks: [block(5, 9, 10)] }, { date: day(6), blocks: [] }], context);
    expect(ids(texts.get(note(5)))).toEqual([[' ', 'Move'], [' ', 'Part']]); expect((await repo.read(child.id)).scheduled_dates).toEqual([day(5)]); await repo.update(child.id, t => ({ ...t, planned_sessions: [block(5, 11, 12)] }));
    await service.saveSchedule(task.id, [{ date: day(7), from: day(5), blocks: [block(7, 9, 10)] }, { date: day(6), from: day(6), blocks: [] }]);
    expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: [day(6), day(7)], planned_sessions: [block(7, 9, 10)] }); expect(texts.get(note(5))).toBe('');
    expect(ids(texts.get(note(7)))).toEqual([[' ', 'Move'], [' ', 'Part']]); expect(await repo.read(child.id)).toMatchObject({ scheduled_dates: [day(7)], planned_sessions: [block(7, 11, 12)] });
    expect((await repo.read(task.id)).movement_history.at(-1)).toMatchObject({ kind: 'reschedule', from: day(5), to: day(7) });
    await service.saveSchedule(task.id, [{ date: day(7), from: day(7), blocks: [block(7, 9, 10)] }]); expect(texts.get(note(6))).toBe(''); expect((await repo.read(task.id)).scheduled_dates).toEqual([day(7)]);
    await service.saveSchedule(task.id, []); expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: [], planned_sessions: [] }); expect(texts.get('Inbox.md')).toContain('- [ ] Move');
    expect(text(Notice.instances.at(-1))).toContain('“Move” is no longer scheduled.');
  });
  it('a subtask that cannot be moved keeps its day and is named', async () => {
    const { service, repo, add, note } = await fixture(); const task = await repo.create('Top'); const child = await repo.create('Stuck');
    await repo.update(task.id, t => ({ ...t, subtasks: ['[[Stuck]]'], scheduled_dates: [day(5)] })); await repo.update(child.id, t => ({ ...t, scheduled_dates: [day(5)] })); await add(note(6), '');
    const insert = vi.spyOn(service, 'insert'); insert.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new Error('busy'));
    await service.saveSchedule(task.id, [{ date: day(6), from: day(5), blocks: [] }]); expect((await repo.read(child.id)).scheduled_dates).toEqual([day(5)]);
    expect(Notice.instances.map(text).join('|')).toContain('Could not move 1 subtask to 2026-03-06: Stuck. They keep 2026-03-05.');
  });
  it('moving or removing the day of the todo the dialog was opened from leaves that todo, marked as scheduled away, with no warning', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Monday'); await add(note(5), `- [<] Monday <!--organized:${task.id}-->`); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5), day(6)] }));
    const context = () => ({ file: repo.file(note(5))!, line: parseTasks(texts.get(note(5))!)[0] });
    await service.saveSchedule(task.id, [{ date: day(9), from: day(5), blocks: [] }, { date: day(6), from: day(6), blocks: [] }], context()); expect(texts.get(note(5))).toContain('- [<] Monday');
    await service.saveSchedule(task.id, [{ date: day(9), from: day(9), blocks: [] }], context()); expect(Notice.instances.map(text).join('|')).not.toContain('missing, ambiguous or changed');
  });
  it('keeps blocks that have begun, keeps the day of a daily note scheduled from, and a typed `<` that schedules nothing gives the marker back', async () => {
    const { service, repo, add, texts, note } = await fixture(at(4, 9, 30)); const task = await repo.create('Here'); await add(note(4), `- [<] Here <!--organized:${(task.id)}-->`);
    await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(4)], planned_sessions: [block(4, 9, 10), block(4, 15, 16)] }));
    const context = { file: repo.file(note(4))!, line: parseTasks(texts.get(note(4))!)[0] };
    await service.saveSchedule(task.id, [{ date: day(4), from: day(4), blocks: [block(4, 9, 10)] }], context); expect((await repo.read(task.id)).planned_sessions).toEqual([block(4, 9, 10)]); expect(texts.get(note(4))).toContain('- [ ] Here');
    const loose = await repo.create('Loose'); const inbox: any = await add('Inbox.md', `- [<] Loose <!--organized:${loose.id}-->`);
    await service.saveSchedule(loose.id, [], { file: inbox, line: parseTasks(texts.get('Inbox.md')!)[0] }); expect(texts.get('Inbox.md')).toContain('- [ ] Loose');
    expect(text(Notice.instances.at(-1))).toContain('no longer scheduled');
  });
  it('puts a todo deleted by hand back only when asked, and names a day whose note cannot be written', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Back'); await add(note(5), ''); await add(note(6), '');
    await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5)] }));
    await service.saveSchedule(task.id, [{ date: day(5), from: day(5), blocks: [] }]); expect(texts.get(note(5))).toBe('');
    await service.saveSchedule(task.id, [{ date: day(5), from: day(5), blocks: [], restore: true }]); expect(ids(texts.get(note(5)))).toEqual([[' ', 'Back']]);
    vi.spyOn(service, 'insert').mockRejectedValue(new Error('locked'));
    await service.saveSchedule(task.id, [{ date: day(5), from: day(5), blocks: [], restore: true }, { date: day(6), blocks: [block(6, 9, 10)] }]);
    expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: [day(5)], planned_sessions: [] }); expect(text(Notice.instances.at(-1))).toContain('Not changed: 2026-03-06, 2026-03-05');
  });
  it('refuses a recurring task and too many days, and sums up long and finished schedules', async () => {
    const { service, repo } = await fixture(); const task = await repo.create('Sum');
    await expect(service.saveSchedule(task.id, Array.from({ length: MAX_DAYS + 1 }, (_, n) => ({ date: new Date(2026, 3, n + 1).toISOString().slice(0, 10), blocks: [] })))).rejects.toThrow('at most 60 days');
    await service.saveSchedule(task.id, [5, 6, 7, 8, 9].map(d => ({ date: day(d), blocks: [] }))); expect(text(Notice.instances.at(-1))).toContain(`scheduled for ${day(5)}, ${day(6)}, ${day(7)} and 2 more.`);
    await service.saveSchedule(task.id, [{ date: day(1), blocks: [] }]); expect(text(Notice.instances.at(-1))).toContain('scheduled only for days that are over');
    await service.recurrence(task.id, parseRule('daily')); await expect(service.saveSchedule(task.id, [])).rejects.toThrow('repeating times');
  });
  it('asks once whether to recreate a missing heading for all the days of one save', async () => {
    const h = harness(); h.setSettings({ missingSection: 'ask' }); const task = await h.repo.create('Ask'); await h.repo.update(task.id, t => ({ ...t, daily_note_section_path: [{ level: 1, text: 'Work', ordinal: 0 }] }));
    const later = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); for (const n of [1, 2]) await h.add(h.service.daily.path(later(n)), '');
    await h.service.saveSchedule(task.id, [{ date: later(1), blocks: [] }, { date: later(2), blocks: [] }]); expect(h.confirm).toHaveBeenCalledTimes(1);
    for (const n of [1, 2]) expect(h.texts.get(h.service.daily.path(later(n)))).toContain('# Work');
  });
});

describe('saving a schedule, the rarer paths', () => {
  it('a typed `<` on a todo already scheduled away stays; clearing leaves lines without `<` alone; a subtask list that loops ends', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Away'); const inbox: any = await add('Inbox.md', `- [<] Away <!--organized:${task.id}-->`);
    await add('Projects/P.md', `- [ ] Away <!--organized:${task.id}-->`); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5)], subtasks: ['[[Away]]'] }));
    await service.saveSchedule(task.id, [{ date: day(7), from: day(5), blocks: [] }], { file: inbox, line: parseTasks(texts.get('Inbox.md')!)[0] }); expect(texts.get('Inbox.md')).toContain('- [<] Away');
    await service.saveSchedule(task.id, []); expect(texts.get('Inbox.md')).toContain('- [ ] Away'); expect(texts.get('Projects/P.md')).toContain('- [ ] Away'); expect(texts.has(note(7))).toBe(false);
  });
  it('subtasks move with a day to today, and to a later day that has no note yet', async () => {
    const { service, repo, texts, note } = await fixture(); const task = await repo.create('Lead'); const child = await repo.create('Follow');
    await repo.update(task.id, t => ({ ...t, subtasks: ['[[Follow]]'], scheduled_dates: [day(5)] })); await repo.update(child.id, t => ({ ...t, scheduled_dates: [day(5)], status: 'in_progress' }));
    await service.saveSchedule(task.id, [{ date: day(4), from: day(5), blocks: [] }]); expect(ids(texts.get(note(4)))).toEqual([[' ', 'Lead'], ['/', 'Follow']]);
    await service.saveSchedule(task.id, [{ date: day(9), from: day(4), blocks: [] }]); expect((await repo.read(child.id)).scheduled_dates).toEqual([day(9)]); expect(texts.has(note(9))).toBe(false);
  });
  it('a block planned on a later day whose note exists puts the todo there, under its parent', async () => {
    const { service, repo, add, texts, note } = await fixture(); const parent = await repo.create('Big'); const task = await repo.create('Small'); await repo.update(parent.id, t => ({ ...t, subtasks: ['[[Small]]'] }));
    await add(note(8), `- [ ] Big <!--organized:${parent.id}-->`); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5)] }));
    await service.addPlanned(task.id, block(8, 9, 10)); expect(texts.get(note(8))).toMatch(/- \[ \] Big .*\n\s+- \[ \] Small/);
  });
  it('a new note gets scheduled parents before their subtasks, today with their own marker; one that cannot be written is named', async () => {
    const { service, repo, add, texts, note } = await fixture(); const parent = await repo.create('Mother'); const child = await repo.create('Daughter'); const grand = await repo.create('Grandchild');
    await repo.update(parent.id, t => ({ ...t, subtasks: ['[[Daughter]]'], scheduled_dates: [day(4)], status: 'in_progress' })); await repo.update(child.id, t => ({ ...t, subtasks: ['[[Grandchild]]'], scheduled_dates: [day(4)] })); await repo.update(grand.id, t => ({ ...t, scheduled_dates: [day(4)] }));
    const gym = await repo.create('Gym'); await service.recurrence(gym.id, parseRule('daily'));
    const today: any = await add(note(4), ''); await service.onDailyCreated(today);
    expect(parseTasks(texts.get(note(4))!).map(l => [l.marker, l.title, l.parent === null ? null : parseTasks(texts.get(note(4))!).find(p => p.line === l.parent)!.title])).toEqual([[' ', 'Gym', null], ['/', 'Mother', null], [' ', 'Daughter', 'Mother'], [' ', 'Grandchild', 'Daughter']]);
    const lone = await repo.create('Lone'); await repo.update(lone.id, t => ({ ...t, scheduled_dates: [day(6)] })); const later: any = await add(note(6), '');
    vi.spyOn(service, 'insert').mockRejectedValue(new Error('busy')); await expect(service.onDailyCreated(later)).rejects.toThrow('2 tasks (Gym, Lone) could not be added');
  });
  it('a missed day whose todo cannot be brought to today is counted as skipped', async () => {
    const { service, repo, add, note } = await fixture(); const task = await repo.create('Skip'); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(2)] }));
    const today: any = await add(note(4), ''); vi.spyOn(service, 'insert').mockRejectedValue(new Error('busy')); await service.reconcile(today);
    expect(text(Notice.instances.at(-1))).toContain('1 conflict skipped');
  });
});

describe('days and the daily routine', () => {
  it('the day view lists the tasks scheduled for a day whose note is not made yet', async () => {
    const { owner, repo, raw } = await fixture(); const task = await repo.create('Ahead'); const gone = await repo.create('Converted'); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(9)] })); await repo.update(gone.id, t => ({ ...t, scheduled_dates: [day(9)], converted_to: 'Notes/C.md' }));
    const done = await repo.create('Done early'); await repo.update(done.id, t => ({ ...t, scheduled_dates: [day(2), day(9)], status: 'completed' })); const past = await repo.create('Past'); await repo.update(past.id, t => ({ ...t, scheduled_dates: [day(2)] }));
    const { OrganizedInspectorView } = await import('../view'); const leaf: any = { app: owner.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    view.tab = 'Calendar'; view.selectedDate = day(9); view.calendarMode = 'Day'; await view.render(); await flush();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-day-task')).map(r => r.textContent)).toEqual([expect.stringContaining('Ahead')]); expect(view.contentEl.textContent).toContain("Their todos go in this day's daily note when it is made.");
    const opened = vi.spyOn(view as any, 'openFromCalendar').mockResolvedValue(undefined); view.contentEl.querySelector<HTMLElement>('.organized-day-task .organized-list-open')!.click(); await flush(); expect(opened).toHaveBeenCalledWith(task.id);
    // A day that is over gets no todos when its note is made, and a task done early goes in no note.
    view.selectedDate = day(2); await view.render(); await flush(); expect(view.contentEl.querySelectorAll('.organized-day-task')).toHaveLength(0); expect(view.contentEl.textContent).toContain('There is no daily note for this day yet.');
    view.selectedDate = day(9); owner.settings.dayTasksCollapsed = true; await view.render(); await flush(); expect(view.contentEl.querySelectorAll('.organized-day-task')).toHaveLength(0);
  });
  it('a scheduled day that went by with no daily note brings the todo to today; one scheduled away to a later day waits', async () => {
    const { service, repo, add, texts, note } = await fixture(); const missed = await repo.create('Missed'); const later = await repo.create('Later'); const done = await repo.create('Finished');
    await repo.update(missed.id, t => ({ ...t, scheduled_dates: [day(2)] })); await repo.update(done.id, t => ({ ...t, scheduled_dates: [day(2)], status: 'completed' }));
    await add(note(3), `- [<] Later <!--organized:${later.id}-->`); await repo.update(later.id, t => ({ ...t, scheduled_dates: [day(9)] }));
    const old = await repo.create('Long ago'); await repo.update(old.id, t => ({ ...t, scheduled_dates: ['2026-02-01'] }));
    const today: any = await add(note(4), ''); await service.reconcile(today);
    expect(ids(texts.get(note(4)))).toEqual([[' ', 'Missed']]); expect(await repo.read(missed.id)).toMatchObject({ scheduled_dates: [day(4)] }); expect((await repo.read(missed.id)).movement_history.at(-1)).toMatchObject({ kind: 'forward', from: day(2), to: day(4) });
  });
  it('a running timer shows on the todo acted on and today\'s; the line scheduled away and a later day keep theirs; done reaches every live line', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Work'); await add('Inbox.md', `- [<] Work <!--organized:${task.id}-->`);
    await add(note(4), `- [ ] Work <!--organized:${task.id}-->`); await add(note(6), `- [ ] Work <!--organized:${task.id}-->`); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(4), day(6)] }));
    await service.status(task.id, 'in_progress', { file: repo.file(note(4))!, line: parseTasks(texts.get(note(4))!)[0] });
    expect([texts.get('Inbox.md'), texts.get(note(4)), texts.get(note(6))].map(t => parseTasks(t!)[0].marker)).toEqual(['<', '/', ' ']);
    await service.status(task.id, 'completed'); expect([texts.get('Inbox.md'), texts.get(note(4)), texts.get(note(6))].map(t => parseTasks(t!)[0].marker)).toEqual(['x', 'x', 'x']);
  });
  it('a block planned on a later day adds that day to a task already scheduled', async () => {
    const { service, repo, add, texts } = await fixture(); const task = await repo.create('More'); await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5)] }));
    await add(service.daily.path(day(8)), ''); await service.addPlanned(task.id, block(8, 9, 10)); expect((await repo.read(task.id)).scheduled_dates).toEqual([day(5), day(8)]); expect(texts.get(service.daily.path(day(8)))).toContain('- [ ] More'); expect(text(Notice.instances.at(-1))).toContain('is also scheduled for 2026-03-08');
  });
  it('clearing the date of a task with several days lets go of all of them', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('All'); await add(note(5), `- [ ] All <!--organized:${task.id}-->`);
    await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5), day(6)], planned_sessions: [block(5, 9, 10), block(6, 9, 10)] }));
    await service.unschedule(task.id); expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: [], planned_sessions: [] }); expect(texts.get(note(5))).toBe('');
    expect(text(Notice.instances.at(-1))).toContain('2 planned blocks on its days removed with it');
  });
});

describe('the Schedule dialog', () => {
  const now = () => at(4, 10, 10);
  function open(extra: Partial<ScheduleSetup> = {}) {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] }); vi.setSystemTime(new Date(now()));
    const h = harness(); const save = vi.fn(async () => undefined); const cancelled = vi.fn();
    const setup: ScheduleSetup = { title: 'Report', days: [], earlier: [], state: 'open', load: () => ({ seconds: 0, clash: null }), budget: () => '', save, cancelled, now, ...extra };
    const modal = new ScheduleModal(h.app, setup); modal.open(); return { h, modal, save, cancelled, el: modal.contentEl };
  }
  const buttons = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll('button')).filter(b => b.textContent === label || b.getAttribute('aria-label') === label);
  const press = (el: HTMLElement, label: string) => buttons(el, label)[0].click();
  const field = (el: HTMLElement, label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const type = (input: HTMLInputElement, value: string, event = 'input') => { input.value = value; input.dispatchEvent(new Event(event)); };
  const days = (el: HTMLElement) => Array.from(el.querySelectorAll('.organized-schedule-day')).map(d => d.querySelector('.organized-schedule-label')!.textContent);

  it('adds days with the quick picks and a date, with an optional time, and saves the draft once', async () => {
    const { modal, el, save } = open({ earlier: [day(1)] }); expect(el.textContent).toContain('Not scheduled yet.'); expect(el.textContent).toContain('Earlier (1)');
    press(el, 'Add today'); press(el, 'Add tomorrow'); press(el, 'Add next week'); press(el, 'Add today'); expect(days(el)).toEqual(['Today', 'Tomorrow', 'Sun 8 Mar']);
    type(field(el, 'Day to add'), '2026-03-12'); type(field(el, 'From (optional)'), '14:00'); press(el, 'Add'); expect(el.querySelector('.organized-session-note')!.textContent).toBe('Add both times, or neither for a day alone.');
    press(el, 'Length 2 h'); expect(field(el, 'To (optional)').value).toBe('16:00'); field(el, 'Day to add').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(days(el)).toEqual(['Today', 'Tomorrow', 'Sun 8 Mar', 'Thu 12 Mar']); expect(field(el, 'From (optional)').value).toBe('');
    type(field(el, 'Day to add'), '2026-03-13'); press(el, 'Add'); press(el, 'Remove Fri 13 Mar');
    type(field(el, 'Day to add'), ''); field(el, 'Day to add').dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); press(el, 'Add'); expect(el.querySelector('.organized-session-note')!.textContent).toBe('Choose a valid date.');
    press(el, 'Save'); await flush(); expect(save).toHaveBeenCalledWith([{ date: day(1), blocks: [] }, { date: day(4), blocks: [] }, { date: day(5), blocks: [] }, { date: day(8), blocks: [] }, { date: day(12), blocks: [block(12, 14, 16)] }]);
    expect(modal.contentEl.childElementCount).toBe(0);
  });
  it('a length with no start fills the next free half hour, and + time skips the times the day has', () => {
    const { el } = open({ days: [{ date: day(4), blocks: [block(4, 10, 11)], locked: [block(4, 8, 9)] }, { date: day(5), blocks: [], locked: [] }] });
    type(field(el, 'Day to add'), day(4)); press(el, 'Length 30 m'); expect([field(el, 'From (optional)').value, field(el, 'To (optional)').value]).toEqual(['11:00', '11:30']);
    type(field(el, 'Day to add'), day(20)); field(el, 'From (optional)').value = ''; press(el, 'Length 1 h'); expect(field(el, 'From (optional)').value).toBe('09:00'); field(el, 'From (optional)').value = '';
    press(el, 'Add a time on Tomorrow'); expect(Array.from(el.querySelectorAll('.organized-schedule-day')[1].querySelectorAll<HTMLInputElement>('input[type=time]')).map(i => i.value)).toEqual(['09:00', '10:00']);
    expect(el.querySelector('.organized-schedule-locked')!.textContent).toBe('08:00–09:00 · done');
    const today = el.querySelectorAll<HTMLElement>('.organized-schedule-day')[0]; for (let n = 0; n < 7; n++) (today.querySelector('button[aria-label="Add a time on Today"]') as HTMLButtonElement).click();
    expect((el.querySelectorAll<HTMLElement>('.organized-schedule-day')[0].querySelector('button[aria-label="Add a time on Today"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('finds a free slot after a long day and past a night, and keeps a night time to the next morning', async () => {
    const { el, save } = open({ days: [{ date: day(5), blocks: [block(5, 9, 21), { start: iso(5, 22), end: iso(6, 2) }], locked: [] }, { date: day(6), blocks: [{ start: iso(6, 9), end: iso(6, 23, 59) }], locked: [] }] });
    press(el, 'Add a time on Tomorrow'); const times = (n: number) => Array.from(el.querySelectorAll<HTMLElement>('.organized-schedule-day')[n].querySelectorAll<HTMLInputElement>('input[type=time]')).map(i => i.value);
    expect(times(0)).toEqual(['09:00', '21:00', '22:00', '02:00', '21:00', '22:00']); press(el, 'Remove 21:00–22:00');
    press(el, 'Add a time on Fri 6 Mar'); expect(times(1).slice(2)).toEqual(['23:30', '00:30']); press(el, 'Remove 23:30–00:30');
    press(el, 'Add today'); press(el, 'Save'); await flush(); expect(save).toHaveBeenCalledWith([{ date: day(4), blocks: [] }, { date: day(5), blocks: [block(5, 9, 21), { start: iso(5, 22), end: iso(6, 2) }] }, { date: day(6), blocks: [{ start: iso(6, 9), end: iso(6, 23, 59) }] }]);
  });
  it('changes, merges and removes days and times, checks the times, and warns about the past and other tasks', async () => {
    const { el, save } = open({ days: [{ date: day(4), blocks: [block(4, 11, 12)], locked: [block(4, 10, 11)], missing: true }, { date: day(5), blocks: [block(5, 9, 10)], locked: [] }, { date: day(6), blocks: [], locked: [] }], load: (d, b) => ({ seconds: d === day(5) ? 7200 : 0, clash: d === day(5) && b.length ? 'Standup' : null }), budget: b => `budget ${b.length}`, highlight: day(5) });
    const cards = () => Array.from(el.querySelectorAll<HTMLElement>('.organized-schedule-day'));
    expect(cards()[1].classList.contains('organized-schedule-highlight')).toBe(true); expect(cards()[1].textContent).toContain('2h planned that day'); expect(cards()[1].textContent).toContain('Overlaps “Standup”.');
    expect(cards()[2].textContent).toContain('Any time · Nothing else planned'); expect(cards()[0].textContent).toContain('10:00–11:00 · started'); expect(el.querySelector('.organized-schedule-budget')!.textContent).toBe('budget 2');
    press(el, 'Add back'); expect(el.textContent).toContain('The todo goes back in the daily note.');
    const [from, to] = Array.from(cards()[0].querySelectorAll<HTMLInputElement>('input[type=time]')); type(from, '09:00'); type(to, '09:30'); expect(cards()[0].textContent).toContain("A time already past won't start a timer.");
    type(to, ''); expect(cards()[0].querySelector('.organized-schedule-note')!.textContent).toBe('Add both times, or neither.'); press(el, 'Save'); expect(save).not.toHaveBeenCalled(); type(to, '09:30');
    // Moved onto a day already there: one day. Moved to a free day: that day, from the old one. An unreadable date stays.
    type(cards()[2].querySelector<HTMLInputElement>('input[type=date]')!, day(5), 'change'); expect(days(el)).toEqual(['Today', 'Tomorrow']);
    const tomorrow = cards()[1].querySelector<HTMLInputElement>('input[type=date]')!; type(tomorrow, '', 'change'); expect(tomorrow.value).toBe(day(5)); type(tomorrow, day(5), 'change'); type(tomorrow, day(8), 'change'); expect(days(el)).toEqual(['Today', 'Sun 8 Mar']);
    press(el, 'Remove 09:00–10:00'); press(el, 'Remove Today'); expect(days(el)).toEqual(['Sun 8 Mar']); vi.runAllTimers(); expect(document.activeElement).toBe(cards()[0].querySelector('input[type=date]'));
    press(el, 'Add today'); press(el, 'Save'); await flush(); expect(save).toHaveBeenCalledWith([{ date: day(4), blocks: [] }, { date: day(8), from: day(5), blocks: [] }]);
  });
  it('closing with no change closes; with changes it asks, and Keep editing comes back to the same draft', async () => {
    let { modal, cancelled } = open(); modal.close(); expect(cancelled).toHaveBeenCalledOnce();
    ({ modal, cancelled } = open()); press(modal.contentEl, 'Save'); expect(cancelled).toHaveBeenCalledOnce();
    ({ modal, cancelled } = open()); press(modal.contentEl, 'Add tomorrow'); press(modal.contentEl, 'Cancel'); let ask = Modal.instances.at(-1) as unknown as ChoiceModal; expect(ask.heading).toBe('Discard changes?');
    press(ask.contentEl, 'Keep editing'); const again = Modal.instances.at(-1) as unknown as ScheduleModal; expect(days(again.contentEl)).toEqual(['Tomorrow']); expect(cancelled).not.toHaveBeenCalled();
    again.close(); ask = Modal.instances.at(-1) as unknown as ChoiceModal; press(ask.contentEl, 'Discard'); expect(cancelled).toHaveBeenCalledOnce();
    ({ modal, cancelled } = open()); press(modal.contentEl, 'Add tomorrow'); modal.close(); (Modal.instances.at(-1) as unknown as ChoiceModal).close(); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('clears the schedule, refuses too many days, and offers Repeat or Reopen instead for repeating and finished tasks', async () => {
    let { el, save } = open({ days: [{ date: day(5), blocks: [], locked: [] }] }); press(el, 'Clear schedule'); await flush(); expect(save).toHaveBeenCalledWith([]);
    ({ el, save } = open({ earlier: Array.from({ length: MAX_DAYS }, (_, n) => new Date(2025, 0, n + 1).toISOString().slice(0, 10)) })); press(el, 'Add tomorrow'); press(el, 'Save'); expect(save).not.toHaveBeenCalled(); expect(el.textContent).toContain('at most 60 days');
    const repeat = vi.fn(); let r = open({ state: 'recurring', repeat }); expect(buttons(r.el, 'Save')).toHaveLength(0); press(r.el, 'Repeat settings…'); expect(repeat).toHaveBeenCalled(); expect(r.cancelled).not.toHaveBeenCalled();
    const reopen = vi.fn(); r = open({ state: 'closed', reopen, days: [{ date: day(5), blocks: [], locked: [] }] }); expect(r.el.textContent).toContain('It was scheduled for Tomorrow.'); press(r.el, 'Reopen to schedule'); expect(reopen).toHaveBeenCalled();
    r = open({ state: 'closed' }); expect(r.el.textContent).toContain('Done, and not scheduled.'); r.modal.close(); expect(r.cancelled).toHaveBeenCalled();
    r = open({ state: 'recurring' }); r.modal.close(); expect(r.cancelled).toHaveBeenCalled();
  });
});

describe('opening the Schedule dialog', () => {
  it('shows each day with its blocks, other tasks on it and the budget; a typed `<` left unused gives the marker back', async () => {
    const { owner, repo, add, texts, note, service } = await fixture(at(4, 9, 30)); const task = await repo.create('Plan'); const other = await repo.create('Meeting');
    await repo.update(other.id, t => ({ ...t, planned_sessions: [block(5, 9, 11)] })); await add(note(5), ''); await add(note(4), `- [<] Plan <!--organized:${task.id}-->`);
    await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(1), day(4), day(5)], planned_sessions: [block(4, 9, 10), block(6, 10, 11)], time_budget_seconds: 3 * 3600 }));
    await owner.pickSchedule(await repo.read(task.id), { file: repo.file(note(4))!, line: parseTasks(texts.get(note(4))!)[0] }, true); const modal = Modal.instances.at(-1) as unknown as ScheduleModal;
    expect(modal.setup.days).toEqual([{ date: day(4), blocks: [], locked: [block(4, 9, 10)], missing: false }, { date: day(5), blocks: [], locked: [], missing: true }, { date: day(6), blocks: [block(6, 10, 11)], locked: [], missing: false }]);
    expect(modal.setup.earlier).toEqual([day(1)]); expect(modal.setup.highlight).toBe(day(4)); expect(modal.setup.state).toBe('open');
    expect(modal.setup.load(day(5), [block(5, 10, 12)])).toEqual({ seconds: 4 * 3600, clash: 'Meeting' }); expect(modal.setup.load(day(7), [])).toEqual({ seconds: 0, clash: null });
    expect(modal.setup.budget([block(6, 10, 11)])).toBe('Planned 1h 30min · 1h 30min of 3h left'); expect(modal.setup.budget([block(6, 10, 15)])).toBe('Planned 5h 30min · 2h 30min over the 3h budget');
    // Today's note is one of its days: the typed `<` goes back to the todo's own marker.
    modal.close(); await flush(); expect(texts.get(note(4))).toContain('- [ ] Plan');
    await repo.update(task.id, t => ({ ...t, time_budget_seconds: null })); await owner.pickSchedule(await repo.read(task.id)); expect((Modal.instances.at(-1) as unknown as ScheduleModal).setup.budget([])).toBe(''); (Modal.instances.at(-1) as unknown as ScheduleModal).close();
    const inbox: any = await add('Inbox.md', `- [<] Plan <!--organized:${task.id}-->`); await owner.pickSchedule(await repo.read(task.id), { file: inbox, line: parseTasks(texts.get('Inbox.md')!)[0] }, true);
    (Modal.instances.at(-1) as unknown as ScheduleModal).close(); await flush(); expect(texts.get('Inbox.md')).toContain('- [<] Plan');
    const save = vi.spyOn(service, 'saveSchedule').mockResolvedValue(); await owner.pickSchedule(await repo.read(task.id)); await (Modal.instances.at(-1) as unknown as ScheduleModal).setup.save([]); expect(save).toHaveBeenCalledWith(task.id, [], undefined);
  });
  it('a finished task reopens into the dialog; a repeating one goes to Repeat; the commands schedule and clear the todo under the cursor', async () => {
    const { owner, repo, add, texts, service } = await fixture(); const task = await repo.create('Shut'); await repo.update(task.id, t => ({ ...t, status: 'completed' }));
    await owner.pickSchedule(await repo.read(task.id)); let modal = Modal.instances.at(-1) as unknown as ScheduleModal; expect(modal.setup.state).toBe('closed');
    modal.setup.reopen!(); await flush(); expect((await repo.read(task.id)).status).toBe('open'); modal = Modal.instances.at(-1) as unknown as ScheduleModal; expect(modal.setup.state).toBe('open'); modal.close();
    await service.recurrence(task.id, parseRule('daily')); await owner.pickSchedule(await repo.read(task.id)); modal = Modal.instances.at(-1) as unknown as ScheduleModal; expect(modal.setup.state).toBe('recurring');
    const repeat = vi.spyOn(owner, 'pickRecurrence').mockImplementation(() => undefined); modal.setup.repeat!(); expect(repeat).toHaveBeenCalled(); modal.close(); repeat.mockRestore();
    // A `<` typed on a repeating task's todo: Repeat settings, then cancelled, gives the todo its marker back.
    const typed: any = await add('Typed.md', `- [<] Shut <!--organized:${task.id}-->`); await owner.pickSchedule(await repo.read(task.id), { file: typed, line: parseTasks(texts.get('Typed.md')!)[0] }, true);
    (Modal.instances.at(-1) as unknown as ScheduleModal).setup.repeat!(); (Modal.instances.at(-1) as any).close(); await flush(); expect(texts.get('Typed.md')).toBe(`- [ ] Shut <!--organized:${task.id}-->`);
    const plain = await repo.create('Cursor'); const file: any = await add('Note.md', `- [ ] Cursor <!--organized:${plain.id}-->`);
    const editor: any = { getValue: () => texts.get('Note.md'), getCursor: () => ({ line: 0, ch: 0 }) }; const stub: any = owner;
    stub.commands.find((c: any) => c.id === 'schedule-task').editorCallback(editor, { file }); await flush(); expect((Modal.instances.at(-1) as unknown as ScheduleModal).setup.title).toBe('Cursor');
    const clear = vi.spyOn(service, 'unschedule').mockResolvedValue(); stub.commands.find((c: any) => c.id === 'clear-schedule').editorCallback(editor, { file }); await flush(); expect(clear).toHaveBeenCalledWith(plain.id);
    const count = Modal.instances.length; stub.commands.find((c: any) => c.id === 'schedule-task').editorCallback(editor, {}); stub.commands.find((c: any) => c.id === 'clear-schedule').editorCallback(editor, {}); await flush();
    expect(Modal.instances.length).toBe(count); expect(clear).toHaveBeenCalledOnce();
  });
});
