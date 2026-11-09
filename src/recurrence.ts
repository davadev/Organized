/** Repeat rules for recurring tasks: a tiny grammar kept in the task note as one readable line (`weekdays`, `every 3 weeks on thu`), plus the question "does it fall on this date?". Dates are `YYYY-MM-DD` strings; no time zones are involved. */
export type Unit = "day" | "week" | "month" | "year";
export interface Rule {
  every: number; unit: Unit;
  /** Weekly: the weekdays, Monday = 0. Empty means the weekday of the anchor date. */
  days: number[];
  /** Monthly: a day of the month, or "last". Null means the day of the anchor date. */
  monthDay: number | "last" | null;
}
export const DAILY: Rule = { every: 1, unit: "day", days: [], monthDay: null };
const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const FULL_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAYS = [0, 1, 2, 3, 4];
const PRESETS: Record<string, Rule> = {
  daily: DAILY, weekdays: { every: 1, unit: "week", days: WEEKDAYS, monthDay: null },
  weekly: { every: 1, unit: "week", days: [], monthDay: null }, monthly: { every: 1, unit: "month", days: [], monthDay: null }, yearly: { every: 1, unit: "year", days: [], monthDay: null },
};
const ALIASES: Record<string, string> = { day: "daily", weekday: "weekdays", week: "weekly", month: "monthly", year: "yearly", annually: "yearly" };
const MAX_EVERY = 999;

const dayNumber = (date: string): number => { const [y, m, d] = date.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
/** Monday = 0. 1970-01-01 was a Thursday. */
const weekday = (date: string): number => (dayNumber(date) + 3) % 7;
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const parts = (date: string): [number, number, number] => { const [y, m, d] = date.split("-").map(Number); return [y, m, d]; };

function dayList(text: string): number[] | null {
  const found: number[] = [];
  for (const token of text.split(/[\s,&]+|\band\b/).filter(Boolean)) {
    const index = FULL_NAMES.findIndex((name, i) => token.length >= 3 && name.startsWith(token) && DAY_NAMES[i] === token.slice(0, 3));
    if (index < 0) return null; found.push(index);
  }
  return found.length ? [...new Set(found)].sort((a, b) => a - b) : null;
}
/** Reads a rule from what a person types or a note holds; null when it is not one. */
export function parseRule(input: string): Rule | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  const preset = PRESETS[ALIASES[text] ?? text]; if (preset) return { ...preset, days: [...preset.days] };
  const match = /^(?:every )?(?:(\d{1,3}) ?)?(day|week|month|year)s?(?: (?:on )?(.+))?$/.exec(text);
  if (!match) { const days = dayList(text.replace(/^every /, "")); return days ? { every: 1, unit: "week", days, monthDay: null } : null; }
  const every = match[1] === undefined ? 1 : Number(match[1]); const unit = match[2] as Unit; const on = match[3];
  if (every < 1 || every > MAX_EVERY) return null;
  if (on === undefined) return { every, unit, days: [], monthDay: null };
  if (unit === "week") { const days = dayList(on); return days ? { every, unit, days, monthDay: null } : null; }
  if (unit === "month") {
    if (on === "last") return { every, unit, days: [], monthDay: "last" };
    const day = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(on); const n = day ? Number(day[1]) : 0;
    return n >= 1 && n <= 31 ? { every, unit, days: [], monthDay: n } : null;
  }
  return null;
}
/** The one-line form kept in the task note; `parseRule` reads it back. */
export function formatRule(rule: Rule): string {
  if (rule.unit === "day" && rule.every === 1) return "daily";
  if (rule.unit === "week" && rule.every === 1 && rule.days.join() === WEEKDAYS.join()) return "weekdays";
  const on = rule.days.length ? ` on ${rule.days.map(d => DAY_NAMES[d]).join(",")}` : rule.monthDay !== null ? ` on ${rule.monthDay}` : "";
  return `every ${rule.every === 1 ? "" : `${rule.every} `}${rule.unit}${rule.every === 1 ? "" : "s"}${on}`;
}
const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
/** How a rule reads in the panel and the picker: "Every 3 weeks on Thu". */
export function ruleLabel(rule: Rule): string {
  if (rule.unit === "day" && rule.every === 1) return "Every day";
  if (rule.unit === "week" && rule.every === 1 && rule.days.join() === WEEKDAYS.join()) return "Every weekday";
  const on = rule.days.length ? ` on ${rule.days.map(d => DAY_NAMES[d][0].toUpperCase() + DAY_NAMES[d].slice(1)).join(", ")}` : rule.monthDay === "last" ? " on the last day" : rule.monthDay !== null ? ` on the ${ordinal(rule.monthDay)}` : "";
  return `Every ${rule.every === 1 ? "" : `${rule.every} `}${rule.unit}${rule.every === 1 ? "" : "s"}${on}`;
}
/** The ready-made choices, anchored on today: every day, weekday, week, month and year. */
export function presetRules(today: string): Rule[] {
  const [, , day] = parts(today);
  const rules: Rule[] = [DAILY, PRESETS.weekdays, { every: 1, unit: "week", days: [weekday(today)], monthDay: null }, { every: 1, unit: "month", days: [], monthDay: day }, PRESETS.yearly];
  return rules.map(rule => ({ ...rule, days: [...rule.days] }));
}
/** Whether `date` is one of the days the rule produces, counting from `anchor` (the day the repeat started). */
export function occursOn(rule: Rule, anchor: string, date: string): boolean {
  const gap = dayNumber(date) - dayNumber(anchor); const mod = (n: number) => ((n % rule.every) + rule.every) % rule.every;
  if (rule.unit === "day") return mod(gap) === 0;
  if (rule.unit === "week") {
    const weeks = Math.floor((gap + weekday(anchor)) / 7);
    return mod(weeks) === 0 && (rule.days.length ? rule.days : [weekday(anchor)]).includes(weekday(date));
  }
  const [ay, am, ad] = parts(anchor); const [y, m, d] = parts(date); const months = (y - ay) * 12 + (m - am);
  if (rule.unit === "month") {
    const wanted = rule.monthDay === "last" ? daysIn(y, m) : Math.min(rule.monthDay ?? ad, daysIn(y, m));
    return mod(months) === 0 && d === wanted;
  }
  return mod(y - ay) === 0 && m === am && d === Math.min(ad, daysIn(y, m));
}
/** Whether a recurring task belongs on `date`. A task without a rule (the old on/off switch) repeats daily; a rule nobody can read does too, so a hand-edit never makes a task vanish. */
export function repeatsOn(task: { recurring: boolean; recurrence: string | null; recurrence_periods: { start: string; stop: string | null }[]; created: string }, date: string): boolean {
  if (!task.recurring) return false;
  const open = [...task.recurrence_periods].reverse().find(p => p.stop === null);
  return occursOn(taskRule(task), open?.start ?? task.created.slice(0, 10), date);
}
export const taskRule = (task: { recurrence: string | null }): Rule => (task.recurrence ? parseRule(task.recurrence) : null) ?? DAILY;
/** Same cadence means the same interval and unit, so a change of weekday or day of month keeps the phase of "every 2 weeks". */
export const sameCadence = (a: Rule, b: Rule): boolean => a.every === b.every && a.unit === b.unit;
