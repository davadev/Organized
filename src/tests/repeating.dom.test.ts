// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Modal, Notice } from './__mocks__/obsidian';
import { ChoiceModal, RecurrencePicker, SessionModal } from '../modals';
import { parseRule } from '../recurrence';
import { splitNote } from '../repository';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; Modal.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.empty(); });
const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).getTime();
const iso = (d: number, h: number, m = 0) => new Date(at(d, h, m)).toISOString();
const block = (d: number, from: number, to: number) => ({ start: iso(d, from), end: iso(d, to) });
const weekdays = parseRule('weekdays')!;
const nine = [{ start: '08:00', end: '12:00' }, { start: '12:00', end: '17:00' }];
async function fixture(time = at(4, 7)) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(time)); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload(); owner.settings.startAtPlannedTime = true;
  return { ...h, owner, service: owner.service, repo: owner.repo };
}
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;

describe('repeating planned time', () => {
  it('starts and stops the timer every day it repeats, with no daily note, and counts blocks back to back as one', async () => {
    const { service, repo, texts } = await fixture(); const task = await repo.create('Work'); await service.recurrence(task.id, weekdays, undefined, nine);
    expect(splitNote(await repo.readText(repo.taskFile(task.id)!)).frontmatter.recurrence_times).toEqual(nine); expect([...texts.keys()].filter(p => p.includes('2026-03-05'))).toEqual([]);
    await service.applyPlanning(at(4, 8)); expect(await repo.read(task.id)).toMatchObject({ time_tracking_started_at: iso(4, 8), auto_started_block: iso(4, 8) });
    expect(await service.applyPlanning(at(4, 12, 30))).toEqual([]); expect(await service.applyPlanning(at(4, 17, 1))).toEqual(['Work']); expect((await repo.read(task.id)).time_tracked_seconds).toBe(9 * 3600);
    // Noticed only the next morning: yesterday's time still ends at 17:00, then today's starts.
    await service.applyPlanning(at(5, 8)); await repo.update(task.id, t => ({ ...t, time_tracking_started_at: iso(5, 8) }));
    expect(await service.applyPlanning(at(6, 8, 30))).toEqual(['Work']); expect((await repo.read(task.id)).time_tracked_seconds).toBe(18 * 3600); await service.applyPlanning(at(6, 8, 31)); expect((await repo.read(task.id)).time_tracking_started_at).toBe(iso(6, 8));
  });
  it('a day ticked done (or canceled) starts no later block that day, and the next day starts again', async () => {
    const { service, repo, add } = await fixture(); const task = await repo.create('Gym'); await service.recurrence(task.id, weekdays, undefined, [{ start: '08:00', end: '09:00' }, { start: '18:00', end: '19:00' }]);
    const note = service.daily.path('2026-03-04'); await add(note, `- [x] Gym <!--organized:${task.id}--> <!--organized:repeat-->`);
    await service.applyPlanning(at(4, 18)); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull();
    vi.setSystemTime(new Date(at(5, 7))); await add(service.daily.path('2026-03-05'), `- [-] Gym <!--organized:${task.id}--> <!--organized:repeat-->`); await service.applyPlanning(at(5, 8)); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull();
    vi.setSystemTime(new Date(at(6, 7))); await service.applyPlanning(at(6, 8)); expect((await repo.read(task.id)).time_tracking_started_at).toBe(iso(6, 8));
  });
  it('times saved while one is under way start the timer now; stopping repeating under its timer stops it now', async () => {
    const { owner, service, repo } = await fixture(at(4, 13)); const task = await repo.create('Shift'); await service.recurrence(task.id, weekdays, undefined, [{ start: '08:00', end: '17:00' }]);
    expect(await repo.read(task.id)).toMatchObject({ time_tracking_started_at: iso(4, 13), auto_started_block: iso(4, 8) });
    vi.setSystemTime(new Date(at(4, 14))); await service.recurrence(task.id, null); expect((await repo.read(task.id)).recurrence_times).toEqual([{ start: '08:00', end: '17:00' }]);
    expect((await repo.read(task.id)).auto_started_block).toBe(iso(4, 8)); expect(await service.applyPlanning(at(4, 14))).toEqual(['Shift']); expect((await repo.read(task.id)).time_tracked_seconds).toBe(3600);
    owner.settings.startAtPlannedTime = false;
  });
  it('changes one day alone: that day keeps blocks of its own, the other days and a later change of the times leave it', async () => {
    const { service, repo } = await fixture(); const task = await repo.create('Desk'); await service.recurrence(task.id, weekdays, undefined, [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]);
    await repo.update(task.id, t => ({ ...t, recurrence_skips: ['2026-02-01', '2026-03-01'] }));
    await service.editRepeatingDay(task.id, '2026-03-04', block(4, 8, 12), null);
    expect(await repo.read(task.id)).toMatchObject({ planned_sessions: [block(4, 13, 17)], recurrence_skips: ['2026-03-01', '2026-03-04'] });
    await service.applyPlanning(at(4, 8)); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull(); await service.applyPlanning(at(4, 13)); expect((await repo.read(task.id)).time_tracking_started_at).toBe(iso(4, 13));
    await service.recurrence(task.id, weekdays, undefined, [{ start: '09:00', end: '10:00' }]); expect((await repo.read(task.id)).planned_sessions).toEqual([block(4, 13, 17)]);
    await service.editRepeatingDay(task.id, '2026-03-05', block(5, 9, 10), block(5, 9, 11)); expect((await repo.read(task.id)).planned_sessions).toEqual([block(4, 13, 17), block(5, 9, 11)]);
    await expect(service.editRepeatingDay(task.id, '2026-03-06', block(6, 7, 8), null)).rejects.toThrow('no longer exists');
    // Moved onto a block the day already has of its own: planned once.
    await repo.update(task.id, t => ({ ...t, planned_sessions: [...t.planned_sessions, block(6, 11, 12)] })); await service.editRepeatingDay(task.id, '2026-03-06', block(6, 9, 10), block(6, 11, 12));
    expect((await repo.read(task.id)).planned_sessions.filter(b => b.start.startsWith('2026-03-06'))).toEqual([block(6, 11, 12)]);
  });
});

