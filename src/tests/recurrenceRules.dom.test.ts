// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Modal } from './__mocks__/obsidian';
import { localDate, nextDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY, parseRule } from '../recurrence';
import { RecurrencePicker } from '../modals';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const rule = (text: string) => parseRule(text)!;
const later = (n: number) => { let d = localDate(); for (let i = 0; i < n; i++) d = nextDate(d); return d; };
const daily = (n: number) => `Daily/${later(n)}.md`;

describe('repeat rules in the notes', () => {
  afterEach(() => { vi.restoreAllMocks(); Modal.instances.length = 0; });
  it('puts the task only into the daily notes the rule produces, and keeps the rule in the task note', async () => {
    const h = harness(); const task = await h.repo.create('Water'); for (let n = 0; n <= 5; n++) await h.add(daily(n));
    await h.service.recurrence(task.id, rule('every 2 days'));
    const has = (n: number) => h.texts.get(daily(n))!.includes(task.id);
    expect([0, 1, 2, 3, 4, 5].map(has)).toEqual([true, false, true, false, true, false]);
    const saved = await h.repo.read(task.id); expect(saved.recurring).toBe(true); expect(saved.recurrence).toBe('every 2 days'); expect(saved.recurrence_periods).toEqual([{ start: localDate(), stop: null }]);
  });
  it('a new interval restarts the count, a new weekday keeps it, and untouched future copies follow the rule', async () => {
    const h = harness(); const task = await h.repo.create('Water'); for (let n = 0; n <= 6; n++) await h.add(daily(n));
    await h.service.recurrence(task.id, rule('every 2 days'));
    await h.service.recurrence(task.id, rule('every 3 days'));
    const has = (n: number) => h.texts.get(daily(n))!.includes(task.id);
    expect([0, 1, 2, 3, 4, 5, 6].map(has)).toEqual([true, false, false, true, false, false, true]);
    let saved = await h.repo.read(task.id); expect(saved.recurrence_periods).toHaveLength(2); expect(saved.recurrence_periods[0].stop).toBe(localDate());
    await h.service.recurrence(task.id, rule('every 2 weeks on mon')); saved = await h.repo.read(task.id); expect(saved.recurrence_periods).toHaveLength(3);
    await h.service.recurrence(task.id, rule('every 2 weeks on thu')); saved = await h.repo.read(task.id); expect(saved.recurrence_periods).toHaveLength(3); expect(saved.recurrence).toBe('every 2 weeks on thu');
  });
  it('leaves a ticked or edited future copy alone when the rule no longer covers it', async () => {
    const h = harness(); const task = await h.repo.create('Water'); for (let n = 0; n <= 4; n++) await h.add(daily(n));
    await h.service.recurrence(task.id, rule('every 2 days'));
    h.texts.set(daily(2), h.texts.get(daily(2))!.replace('[ ]', '[x]'));
    await h.service.recurrence(task.id, rule('every 3 days'));
    expect(parseTasks(h.texts.get(daily(2))!)[0].marker).toBe('x'); expect(h.texts.get(daily(4))).not.toContain(task.id); expect(h.texts.get(daily(3))).toContain(task.id);
  });
  it('stopping removes untouched future copies, keeps today, and clears the rule', async () => {
    const h = harness(); const task = await h.repo.create('Water'); for (let n = 0; n <= 2; n++) await h.add(daily(n));
    await h.service.recurrence(task.id, rule('weekdays')); await h.service.recurrence(task.id, rule('every 3 days')); await h.service.recurrence(task.id, null);
    const saved = await h.repo.read(task.id); expect(saved.recurring).toBe(false); expect(saved.recurrence).toBeNull(); expect(h.texts.get(daily(0))).toContain(task.id); expect(h.texts.get(daily(2))).not.toContain(task.id);
    expect(saved.recurrence_periods.every(p => p.stop !== null)).toBe(true);
  });
  it('a new daily note gets the task only when the rule says so, and a task without a rule still repeats daily', async () => {
    const h = harness(); const every2 = await h.repo.create('Every other day'); const legacy = await h.repo.create('Old switch'); const broken = await h.repo.create('Broken rule');
    await h.service.recurrence(every2.id, rule('every 2 days'));
    await h.repo.update(legacy.id, t => ({ ...t, recurring: true, recurrence_periods: [] })); await h.repo.update(broken.id, t => ({ ...t, recurring: true, recurrence: 'whenever' }));
    const one: any = await h.add(daily(1)); await h.service.onDailyCreated(one); const two: any = await h.add(daily(2)); await h.service.onDailyCreated(two);
    const ids = (file: any) => parseTasks(h.texts.get(file.path)!).map(t => t.id);
    expect(ids(one)).toEqual(expect.arrayContaining([legacy.id, broken.id])); expect(ids(one)).not.toContain(every2.id); expect(ids(two)).toEqual(expect.arrayContaining([legacy.id, broken.id, every2.id]));
  });
});

