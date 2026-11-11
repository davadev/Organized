// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { editorLivePreviewField, Modal, Notice } from './__mocks__/obsidian';
import { parseTasks, replaceTask, taskText } from '../codec';
import { dayTimes, plannedFrom, plannedText } from '../plans';
import { taskFrom } from '../model';
import { splitNote } from '../repository';
import { editorExtension } from '../render';
import { ScheduleModal } from '../modals';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; Modal.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.empty(); process.env.TZ = TZ; });
const TZ = process.env.TZ;
const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).getTime();
const iso = (d: number, h: number, m = 0) => new Date(at(d, h, m)).toISOString();
const block = (d: number, from: number, to: number) => ({ start: iso(d, from), end: iso(d, to) });
const day = (d: number) => `2026-03-${String(d).padStart(2, '0')}`;
async function fixture(time = at(4, 7)) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(time)); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  return { ...h, owner, service: owner.service, repo: owner.repo, note: (d: number) => owner.service.daily.path(day(d)) };
}

describe('planned times in a todo line', () => {
  it('reads the times after the title apart from it, writes them back, and leaves text that only looks like times alone', () => {
    const [line] = parseTasks('- [ ] Report · 10:00–11:00, 14:00–15:30 <!--organized:abcdefgh12-->\r');
    expect([line.title, line.times]).toEqual(['Report', '10:00–11:00, 14:00–15:30']);
    expect(taskText(line, { marker: 'x' })).toBe('- [x] Report · 10:00–11:00, 14:00–15:30 <!--organized:abcdefgh12-->\r'); expect(taskText(line, { times: null })).toBe('- [ ] Report <!--organized:abcdefgh12-->\r');
    expect(taskText(line, { title: 'Renamed', times: '09:00–10:00' })).toBe('- [ ] Renamed · 09:00–10:00 <!--organized:abcdefgh12-->\r');
    expect(parseTasks('- [ ] Plain · 10:00–11:00').map(t => [t.title, t.times])).toEqual([['Plain · 10:00–11:00', null]]);
    expect(parseTasks('- [ ] Odd · 9:00–10:00 <!--organized:abcdefgh12-->').map(t => [t.title, t.times])).toEqual([['Odd · 9:00–10:00', null]]);
    expect(taskText({ ...line, id: null }, {})).toBe('- [ ] Report\r');
  });
  it('lists a day\'s planned times in order', () => {
    expect(dayTimes({ planned_sessions: [block(5, 14, 15), block(5, 9, 10), block(6, 9, 10)] }, day(5))).toBe('09:00–10:00, 14:00–15:00'); expect(dayTimes({ planned_sessions: [] }, day(5))).toBeNull();
  });
});