describe('repeat dialog times', () => {
  it('adds, removes and checks times, and saves them with the rule; stopping keeps the stored times', async () => {
    const { app } = harness(); const choose = vi.fn(async () => undefined);
    const picker = new RecurrencePicker(app, '2026-03-04', null, choose, undefined, [{ start: '08:00', end: '12:00' }]); picker.open(); const el = picker.contentEl;
    const inputs = () => Array.from(el.querySelectorAll<HTMLInputElement>('.organized-repeat-time input')); const note = () => el.querySelectorAll('.organized-session-note')[0].textContent;
    expect(inputs().map(i => i.value)).toEqual(['08:00', '12:00']); expect(note()).toBe('08:00–12:00');
    button(el, 'Add time').click(); expect(document.activeElement === inputs()[2] || inputs().length === 4).toBe(true); inputs()[2].value = '11:00'; inputs()[2].dispatchEvent(new Event('input')); expect(note()).toBe('Add both times, or neither.');
    (el.querySelectorAll('.organized-repeat-preset')[1] as HTMLElement).click(); await flush(); expect(choose).not.toHaveBeenCalled();
    inputs()[3].value = '13:00'; inputs()[3].dispatchEvent(new Event('input')); expect(note()).toBe('These times overlap; make them one.');
    inputs()[2].value = '22:00'; inputs()[3].value = '02:00'; inputs()[3].dispatchEvent(new Event('input')); expect(note()).toBe('08:00–12:00, 22:00–02:00 (+1 day)');
    button(el, 'Remove time 1').click(); for (let n = 0; n < 7; n++) button(el, 'Add time').click(); expect((button(el, 'Add time') as HTMLButtonElement).disabled).toBe(true);
    button(el, 'Remove time 3').click(); expect((button(el, 'Add time') as HTMLButtonElement).disabled).toBe(false);
    (el.querySelectorAll('.organized-repeat-preset')[1] as HTMLElement).click(); await flush(); expect(choose).toHaveBeenCalledWith(weekdays, [{ start: '22:00', end: '02:00' }]);
    const stop = new RecurrencePicker(app, '2026-03-04', weekdays, choose, undefined, [{ start: '08:00', end: '12:00' }]); stop.open(); const rows = Array.from(stop.contentEl.querySelectorAll<HTMLInputElement>('.organized-repeat-time input'));
    rows[1].value = ''; rows[1].dispatchEvent(new Event('input')); button(stop.contentEl, 'Stop repeating').click(); await flush(); expect(choose).toHaveBeenLastCalledWith(null, [{ start: '08:00', end: '12:00' }]);
  });
  it('asks a question with buttons and answers nothing when closed', () => {
    const { app } = harness(); const first = vi.fn(); const second = vi.fn(); const modal = new ChoiceModal(app, 'Pick', 'Which one?', [{ label: 'One', run: first }, { label: 'Two', run: second }]); modal.open();
    expect(modal.contentEl.textContent).toContain('Which one?'); button(modal.contentEl, 'Two').click(); expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]); expect(modal.contentEl.childElementCount).toBe(0);
  });
});

