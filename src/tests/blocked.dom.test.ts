// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Modal, Notice } from './__mocks__/obsidian';
import { addDays, localDate, markerOf, nextDate, newTask, setStatus, statusOfMarker, taskFrom, STATUS_ICONS } from '../model';
import { BlockedModal } from '../modals';
import { parseTasks, sortTasks, ACTION_MARKERS, projectSection } from '../codec';
import { symbolOf } from '../render';
import { splitNote } from '../repository';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); Modal.instances.length = 0; Notice.instances.length = 0; });
const today = () => localDate(); const later = (n: number) => addDays(today(), n);
const SETUP: { kind: 'waiting' | 'backlog'; days: number; mode: 'reminder' | 'reopen' } = { kind: 'waiting', days: 3, mode: 'reminder' };

describe('the blocked status in the model', () => {
  it('reads and writes its details, drops the ones that mean nothing, and remembers the interval and mode', () => {
    const base = { id: 'abcdefgh', title: 'T' };
    expect(taskFrom({ ...base, status: 'blocked', blocked_kind: 'backlog', blocked_interval_days: 5, blocked_mode: 'reopen', blocked_next: '2026-03-09' }, 'abcdefgh')).toMatchObject({ status: 'blocked', blocked_kind: 'backlog', blocked_interval_days: 5, blocked_mode: 'reopen', blocked_next: '2026-03-09' });
    expect(taskFrom({ ...base, status: 'blocked' }, 'abcdefgh')).toMatchObject({ blocked_kind: 'waiting', blocked_interval_days: null, blocked_mode: null, blocked_next: null });
    expect(taskFrom({ ...base, status: 'blocked', blocked_kind: 'x', blocked_interval_days: 0, blocked_mode: 'x', blocked_next: 'soon' }, 'abcdefgh')).toMatchObject({ blocked_kind: 'waiting', blocked_interval_days: null, blocked_mode: null, blocked_next: null });
    for (const days of [1.5, 366, '3']) expect(taskFrom({ ...base, blocked_interval_days: days }, 'abcdefgh').blocked_interval_days).toBeNull();
    // Details of a task that is not blocked: only what is remembered stays.
    expect(taskFrom({ ...base, status: 'open', blocked_kind: 'waiting', blocked_next: '2026-03-09', blocked_interval_days: 4, blocked_mode: 'reminder' }, 'abcdefgh')).toMatchObject({ blocked_kind: null, blocked_next: null, blocked_interval_days: 4, blocked_mode: 'reminder' });
  });
  it('leaving the blocked status clears why and when, keeps the interval, stops a running timer and never closes the task', () => {
    const task = { ...newTask('Wait', 'abcdefgh'), status: 'blocked' as const, blocked_kind: 'waiting' as const, blocked_interval_days: 4, blocked_mode: 'reopen' as const, blocked_next: '2026-03-09' };
    expect(setStatus(task, 'blocked')).toMatchObject({ status: 'blocked', closed_at: null, blocked_next: '2026-03-09' });
    expect(setStatus(task, 'open')).toMatchObject({ status: 'open', blocked_kind: null, blocked_next: null, blocked_interval_days: 4, blocked_mode: 'reopen' });
    const running = { ...newTask('Run', 'abcdefgh'), status: 'in_progress' as const, time_tracking_started_at: new Date(Date.now() - 3600000).toISOString() };
    expect(setStatus(running, 'blocked')).toMatchObject({ status: 'blocked', time_tracking_started_at: null }); expect(setStatus(running, 'blocked').time_tracked_seconds).toBeGreaterThan(3000);
  });
  it('has a marker, an icon and a project heading, and adds days by the calendar', () => {
    expect(statusOfMarker('B')).toBe('blocked'); expect(markerOf({ ...newTask('x', 'abcdefgh'), status: 'blocked' })).toBe('B'); expect(STATUS_ICONS.blocked).toBe('hourglass'); expect(ACTION_MARKERS).toContain('B');
    expect(projectSection({ recurring: false, status: 'blocked' })).toBe('Open');
    expect(addDays('2026-03-28', 5)).toBe('2026-04-02'); expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); expect(nextDate('2026-12-31')).toBe('2027-01-01');
    const symbol = symbolOf('status', { ...newTask('x', 'abcdefgh'), status: 'blocked' }); expect(symbol).toMatchObject({ icon: 'hourglass', label: 'Status: blocked' });
  });
  it('sorts blocked todos below open ones and above finished ones', () => {
    const text = ['- [x] Done <!--organized:aaaaaaaa-->', '- [B] Blocked <!--organized:bbbbbbbb-->', '- [ ] Low <!--organized:cccccccc-->', '- [/] Running <!--organized:dddddddd-->'].join('\n');
    const sorted = sortTasks(text, 0, 'list', new Map([['cccccccc', 'low']]));
    expect(sorted.split('\n').map(line => line.slice(3, 4))).toEqual(['/', ' ', 'B', 'x']);
  });
});