describe('planned blocks in the task note', () => {
  it('writes local text a person can read, and keeps exact times where the text cannot say them', () => {
    expect(plannedText(block(5, 9, 10))).toBe('2026-03-05 09:00–10:00'); expect(plannedText({ start: iso(5, 22), end: iso(6, 2) })).toBe('2026-03-05 22:00–02:00');
    const seconds = { start: new Date(2026, 2, 5, 9, 0, 30).toISOString(), end: iso(5, 10) }; expect(plannedText(seconds)).toEqual(seconds);
    const long = { start: iso(5, 9), end: iso(6, 12) }; expect(plannedText(long)).toEqual(long);
    expect(plannedFrom('2026-03-05 9:00-10:00')).toEqual(block(5, 9, 10)); expect(plannedFrom(' 2026-03-05 10:00 – 10:00 ')).toEqual({ start: iso(5, 10), end: iso(6, 10) });
    for (const bad of ['2026-03-05', '2026-03-05 24:00–25:00', '2026-03-05 10:60–11:00', '2026-02-30 10:00–11:00', 'soon']) expect(plannedFrom(bad), bad).toBeNull();
  });
  it('keeps clock times across the clock changes, and the exact times when a clock time does not exist', () => {
    process.env.TZ = 'Europe/Prague';
    const spring = { start: new Date(2026, 2, 29, 1, 0).toISOString(), end: new Date(2026, 2, 29, 4, 0).toISOString() }; expect(plannedText(spring)).toBe('2026-03-29 01:00–04:00');
    expect(plannedFrom('2026-03-29 01:00–04:00')).toEqual(spring); expect(plannedFrom('2026-03-29 02:30–03:30')).toBeNull();
    const autumn = { start: new Date(2026, 9, 25, 1, 0).toISOString(), end: new Date(2026, 9, 25, 4, 0).toISOString() }; expect(plannedFrom(plannedText(autumn) as string)).toEqual(autumn);
  });
  it('reads both forms, drops what is neither, and never takes text for worked time', () => {
    const task = taskFrom({ id: 'abcdefgh12', title: 'T', planned_sessions: ['2026-03-05 09:00–10:00', block(5, 14, 15), 'nope', 7], work_sessions: ['2026-03-05 09:00–10:00'] }, 'abcdefgh12');
    expect([task.planned_sessions, task.work_sessions]).toEqual([[block(5, 9, 10), block(5, 14, 15)], []]);
  });
  it('the task note holds the readable form after any change', async () => {
    const { repo, texts } = await fixture(); const task = await repo.create('Readable');
    await repo.update(task.id, t => ({ ...t, planned_sessions: [block(5, 9, 10), { start: iso(5, 22), end: iso(6, 2) }] }));
    expect(splitNote(texts.get(repo.taskFile(task.id)!.path)!).frontmatter.planned_sessions).toEqual(['2026-03-05 09:00–10:00', '2026-03-05 22:00–02:00']);
    expect((await repo.read(task.id)).planned_sessions).toEqual([block(5, 9, 10), { start: iso(5, 22), end: iso(6, 2) }]);
  });
});

