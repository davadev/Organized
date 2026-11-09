import { describe, expect, it } from 'vitest';
import { DAILY, formatRule, occursOn, parseRule, presetRules, repeatsOn, ruleLabel, sameCadence, taskRule } from '../recurrence';

const rule = (text: string) => parseRule(text)!;
const task = (over: Record<string, unknown>) => ({ recurring: true, recurrence: null, recurrence_periods: [{ start: '2026-03-02', stop: null }], created: '2026-01-01T00:00:00.000Z', ...over }) as any;

describe('repeat rules', () => {
  it('reads presets, aliases and the general form, and writes them back the same', () => {
    for (const text of ['daily', 'weekdays', 'every week', 'every month', 'every year', 'every 3 weeks on thu', 'every 2 days', 'every 2 months on 15', 'every month on last', 'every week on mon,wed,fri', 'every 2 years']) expect(formatRule(rule(text))).toBe(text);
    expect(formatRule(rule('Weekly'))).toBe('every week'); expect(formatRule(rule('day'))).toBe('daily'); expect(formatRule(rule('weekday'))).toBe('weekdays'); expect(formatRule(rule('annually'))).toBe('every year');
    expect(formatRule(rule('3 weeks thu'))).toBe('every 3 weeks on thu'); expect(formatRule(rule('every thursday'))).toBe('every week on thu'); expect(formatRule(rule('mon, thu'))).toBe('every week on mon,thu');
    expect(formatRule(rule('every week on thursday and monday'))).toBe('every week on mon,thu'); expect(formatRule(rule('every  2   months on 1st'))).toBe('every 2 months on 1');
  });
  it('rejects what is not a rule', () => {
    for (const text of ['', 'sometimes', 'every 0 days', 'every 1000 days', 'every day on mon', 'every year on 3', 'every month on 32', 'every month on 0', 'every week on funday', 'every week on mo', 'every month on', 'tomorrow']) expect(parseRule(text)).toBeNull();
  });
  it('labels rules for people', () => {
    expect(ruleLabel(DAILY)).toBe('Every day'); expect(ruleLabel(rule('weekdays'))).toBe('Every weekday'); expect(ruleLabel(rule('every 3 weeks on thu'))).toBe('Every 3 weeks on Thu'); expect(ruleLabel(rule('every week on mon,fri'))).toBe('Every week on Mon, Fri');
    expect(ruleLabel(rule('every month on 1'))).toBe('Every month on the 1st'); expect(ruleLabel(rule('every month on 22'))).toBe('Every month on the 22nd'); expect(ruleLabel(rule('every month on 3'))).toBe('Every month on the 3rd'); expect(ruleLabel(rule('every month on 12'))).toBe('Every month on the 12th'); expect(ruleLabel(rule('every month on 11'))).toBe('Every month on the 11th'); expect(ruleLabel(rule('every month on 15'))).toBe('Every month on the 15th');
    expect(ruleLabel(rule('every 2 months on last'))).toBe('Every 2 months on the last day'); expect(ruleLabel(rule('every year'))).toBe('Every year'); expect(ruleLabel(rule('every week'))).toBe('Every week');
  });
  it('offers the usual choices anchored on today', () => {
    // 2026-03-12 is a Thursday.
    expect(presetRules('2026-03-12').map(formatRule)).toEqual(['daily', 'weekdays', 'every week on thu', 'every month on 12', 'every year']);
    expect(presetRules('2026-03-12')[0]).not.toBe(DAILY);
  });
  it('daily and every N days count from the anchor', () => {
    expect(occursOn(DAILY, '2026-03-02', '2030-01-01')).toBe(true);
    const third = rule('every 3 days'); expect(occursOn(third, '2026-03-02', '2026-03-05')).toBe(true); expect(occursOn(third, '2026-03-02', '2026-03-06')).toBe(false); expect(occursOn(third, '2026-03-02', '2026-02-27')).toBe(true); expect(occursOn(third, '2026-03-02', '2026-02-28')).toBe(false);
  });
  it('weekly rules pick weekdays, default to the anchor weekday and count weeks from Monday', () => {
    const weekdays = rule('weekdays'); expect(['2026-03-02', '2026-03-06'].map(d => occursOn(weekdays, '2026-03-02', d))).toEqual([true, true]); expect(['2026-03-07', '2026-03-08'].map(d => occursOn(weekdays, '2026-03-02', d))).toEqual([false, false]);
    const weekly = rule('weekly'); expect(occursOn(weekly, '2026-03-04', '2026-03-11')).toBe(true); expect(occursOn(weekly, '2026-03-04', '2026-03-12')).toBe(false);
    const every3 = rule('every 3 weeks on thu'); expect(occursOn(every3, '2026-03-02', '2026-03-05')).toBe(true); expect(occursOn(every3, '2026-03-02', '2026-03-12')).toBe(false); expect(occursOn(every3, '2026-03-02', '2026-03-26')).toBe(true); expect(occursOn(every3, '2026-03-02', '2026-03-19')).toBe(false);
    // Across the new year: 2025-12-29 is a Monday, 2026-01-15 a Thursday three weeks later.
    expect(occursOn(every3, '2025-12-29', '2026-01-22')).toBe(true); expect(occursOn(every3, '2025-12-29', '2026-01-15')).toBe(false);
    // The anchor week counts from its Monday even when the anchor is a Sunday.
    const sunday = rule('every 2 weeks on mon,sun'); expect(occursOn(sunday, '2026-03-08', '2026-03-08')).toBe(true); expect(occursOn(sunday, '2026-03-08', '2026-03-09')).toBe(false); expect(occursOn(sunday, '2026-03-08', '2026-03-16')).toBe(true); expect(occursOn(sunday, '2026-03-08', '2026-03-22')).toBe(true); expect(occursOn(sunday, '2026-03-08', '2026-03-23')).toBe(false);
    expect(occursOn(every3, '2026-03-02', '2026-02-12')).toBe(true);
  });
  it('monthly rules clamp to short months and honour last', () => {
    const on31 = rule('every month on 31'); expect(occursOn(on31, '2026-01-31', '2026-02-28')).toBe(true); expect(occursOn(on31, '2026-01-31', '2026-02-27')).toBe(false); expect(occursOn(on31, '2026-01-31', '2026-04-30')).toBe(true); expect(occursOn(on31, '2026-01-31', '2026-05-31')).toBe(true); expect(occursOn(on31, '2028-01-31', '2028-02-29')).toBe(true);
    const last = rule('every month on last'); expect(occursOn(last, '2026-01-10', '2026-02-28')).toBe(true); expect(occursOn(last, '2026-01-10', '2026-02-27')).toBe(false);
    const byAnchor = rule('monthly'); expect(occursOn(byAnchor, '2026-01-15', '2026-02-15')).toBe(true); expect(occursOn(byAnchor, '2026-01-15', '2026-02-16')).toBe(false); expect(occursOn(byAnchor, '2026-01-31', '2026-02-28')).toBe(true);
    const every2 = rule('every 2 months on 1'); expect(occursOn(every2, '2026-01-20', '2026-03-01')).toBe(true); expect(occursOn(every2, '2026-01-20', '2026-02-01')).toBe(false); expect(occursOn(every2, '2026-01-20', '2025-11-01')).toBe(true);
  });
  it('yearly rules keep the date and clamp 29 February', () => {
    const yearly = rule('yearly'); expect(occursOn(yearly, '2026-03-12', '2027-03-12')).toBe(true); expect(occursOn(yearly, '2026-03-12', '2027-03-13')).toBe(false); expect(occursOn(yearly, '2026-03-12', '2027-04-12')).toBe(false);
    expect(occursOn(yearly, '2028-02-29', '2029-02-28')).toBe(true); expect(occursOn(yearly, '2028-02-29', '2032-02-29')).toBe(true); expect(occursOn(yearly, '2028-02-29', '2029-03-01')).toBe(false);
    const every2 = rule('every 2 years'); expect(occursOn(every2, '2026-03-12', '2028-03-12')).toBe(true); expect(occursOn(every2, '2026-03-12', '2027-03-12')).toBe(false);
  });
  it('treats a task without a readable rule as daily and a stopped task as never', () => {
    expect(taskRule(task({}))).toBe(DAILY); expect(taskRule(task({ recurrence: 'nonsense' }))).toBe(DAILY); expect(formatRule(taskRule(task({ recurrence: 'weekdays' })))).toBe('weekdays');
    expect(repeatsOn(task({}), '2026-03-07')).toBe(true); expect(repeatsOn(task({ recurring: false }), '2026-03-07')).toBe(false);
    expect(repeatsOn(task({ recurrence: 'every week on thu' }), '2026-03-12')).toBe(true); expect(repeatsOn(task({ recurrence: 'every week on thu' }), '2026-03-13')).toBe(false);
    // The open period is the anchor; with none, the day the task was created.
    expect(repeatsOn(task({ recurrence: 'every 2 days', recurrence_periods: [{ start: '2026-03-01', stop: '2026-03-02' }, { start: '2026-03-05', stop: null }] }), '2026-03-07')).toBe(true);
    expect(repeatsOn(task({ recurrence: 'every 2 days', recurrence_periods: [], created: '2026-03-06T10:00:00.000Z' }), '2026-03-08')).toBe(true);
  });
  it('compares cadence by interval and unit only', () => {
    expect(sameCadence(rule('every 2 weeks on mon'), rule('every 2 weeks on thu'))).toBe(true); expect(sameCadence(rule('every 2 weeks'), rule('every 3 weeks'))).toBe(false); expect(sameCadence(rule('weekly'), rule('monthly'))).toBe(false);
  });
});