describe('blocking a task', () => {
  it('writes the status, details and marker, remembers the choice after the task opens, and offers it again', async () => {
    const h = harness(); const task = await h.repo.create('Wait for Sam'); const file: any = await h.add(`Daily/${today()}.md`, `- [B] Wait for Sam <!--organized:${task.id}-->`);
    await h.service.block(task.id, { kind: 'backlog', days: 5, mode: 'reopen' }, { file, line: parseTasks(h.texts.get(file.path)!)[0] });
    expect(await h.repo.read(task.id)).toMatchObject({ status: 'blocked', blocked_kind: 'backlog', blocked_interval_days: 5, blocked_mode: 'reopen', blocked_next: later(5), closed_at: null }); expect(h.texts.get(file.path)).toContain('- [B] Wait for Sam');
    await h.service.status(task.id, 'open'); const open = await h.repo.read(task.id); expect(open).toMatchObject({ status: 'open', blocked_kind: null, blocked_next: null, blocked_interval_days: 5, blocked_mode: 'reopen' });
    const frontmatter = splitNote(await h.repo.readText(h.repo.taskFile(task.id)!)).frontmatter; expect(frontmatter).not.toHaveProperty('blocked_next'); expect(frontmatter).toHaveProperty('blocked_interval_days', 5);
    // Without a choice, a status change to blocked uses what the task remembers, then the settings.
    await h.service.status(task.id, 'blocked'); expect(await h.repo.read(task.id)).toMatchObject({ blocked_kind: 'waiting', blocked_interval_days: 5, blocked_mode: 'reopen', blocked_next: later(5) });
    const fresh = await h.repo.create('Fresh'); h.setSettings({ blockedDefaultDays: 9, blockedDefaultMode: 'reminder' }); await h.service.status(fresh.id, 'blocked');
    expect(await h.repo.read(fresh.id)).toMatchObject({ blocked_interval_days: 9, blocked_mode: 'reminder', blocked_next: later(9) });
  });
  it('refuses a recurring task and puts its marker back', async () => {
    const h = harness(); const task = await h.repo.create('Habit'); await h.repo.update(task.id, t => ({ ...t, recurring: true })); const file: any = await h.add(`Daily/${today()}.md`, `- [B] Habit <!--organized:${task.id}-->`);
    await expect(h.service.block(task.id, SETUP, { file, line: parseTasks(h.texts.get(file.path)!)[0] })).rejects.toThrow('cannot be blocked'); expect(h.texts.get(file.path)).toContain('- [ ] Habit');
    await expect(h.service.block(task.id, SETUP)).rejects.toThrow('cannot be blocked'); expect((await h.repo.read(task.id)).status).toBe('open');
    vi.spyOn(h.service, 'clean').mockRejectedValueOnce(new Error('gone')); await expect(h.service.block(task.id, SETUP, { file, line: parseTasks(h.texts.get(file.path)!)[0] })).rejects.toThrow('cannot be blocked');
  });
  it('is left out of planning, of scheduled days and of the carried-forward todos', async () => {
    const h = harness(); const task = await h.repo.create('Parked'); await h.repo.update(task.id, t => ({ ...t, scheduled_dates: [later(1)] }));
    await h.service.block(task.id, SETUP); const note: any = await h.add(`Daily/${later(1)}.md`); await h.service.onDailyCreated(note); expect(h.texts.get(note.path)).not.toContain(task.id);
    const yesterday = addDays(today(), -1); await h.add(`Daily/${yesterday}.md`, `- [ ] Parked <!--organized:${task.id}-->`); const now: any = await h.add(`Daily/${today()}.md`); await h.service.reconcile(now); expect(h.texts.get(now.path)).not.toContain(task.id);
  });
});

