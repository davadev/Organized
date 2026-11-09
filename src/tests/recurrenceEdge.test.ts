import { describe, expect, it } from 'vitest';
import { anchorOf, DAILY, explicitRule, formatRule, occursOn, parseRule, repeatsOn, Rule, ruleLabel, Unit } from '../recurrence';

/** A seeded generator, so a failure names the rule and date that broke. */
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const parts = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7 }; };
const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const mondayIndex = (date: string) => Math.floor((day(date) - 4) / 7); // 1970-01-05 was a Monday

/** The rule written out the slow, obvious way, to check the fast one against. */
function reference(rule: Rule, anchor: string, date: string): boolean {
  const a = parts(anchor); const t = parts(date);
  if (rule.unit === 'day') return (day(date) - day(anchor)) % rule.every === 0;
  if (rule.unit === 'week') return (mondayIndex(date) - mondayIndex(anchor)) % rule.every === 0 && (rule.days.length ? rule.days : [a.wd]).includes(t.wd);
  const months = (t.y - a.y) * 12 + (t.m - a.m);
  if (rule.unit === 'month') { const want = rule.monthDay === 'last' ? lastOf(t.y, t.m) : Math.min(rule.monthDay ?? a.d, lastOf(t.y, t.m)); return months % rule.every === 0 && t.d === want; }
  return (t.y - a.y) % rule.every === 0 && t.m === a.m && t.d === Math.min(a.d, lastOf(t.y, t.m));
}
const randomRule = (next: () => number): Rule => {
  const unit = (['day', 'week', 'month', 'year'] as Unit[])[Math.floor(next() * 4)]; const every = 1 + Math.floor(next() * 5);
  const days = unit === 'week' && next() < 0.7 ? [...new Set(Array.from({ length: 1 + Math.floor(next() * 4) }, () => Math.floor(next() * 7)))].sort((a, b) => a - b) : [];
  const monthDay = unit === 'month' && next() < 0.7 ? (next() < 0.2 ? 'last' as const : 1 + Math.floor(next() * 31)) : null;
  return { every, unit, days, monthDay };
};

describe('repeat rules against an independent reference', () => {
  it('agrees on every day of five years for hundreds of random rules and anchors', () => {
    const next = seeded(7); const start = day('2024-01-01');
    for (let n = 0; n < 300; n++) {
      const rule = randomRule(next); const anchor = iso((start + Math.floor(next() * 800)) * 86400000);
      for (let d = 0; d < 1830; d += 1) { const date = iso((start - 200 + d) * 86400000); if (occursOn(rule, anchor, date) !== reference(rule, anchor, date)) throw new Error(`${formatRule(rule)} from ${anchor} on ${date}`); }
    }
  });
  it('reads back what it writes, for every rule it can produce', () => {
    const next = seeded(11);
    for (let n = 0; n < 500; n++) { const rule = randomRule(next); const text = formatRule(rule); const back = parseRule(text); expect(back, text).not.toBeNull(); expect(formatRule(back!), text).toBe(text); expect(ruleLabel(back!)).toBe(ruleLabel(rule)); }
  });
  it('fires on exactly the expected number of days in a year', () => {
    const count = (rule: Rule, anchor: string, year: number) => { let c = 0; for (let d = day(`${year}-01-01`); d < day(`${year + 1}-01-01`); d++) if (occursOn(rule, anchor, iso(d * 86400000))) c++; return c; };
    expect(count(DAILY, '2026-03-02', 2026)).toBe(365); expect(count(DAILY, '2026-03-02', 2028)).toBe(366);
    expect(count(parseRule('weekdays')!, '2026-03-02', 2026)).toBe(261); expect(count(parseRule('weekly')!, '2026-03-02', 2026)).toBe(52);
    expect(count(parseRule('monthly')!, '2026-01-31', 2026)).toBe(12); expect(count(parseRule('every month on last')!, '2026-01-10', 2026)).toBe(12); expect(count(parseRule('yearly')!, '2028-02-29', 2026)).toBe(1); expect(count(parseRule('yearly')!, '2028-02-29', 2028)).toBe(1);
    expect(count(parseRule('every 2 weeks on mon,fri')!, '2026-01-05', 2026)).toBe(52);
  });
  it('never fires twice in a row for an interval above one, and never before it is due', () => {
    const rule = parseRule('every 3 days')!; let last = ''; for (let d = day('2026-03-01'); d < day('2026-06-01'); d++) { const date = iso(d * 86400000); if (occursOn(rule, '2026-03-01', date)) { if (last) expect(day(date) - day(last)).toBe(3); last = date; } }
  });
});

