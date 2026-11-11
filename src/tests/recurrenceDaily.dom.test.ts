// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { localDate, nextDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY, parseRule } from '../recurrence';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
const rule = (text: string) => parseRule(text)!;
const later = (n: number) => { let d = localDate(); for (let i = 0; i < n; i++) d = nextDate(d); return d; };
const earlier = (n: number) => { const d = new Date(`${localDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const copies = (text: string | undefined, id: string) => parseTasks(text ?? '').filter(t => t.id === id);
async function loaded() {
  vi.useFakeTimers(); const h = harness(); (h.app.workspace as any).layoutReady = false;
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload(); h.layout[0](); vi.useRealTimers(); await flush();
  return { h, plugin };
}
/** What another plugin (Templater, Periodic Notes, Calendar, QuickAdd…) does: create the file, with or without content, then maybe change it. */
const createdBy = async (h: ReturnType<typeof harness>, path: string, text = '') => { const file: any = await h.add(path, text); vi.useFakeTimers({ toFake: ['setTimeout'] }); h.events.create.forEach(fn => fn(file)); await vi.advanceTimersByTimeAsync(2500); vi.useRealTimers(); await flush(); return file; };

describe('daily notes made by other plugins', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); Notice.instances.length = 0; });
  it('gets the task through the real create event for a note made elsewhere', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY);
    await createdBy(h, `Daily/${later(3)}.md`, '# Plan\n'); expect(copies(h.texts.get(`Daily/${later(3)}.md`), task.id)).toHaveLength(1);
  });
  it('ignores renames, edits and deletes, so a note renamed into a date or rewritten by a template is not touched', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY);
    const file: any = await h.add('Untitled.md', 'draft'); const target = `Daily/${later(4)}.md`; h.texts.set(target, 'draft'); h.texts.delete('Untitled.md'); file.path = target; h.events.rename.forEach(fn => fn(file, 'Untitled.md')); await flush(); expect(h.texts.get(target)).toBe('draft');
    h.texts.set(target, 'rewritten by a template'); h.events.modify.forEach(fn => fn(file)); await flush(); expect(h.texts.get(target)).toBe('rewritten by a template'); h.events.delete.forEach(fn => fn(file)); await flush();
  });
  it('a template that overwrites the note right after creation removes the copy, and nothing adds it back on its own', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY); const path = `Daily/${later(2)}.md`;
    const file = await createdBy(h, path); expect(copies(h.texts.get(path), task.id)).toHaveLength(1);
    h.texts.set(path, '# Template\n- [ ] Plan the day'); h.events.modify.forEach(fn => fn(file)); h.events['file-open'].forEach(fn => fn(file)); await flush(); expect(copies(h.texts.get(path), task.id)).toHaveLength(0);
    // Setting the rule again is the way back: it fills every matching note that lacks the task.
    await plugin.service.recurrence(task.id, DAILY); expect(copies(h.texts.get(path), task.id)).toHaveLength(1); expect(h.texts.get(path)).toContain('Plan the day');
  });
  it('does not add anything for notes that only look like daily notes', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY); const d = '2031-03-05';
    const names = [`Daily/Meeting ${d}.md`, `Archive/${d}.md`, `${d}.md`, `Daily/${d}.txt`, `Daily/${d}x.md`, `Daily/${d.replace(/-0/g, '-')}.md`, `Daily/${d.slice(0, 4)}-W10.md`, `Daily/${d}/index.md`, `daily/${d}.md`];
    for (const name of names) { const file = await createdBy(h, name, 'x'); expect(h.texts.get(file.path), name).toBe('x'); }
  });
  it('skips a note for a day that has passed, as when a plugin back-fills a journal, but fills today and later', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY);
    for (const [name, want] of [[earlier(1), 0], [earlier(400), 0], [localDate(), 1], [later(1), 1], [later(400), 1]] as [string, number][]) { await createdBy(h, `Daily/${name}.md`); expect(copies(h.texts.get(`Daily/${name}.md`), task.id), name).toHaveLength(want); }
  });
  it('works with other daily-note settings', async () => {
    for (const [folder, format] of [['', 'YYYY-MM-DD'], ['Journal/Daily', 'YYYY/MM/YYYY-MM-DD'], ['Daily', 'DD.MM.YYYY'], ['Daily', 'YYYY-MM-DD [daily]'], ['Daily', 'YYYYMMDD']]) {
      const { h, plugin } = await loaded(); h.setSettings({ dailyFolder: folder, dailyFormat: format }); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY);
      const path = plugin.service.daily.path(later(2)); await createdBy(h, path, '# Day'); expect(copies(h.texts.get(path), task.id), `${folder}|${format}`).toHaveLength(1);
      const wrong = `Daily/${later(3)}.md`; if (wrong !== plugin.service.daily.path(later(3))) { await createdBy(h, wrong, 'x'); expect(h.texts.get(wrong), `${folder}|${format}`).toBe('x'); }
    }
  });
  it('a note made at the same moment the plugin creates it for a scheduled task is created once and holds each task once', async () => {
    const { h, plugin } = await loaded(); const gym = await plugin.repo.create('Gym'); await plugin.service.recurrence(gym.id, DAILY); const other = await plugin.repo.create('Other'); const date = later(5); const path = plugin.service.daily.path(date);
    const real = h.raw.vault.create.getMockImplementation()!; let first = true; h.raw.vault.create.mockImplementation(async (p: string, text: string) => { if (p === path && first) { first = false; await real(p, '# From another plugin\n'); throw new Error('Exists'); } return real(p, text); });
    // A later day's note is not made when scheduling; the note another plugin makes for it gets the scheduled task along with the recurring one.
    await plugin.service.scheduleTask(other.id, date); expect(h.files.get(path)).toBeUndefined(); await plugin.service.daily.ensure(date);
    vi.useFakeTimers({ toFake: ['setTimeout'] }); h.events.create.forEach(fn => fn(h.files.get(path))); await vi.advanceTimersByTimeAsync(2500); vi.useRealTimers(); await flush();
    expect(h.texts.get(path)).toContain('# From another plugin'); expect(copies(h.texts.get(path), other.id)).toHaveLength(1); expect(copies(h.texts.get(path), gym.id)).toHaveLength(1);
  });
});

describe('templates that already hold content', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('puts the task under the heading it came from, and makes a missing heading once for several tasks', async () => {
    const { h, plugin } = await loaded(); const section = [{ level: 2, text: 'Habits', ordinal: 0 }]; const tasks = [];
    for (const title of ['Gym', 'Read', 'Stretch']) { const t = await plugin.repo.create(title); await plugin.service.recurrence(t.id, DAILY); await plugin.repo.update(t.id, x => ({ ...x, daily_note_section_path: section })); tasks.push(t); }
    const withHeading = `Daily/${later(2)}.md`; await createdBy(h, withHeading, '# Day\n\n## Habits\n\n## Notes\nText\n'); const without = `Daily/${later(3)}.md`; await createdBy(h, without, '# Day\n');
    for (const path of [withHeading, without]) { const text = h.texts.get(path)!; expect(text.match(/^## Habits$/gm), path).toHaveLength(1); expect(tasks.every(t => copies(text, t.id).length === 1), path).toBe(true); }
    const text = h.texts.get(withHeading)!; expect(text.indexOf('Gym')).toBeGreaterThan(text.indexOf('## Habits')); expect(text.indexOf('Stretch')).toBeLessThan(text.indexOf('## Notes')); expect(text).toContain('Text');
  });
  it('leaves a plain todo of the same name alone and adds one linked copy next to it', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY); const path = `Daily/${later(1)}.md`;
    await createdBy(h, path, '- [ ] Gym\n- [x] Done thing\n'); expect(h.texts.get(path)).toContain('- [ ] Gym\n'); expect(copies(h.texts.get(path), task.id)).toHaveLength(1); expect(parseTasks(h.texts.get(path)!).filter(t => t.title === 'Gym')).toHaveLength(2);
  });
  it('handles nested and repeated headings, callouts and code fences in the template', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY);
    const weird = ['> [!note]\n> - [ ] in a callout\n', '```\n- [ ] in code\n```\n', '# A\n## B\n### C\n', '# Same\n# Same\n', '---\n---\n', '   \n\n\n', '- [ ] only a todo', '| a | b |\n|---|---|\n'];
    let n = 10; for (const text of weird) { const path = `Daily/${later(n++)}.md`; await createdBy(h, path, text); const out = h.texts.get(path)!; expect(copies(out, task.id), text).toHaveLength(1); expect(out.replace(/- \[ \] Gym.*\n?/, '').replace(/\n+$/, ''), text).toContain(text.trim().split('\n')[0]); }
  });
  it('keeps a task in its own section when the section appears twice in the template', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Gym'); await plugin.service.recurrence(task.id, DAILY); await plugin.repo.update(task.id, t => ({ ...t, daily_note_section_path: [{ level: 2, text: 'Habits', ordinal: 1 }] }));
    const path = `Daily/${later(2)}.md`; await createdBy(h, path, '## Habits\n\n## Habits\n\n## End\n'); const text = h.texts.get(path)!; expect(copies(text, task.id)).toHaveLength(1); expect(text.indexOf('Gym')).toBeGreaterThan(text.lastIndexOf('## Habits')); expect(text.indexOf('Gym')).toBeLessThan(text.indexOf('## End'));
  });
  it('with the full heading path of the note it came from, tasks also share one heading', async () => {
    const { h, plugin } = await loaded(); const section = [{ level: 1, text: 'Day', ordinal: 0 }, { level: 2, text: 'Habits', ordinal: 0 }]; const tasks = [];
    for (const title of ['Gym', 'Read']) { const t = await plugin.repo.create(title); await plugin.service.recurrence(t.id, DAILY); await plugin.repo.update(t.id, x => ({ ...x, daily_note_section_path: section })); tasks.push(t); }
    for (const [n, template] of [[2, '# Day\n\n## Habits\n'], [3, '# Day\n'], [4, '']] as [number, string][]) { const path = `Daily/${later(n)}.md`; await createdBy(h, path, template); const text = h.texts.get(path)!; expect(text.match(/^## Habits$/gm), template).toHaveLength(1); expect(tasks.every(t => copies(text, t.id).length === 1), template).toBe(true); }
  });
  it('a template without the parent heading gets the whole path, with each task once', async () => {
    const { h, plugin } = await loaded(); const section = [{ level: 1, text: 'Day', ordinal: 0 }, { level: 2, text: 'Habits', ordinal: 0 }]; const tasks = [];
    for (const title of ['Gym', 'Read']) { const t = await plugin.repo.create(title); await plugin.service.recurrence(t.id, DAILY); await plugin.repo.update(t.id, x => ({ ...x, daily_note_section_path: section })); tasks.push(t); }
    const path = `Daily/${later(2)}.md`; await createdBy(h, path, '## Habits\n'); const text = h.texts.get(path)!; expect(text.match(/^# Day$/gm)).toHaveLength(1); expect(tasks.every(t => copies(text, t.id).length === 1)).toBe(true); expect(text.startsWith('## Habits')).toBe(true);
  });
});