describe('planning time for a blocked task', () => {
  const fixed = { start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 86400000 + 3600000).toISOString() }; const block = () => ({ ...fixed });
  it('opens the task and says so, whether the block is added, moved or saved in the Schedule dialog', async () => {
    const h = harness(); const file: any = await h.add(`Daily/${today()}.md`, '');
    for (const [name, plan] of [['add', (id: string) => h.service.addPlanned(id, block())], ['change', async (id: string) => { await h.service.addPlanned(id, block()); await h.service.block(id, SETUP); await h.service.changePlanned(id, block(), { start: block().start, end: new Date(Date.parse(block().end) + 3600000).toISOString() }); }], ['dialog', (id: string) => h.service.saveSchedule(id, [{ date: later(1), blocks: [block()] }])]] as const) {
      const task = await h.repo.create(name); await h.service.block(task.id, SETUP); Notice.instances.length = 0; await plan(task.id);
      expect(await h.repo.read(task.id), name).toMatchObject({ status: 'open', blocked_next: null, blocked_interval_days: 3 }); expect(Notice.instances.some(n => typeof n.message === 'string' && n.message.includes('no longer blocked')), name).toBe(true);
    }
    expect(file).toBeTruthy();
  });
  it('keeps it blocked when nothing is planned: a block taken away, a schedule without time, an open task', async () => {
    const h = harness(); const task = await h.repo.create('Parked'); await h.service.block(task.id, SETUP); Notice.instances.length = 0;
    await h.service.saveSchedule(task.id, [{ date: later(1), blocks: [] }]); expect((await h.repo.read(task.id)).status).toBe('blocked');
    await h.service.changePlanned(task.id, block(), null).catch(() => undefined); expect((await h.repo.read(task.id)).status).toBe('blocked');
    const open = await h.repo.create('Open'); await h.service.addPlanned(open.id, block()); expect(Notice.instances.some(n => typeof n.message === 'string' && n.message.includes('no longer blocked'))).toBe(false);
  });
  it('puts the todo in the note back to open, and Undo takes it back', async () => {
    const h = harness(); const task = await h.repo.create('Parked'); const file: any = await h.add(`Daily/${today()}.md`, `- [B] Parked <!--organized:${task.id}-->`); await h.service.block(task.id, SETUP);
    await h.service.addPlanned(task.id, block()); expect(h.texts.get(file.path)).toContain('- [ ] Parked');
  });
});

describe('blocked tasks in the move and carry pipelines', () => {
  it('reconcile does not carry a blocked task whose scheduled day went by with no note', async () => {
    const h = harness(); const task = await h.repo.create('Parked'); await h.repo.update(task.id, t => ({ ...t, scheduled_dates: [addDays(today(), -3)] })); await h.service.block(task.id, SETUP);
    const note: any = await h.add(`Daily/${today()}.md`); await h.service.reconcile(note); expect(h.texts.get(note.path)).not.toContain(task.id); expect((await h.repo.read(task.id)).scheduled_dates).toEqual([addDays(today(), -3)]);
  });
  it('forwarding or scheduling a blocked todo writes it blocked on the other day, not open', async () => {
    const h = harness(); const task = await h.repo.create('Parked'); await h.service.block(task.id, SETUP); const file: any = await h.add(`Daily/${today()}.md`, `- [B] Parked <!--organized:${task.id}-->`);
    await h.add(`Daily/${later(1)}.md`);
    await h.service.marker({ file, line: parseTasks(h.texts.get(file.path)!)[0] }, '>'); expect(h.texts.get(`Daily/${later(1)}.md`)).toContain('- [B] Parked'); expect((await h.repo.read(task.id)).status).toBe('blocked');
    const other = await h.repo.create('Other'); await h.service.block(other.id, SETUP); await h.add(`Daily/${later(2)}.md`);
    await h.service.saveSchedule(other.id, [{ date: later(2), blocks: [] }]); expect(h.texts.get(`Daily/${later(2)}.md`)).toContain('- [B] Other'); expect((await h.repo.read(other.id)).status).toBe('blocked');
  });
});

