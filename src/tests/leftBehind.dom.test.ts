// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { addDays, localDate } from '../model';
import { parseTasks } from '../codec';
import { DAILY } from '../recurrence';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { Notice.instances.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });
const today = () => localDate(); const ago = (n: number) => addDays(today(), -n); const later = (n: number) => addDays(today(), n);
const note = (date: string) => `Daily/${date}.md`;
const line = (marker: string, title: string, id: string) => `- [${marker}] ${title} <!--organized:${id}-->`;

describe('carrying left-behind tasks to today', () => {
  it('brings the latest earlier todo of an unfinished task to today, once, with one Undo, and leaves the old line as forwarded', async () => {
    const h = harness(); const a = await h.repo.create('Open one'); const b = await h.repo.create('Running'); const c = await h.repo.create('Stepwise'); await h.service.status(b.id, 'in_progress');
    await h.add(note(ago(5)), `${line(' ', 'Open one', a.id)}\n${line('/', 'Running', b.id)}\n${line('>', 'Stepwise', c.id)}`); await h.add(note(ago(3)), line(' ', 'Stepwise', c.id));
    await h.add(note(today()), '- [ ] My own todo'); const result = await h.service.carryLeftBehind();
    expect(result.moved.sort()).toEqual(['Open one', 'Running', 'Stepwise']); expect(result.skipped).toEqual([]);
    const now = parseTasks(h.texts.get(note(today()))!); expect(now.filter(t => t.id).map(t => t.id).sort()).toEqual([a.id, b.id, c.id].sort()); expect(now.find(t => t.id === b.id)!.marker).toBe('/');
    expect(h.texts.get(note(ago(5)))).toContain('[>] Open one'); expect(h.texts.get(note(ago(3)))).toContain('[>] Stepwise'); expect(h.texts.get(note(ago(5)))).toContain('[>] Stepwise');
    expect((await h.service.carryLeftBehind()).moved).toEqual([]); expect(parseTasks(h.texts.get(note(today()))!)).toHaveLength(4);
    await h.service.undo(); expect(h.texts.get(note(today()))).not.toContain(a.id);
  });
  it('leaves alone what is not left behind: recurring, finished, blocked, converted, already today or later, scheduled ahead', async () => {
    const h = harness(); const ids: Record<string, string> = {};
    for (const name of ['habit', 'done', 'canceled', 'blocked', 'note', 'today', 'tomorrow', 'ahead']) ids[name] = (await h.repo.create(name)).id;
    await h.repo.update(ids.habit, t => ({ ...t, recurring: true, recurrence: DAILY.toString() === '' ? null : null })); await h.service.status(ids.done, 'completed'); await h.service.status(ids.canceled, 'canceled'); await h.service.block(ids.blocked, { kind: 'waiting', days: 3, mode: 'reminder' });
    await h.repo.update(ids.note, t => ({ ...t, converted_to: 'Note.md' })); await h.repo.update(ids.ahead, t => ({ ...t, scheduled_dates: [later(4)] }));
    await h.add(note(ago(2)), Object.entries(ids).map(([name, id]) => line(' ', name, id)).join('\n'));
    await h.add(note(today()), line(' ', 'today', ids.today)); await h.add(note(later(1)), line(' ', 'tomorrow', ids.tomorrow));
    const result = await h.service.carryLeftBehind(); expect(result).toEqual({ moved: [], skipped: [] }); expect(parseTasks(h.texts.get(note(today()))!).map(t => t.id)).toEqual([ids.today]);
  });
  it('ignores todos that are not open ones: ticked, canceled, blocked, repeat marker, text without a task', async () => {
    const h = harness(); const task = await h.repo.create('Open in the task note'); await h.add(note(ago(2)), `${line('x', 'Open in the task note', task.id)}\n- [ ] Plain todo\n${line('r', 'Repeat', 'abcdefgh')}\n${line('B', 'Parked', 'bbbbbbbb')}\n${line('-', 'Gone', 'cccccccc')}`);
    expect((await h.service.carryLeftBehind()).moved).toEqual([]);
  });
  it('carries a scheduled-away line whose day came, but not one that waits for its day', async () => {
    const h = harness(); const due = await h.repo.create('Was due today'); const waits = await h.repo.create('Waits');
    await h.repo.update(due.id, t => ({ ...t, scheduled_dates: [today()] })); await h.repo.update(waits.id, t => ({ ...t, scheduled_dates: [later(2)] }));
    await h.add(note(ago(1)), `${line('<', 'Was due today', due.id)}\n${line('<', 'Waits', waits.id)}`);
    expect((await h.service.carryLeftBehind()).moved).toEqual(['Was due today']); expect(h.texts.get(note(today()))).not.toContain(waits.id);
  });
  it('takes subtasks along with their parent once, and reports a task it cannot move without stopping the rest', async () => {
    const h = harness(); const parent = await h.repo.create('Parent'); const child = await h.repo.create('Child'); const twice = await h.repo.create('Twice'); const fine = await h.repo.create('Fine');
    await h.add(note(ago(2)), `${line(' ', 'Parent', parent.id)}\n  ${line(' ', 'Child', child.id)}\n${line(' ', 'Twice', twice.id)}\n${line(' ', 'Twice', twice.id)}\n${line(' ', 'Fine', fine.id)}\n${line(' ', 'Missing task', 'zzzzzzzz')}`);
    const result = await h.service.carryLeftBehind(); expect(result.moved.sort()).toEqual(['Fine', 'Parent']); expect(result.skipped).toHaveLength(2);
    expect(result.skipped.some(s => s.startsWith('Twice'))).toBe(true); expect(result.skipped.some(s => s.startsWith('Missing task'))).toBe(true);
    expect(parseTasks(h.texts.get(note(today()))!).filter(t => t.id === child.id)).toHaveLength(1);
  });
  it('writes nothing when nothing is left behind: today\'s note is made only by the first move', async () => {
    const h = harness(); await h.service.carryLeftBehind(); expect(h.texts.has(note(today()))).toBe(false);
    const task = await h.repo.create('Left'); await h.add(note(ago(2)), line(' ', 'Left', task.id)); await h.service.carryLeftBehind(); expect(h.texts.get(note(today()))).toContain(task.id);
  });
  it('reads a skipped one that is not an error object', async () => {
    const h = harness(); const task = await h.repo.create('Odd'); await h.add(note(ago(2)), `${line(' ', 'Odd', task.id)}\n- [ ] \n${line(' ', '', 'zzzzzzzz')}`); await h.add(note(today()), '- [ ] My own todo'); vi.spyOn(h.service, 'schedule').mockRejectedValueOnce('plain text');
    const { skipped } = await h.service.carryLeftBehind(); expect(skipped[0]).toBe('Odd (plain text)'); expect(skipped[1]).toContain('zzzzzzzz ('); expect(h.texts.has(note(today()))).toBe(true);
  });
});