describe('repeating time in the views', () => {
  async function viewed(time = at(4, 7)) {
    const f = await fixture(time); const leaf: any = { app: f.app }; const view = new OrganizedInspectorView(leaf, f.owner); leaf.view = view; document.body.appendChild(view.contentEl); f.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    return { ...f, view };
  }
  it('draws repeating blocks on the day and asks whether a change is for this day or every day', async () => {
    const { service, repo, view, owner } = await viewed(); const task = await repo.create('Desk'); await service.recurrence(task.id, weekdays, undefined, [{ start: '09:00', end: '10:00' }]);
    view.tab = 'Calendar'; view.selectedDate = '2026-03-05'; view.calendarMode = 'Day'; await view.render(); await flush();
    const part = () => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block')).find(b => b.textContent?.includes('Desk'))!;
    expect(part().getAttribute('data-planned')).toBe('true'); part().click(); const ask = Modal.instances.at(-1) as unknown as ChoiceModal; expect(ask).toBeInstanceOf(ChoiceModal);
    button(ask.contentEl, 'This day').click(); const edit = Modal.instances.at(-1) as unknown as SessionModal; expect(edit.edit.logWorked).toBeUndefined();
    const change = vi.spyOn(service, 'editRepeatingDay'); await edit.edit.save(block(5, 9, 11), 'planned'); await flush(); expect(change).toHaveBeenLastCalledWith(task.id, '2026-03-05', block(5, 9, 10), block(5, 9, 11));
    await repo.update(task.id, t => ({ ...t, planned_sessions: [], recurrence_skips: [] })); await view.render(); await flush(); part().click(); button((Modal.instances.at(-1) as unknown as ChoiceModal).contentEl, 'This day').click();
    await (Modal.instances.at(-1) as unknown as SessionModal).edit.remove!(); await flush(); expect(change).toHaveBeenLastCalledWith(task.id, '2026-03-05', block(5, 9, 10), null);
    await (Modal.instances.at(-1) as unknown as SessionModal).edit.openTask!();
    view.tab = 'Calendar'; view.selectedDate = '2026-03-06'; await view.render(); await flush();  part().click(); const pick = vi.spyOn(owner, 'pickRecurrence'); button((Modal.instances.at(-1) as unknown as ChoiceModal).contentEl, 'Every day').click(); expect(pick).toHaveBeenCalled();
    // Today's block that is over can be logged as worked for this day.
    vi.setSystemTime(new Date(at(4, 11))); await repo.update(task.id, t => ({ ...t, planned_sessions: [], recurrence_skips: [] })); view.selectedDate = '2026-03-04'; await view.render(); await flush();
    part().click(); button((Modal.instances.at(-1) as unknown as ChoiceModal).contentEl, 'This day').click(); await (Modal.instances.at(-1) as unknown as SessionModal).edit.logWorked!(); await flush();
    expect(await repo.read(task.id)).toMatchObject({ planned_sessions: [], recurrence_skips: ['2026-03-04'], time_tracked_seconds: 3600 });
  });
  it('a day ticked done hides its repeating time from the day and the budgets', async () => {
    const { service, repo, view, add } = await viewed(); const task = await repo.create('Done today'); await service.recurrence(task.id, weekdays, undefined, [{ start: '09:00', end: '10:00' }]);
    await add(service.daily.path('2026-03-04'), `- [x] Done today <!--organized:${task.id}--> <!--organized:repeat-->`);
    view.tab = 'Calendar'; view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-block')).toBeNull();
    view.calendarMode = 'Week'; await view.render(); await flush(); expect(view.contentEl.querySelectorAll('.organized-week-block').length).toBe(2);
  });
  it('shows the repeating times in the Timer card, opens the repeat dialog from them, and offers no task budget while repeating', async () => {
    const { service, repo, view, owner } = await viewed(); const task = await repo.create('Standup'); await service.recurrence(task.id, weekdays, undefined, [{ start: '09:00', end: '09:15' }]);
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush();
    const row = button(view.contentEl, 'Every weekday · 09:00–09:15'); expect(row).toBeTruthy(); expect(button(view.contentEl, 'Set budget')).toBeUndefined();
    const pick = vi.spyOn(owner, 'pickRecurrence').mockImplementation(() => undefined); row.click(); expect(pick).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), undefined);
    // The cursor's todo goes along only when it is this task's (another task's line is never changed from here).
    const context: any = { file: { path: 'Note.md' }, line: { id: task.id } }; owner.context = context; row.click(); expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ id: task.id }), context);
  });
});