describe('repeat dialog', () => {
  afterEach(() => { vi.restoreAllMocks(); Modal.instances.length = 0; });
  const open = (current: any = null, choose = vi.fn().mockResolvedValue(undefined), cancelled?: () => void) => { const h = harness(); const dialog = new RecurrencePicker(h.app, '2026-03-12', current, choose, cancelled); dialog.open(); return { dialog, choose, el: dialog.contentEl }; };
  const field = (el: HTMLElement, label: string) => el.querySelector<any>(`[aria-label="${label}"]`)!;
  const type = (input: any, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  const byText = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text)!;
  it('saves a common repeat with one tap', async () => {
    const { el, choose, dialog } = open(); expect(Array.from(el.querySelectorAll('.organized-repeat-preset')).map(b => b.textContent)).toEqual(['day', 'weekday', 'week on Thu', 'month on the 12th', 'year']);
    (el.querySelectorAll('.organized-repeat-preset')[1] as HTMLElement).click(); await flush(); expect(choose).toHaveBeenCalledWith(rule('weekdays')); expect((dialog as any).isOpen).toBe(false);
  });
  it('marks the current repeat and offers to stop it', async () => {
    const { el, choose } = open(rule('weekdays')); const pressed = Array.from(el.querySelectorAll('.organized-repeat-preset')).map(b => b.getAttribute('aria-pressed')); expect(pressed).toEqual(['false', 'true', 'false', 'false', 'false']);
    expect(field(el, 'Repeat every').value).toBe('1'); byText(el, 'Stop repeating').click(); await flush(); expect(choose).toHaveBeenCalledWith(null);
    expect(open().el.textContent).not.toContain('Stop repeating');
  });
  it('builds a weekly rule from days and a number, and says it in words', async () => {
    const { el, choose } = open(); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every week on Thu');
    type(field(el, 'Repeat every'), '3'); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every 3 weeks on Thu');
    byText(el, 'Mon').click(); byText(el, 'Thu').click(); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every 3 weeks on Mon');
    byText(el, 'Mon').click(); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every 3 weeks on Mon');
    byText(el, 'Fri').click(); byText(el, 'Save').click(); await flush(); expect(choose).toHaveBeenCalledWith(rule('every 3 weeks on mon,fri'));
  });
  it('shows only the fields that belong to the unit', async () => {
    const { el, choose } = open(); const days = el.querySelector('.organized-repeat-days')!; const month = field(el, 'Day of the month').parentElement!;
    expect(days.classList.contains('organized-hidden')).toBe(false); expect(month.classList.contains('organized-hidden')).toBe(true);
    const unit = field(el, 'Repeat unit'); unit.value = 'month'; unit.dispatchEvent(new Event('input')); expect(days.classList.contains('organized-hidden')).toBe(true); expect(month.classList.contains('organized-hidden')).toBe(false); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every month on the 12th');
    const day = field(el, 'Day of the month'); day.value = 'last'; day.dispatchEvent(new Event('input')); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every month on the last day'); day.value = '1'; day.dispatchEvent(new Event('input')); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every month on the 1st');
    day.value = '22'; day.dispatchEvent(new Event('input')); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every month on the 22nd'); day.value = '13'; day.dispatchEvent(new Event('input')); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every month on the 13th');
    unit.value = 'year'; unit.dispatchEvent(new Event('input')); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Every year'); byText(el, 'Save').click(); await flush(); expect(choose).toHaveBeenCalledWith(rule('every year'));
  });
  it('starts the form from the current rule', () => {
    const { el } = open(rule('every 2 months on last')); expect(field(el, 'Repeat every').value).toBe('2'); expect(field(el, 'Repeat unit').value).toBe('month'); expect(field(el, 'Day of the month').value).toBe('last');
    const weekly = open(rule('every 2 weeks on tue,sun')).el; expect(Array.from(weekly.querySelectorAll('.organized-repeat-day')).map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'true']);
  });
  it('refuses a number that is not 1 to 999', async () => {
    const { el, choose, dialog } = open(); type(field(el, 'Repeat every'), '0'); expect(el.querySelector('.organized-repeat-summary')!.textContent).toBe('Use a whole number from 1 to 999.');
    byText(el, 'Save').click(); await flush(); expect(choose).not.toHaveBeenCalled(); expect((dialog as any).isOpen).toBe(true); type(field(el, 'Repeat every'), '1000'); expect(el.querySelector('.organized-session-problem')).not.toBeNull(); type(field(el, 'Repeat every'), '2.5'); expect(el.querySelector('.organized-session-problem')).not.toBeNull();
  });
  it('reports a failed save and tells the caller when it is dismissed', async () => {
    const choose = vi.fn().mockRejectedValue(Error('no write')); const first = open(null, choose); (first.el.querySelector('.organized-repeat-preset') as HTMLElement).click(); await flush();
    const cancelled = vi.fn(); const dismissed = open(null, undefined, cancelled); dismissed.dialog.close(); await flush(); expect(cancelled).toHaveBeenCalledTimes(1);
    const saved = open(null, undefined, cancelled); (saved.el.querySelector('.organized-repeat-preset') as HTMLElement).click(); await flush(); expect(cancelled).toHaveBeenCalledTimes(1);
    const quiet = open(); quiet.dialog.close(); await flush();
  });
});