describe('a blocked task resurfacing', () => {
  async function blocked(setup: typeof SETUP, due: string) {
    const h = harness(); const task = await h.repo.create('Wait for Sam'); await h.service.block(task.id, setup); await h.repo.update(task.id, t => ({ ...t, blocked_next: due })); return { h, task };
  }
  it('stays away until it is due', async () => {
    const { h, task } = await blocked(SETUP, later(2)); const note: any = await h.add(`Daily/${today()}.md`); await h.service.onDailyCreated(note); expect(h.texts.get(note.path)).not.toContain(task.id);
    const early: any = await h.add(`Daily/${later(1)}.md`); await h.service.onDailyCreated(early); expect(h.texts.get(early.path)).not.toContain(task.id);
    const due: any = await h.add(`Daily/${later(2)}.md`); await h.service.onDailyCreated(due); expect(h.texts.get(due.path)).toContain(`- [B] Wait for Sam <!--organized:${task.id}-->`);
  });
  it('reminder mode writes the blocked todo once, keeps the task blocked and brings it back one interval later, not in the next note', async () => {
    const { h, task } = await blocked(SETUP, today()); const note: any = await h.add(`Daily/${today()}.md`); await h.service.onDailyCreated(note);
    expect(h.texts.get(note.path)).toContain(`- [B] Wait for Sam <!--organized:${task.id}-->`); expect(await h.repo.read(task.id)).toMatchObject({ status: 'blocked', blocked_next: later(3) });
    await h.service.onDailyCreated(note); expect(parseTasks(h.texts.get(note.path)!)).toHaveLength(1);
    for (const n of [1, 2]) { const next: any = await h.add(`Daily/${later(n)}.md`); await h.service.onDailyCreated(next); expect(h.texts.get(next.path)).not.toContain(task.id); }
    const again: any = await h.add(`Daily/${later(3)}.md`); await h.service.onDailyCreated(again); expect(h.texts.get(again.path)).toContain('- [B] Wait for Sam'); expect((await h.repo.read(task.id)).blocked_next).toBe(later(6));
    await h.service.status(task.id, 'completed'); const after: any = await h.add(`Daily/${later(6)}.md`); await h.service.onDailyCreated(after); expect(h.texts.get(after.path)).not.toContain(task.id);
  });
  it('a reminder noticed late counts the interval from the note it came into, and a task with no interval of its own uses the setting', async () => {
    const { h, task } = await blocked(SETUP, addDays(today(), -5)); await h.repo.update(task.id, t => ({ ...t, blocked_interval_days: null })); h.setSettings({ blockedDefaultDays: 4 });
    const note: any = await h.add(`Daily/${today()}.md`); await h.service.onDailyCreated(note); expect((await h.repo.read(task.id)).blocked_next).toBe(later(4));
  });
  it('open mode opens the task, clears it and writes an open todo; a todo already in the note is opened', async () => {
    const { h, task } = await blocked({ ...SETUP, mode: 'reopen' }, today()); const note: any = await h.add(`Daily/${today()}.md`); await h.service.onDailyCreated(note);
    expect(h.texts.get(note.path)).toContain(`- [ ] Wait for Sam <!--organized:${task.id}-->`); expect(await h.repo.read(task.id)).toMatchObject({ status: 'open', blocked_next: null, blocked_kind: null, blocked_interval_days: 3 });
    const other = await blocked({ ...SETUP, mode: 'reopen' }, today()); const there: any = await other.h.add(`Daily/${later(1)}.md`, `- [B] Wait for Sam <!--organized:${other.task.id}-->`); await other.h.service.onDailyCreated(there);
    expect(other.h.texts.get(there.path)).toBe(`- [ ] Wait for Sam <!--organized:${other.task.id}-->`);
  });
  it('is brought into today\'s note once a day by the check that runs when it is opened, also when the note was made without the plugin', async () => {
    const { h, task } = await blocked(SETUP, addDays(today(), -2)); const note: any = await h.add(`Daily/${today()}.md`, 'My own note');
    await h.service.reconcile(note); expect(h.texts.get(note.path)).toContain(`- [B] Wait for Sam <!--organized:${task.id}-->`);
    h.texts.set(note.path, 'My own note'); await h.service.reconcile(note); expect(h.texts.get(note.path)).toBe('My own note');
  });
  it('brings several in by title, and a hand-edited task without a mode follows the setting', async () => {
    const { h, task } = await blocked(SETUP, today()); const other = await h.repo.create('Another'); await h.service.block(other.id, SETUP); await h.repo.update(other.id, t => ({ ...t, blocked_next: today(), blocked_mode: null }));
    h.setSettings({ blockedDefaultMode: 'reopen' }); const note: any = await h.add(`Daily/${today()}.md`); await h.service.onDailyCreated(note);
    expect(parseTasks(h.texts.get(note.path)!).map(t => [t.title, t.marker])).toEqual([['Another', ' '], ['Wait for Sam', 'B']]); expect((await h.repo.read(other.id)).status).toBe('open'); expect(task.id).toBeTruthy();
  });
  it('tries a todo that cannot be written again with the next note, and says nothing', async () => {
    const { h, task } = await blocked(SETUP, today()); const note: any = await h.add(`Daily/${today()}.md`); vi.spyOn(h.service, 'insert').mockRejectedValueOnce(new Error('busy'));
    await h.service.onDailyCreated(note); expect(h.texts.get(note.path)).not.toContain(task.id); await h.service.onDailyCreated(note); expect(h.texts.get(note.path)).toContain(task.id);
  });
});

