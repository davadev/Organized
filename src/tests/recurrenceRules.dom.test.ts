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

describe('repeat picker', () => {
  afterEach(() => { vi.restoreAllMocks(); Modal.instances.length = 0; });
  it('lists the usual choices, reads typed rules and offers to stop only when repeating', async () => {
    const h = harness(); const choose = vi.fn().mockResolvedValue(undefined); const cancelled = vi.fn();
    const picker = new RecurrencePicker(h.app, '2026-03-12', null, choose, cancelled);
    expect(picker.getSuggestions('').map(c => c.label)).toEqual(['Every day', 'Every weekday', 'Every week on Thu', 'Every month on the 12th', 'Every year']);
    expect(picker.getSuggestions('week').map(c => c.label)).toEqual(['Every week', 'Every weekday', 'Every week on Thu']); expect(picker.getSuggestions('daily').map(c => c.label)).toEqual(['Every day']); expect(picker.getSuggestions('3 weeks thu').map(c => c.label)).toEqual(['Every 3 weeks on Thu']); expect(picker.getSuggestions('zzz')).toEqual([]); expect(picker.getSuggestions('stop')).toEqual([]);
    const host = document.createElement('div'); picker.renderSuggestion(picker.getSuggestions('')[0], host); expect(host.textContent).toBe('Every day');
    picker.open(); picker.onChooseSuggestion(picker.getSuggestions('')[1]); picker.close(); await flush(); expect(choose).toHaveBeenCalledWith(rule('weekdays')); expect(cancelled).not.toHaveBeenCalled();
    const current = new RecurrencePicker(h.app, '2026-03-12', DAILY, choose, cancelled); expect(current.getSuggestions('').map(c => c.label).at(-1)).toBe('Stop repeating');
    const row = document.createElement('div'); current.renderSuggestion(current.getSuggestions('')[0], row); expect(row.textContent).toBe('Every day · current'); const other = document.createElement('div'); current.renderSuggestion(current.getSuggestions('')[1], other); expect(other.textContent).toBe('Every weekday'); const stop = document.createElement('div'); current.renderSuggestion(current.getSuggestions('stop')[0], stop); expect(stop.textContent).toBe('Stop repeating');
    current.open(); current.onChooseSuggestion(current.getSuggestions('stop')[0]); current.close(); await flush(); expect(choose).toHaveBeenLastCalledWith(null);
    choose.mockRejectedValueOnce(Error('no write')); current.onChooseSuggestion(current.getSuggestions('')[0]); await flush();
    const quiet = new RecurrencePicker(h.app, '2026-03-12', null, choose); quiet.open(); quiet.close(); await flush();
    const dismissed = new RecurrencePicker(h.app, '2026-03-12', null, choose, cancelled); dismissed.open(); dismissed.close(); await flush(); expect(cancelled).toHaveBeenCalledTimes(1);
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
    picker.onChooseSuggestion({ label: '', rule: rule('weekdays') }); await flush(); expect(set).toHaveBeenCalledWith(task.id, rule('weekdays'), expect.objectContaining({ file })); picker.close(); await flush(); expect(clean).not.toHaveBeenCalled();
    await plugin.trigger(context()); picker = Modal.instances.at(-1) as RecurrencePicker; picker.close(); await flush(); expect(clean).toHaveBeenCalledWith(expect.objectContaining({ file }), ' ');
    await plugin.repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'every 2 days' })); const fresh = await plugin.repo.read(task.id);
    plugin.pickRecurrence(fresh); picker = Modal.instances.at(-1) as RecurrencePicker; expect(picker.current).toEqual(rule('every 2 days')); clean.mockClear(); picker.close(); await flush(); expect(clean).not.toHaveBeenCalled();
  });
});
