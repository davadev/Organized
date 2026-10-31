// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { harness } from './harness';
import { parseTasks, insertTask, sortTasks } from '../codec';
import { localDate, nextDate } from '../model';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { DataSafety } from '../safety';

installObsidianDom();
describe('conflict and structural regression cases', () => {
  it('does not interpret YAML/code headings as insertion destinations; reconstructs exact duplicate ordinals', () => {
    const section = [{ level: 1, text: 'Work', ordinal: 0 }, { level: 2, text: 'Focus', ordinal: 1 }];
    const text = '---\n# Work\ntitle: Daily\n---\n```\n# Work\n```\n# Work\n## Focus\nold prose\n# Other\n';
    const result = insertTask(text, '- [ ] New', section); expect(result.missing).toBe(true); expect(result.text.startsWith('---\n# Work\ntitle: Daily\n---')).toBe(true); expect(parseTasks(result.text)[0].section).toEqual(section);
    const repeated = insertTask(result.text, '- [ ] Another', section); expect(repeated.missing).toBe(false); expect(repeated.text.match(/## Focus/g)).toHaveLength(2); expect(parseTasks(repeated.text).map(t => t.section)).toEqual([section, section]);
    const noParent = insertTask('', '- [ ] New', [{ level: 1, text: 'Duplicate', ordinal: 1 }]); expect(parseTasks(noParent.text)[0].section[0].ordinal).toBe(1);
    const endParent = insertTask('# Work\n## One\n# Work\n## Two\n', '- [ ] New', [{ level: 1, text: 'Work', ordinal: 1 }, { level: 2, text: 'Absent', ordinal: 0 }]); expect(parseTasks(endParent.text)[0].section).toEqual([{ level: 1, text: 'Work', ordinal: 1 }, { level: 2, text: 'Absent', ordinal: 0 }]);
    const deeper = insertTask('# A\n## B\n### C\n', '- [ ] New', [{ level: 1, text: 'A', ordinal: 0 }, { level: 2, text: 'Missing', ordinal: 0 }, { level: 3, text: 'C', ordinal: 0 }]); expect(parseTasks(deeper.text)[0].section[1].text).toBe('Missing');
  });
  it('moves complete sibling blocks including subtasks, preserving prose and heading boundaries', () => {
    const text = '# A\n- [ ] Low <!--organized:task_low-->\n    - [ ] child\n    description\n- [ ] High <!--organized:taskhigh-->\n    - [ ] high child\n\nProse\n# B\n- [ ] untouched';
    const priorities = new Map([['task_low', 'low' as const], ['taskhigh', 'high' as const]]); const sorted = sortTasks(text, 1, 'list', priorities);
    expect(sorted).toContain('- [ ] High <!--organized:taskhigh-->\n    - [ ] high child\n- [ ] Low <!--organized:task_low-->\n    - [ ] child\n    description'); expect(sorted).toContain('\nProse\n# B\n- [ ] untouched');
    expect(sortTasks(text, 4, 'list', priorities)).toBe(sorted);
  });
  it('can schedule a browse-selected or orphan record without an editor, and reschedule without guessing', async () => {
    const h = harness(); const task = await h.repo.create('Detached'); await h.service.scheduleTask(task.id, '2099-01-01'); expect(h.texts.get('Daily/2099-01-01.md')).toContain(task.id);
    await h.service.scheduleTask(task.id, '2099-01-01'); expect(parseTasks(h.texts.get('Daily/2099-01-01.md')!)).toHaveLength(1);
    await h.service.scheduleTask(task.id, '2099-01-02'); expect(h.texts.get('Daily/2099-01-01.md')).not.toContain(task.id); expect((await h.repo.read(task.id)).movement_history.some(m => m.kind === 'reschedule')).toBe(true);
    h.texts.set('Daily/2099-01-02.md', 'User removed occurrence'); await h.service.scheduleTask(task.id, '2099-01-03'); expect(h.texts.get('Daily/2099-01-02.md')).toBe('User removed occurrence');
    h.files.delete('Daily/2099-01-03.md'); await h.service.scheduleTask(task.id, '2099-01-04'); expect((await h.repo.read(task.id)).scheduled).toBe('2099-01-04');
    const file: any = await h.add('Origin.md', `- [<] Detached <!--organized:${task.id}-->`); const context = { file, line: parseTasks(h.texts.get('Origin.md')!)[0] }; await h.service.scheduleTask(task.id, '2099-01-05', context); expect(h.texts.get('Origin.md')).toContain('[<]');
    await h.service.scheduleTask(task.id, '2099-01-06', { file, line: parseTasks('- [ ] Other <!--organized:other123-->')[0] }); expect((await h.repo.read(task.id)).scheduled).toBe('2099-01-06');
  });
  it('resolves a moved unique line but not changed, duplicated or missing context', async () => {
    const h = harness(); const task = await h.repo.create('Task'); const raw = `- [ ] Task <!--organized:${task.id}-->`; const file: any = await h.add('Note.md', raw); const context = { file, line: parseTasks(raw)[0] };
    h.texts.set(file.path, 'intro\n' + raw); expect((await h.service.resolve(context)).line.line).toBe(1);
    h.texts.set(file.path, raw.replace('Task', 'Edited')); await expect(h.service.resolve(context)).rejects.toThrow('context changed');
    h.texts.set(file.path, 'intro\n' + raw + '\n' + raw); await expect(h.service.resolve(context)).rejects.toThrow();
    const plain = '- [!] Unlinked'; h.texts.set(file.path, plain); await expect(h.service.priority({ file, line: parseTasks(plain)[0] }, 'none')).rejects.toThrow('Attach');
    expect((await h.repo.occurrences(task.id))).toEqual([]);
  });
  it('preserves missing previous destinations and skips tasks already in today during date-flip', async () => {
    const h = harness(); const task = await h.repo.create('Task'); await h.repo.update(task.id, t => ({ ...t, scheduled: '2026-01-01' }));
    const file: any = await h.add('Origin.md', `- [<] Task <!--organized:${task.id}-->`); await h.service.schedule({ file, line: parseTasks(h.texts.get(file.path)!)[0] }, '2026-01-02'); expect((await h.repo.read(task.id)).scheduled).toBe('2026-01-02');
    await h.add('Daily/2020-01-01.md', `- [ ] Task <!--organized:${task.id}-->\n- [ ] ordinary`); const today: any = await h.add(`Daily/${localDate()}.md`, `- [ ] Task <!--organized:${task.id}-->`);
    await h.service.reconcile(today); expect(parseTasks(h.texts.get(today.path)!)).toHaveLength(1); expect(h.texts.get('Daily/2020-01-01.md')).toContain('[ ] Task');
  });
  it('rescheduling searches stable IDs, preserves origin/history/generated lines and reports changed daily configuration', async () => {
    const h = harness(); const task = await h.repo.create('Schedule'); const origin: any = await h.add('Daily/2026-01-01.md', `- [<] Schedule <!--organized:${task.id}-->`);
    await h.repo.update(task.id, t => ({ ...t, scheduled: '2026-01-01' }));
    await h.service.schedule({ file: origin, line: parseTasks(h.texts.get(origin.path)!)[0] }, '2026-01-02'); expect(h.texts.get(origin.path)).toContain('[<]');
    h.texts.set('Daily/2026-01-02.md', `- [x] Schedule <!--organized:${task.id}-->`); await h.service.scheduleTask(task.id, '2026-01-03'); expect(h.texts.get('Daily/2026-01-02.md')).toContain('[x]');
    h.texts.set('Daily/2026-01-03.md', `- [ ] Schedule <!--organized:${task.id}--> <!--organized:repeat-->`); await h.service.scheduleTask(task.id, '2026-01-04'); expect(h.texts.get('Daily/2026-01-03.md')).toContain('organized:repeat');
    h.setSettings({ dailyFolder: 'New daily folder' }); await h.service.scheduleTask(task.id, '2026-01-05'); expect(h.texts.get('Daily/2026-01-04.md')).toContain(task.id); expect(h.texts.get('New daily folder/2026-01-05.md')).toContain(task.id); expect(Notice.instances.at(-1)?.message).toContain('references list to repair');
  });
  it('keeps independent recurring dates and malformed stopped periods safe', async () => {
    const h = harness(); const task = await h.repo.create('Repeat'); await h.repo.update(task.id, t => ({ ...t, recurring: true, recurrence_periods: [] }));
    const today: any = await h.add(`Daily/${localDate()}.md`, `- [ ] Repeat <!--organized:${task.id}-->`); const tomorrow = `Daily/${nextDate(localDate())}.md`; const line = `- [ ] Repeat <!--organized:${task.id}--> <!--organized:repeat-->`;
    await h.add(tomorrow, line + '\n' + line); await h.add('Daily/2099-01-01.md', '- [ ] Plain');
    await h.service.status(task.id, 'open', { file: today, line: parseTasks(h.texts.get(today.path)!)[0] }); expect(h.texts.get(today.path)).toContain('[ ]');
    await h.service.recurrence(task.id); expect(h.texts.get(tomorrow)).toContain(line); expect((Notice.instances.at(-1)?.message as DocumentFragment).textContent).toContain('preserved for repair');
    await h.repo.update(task.id, t => ({ ...t, recurring: true, recurrence_periods: [{ start: '2020-01-01', stop: '2020-02-01' }] })); await h.service.recurrence(task.id); expect((await h.repo.read(task.id)).recurring).toBe(false);
    const fragment = Notice.instances.at(-1)!.message as DocumentFragment; fragment.querySelector<HTMLButtonElement>('button')!.click(); for (let i = 0; i < 50; i++) await Promise.resolve(); expect((await h.repo.read(task.id)).recurring).toBe(true);
  });
  it('reports recurrence conflicts with usable Undo instead of abandoning the successful part of a batch', async () => {
    const h = harness(); const task = await h.repo.create('Repeat'); const source: any = await h.add('Origin.md', `- [f] Repeat <!--organized:${task.id}-->`); const context = { file: source, line: parseTasks(h.texts.get(source.path)!)[0] };
    await h.add('Daily/2099-01-01.md'); await h.add('Daily/2099-01-02.md');
    h.raw.vault.process.mockImplementationOnce(async () => { h.texts.set(source.path, 'Concurrent source change'); throw Error('concurrent destination'); });
    await h.service.recurrence(task.id, context); expect(h.texts.get('Daily/2099-01-01.md')).toBe(''); expect(h.texts.get('Daily/2099-01-02.md')).toContain(task.id); expect(h.texts.get(source.path)).toBe('Concurrent source change'); expect((Notice.instances.at(-1)?.message as DocumentFragment).textContent).toContain('preserved for repair');
    await h.service.undo(); expect((await h.repo.read(task.id)).recurring).toBe(false); expect(h.texts.get('Daily/2099-01-02.md')).toBe(''); expect(h.texts.get(source.path)).toBe('Concurrent source change');
  });
  it('creates project controls with every status, preserves missing unlinks and indexes ordinary unlinked tasks safely', async () => {
    const h = harness(); const task = await h.repo.create('Project');
    for (const [status, timer, marker] of [['completed', null, 'x'], ['canceled', null, '-'], ['in_progress', '2026-01-01T00:00:00Z', '/']] as const) {
      await h.repo.update(task.id, t => ({ ...t, status, time_tracking_started_at: timer })); await h.service.projects(task.id, [`${status}.md`]); expect(h.texts.get(`${status}.md`)).toContain(`[${marker}]`);
    }
    h.files.delete('in_progress.md'); await h.service.projects(task.id, []); expect((await h.repo.read(task.id)).projects).toEqual([]);
    const file: any = await h.add('Plain.md', '- [ ] Plain'); await h.service.refs(task.id); await h.service.index(file); expect(await h.service.refs(task.id)).toEqual([]);
    h.setSettings({ dailyFormat: 'YYYY-MMMM-DD' }); expect(h.service.daily.date('Daily/2026-january-02.md')).toBeNull();
    const records = new DataSafety(h.app.vault.adapter, 'none', '0.1.0', vi.fn()); await records.snapshot('upgrade'); expect(h.raw.vault.adapter.write).not.toHaveBeenCalled();
  });
});