describe('typing B and the panel', () => {
  async function plugin() { const h = harness(); const owner = new Organized(h.app as any, { id: 'organized', name: 'Organized', version: '0.0.0' } as any); await owner.onload(); await flush(); return { h, owner }; }
  it('opens the dialog with the remembered choice, saves it, and puts the todo\'s marker back when it is closed', async () => {
    const { h, owner } = await plugin(); const task = await owner.repo.create('Wait'); const file: any = await h.add('Note.md', '');
    const context = () => { const text = `- [B] Wait <!--organized:${task.id}-->`; h.texts.set(file.path, text); return { file, line: parseTasks(text)[0] }; };
    const block = vi.spyOn(owner.service, 'block').mockResolvedValue(); const clean = vi.spyOn(owner.service, 'clean').mockResolvedValue();
    await owner.trigger(context()); let dialog = Modal.instances.at(-1) as BlockedModal; expect(dialog).toBeInstanceOf(BlockedModal); expect(dialog.initial).toEqual({ kind: 'waiting', days: 3, mode: 'reminder' });
    const field = (name: string) => dialog.contentEl.querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="${name}"]`)!;
    field('Days until it resurfaces').value = '0'; field('Days until it resurfaces').dispatchEvent(new Event('input')); expect(dialog.contentEl.querySelector('.organized-session-problem')?.textContent).toContain('1 to 365');
    (dialog.contentEl.querySelector('button.mod-cta') as HTMLElement).click(); await flush(); expect(block).not.toHaveBeenCalled();
    field('Days until it resurfaces').value = '7'; field('Days until it resurfaces').dispatchEvent(new Event('input')); expect(dialog.contentEl.querySelector('.organized-session-problem')).toBeNull();
    field('Why is it blocked?').value = 'backlog'; field('When it comes back').value = 'reopen'; (dialog.contentEl.querySelector('button.mod-cta') as HTMLElement).click(); await flush();
    expect(block).toHaveBeenCalledWith(task.id, { kind: 'backlog', days: 7, mode: 'reopen' }, expect.objectContaining({ file })); expect(clean).not.toHaveBeenCalled();
    await owner.trigger(context()); dialog = Modal.instances.at(-1) as BlockedModal; dialog.close(); await flush(); expect(clean).toHaveBeenCalledWith(expect.objectContaining({ file }), ' ');
    await owner.repo.update(task.id, t => ({ ...t, blocked_interval_days: 10, blocked_mode: 'reopen', blocked_kind: null })); owner.pickBlocked(await owner.repo.read(task.id)); dialog = Modal.instances.at(-1) as BlockedModal; expect(dialog.initial).toEqual({ kind: 'waiting', days: 10, mode: 'reopen' }); clean.mockClear(); dialog.close(); await flush(); expect(clean).not.toHaveBeenCalled();
  });
  it('says a recurring task cannot be blocked and gives its marker back', async () => {
    const { h, owner } = await plugin(); const task = await owner.repo.create('Habit'); await owner.repo.update(task.id, t => ({ ...t, recurring: true })); const file: any = await h.add('Note.md', `- [B] Habit <!--organized:${task.id}-->`);
    const clean = vi.spyOn(owner.service, 'clean').mockResolvedValue(); const before = Modal.instances.length;
    await owner.trigger({ file, line: parseTasks(h.texts.get(file.path)!)[0] }); await flush(); expect(Modal.instances.length).toBe(before); expect(Notice.instances.at(-1)?.message).toContain('cannot be blocked'); expect(clean).toHaveBeenCalledWith(expect.anything(), ' ');
    owner.pickBlocked(await owner.repo.read(task.id)); expect(Notice.instances.at(-1)?.message).toContain('cannot be blocked');
  });
  it('turns a plain todo into a task when B is typed, and stops a running timer', async () => {
    const { h, owner } = await plugin(); const task = await owner.repo.create('Run'); await owner.service.status(task.id, 'in_progress');
    const file: any = await h.add('Note.md', `- [/] Run <!--organized:${task.id}-->`); h.setActive(file, `- [/] Run <!--organized:${task.id}-->`);
    expect(ACTION_MARKERS).toContain('B'); const update = (owner as any).stopEditedTimers.bind(owner);
    const edited = { state: { doc: { toString: () => `- [B] Run <!--organized:${task.id}-->` } }, startState: { doc: { toString: () => `- [/] Run <!--organized:${task.id}-->` } } };
    h.setActive(file, `- [B] Run <!--organized:${task.id}-->`); update(edited); await flush(); expect((await owner.repo.read(task.id)).time_tracking_started_at).toBeNull();
  });
});

describe('the panel', () => {
  it('asks before blocking, keeps the shown status until it is saved, and shows the blocked task with its icon', async () => {
    vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
    const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
    const task = await owner.repo.create('Wait'); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    const select = view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!; expect(Array.from(select.options).map(o => o.value)).toContain('blocked');
    select.value = 'blocked'; select.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(10); const dialog = Modal.instances.at(-1) as BlockedModal; expect(dialog).toBeInstanceOf(BlockedModal); expect(select.value).toBe('open');
    (dialog.contentEl.querySelector('button.mod-cta') as HTMLElement).click(); await vi.advanceTimersByTimeAsync(10); expect(await owner.repo.read(task.id)).toMatchObject({ status: 'blocked', blocked_next: later(3) });
    await view.render(); expect(view.contentEl.querySelector('.organized-status-icon')?.getAttribute('data-status')).toBe('blocked');
    // A compact pill shows why and how often, opens the dialog with the task's choices, and the list card says when it is back.
    const pill = view.contentEl.querySelector<HTMLElement>('.organized-prop-blocked')!; expect(pill.textContent).toBe('waiting · 3d'); expect(pill.title).toBe(`Blocked (waiting): back every 3 days, next ${later(3)}, as a reminder`);
    pill.click(); await vi.advanceTimersByTimeAsync(10); const edit = Modal.instances.at(-1) as BlockedModal; expect(edit).toBeInstanceOf(BlockedModal); expect(edit.initial).toEqual({ kind: 'waiting', days: 3, mode: 'reminder' });
    edit.contentEl.querySelector<HTMLInputElement>('[aria-label="Days until it resurfaces"]')!.value = '10'; edit.contentEl.querySelector<HTMLSelectElement>('[aria-label="When it comes back"]')!.value = 'reopen'; (edit.contentEl.querySelector('button.mod-cta') as HTMLElement).click(); await vi.advanceTimersByTimeAsync(10);
    expect(await owner.repo.read(task.id)).toMatchObject({ status: 'blocked', blocked_interval_days: 10, blocked_mode: 'reopen', blocked_next: later(10) });
    await view.render(); expect(view.contentEl.querySelector<HTMLElement>('.organized-prop-blocked')!.title).toContain('then opens');
    view.tab = 'Favorites'; await owner.repo.update(task.id, t => ({ ...t, starred: true })); await view.render(); expect(view.contentEl.querySelector('.organized-list-meta')?.textContent).toContain(`waiting · back ${later(10)}`);
    // A note edited by hand to blocked, with no interval or mode, shows the settings' defaults.
    await owner.repo.update(task.id, t => ({ ...t, blocked_interval_days: null, blocked_mode: null })); view.tab = 'Task'; await view.render(); expect(view.contentEl.querySelector<HTMLElement>('.organized-prop-blocked')!.textContent).toBe('waiting · 3d'); expect(view.contentEl.querySelector<HTMLElement>('.organized-prop-blocked')!.title).toContain('as a reminder');
    await owner.service.status(task.id, 'open'); view.tab = 'Task'; await view.render(); expect(view.contentEl.querySelector('.organized-prop-blocked')).toBeNull();
  });
});