describe('the command', () => {
  async function plugin() { const h = harness(); const owner = new Organized(h.app as any, { id: 'organized', name: 'Organized', version: '0.0.0' } as any); await owner.onload(); await flush(); return { h, owner, run: () => (owner as any).commands.find((c: any) => c.id === 'carry-left-behind').callback() }; }
  const messages = () => Notice.instances.map(n => typeof n.message === 'string' ? n.message : '');
  it('says when nothing was left behind, what it could not move, and refuses on a device that does not write daily notes', async () => {
    const { h, owner, run } = await plugin(); run(); await flush(); expect(messages().at(-1)).toContain('No unfinished task was left behind');
    await h.add(note(ago(2)), line(' ', 'Gone task', 'zzzzzzzz')); run(); await vi.waitFor(() => expect(messages().some(m => m.includes('Nothing was moved. Not moved: Gone task'))).toBe(true));
    owner.role = 'secondary'; Notice.instances.length = 0; run(); await flush(); expect(messages().at(-1)).toContain('main device');
  });
  it('moves tasks and shows the summary with Undo', async () => {
    const { h, owner, run } = await plugin(); const task = await owner.repo.create('Left'); await h.add(note(ago(2)), line(' ', 'Left', task.id));
    run(); await flush(); expect(h.texts.get(note(today()))).toContain(task.id); expect(Notice.instances.length).toBeGreaterThan(0);
  });
});
