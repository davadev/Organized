// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Modal, Notice } from './__mocks__/obsidian';
import { addDays, localDate, newTask, taskFrom } from '../model';
import { parseTasks } from '../codec';
import { DAILY, occursBetween, parseRule, repeatsOn } from '../recurrence';
import { plansIn } from '../plans';
import { RecurrencePicker } from '../modals';
import { splitNote } from '../repository';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); Modal.instances.length = 0; });
const today = () => localDate(); const later = (n: number) => addDays(today(), n);
const rule = (text: string) => parseRule(text)!;
const note = (date: string) => `Daily/${date}.md`;
const dayName = (date: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00`).getDay()];
const copy = (title: string, id: string, marker = ' ') => `- [${marker}] ${title} <!--organized:${id}--> <!--organized:repeat-->`;

describe('the last day of a repeat in the model', () => {
  it('is kept only while the task repeats, and only as a real date', () => {
    const base = { id: 'abcdefgh', title: 'T' };
    expect(taskFrom({ ...base, recurring: true, recurrence_end: '2026-12-31' }, 'abcdefgh').recurrence_end).toBe('2026-12-31');
    for (const end of ['2026-02-30', 'soon', 5, null, '']) expect(taskFrom({ ...base, recurring: true, recurrence_end: end }, 'abcdefgh').recurrence_end, String(end)).toBeNull();
    expect(taskFrom({ ...base, recurring: false, recurrence_end: '2026-12-31' }, 'abcdefgh').recurrence_end).toBeNull();
  });
  it('makes the repeat fall on its last day and on no day after it', () => {
    const task = { ...newTask('Habit', 'abcdefgh'), recurring: true, recurrence: 'daily', recurrence_periods: [{ start: '2026-03-01', stop: null }], recurrence_end: '2026-03-10' };
    expect(repeatsOn(task, '2026-03-09')).toBe(true); expect(repeatsOn(task, '2026-03-10')).toBe(true); expect(repeatsOn(task, '2026-03-11')).toBe(false); expect(repeatsOn({ ...task, recurrence_end: null }, '2026-03-11')).toBe(true);
    // Repeating planned times stop the same day.
    const timed = { ...task, recurrence_times: [{ start: '09:00', end: '10:00' }] }; const day = (d: string) => new Date(`${d}T00:00:00`).getTime();
    expect(plansIn(timed, day('2026-03-10'), day('2026-03-11'), day('2026-03-10')).length).toBe(1); expect(plansIn(timed, day('2026-03-11'), day('2026-03-12'), day('2026-03-11')).length).toBe(0);
  });
  it('tells whether a rule falls on any day before an end, from the phase it already has, and gives up looking after ten years', () => {
    expect(occursBetween(DAILY, '2026-03-01', '2026-03-05', '2026-03-05')).toBe(true);
    expect(occursBetween(rule('every 3 days'), '2026-03-01', '2026-03-02', '2026-03-03')).toBe(false); expect(occursBetween(rule('every 3 days'), '2026-03-01', '2026-03-02', '2026-03-04')).toBe(true);
    expect(occursBetween(rule('every year'), '2026-03-01', '2026-03-02', '2027-02-28')).toBe(false); expect(occursBetween(rule('every year'), '2026-03-01', '2026-03-02', '2027-03-01')).toBe(true);
    expect(occursBetween(rule('every 999 years'), '2026-03-01', '2026-03-02', '9000-01-01')).toBe(true);
    expect(occursBetween(DAILY, '2026-03-01', '2026-03-05', '2026-03-04')).toBe(false);
  });
});

describe('setting the last day of a repeat', () => {
  it('stores it, and lets later notes hold the todo up to that day and not after', async () => {
    const h = harness(); const task = await h.repo.create('Vitamins'); for (let n = 0; n <= 6; n++) await h.add(note(later(n)));
    await h.service.recurrence(task.id, DAILY, undefined, undefined, later(3));
    expect(await h.repo.read(task.id)).toMatchObject({ recurring: true, recurrence_end: later(3) });
    const has = (n: number) => h.texts.get(note(later(n)))!.includes(task.id); expect([0, 1, 2, 3, 4, 5, 6].map(has)).toEqual([true, true, true, true, false, false, false]);
    const fresh: any = await h.add(note(later(9))); await h.service.onDailyCreated(fresh); expect(h.texts.get(fresh.path)).not.toContain(task.id);
  });
  it('takes away only the untouched copies after the new last day, keeps ticked or edited ones, and brings the copies back when the end is lifted', async () => {
    const h = harness(); const task = await h.repo.create('Vitamins'); for (let n = 0; n <= 5; n++) await h.add(note(later(n)));
    await h.service.recurrence(task.id, DAILY); h.texts.set(note(later(4)), copy('Vitamins', task.id, 'x'));
    await h.service.recurrence(task.id, DAILY, undefined, undefined, later(2));
    expect([2, 3, 4, 5].map(n => h.texts.get(note(later(n)))!.includes(task.id))).toEqual([true, false, true, false]); expect(h.texts.get(note(later(4)))).toContain('[x]');
    await h.service.recurrence(task.id, DAILY); expect((await h.repo.read(task.id)).recurrence_end).toBeNull(); expect(h.texts.get(note(later(3)))).toContain(task.id);
  });
  it('refuses a day that is over, a date that is not one and an end the rule never reaches, and writes nothing', async () => {
    const h = harness(); const task = await h.repo.create('Habit'); const before = await h.repo.readText(h.repo.taskFile(task.id)!);
    await expect(h.service.recurrence(task.id, DAILY, undefined, undefined, later(-1))).rejects.toThrow('today or later');
    await expect(h.service.recurrence(task.id, DAILY, undefined, undefined, '2026-02-30')).rejects.toThrow('today or later');
    await expect(h.service.recurrence(task.id, rule(`every week on ${dayName(later(4))}`), undefined, undefined, later(3))).rejects.toThrow('No day up to the end date');
    expect(await h.repo.readText(h.repo.taskFile(task.id)!)).toBe(before); expect((await h.repo.read(task.id)).recurring).toBe(false);
    await h.service.recurrence(task.id, rule(`every week on ${dayName(later(4))}`), undefined, undefined, later(5)); expect((await h.repo.read(task.id)).recurrence_end).toBe(later(5));
  });
  it('lets today be the last day, counts the phase of a repeat that keeps its cadence, and drops the end with the repeat', async () => {
    const h = harness(); const task = await h.repo.create('Habit'); await h.service.recurrence(task.id, rule('every 3 days'), undefined, undefined, today()); expect((await h.repo.read(task.id)).recurrence_end).toBe(today());
    // The same cadence keeps its start day: an end two days out still reaches the third day of the count that began three days ago.
    const other = await h.repo.create('Phase'); await h.repo.update(other.id, t => ({ ...t, recurring: true, recurrence: 'every 3 days', created: new Date(Date.now() - 4 * 86400000).toISOString(), recurrence_periods: [{ start: addDays(today(), -4), stop: null }] }));
    await h.service.recurrence(other.id, rule('every 3 days'), undefined, undefined, later(2)); expect((await h.repo.read(other.id)).recurrence_end).toBe(later(2));
    await h.service.recurrence(task.id, null, undefined, undefined, later(3)); expect(await h.repo.read(task.id)).toMatchObject({ recurring: false, recurrence_end: null });
    expect(splitNote(await h.repo.readText(h.repo.taskFile(task.id)!)).frontmatter).not.toHaveProperty('recurrence_end');
  });
  it('can be undone with the notice, and a task with no end writes no extra key', async () => {
    const h = harness(); const task = await h.repo.create('Habit'); await h.service.recurrence(task.id, DAILY); expect(splitNote(await h.repo.readText(h.repo.taskFile(task.id)!)).frontmatter).not.toHaveProperty('recurrence_end');
    await h.service.recurrence(task.id, DAILY, undefined, undefined, later(7)); expect(splitNote(await h.repo.readText(h.repo.taskFile(task.id)!)).frontmatter).toHaveProperty('recurrence_end', later(7));
    await h.service.undo(); expect((await h.repo.read(task.id)).recurrence_end).toBeNull();
  });
});

describe('a repeat that reached its last day', () => {
  async function ended(h: ReturnType<typeof harness>, lastDay = later(-2)) {
    const task = await h.repo.create('Vitamins'); await h.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'daily', recurrence_end: lastDay, recurrence_periods: [{ start: later(-40), stop: later(-30) }, { start: later(-9), stop: null }] }));
    return task;
  }
  it('is switched off by the first check of a new day: no more todos, its period closes on its last day, its status and old todos stay, and one Undo brings the repeat back', async () => {
    const h = harness(); const task = await ended(h); await h.add(note(later(-2)), copy('Vitamins', task.id, 'x')); const todayNote: any = await h.add(note(today()));
    await h.service.reconcile(todayNote);
    expect(await h.repo.read(task.id)).toMatchObject({ recurring: false, recurrence: null, recurrence_end: null, status: 'open', recurrence_periods: [{ start: later(-40), stop: later(-30) }, { start: later(-9), stop: later(-2) }] });
    expect(h.texts.get(note(later(-2)))).toContain(task.id); expect(Notice.instances.some(n => (n as any).message?.querySelector?.('.organized-notice-title')?.textContent === 'Repeat ended')).toBe(true);
    const next: any = await h.add(note(later(1))); await h.service.onDailyCreated(next); expect(h.texts.get(next.path)).not.toContain(`<!--organized:repeat-->`);
    await h.service.undo(); expect(await h.repo.read(task.id)).toMatchObject({ recurring: true, recurrence_end: later(-2) });
  });
  it('is left alone on its last day, and on a day before it, and a task that never ends is never touched', async () => {
    const h = harness(); const onDay = await ended(h, today()); const ahead = await ended(h, later(3)); const forever = await h.repo.create('Forever'); await h.service.recurrence(forever.id, DAILY);
    await h.service.reconcile(await h.add(note(today())) as any);
    expect((await h.repo.read(onDay.id)).recurring).toBe(true); expect((await h.repo.read(ahead.id)).recurring).toBe(true); expect((await h.repo.read(forever.id)).recurring).toBe(true);
    expect(Notice.instances.some(n => (n as any).message?.querySelector?.('.organized-notice-title')?.textContent === 'Repeat ended')).toBe(false);
  });
  it('is checked once a day, tried again the next day when it could not be written, and several are named in one notice', async () => {
    const h = harness(); const a = await ended(h); const b = await ended(h); const note1: any = await h.add(note(today()));
    const update = h.repo.update.bind(h.repo); const spy = vi.spyOn(h.repo, 'update').mockImplementation(async (id, change) => { if (id === a.id) throw new Error('busy'); return update(id, change); });
    await h.service.reconcile(note1); expect((await h.repo.read(a.id)).recurring).toBe(true); expect((await h.repo.read(b.id)).recurring).toBe(false);
    spy.mockRestore(); await h.service.reconcile(note1); expect((await h.repo.read(a.id)).recurring).toBe(true);
    (h.service as any).repeatsEnded = ''; await h.service.reconcile(note1); expect((await h.repo.read(a.id)).recurring).toBe(false);
  });
  it('is switched off even when it was noticed weeks late, and its unticked last todo is then carried forward like any unfinished task', async () => {
    const h = harness(); const task = await ended(h, later(-20)); await h.add(note(later(-20)), copy('Vitamins', task.id)); const now: any = await h.add(note(today()));
    await h.service.reconcile(now); expect(await h.repo.read(task.id)).toMatchObject({ recurring: false, recurrence_periods: [{ start: later(-40), stop: later(-30) }, { start: later(-9), stop: later(-20) }] });
    expect(parseTasks(h.texts.get(now.path)!).map(t => t.id)).toEqual([task.id]);
  });
});

describe('the dialog', () => {
  const open = (current: any = null, end: string | null = null, anchor = '2026-03-12', choose = vi.fn().mockResolvedValue(undefined), cancelled?: () => void) => {
    const h = harness(); const dialog = new RecurrencePicker(h.app, '2026-03-12', current, choose, cancelled, [], end, anchor); dialog.open(); return { dialog, choose, el: dialog.contentEl };
  };
  const field = (el: HTMLElement) => el.querySelector<HTMLInputElement>('[aria-label="Last day of the repeat"]')!;
  const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  const preset = (el: HTMLElement, n: number) => (el.querySelectorAll('.organized-repeat-preset')[n] as HTMLElement).click();
  const problem = (el: HTMLElement) => el.querySelector('.organized-session-problem')?.textContent ?? null;
  it('shows the stored last day, leaves it empty for a repeat for good, and hands the day to every way of saving', async () => {
    const { el, choose } = open(rule('weekdays'), '2026-04-30'); expect(field(el).value).toBe('2026-04-30'); expect(field(el).min).toBe('2026-03-12');
    preset(el, 0); await flush(); expect(choose).toHaveBeenLastCalledWith(DAILY, [], '2026-04-30');
    const custom = open(null); expect(field(custom.el).value).toBe(''); preset(custom.el, 1); await flush(); expect(custom.choose).toHaveBeenCalledWith(rule('weekdays'), [], null);
    const saved = open(null); type(field(saved.el), '2026-03-20'); (Array.from(saved.el.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLElement).click(); await flush(); expect(saved.choose).toHaveBeenCalledWith(expect.objectContaining({ unit: 'week' }), [], '2026-03-20');
  });
  it('names a day that is over or that no day of the rule reaches, keeps the dialog open and clears the message when the field changes', async () => {
    const { el, choose, dialog } = open(null); type(field(el), '2026-03-11'); preset(el, 0); await flush(); expect(choose).not.toHaveBeenCalled(); expect(problem(el)).toBe('The last day must be today or later.'); expect((dialog as any).isOpen).toBe(true);
    type(field(el), '2026-03-14'); expect(problem(el)).toBeNull(); type(field(el), ''); preset(el, 4); await flush(); expect(choose).toHaveBeenCalledWith(rule('yearly'), [], null);
    const same = open(rule('every 3 days'), '2026-03-14', '2026-03-10'); preset(same.el, 0); await flush(); expect(same.choose).toHaveBeenCalledWith(DAILY, [], '2026-03-14');
    const phase = open(rule('every 3 days'), '2026-03-12', '2026-03-11'); (Array.from(phase.el.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLElement).click(); await flush(); expect(problem(phase.el)).toBe('No day up to then matches this repeat.');
  });
  it('drops the last day when the repeat is stopped, whatever the field says, and puts the marker back on dismissal', async () => {
    const cancelled = vi.fn(); const { el, choose, dialog } = open(rule('weekdays'), '2026-03-20', '2026-03-12', undefined, cancelled);
    (Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Stop repeating') as HTMLElement).click(); await flush(); expect(choose).toHaveBeenCalledWith(null, [], null);
    const shut = open(null, null, '2026-03-12', undefined, cancelled); shut.dialog.close(); await flush(); expect(cancelled).toHaveBeenCalledTimes(1); expect(dialog).toBeTruthy();
  });
  it('is opened by the panel and the typed marker with the task\'s own last day and start', async () => {
    const h = harness(); const owner = new Organized(h.app as any, { id: 'organized', name: 'Organized', version: '0.0.0' } as any); await owner.onload(); await flush();
    const task = await owner.repo.create('Habit'); await owner.service.recurrence(task.id, DAILY, undefined, undefined, later(10));
    owner.pickRecurrence(await owner.repo.read(task.id)); const picker = Modal.instances.at(-1) as RecurrencePicker; expect(picker.end).toBe(later(10)); expect(picker.anchor).toBe(today());
    const save = vi.spyOn(owner.service, 'recurrence').mockResolvedValue(); (picker.contentEl.querySelectorAll('.organized-repeat-preset')[1] as HTMLElement).click(); await flush(); expect(save).toHaveBeenCalledWith(task.id, rule('weekdays'), undefined, [], later(10));
  });
});

describe('the panel', () => {
  it('says until when a repeat runs, and that it ended when the day is over and the check has not run yet', async () => {
    vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
    const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    const task = await owner.repo.create('Habit'); await owner.service.recurrence(task.id, DAILY, undefined, undefined, later(10)); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    const pill = () => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-prop')).find(el => el.getAttribute('aria-label') === 'Recurring')!;
    expect(pill().textContent).toContain(`Every day · until ${later(10)}`);
    await owner.repo.update(task.id, t => ({ ...t, recurrence_end: later(-1) })); await view.render(); expect(pill().textContent).toContain(`Every day · ended ${later(-1)}`);
    await owner.repo.update(task.id, t => ({ ...t, recurrence_end: null })); await view.render(); expect(pill().textContent).toBe('Every day');
  });
});