describe('the times a day\'s todo shows', () => {
  it('follow every change of the plan in today\'s and later notes, never in earlier ones', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Report');
    await add(note(3), `- [ ] Report <!--organized:${task.id}-->`); await add(note(5), ''); await add('Inbox.md', `- [<] Report <!--organized:${task.id}-->`);
    await repo.update(task.id, t => ({ ...t, planned_sessions: [block(3, 9, 10)] }));
    await service.saveSchedule(task.id, [{ date: day(5), blocks: [block(5, 14, 15), block(5, 9, 10)] }]);
    expect(texts.get(note(5))).toContain(`- [ ] Report · 09:00–10:00, 14:00–15:00 <!--organized:${task.id}-->`); expect(texts.get(note(3))).toBe(`- [ ] Report <!--organized:${task.id}-->`); expect(texts.get('Inbox.md')).toBe(`- [<] Report <!--organized:${task.id}-->`);
    await service.changePlanned(task.id, block(5, 9, 10), block(5, 10, 11)); expect(parseTasks(texts.get(note(5))!)[0].times).toBe('10:00–11:00, 14:00–15:00');
    await service.addPlanned(task.id, block(5, 16, 17)); expect(parseTasks(texts.get(note(5))!)[0].times).toBe('10:00–11:00, 14:00–15:00, 16:00–17:00');
    vi.setSystemTime(new Date(at(5, 18))); await service.logPlanned(task.id, block(5, 16, 17)); expect(parseTasks(texts.get(note(5))!)[0].times).toBe('10:00–11:00, 14:00–15:00');
    await service.title(task.id, 'Final report'); expect(texts.get(note(5))).toContain('- [ ] Final report · 10:00–11:00, 14:00–15:00');
    await service.unschedule(task.id); expect(texts.get(note(5))).not.toContain('Final report');
  });
  it('a recurring task\'s lines get no times, and a note that cannot be written now is left for the next change', async () => {
    const { service, repo, add, texts, note } = await fixture(); const task = await repo.create('Gym'); await add(note(5), `- [ ] Gym <!--organized:${task.id}--> <!--organized:repeat-->`);
    await repo.update(task.id, t => ({ ...t, recurring: true, recurrence: 'daily', recurrence_periods: [{ start: day(1), stop: null }] })); await service.addPlanned(task.id, block(5, 9, 10)); expect(texts.get(note(5))).not.toContain('09:00');
    const other = await repo.create('Busy'); await add(note(6), ''); await repo.update(other.id, t => ({ ...t, scheduled_dates: [day(6)] })); await service.saveSchedule(other.id, [{ date: day(6), from: day(6), blocks: [] }, { date: day(7), blocks: [] }]);
    const edit = vi.spyOn(service, 'edit').mockRejectedValueOnce(new Error('changed concurrently')); await service.addPlanned(other.id, block(6, 9, 10)); edit.mockRestore();
    expect((await repo.read(other.id)).planned_sessions).toEqual([block(6, 9, 10)]);
  });
  it('a dialog still holding the todo from before its times changed acts on it, and the title sync sees a title that ends like times as unchanged', async () => {
    const { owner, service, repo, add, texts, note } = await fixture(); const task = await repo.create('Plan'); await add(note(5), `- [t] Plan <!--organized:${task.id}-->`);
    const context = { file: repo.file(note(5))!, line: parseTasks(texts.get(note(5))!)[0] }; await repo.update(task.id, t => ({ ...t, scheduled_dates: [day(5)] }));
    await service.addPlanned(task.id, block(5, 9, 10)); expect(texts.get(note(5))).toContain('[t] Plan · 09:00–10:00'); await service.clean(context); expect(texts.get(note(5))).toContain('- [ ] Plan · 09:00–10:00');
    await expect(service.clean({ ...context, line: { ...context.line, raw: '- [t] Other <!--organized:x-->' } })).rejects.toThrow('Task context changed');
    const timed = await repo.create('Call · 10:00–11:00'); await add('Calls.md', `- [ ] Call · 10:00–11:00 <!--organized:${timed.id}-->`); const rename = vi.spyOn(service, 'title');
    await (owner as any).syncEditedTitle(repo.file('Calls.md')!, timed.id); expect(rename).not.toHaveBeenCalled(); rename.mockRestore();
    // Its own line in a scheduled day keeps the whole title, with the day's times after it; a rename does not take the title's end for times.
    await add(note(6), `- [ ] Call · 10:00–11:00 <!--organized:${timed.id}-->`); await repo.update(timed.id, t => ({ ...t, scheduled_dates: [day(6)] }));
    await service.addPlanned(timed.id, block(6, 14, 15)); expect(texts.get(note(6))).toContain(`- [ ] Call · 10:00–11:00 · 14:00–15:00 <!--organized:${timed.id}-->`);
    await service.changePlanned(timed.id, block(6, 14, 15), null); expect(texts.get(note(6))).toContain(`- [ ] Call · 10:00–11:00 <!--organized:${timed.id}-->`); expect((await repo.read(timed.id)).title).toBe('Call · 10:00–11:00');
    await service.title(timed.id, 'Phone call'); expect(texts.get('Calls.md')).toContain('- [ ] Phone call <!--organized:');
  });
});

describe('the times in Live Preview', () => {
  it('show as a quiet chip that opens the Schedule dialog', async () => {
    const { owner, repo } = await fixture(); const task = await repo.create('Chip');
    const doc = `- [ ] Chip · 09:00–10:00 <!--organized:${task.id}-->\nplain text`;
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [editorLivePreviewField, editorExtension(owner)] }), parent: document.body.createDiv() });
    const chip = view.dom.querySelector<HTMLElement>('.organized-line-times')!; expect(chip.textContent).toBe(' · 09:00–10:00');
    chip.click(); await flush(); expect(Modal.instances.at(-1)).toBeInstanceOf(ScheduleModal); (Modal.instances.at(-1) as unknown as ScheduleModal).close();
    const count = Modal.instances.length; view.dom.querySelector<HTMLElement>('.cm-line')!.click(); await flush(); expect(Modal.instances.length).toBe(count);
    const stray = document.body.createSpan({ cls: 'organized-line-times' }); view.dom.querySelectorAll('.cm-line')[1].appendChild(stray); stray.click(); await flush(); expect(Modal.instances.length).toBe(count);
    view.destroy();
  });
});