describe('typed and hand-edited rules', () => {
  it('rejects half-finished and odd text without throwing', () => {
    for (const text of ['every', 'every week on', 'every 2', 'every  ', 'on mon', 'every week on mon,', ',', 'every week on ,', 'every -1 days', 'every 1.5 weeks', 'every 2 weeks on mon tue wed thu fri sat sun mon', 'EVERY WEEK ON MON', 'every month on 1st,2nd', '2', 'every week on 1', 'every years', 'weekly on mon', 'every other day', '\n', '\u0000']) expect(() => parseRule(text), text).not.toThrow();
    for (const text of ['every', 'every week on', 'every 2', 'on mon', 'every -1 days', 'every 1.5 weeks', 'every other day', 'weekly on mon', '2']) expect(parseRule(text), text).toBeNull();
  });
  it('is case, space and plural tolerant', () => {
    expect(formatRule(parseRule('  EVERY   2   WEEKS   ON   MON ,  THU ')!)).toBe('every 2 weeks on mon,thu'); expect(formatRule(parseRule('Every Monday')!)).toBe('every week on mon'); expect(formatRule(parseRule('every 1 days')!)).toBe('daily');
  });
  it('keeps a task without a period or rule from vanishing', () => {
    const task: any = { recurring: true, recurrence: '???', recurrence_periods: [], created: 'garbage' };
    expect(() => repeatsOn(task, '2026-03-02')).not.toThrow();
  });
  it('treats days before 1970 and far-future dates consistently', () => {
    const rule = parseRule('every week on mon')!; for (const date of ['1969-12-29', '1900-01-01', '1900-01-02', '1899-12-31', '2999-12-31']) { expect(occursOn(rule, '1970-01-01', date)).toBe(reference(rule, '1970-01-01', date)); const tue = parseRule('every week on tue')!; expect(occursOn(tue, '1900-01-02', date)).toBe(reference(tue, '1900-01-02', date)); }
  });
});

describe('explicit rules', () => {
  it('spells out the weekday or day of the month a rule leaves to its start date', () => {
    expect(formatRule(explicitRule(parseRule('every 2 weeks')!, '2026-03-04'))).toBe('every 2 weeks on wed'); expect(formatRule(explicitRule(parseRule('every month')!, '2026-03-31'))).toBe('every month on 31');
    expect(formatRule(explicitRule(parseRule('every 2 weeks on mon')!, '2026-03-04'))).toBe('every 2 weeks on mon'); expect(formatRule(explicitRule(parseRule('every month on last')!, '2026-03-04'))).toBe('every month on last'); expect(formatRule(explicitRule(parseRule('every year')!, '2026-03-04'))).toBe('every year');
    for (const text of ['every 2 weeks', 'every 3 months', 'every 4 days', 'every 2 years']) for (let d = 1; d <= 60; d++) { const date = iso((day('2026-03-04') + d) * 86400000); expect(occursOn(explicitRule(parseRule(text)!, '2026-03-04'), '2026-03-04', date), `${text} ${date}`).toBe(occursOn(parseRule(text)!, '2026-03-04', date)); }
  });
  it('finds the start of the open period, else the creation day', () => {
    expect(anchorOf({ recurring: true, recurrence: null, recurrence_periods: [{ start: '2026-01-01', stop: '2026-02-01' }, { start: '2026-03-01', stop: null }], created: '2025-05-05T00:00:00Z' })).toBe('2026-03-01'); expect(anchorOf({ recurring: true, recurrence: null, recurrence_periods: [], created: '2025-05-05T00:00:00Z' })).toBe('2025-05-05');
  });
});