describe('typing r', () => {
  afterEach(() => { vi.restoreAllMocks(); Modal.instances.length = 0; });
  it('opens the picker, saves the choice, and puts the todo marker back when it is dismissed', async () => {
    const h = harness(); const plugin = new Organized(h.app as any, { id: 'organized', name: 'Organized', version: '0.0.0' } as any); await plugin.onload(); await flush();
    const task = await plugin.repo.create('Water'); const file: any = await h.add('Note.md', '');
    const context = () => { const text = `- [r] Water <!--organized:${task.id}-->`; h.texts.set(file.path, text); return { file, line: parseTasks(text)[0] }; };
    const set = vi.spyOn(plugin.service, 'recurrence').mockResolvedValue(); const clean = vi.spyOn(plugin.service, 'clean').mockResolvedValue();
    await plugin.trigger(context()); let picker = Modal.instances.at(-1) as RecurrencePicker; expect(picker).toBeInstanceOf(RecurrencePicker); expect(picker.current).toBeNull();
    (picker.contentEl.querySelectorAll('.organized-repeat-preset')[1] as HTMLElement).click(); await flush(); expect(set).toHaveBeenCalledWith(task.id, rule('weekdays'), expect.objectContaining({ file })); picker.close(); await flush(); expect(clean).not.toHaveBeenCalled();
    await plugin.trigger(context()); picker = Modal.instances.at(-1) as RecurrencePicker; picker.close(); await flush(); expect(clean).toHaveBeenCalledWith(expect.objectContaining({ file }), ' ');
    await plugin.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'every 2 days' })); const fresh = await plugin.repo.read(task.id);
    plugin.pickRecurrence(fresh); picker = Modal.instances.at(-1) as RecurrencePicker; expect(picker.current).toEqual(rule('every 2 days')); clean.mockClear(); picker.close(); await flush(); expect(clean).not.toHaveBeenCalled();
  });
});