describe('found by the bug hunt of beta.11 and beta.12', () => {
  async function viewed(time = at(4, 7)) {
    const f = await fixture(time); const leaf: any = { app: f.app }; const view = new OrganizedInspectorView(leaf, f.owner); leaf.view = view; document.body.appendChild(view.contentEl); f.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    return { ...f, view };
  }
  const daily = parseRule('daily')!;
  it('logging a planned block as worked adds only the part no timer or session already covers, and is not offered once all of it is worked', async () => {
    const { service, repo, view } = await viewed(); const task = await repo.create('Plan'); await service.addPlanned(task.id, block(4, 9, 10));
    await service.applyPlanning(at(4, 9)); await service.applyPlanning(at(4, 10, 1)); expect((await repo.read(task.id)).time_tracked_seconds).toBe(3600);
    await service.logPlanned(task.id, block(4, 9, 10)); expect(await repo.read(task.id)).toMatchObject({ time_tracked_seconds: 3600, planned_sessions: [], work_sessions: [block(4, 9, 10)] });
    // Worked 10:15–10:30 by hand inside a plan of 10–11: logging adds the quarter before and the half hour after.
    await repo.update(task.id, t => ({ ...t, planned_sessions: [block(4, 10, 11)], work_sessions: [...t.work_sessions, { start: iso(4, 10, 15), end: iso(4, 10, 30) }], time_tracked_seconds: 3600 + 900 }));
    await service.logPlanned(task.id, block(4, 10, 11)); expect((await repo.read(task.id)).time_tracked_seconds).toBe(2 * 3600); expect((await repo.read(task.id)).work_sessions).toHaveLength(4);
    // In the day view: a plan that was all worked offers no Log as worked; one that was not, does.
    vi.setSystemTime(new Date(at(4, 12))); await repo.update(task.id, t => ({ ...t, planned_sessions: [block(4, 9, 10), { start: iso(4, 11), end: iso(4, 11, 30) }] }));
    view.tab = 'Calendar'; view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); await flush();
    const planned = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block[data-planned="true"]'));
    planned[0].click(); await flush(); expect((Modal.instances.at(-1) as unknown as SessionModal).edit.logWorked).toBeUndefined(); planned[1].click(); await flush(); expect((Modal.instances.at(-1) as unknown as SessionModal).edit.logWorked).toBeDefined();
  });
  it('a day whose daily note cannot be written keeps its todo and its blocks', async () => {
    const { repo, service, add } = await viewed(); const task = await repo.create('Keep'); await repo.update(task.id, t => ({ ...t, scheduled: '2026-03-05', planned_sessions: [block(5, 10, 11)] })); await add(service.daily.path('2026-03-06'), '');
    const insert = vi.spyOn(service, 'insert').mockRejectedValueOnce(new Error('disk full'));
    await service.saveSchedule(task.id, [{ date: '2026-03-06', from: '2026-03-05', blocks: [block(6, 14, 15)] }]); expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: ['2026-03-05'], planned_sessions: [block(5, 10, 11)] });
    expect((Notice.instances.at(-1)!.message as unknown as HTMLElement).textContent).toContain('Not changed: 2026-03-06'); insert.mockRestore();
    // Same day, same times: nothing to change; emptied times take the block away and keep the day.
    await service.saveSchedule(task.id, [{ date: '2026-03-05', from: '2026-03-05', blocks: [block(5, 10, 11)] }]); expect((await repo.read(task.id)).planned_sessions).toEqual([block(5, 10, 11)]);
    await service.saveSchedule(task.id, [{ date: '2026-03-05', from: '2026-03-05', blocks: [] }]); expect(await repo.read(task.id)).toMatchObject({ scheduled_dates: ['2026-03-05'], planned_sessions: [] });
  });
  it('Undo right after saving times that started the timer takes back both', async () => {
    const { service, repo, texts, add } = await fixture(at(4, 13)); const task = await repo.create('Shift'); const note = service.daily.path('2026-03-04'); await add(note, '');
    await service.recurrence(task.id, daily, undefined, [{ start: '08:00', end: '17:00' }]); expect((await repo.read(task.id)).time_tracking_started_at).not.toBeNull(); expect(texts.get(note)).toContain('[/] Shift');
    await service.undo(); expect(Notice.instances.at(-1)!.message).toBe('Organized changes undone. Created notes are preserved.');
    expect(await repo.read(task.id)).toMatchObject({ recurring: false, recurrence_times: [], time_tracking_started_at: null }); expect(texts.get(note)).toBe('');
    // Planning a later day for an undated task, with Undo, too.
    const later = await repo.create('Later'); await service.addPlanned(later.id, block(5, 9, 10)); await service.undo(); expect(Notice.instances.at(-1)!.message).toBe('Organized changes undone. Created notes are preserved.');
  });
  it('the morning part of a night block is changed for the day the block starts on', async () => {
    const { service, repo, view } = await viewed(); const task = await repo.create('Night'); await service.recurrence(task.id, daily, undefined, [{ start: '22:00', end: '02:00' }]);
    view.tab = 'Calendar'; view.selectedDate = '2026-03-05'; view.calendarMode = 'Day'; await view.render(); await flush();
    const morning = view.contentEl.querySelector<HTMLElement>('.organized-block')!; morning.click(); const ask = Modal.instances.at(-1) as unknown as ChoiceModal; expect(ask.message).toContain('Change only 2026-03-04');
    button(ask.contentEl, 'This day').click(); await (Modal.instances.at(-1) as unknown as SessionModal).edit.remove!(); await flush();
    expect(await repo.read(task.id)).toMatchObject({ recurrence_skips: ['2026-03-04'], planned_sessions: [] }); expect(Notice.instances.map(n => n.message).join('|')).not.toContain('no longer exists');
  });
  it('scheduling with a time the day already has does not plan it twice', async () => {
    const { repo, service } = await fixture(); const task = await repo.create('Twice'); await repo.update(task.id, t => ({ ...t, scheduled: '2026-03-05', planned_sessions: [block(5, 10, 11), block(5, 14, 15)] }));
    await service.scheduleTask(task.id, '2026-03-05', undefined, undefined, undefined, block(5, 10, 11)); expect((await repo.read(task.id)).planned_sessions).toEqual([block(5, 10, 11), block(5, 14, 15)]);
  });
  it('a recurring task canceled for today leaves today out of the day view and the budgets, like one done', async () => {
    const { service, repo, view, add } = await viewed(); const task = await repo.create('Job'); await service.recurrence(task.id, daily, undefined, [{ start: '09:00', end: '10:00' }]);
    await add(service.daily.path('2026-03-04'), `- [-] Job <!--organized:${task.id}--> <!--organized:repeat-->`);
    view.tab = 'Calendar'; view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-block')).toBeNull();
    // Canceled is not done: the list still says canceled for today, not done.
    expect((view as any).doneToday.has(task.id)).toBe(false);
  });
});

