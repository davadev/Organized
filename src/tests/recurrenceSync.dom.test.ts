// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { localDate, nextDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY, parseRule } from '../recurrence';

installObsidianDom();
const rule = (text: string) => parseRule(text)!;
const later = (n: number) => { let d = localDate(); for (let i = 0; i < n; i++) d = nextDate(d); return d; };
const path = (n: number) => `Daily/${later(n)}.md`;
const copies = (text: string | undefined, id: string) => parseTasks(text ?? '').filter(t => t.id === id);

describe('repeat rules with sync, races and odd notes', () => {
  afterEach(() => { vi.restoreAllMocks(); Notice.instances.length = 0; });
  it('a note that arrives from another device already holding the task is left alone, and one without it gets it', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, DAILY);
    const synced: any = await h.add(path(1), `# Work\n- [x] Gym <!--organized:${task.id}--> <!--organized:repeat-->\n- [ ] Other`); const before = h.texts.get(path(1));
    await h.service.onDailyCreated(synced); await h.service.onDailyCreated(synced); expect(h.texts.get(path(1))).toBe(before);
    const bare: any = await h.add(path(2), '# Work\n- [ ] Other'); await h.service.onDailyCreated(bare); expect(copies(h.texts.get(path(2)), task.id)).toHaveLength(1); expect(h.texts.get(path(2))).toContain('- [ ] Other');
  });
  it('two devices adding the same copy and syncing both ways never leaves a second line', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, DAILY); const file: any = await h.add(path(1));
    await Promise.all([h.service.onDailyCreated(file), h.service.onDailyCreated(file), h.service.recurrence(task.id, DAILY)]); expect(copies(h.texts.get(path(1)), task.id)).toHaveLength(1);
  });
  it('overlapping rule changes end in the last rule with no stray copies', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); for (let n = 0; n <= 6; n++) await h.add(path(n));
    for (const text of ['daily', 'every 2 days', 'every 3 days', 'every 2 days']) await h.repo.serial(() => h.service.recurrence(task.id, rule(text)));
    expect([0, 1, 2, 3, 4, 5, 6].map(n => copies(h.texts.get(path(n)), task.id).length)).toEqual([1, 0, 1, 0, 1, 0, 1]);
  });
  it('one task failing to write does not keep the others out of a new daily note, and is tried again', async () => {
    const h = harness(); const first = await h.repo.create('First'); const second = await h.repo.create('Second'); const third = await h.repo.create('Third');
    for (const t of [first, second, third]) await h.repo.update(t.id, x => ({ ...x, recurring: true, recurrence_periods: [{ start: localDate(), stop: null }] }));
    const file: any = await h.add(path(1)); const write = h.repo.write.bind(h.repo); let blocked = 1;
    vi.spyOn(h.repo, 'write').mockImplementation(async (f, before, after) => { if (after.includes(second.id) && blocked-- > 0) throw new Error(`${f.path} changed concurrently; preserved. Retry the action.`); return write(f, before, after); });
    await h.service.onDailyCreated(file); expect([first, second, third].map(t => copies(h.texts.get(path(1)), t.id).length)).toEqual([1, 1, 1]);
  });
  it('a task that keeps failing is named in one error while the rest are added', async () => {
    const h = harness(); const ok = await h.repo.create('Fine'); const bad = await h.repo.create('Stuck'); const worse = await h.repo.create('Stuck too');
    for (const t of [ok, bad, worse]) await h.repo.update(t.id, x => ({ ...x, recurring: true, recurrence_periods: [{ start: localDate(), stop: null }] }));
    const file: any = await h.add(path(1)); const write = h.repo.write.bind(h.repo);
    vi.spyOn(h.repo, 'write').mockImplementation(async (f, before, after) => { if (after.includes(bad.id) || after.includes(worse.id)) throw new Error('locked by sync'); return write(f, before, after); });
    await expect(h.service.onDailyCreated(file)).rejects.toThrow(/2 recurring tasks \(Stuck, Stuck too\) could not be added to Daily\/.*locked by sync/);
    expect(copies(h.texts.get(path(1)), ok.id)).toHaveLength(1); await expect(h.service.onDailyCreated(await h.add(path(2)) as any)).rejects.toThrow(/2 recurring tasks/);
    vi.spyOn(h.repo, 'write').mockImplementation(async (f, before, after) => { if (after.includes(bad.id)) throw new Error('locked'); return write(f, before, after); });
    await expect(h.service.onDailyCreated(await h.add(path(3)) as any)).rejects.toThrow(/1 recurring task \(Stuck\)/);
    vi.spyOn(h.repo, 'write').mockImplementation(async (f, before, after) => { if (after.includes(bad.id)) throw 'plain text failure'; return write(f, before, after); });
    await expect(h.service.onDailyCreated(await h.add(path(5)) as any)).rejects.toThrow(/plain text failure/);
  });
  it('adds the task to notes with Windows line endings, no final newline, or only front matter', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, DAILY);
    const cases: Record<string, string> = { crlf: '# Work\r\n- [ ] Other\r\n', bare: '- [ ] Other', fm: '---\ntags: daily\n---\n', empty: '', headingOnly: '# Work' };
    let n = 1; for (const [name, text] of Object.entries(cases)) { const file: any = await h.add(path(n), text); await h.service.onDailyCreated(file); const out = h.texts.get(path(n))!; expect(copies(out, task.id), name).toHaveLength(1); expect(out, name).toContain(text.trim() ? text.trim().split(/\r?\n/)[0] : ''); n++; }
    expect(h.texts.get(path(3))).toMatch(/^---\ntags: daily\n---\n/); expect(h.texts.get(path(1))).toContain('\r\n- [ ] Other');
  });
  it('fills a new note with many recurring tasks, each once', async () => {
    const h = harness(); const tasks = []; for (let i = 0; i < 60; i++) { const t = await h.repo.create(`Habit ${i}`); await h.repo.update(t.id, x => ({ ...x, recurring: true, recurrence: i % 2 ? 'every 2 days' : null, recurrence_periods: [{ start: localDate(), stop: null }] })); tasks.push(t); }
    const one: any = await h.add(path(1)); const two: any = await h.add(path(2)); await h.service.onDailyCreated(one); await h.service.onDailyCreated(two);
    expect(tasks.map((t, i) => copies(h.texts.get(path(1)), t.id).length === (i % 2 ? 0 : 1))).toEqual(tasks.map(() => true)); expect(tasks.map(t => copies(h.texts.get(path(2)), t.id).length)).toEqual(tasks.map(() => 1));
  });
  it('a copied task note with the same id (a sync conflict copy) is skipped rather than guessed at', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, DAILY); const note = h.repo.taskFile(task.id)!;
    await h.add('Tasks/Gym 2.md', h.texts.get(note.path)!); const file: any = await h.add(path(1)); await h.service.onDailyCreated(file); expect(copies(h.texts.get(path(1)), task.id)).toHaveLength(0);
    h.texts.delete('Tasks/Gym 2.md'); h.files.delete('Tasks/Gym 2.md'); const later1: any = await h.add(path(2)); await h.service.onDailyCreated(later1); expect(copies(h.texts.get(path(2)), task.id)).toHaveLength(1);
  });
  it('a rule edited in the task note by hand or by sync applies from the next note, even at the same file size', async () => {
    const h = harness(); const task = await h.repo.create('Gym'); await h.service.recurrence(task.id, rule('every 2 days')); const note = h.repo.taskFile(task.id)!;
    const one: any = await h.add(path(2)); await h.service.onDailyCreated(one); expect(copies(h.texts.get(path(2)), task.id)).toHaveLength(1);
    h.texts.set(note.path, h.texts.get(note.path)!.replace('every 2 days', 'every 3 days')); note.stat.mtime += 1;
    const two: any = await h.add(path(4)); await h.service.onDailyCreated(two); expect(copies(h.texts.get(path(4)), task.id)).toHaveLength(0);
  });
  it('a task note deleted or made invalid stops repeating without breaking other tasks', async () => {
    const h = harness(); const gone = await h.repo.create('Gone'); const broken = await h.repo.create('Broken'); const fine = await h.repo.create('Fine');
    for (const t of [gone, broken, fine]) await h.service.recurrence(t.id, DAILY);
    const goneNote = h.repo.taskFile(gone.id)!; h.texts.delete(goneNote.path); h.files.delete(goneNote.path); const brokenNote = h.repo.taskFile(broken.id)!; h.texts.set(brokenNote.path, '---\nid: nonsense\n---\n');
    const file: any = await h.add(path(1)); await h.service.onDailyCreated(file); expect(copies(h.texts.get(path(1)), fine.id)).toHaveLength(1); expect(copies(h.texts.get(path(1)), gone.id)).toHaveLength(0); expect(copies(h.texts.get(path(1)), broken.id)).toHaveLength(0);
  });
});
