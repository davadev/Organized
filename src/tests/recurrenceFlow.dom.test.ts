// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { localDate, nextDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY, occursOn, parseRule, repeatsOn } from '../recurrence';

installObsidianDom();
const rule = (text: string) => parseRule(text)!;
const later = (n: number) => { let d = localDate(); for (let i = 0; i < n; i++) d = nextDate(d); return d; };
const path = (n: number) => `Daily/${later(n)}.md`;
const copies = (text: string | undefined, id: string) => parseTasks(text ?? '').filter(t => t.id === id);
const noteOf = (h: ReturnType<typeof harness>, id: string) => h.texts.get(h.repo.taskFile(id)!.path)!;

describe('repeat rules: edge cases in the notes', () => {
  afterEach(() => { vi.restoreAllMocks(); Notice.instances.length = 0; });
  it('daily notes made one by one over two months get the task exactly on the matching days', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.add(path(0));
    await h.service.recurrence(task.id, rule('every 3 weeks on thu,sun'));
    const saved = await h.repo.read(task.id);
    for (let n = 1; n <= 70; n++) { const file: any = await h.add(path(n)); await h.service.onDailyCreated(file); }
    for (let n = 0; n <= 70; n++) { const got = copies(h.texts.get(path(n)), task.id).length; const want = repeatsOn(saved, later(n)) ? 1 : 0; expect(got, later(n)).toBe(want); expect(occursOn(rule('every 3 weeks on thu,sun'), localDate(), later(n))).toBe(want === 1); }
    const total = Array.from({ length: 71 }, (_, n) => copies(h.texts.get(path(n)), task.id).length).reduce((a, b) => a + b, 0); expect(total).toBeGreaterThanOrEqual(6); expect(total).toBeLessThanOrEqual(10);
  });
  it('keeps the rule readable in the task note and removes it, not the task, when stopped', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.add(path(0));
    await h.service.recurrence(task.id, rule('every 2 months on last')); let text = noteOf(h, task.id);
    expect(text).toMatch(/^recurrence: every 2 months on last$/m); expect(text).toMatch(/^recurring: true$/m);
    await h.service.recurrence(task.id, null); text = noteOf(h, task.id); expect(text).not.toMatch(/^recurrence:/m); expect(text).toMatch(/^recurring: false$/m); expect(text).toContain('recurrence_periods');
  });
  it('setting the same rule twice changes nothing and starts no new period', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); for (let n = 0; n <= 3; n++) await h.add(path(n));
    await h.service.recurrence(task.id, rule('every 2 days')); const before = [0, 1, 2, 3].map(n => h.texts.get(path(n))); const periods = (await h.repo.read(task.id)).recurrence_periods;
    await h.service.recurrence(task.id, rule('every 2 days')); expect([0, 1, 2, 3].map(n => h.texts.get(path(n)))).toEqual(before); expect((await h.repo.read(task.id)).recurrence_periods).toEqual(periods);
  });
  it('undo puts back the earlier rule and the copies it removed', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); for (let n = 0; n <= 4; n++) await h.add(path(n));
    await h.service.recurrence(task.id, DAILY); await h.service.recurrence(task.id, rule('every 2 days'));
    expect([0, 1, 2, 3, 4].map(n => copies(h.texts.get(path(n)), task.id).length)).toEqual([1, 0, 1, 0, 1]);
    await h.service.undo(); expect((await h.repo.read(task.id)).recurrence).toBe('daily'); expect([0, 1, 2, 3, 4].map(n => copies(h.texts.get(path(n)), task.id).length)).toEqual([1, 1, 1, 1, 1]);
  });
  it('the line the rule was set from stays the only copy in today\'s note, matching today or not', async () => {
    for (const text of ['daily', 'every week on mon,tue,wed,thu,fri,sat,sun', 'every 2 days']) {
      const h = harness(); const task = await h.repo.create('Gym'); const file: any = await h.add(path(0), `- [r] Gym <!--organized:${task.id}-->`);
      await h.service.recurrence(task.id, rule(text), { file, line: parseTasks(h.texts.get(path(0))!)[0] });
      const lines = copies(h.texts.get(path(0)), task.id); expect(lines, text).toHaveLength(1); expect(lines[0].marker).toBe(' ');
    }
    const h = harness(); const task = await h.repo.create('Gym'); const file: any = await h.add(path(0), `- [r] Gym <!--organized:${task.id}-->`); const today = parseRule('every 2 days')!;
    await h.service.recurrence(task.id, { ...today, every: 2, unit: 'year' }, { file, line: parseTasks(h.texts.get(path(0))!)[0] }); expect(copies(h.texts.get(path(0)), task.id)).toHaveLength(1);
  });
  it('a ticked or forwarded copy survives any later rule change, and today\'s copy is never removed', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); for (let n = 0; n <= 3; n++) await h.add(path(n));
    await h.service.recurrence(task.id, DAILY);
    h.texts.set(path(1), h.texts.get(path(1))!.replace('[ ]', '[x]')); h.texts.set(path(2), h.texts.get(path(2))!.replace('[ ]', '[>]')); h.texts.set(path(0), h.texts.get(path(0))!.replace('[ ]', '[x]'));
    await h.service.recurrence(task.id, rule('every year')); await h.service.recurrence(task.id, null);
    expect(parseTasks(h.texts.get(path(0))!).map(t => t.marker)).toEqual(['x']); expect(parseTasks(h.texts.get(path(1))!).map(t => t.marker)).toEqual(['x']); expect(parseTasks(h.texts.get(path(2))!).map(t => t.marker)).toEqual(['>']); expect(copies(h.texts.get(path(3)), task.id)).toHaveLength(0);
  });
  it('a hand-edited rule is honoured for new notes, and a broken one falls back to daily', async () => {
    const h = harness(); const odd = await h.repo.create('Odd case'); const broken = await h.repo.create('Broken'); const off = await h.repo.create('Switched off');
    await h.repo.update(odd.id, t => ({ ...t, recurring: true, recurrence: 'EVERY  2  Days', recurrence_periods: [{ start: localDate(), stop: null }] }));
    await h.repo.update(broken.id, t => ({ ...t, recurring: true, recurrence: 'every blue moon' })); await h.repo.update(off.id, t => ({ ...t, recurring: false, recurrence: 'daily' }));
    for (let n = 1; n <= 4; n++) { const file: any = await h.add(path(n)); await h.service.onDailyCreated(file); }
    expect([1, 2, 3, 4].map(n => copies(h.texts.get(path(n)), odd.id).length)).toEqual([0, 1, 0, 1]); expect([1, 2, 3, 4].map(n => copies(h.texts.get(path(n)), broken.id).length)).toEqual([1, 1, 1, 1]); expect([1, 2, 3, 4].map(n => copies(h.texts.get(path(n)), off.id).length)).toEqual([0, 0, 0, 0]);
  });
  it('creating the same daily note twice does not duplicate the task', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, DAILY); const file: any = await h.add(path(1)); await h.service.onDailyCreated(file); await h.service.onDailyCreated(file); expect(copies(h.texts.get(path(1)), task.id)).toHaveLength(1);
  });
  it('keeps two tasks with different rules apart in one note', async () => {
    const h = harness(); const a = await h.repo.create('A'); const b = await h.repo.create('B'); for (let n = 0; n <= 3; n++) await h.add(path(n));
    await h.service.recurrence(a.id, rule('every 2 days')); await h.service.recurrence(b.id, rule('every 3 days')); await h.service.recurrence(a.id, null);
    expect([0, 1, 2, 3].map(n => copies(h.texts.get(path(n)), a.id).length)).toEqual([1, 0, 0, 0]); expect([0, 1, 2, 3].map(n => copies(h.texts.get(path(n)), b.id).length)).toEqual([1, 0, 0, 1]);
  });
  it('a project note keeps one line under Ongoing through rule changes and stopping', async () => {
    const h = harness(); const task = await h.repo.create('Water plants'); const note: any = await h.add(`${h.repo.projectFolder()}/Home.md`, '---\norganized_type: project\n---\n');
    await h.service.projects(task.id, [note.path]); const under = () => h.texts.get(note.path)!.split('\n').filter(l => l.includes(task.id)).length;
    await h.service.recurrence(task.id, rule('weekdays')); await h.service.recurrence(task.id, rule('every 2 weeks on mon')); expect(under()).toBe(1); expect(h.texts.get(note.path)).toMatch(/Ongoing[\s\S]*Water plants/);
    await h.service.recurrence(task.id, null); expect(under()).toBe(1); expect(h.texts.get(note.path)).not.toMatch(/Ongoing\n- \[ \] Water plants/);
  });
  it('reports a daily note it could not change and still applies the rest', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); for (let n = 0; n <= 3; n++) await h.add(path(n));
    const file = h.files.get(path(2)) as any; const read = h.repo.readText.bind(h.repo); vi.spyOn(h.repo, 'readText').mockImplementation(async f => { if (f === file) throw new Error('gone'); return read(f); });
    await h.service.recurrence(task.id, DAILY); expect((Notice.instances.at(-1)?.message as DocumentFragment).textContent).toContain(path(2)); expect(copies(h.texts.get(path(3)), task.id)).toHaveLength(1); expect((await h.repo.read(task.id)).recurring).toBe(true);
  });
  it('setting a rule from the panel does not duplicate the todo already in today\'s note, or one forwarded there', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.add(path(0), `- [ ] Gym <!--organized:${task.id}-->`); await h.add(path(1), `- [ ] Gym <!--organized:${task.id}-->`);
    await h.service.recurrence(task.id, DAILY); expect(copies(h.texts.get(path(0)), task.id)).toHaveLength(1); expect(copies(h.texts.get(path(1)), task.id)).toHaveLength(1);
    await h.service.recurrence(task.id, rule('every 2 days')); await h.service.recurrence(task.id, DAILY); expect(copies(h.texts.get(path(1)), task.id)).toHaveLength(1);
  });
});