describe('found by the bug hunt of beta.13', () => {
  it('a todo forwarded by hand takes the day\'s blocks that have not begun along, so they start no timer on the day it left; the automatic carry-over moves none', async () => {
    const { service, repo, add, texts } = await fixture(at(4, 10)); const note = service.daily.path('2026-03-04'); const tomorrow = service.daily.path('2026-03-05');
    await add(tomorrow, ''); const old = await repo.create('Old'); await add(note, `- [ ] Old <!--organized:${old.id}-->`); await repo.update(old.id, t => ({ ...t, planned_sessions: [block(4, 20, 21)] }));
    const task = await repo.create('Later'); await service.scheduleTask(task.id, '2026-03-04'); await service.addPlanned(task.id, block(4, 8, 9)); await service.addPlanned(task.id, block(4, 15, 16));
    const line = (await repo.occurrences(task.id)).find(o => o.file.path === note)!; await service.marker({ file: line.file, line: line.tasks[0] }, '>');
    expect(await repo.read(task.id)).toMatchObject({ scheduled: '2026-03-05', planned_sessions: [block(4, 8, 9), block(5, 15, 16)] }); expect(Notice.instances.map(n => (n.message as unknown as HTMLElement).textContent ?? n.message).join('|')).toContain('moved from 2026-03-04 to 2026-03-05');
    await service.applyPlanning(at(4, 15)); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull(); expect(texts.get(note)).toContain('[>] Later'); expect(texts.get(tomorrow)).toContain('[ ] Later');
    await service.undo(); expect((await repo.read(task.id)).planned_sessions).toEqual([block(4, 8, 9), block(4, 15, 16)]);
    // Carried over by itself the next morning: what was planned for the day before stays there, as its record.
    vi.setSystemTime(new Date(at(5, 7))); const occurrence = (await repo.occurrences(old.id)).find(o => o.file.path === note)!;
    await service.schedule({ file: occurrence.file, line: occurrence.tasks[0] }, '2026-03-05', 'forward', 'automatic'); expect((await repo.read(old.id)).planned_sessions).toEqual([block(4, 20, 21)]);
  });
});
