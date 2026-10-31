// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView, VIEW_TYPE } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice, Setting, Modal } from './__mocks__/obsidian';
import { localDate } from '../model';
import { DatePicker } from '../modals';
import { moment } from '../moment';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); });
async function fixture() {
  vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl);
  h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  return { ...h, repo: owner.repo, service: owner.service, owner, view };
}
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
describe('calendar, task and project inspector', () => {
  it('defaults to Calendar; month navigation, date selection and keyboard focus are explicit', async () => {
    const { owner, view, raw, repo } = await fixture(); expect(view.getViewType()).toBe(VIEW_TYPE); expect(view.getDisplayText()).toBe('Organized'); expect(view.getIcon()).toBe('calendar-check');
    await view.onOpen(); await flush(); expect(view.contentEl.querySelectorAll('.organized-calendar button')).toHaveLength(42); expect(raw.vault.create).not.toHaveBeenCalled(); expect(view.contentEl.textContent).toContain('0 active');
    const month = view.month.format('YYYY-MM'); button(view.contentEl, 'Next month').click(); await flush(); expect(view.month.format('YYYY-MM')).not.toBe(month); button(view.contentEl, 'Previous month').click(); await flush(); expect(view.month.format('YYYY-MM')).toBe(month);
    const days = view.contentEl.querySelectorAll<HTMLButtonElement>('.organized-calendar button');
    days[8].focus(); days[8].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(document.activeElement).toBe(days[9]);
    for (const [key, index] of [['ArrowLeft', 7], ['ArrowDown', 15], ['ArrowUp', 1], ['Enter', 8]] as const) { days[8].focus(); days[8].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); expect(document.activeElement).toBe(days[index]); }
    button(view.contentEl, 'Today').click(); await flush(); expect(repo.file(owner.service.daily.path(localDate()))).toBeTruthy(); expect(view.selectedDate).toBe(localDate());
    await view.render(); expect(view.contentEl.querySelector('.organized-has-note')).toBeTruthy();
    const select = vi.spyOn(view, 'selectDay').mockResolvedValue(); view.contentEl.querySelector<HTMLButtonElement>('.organized-calendar button')!.click(); await flush(); expect(select).toHaveBeenCalled();
    button(view.contentEl, 'Task').click(); await flush(); expect(view.tab).toBe('Task'); expect(view.contentEl.textContent).toContain('Place the cursor');
    button(view.contentEl, 'Projects').click(); await flush(); expect(view.tab).toBe('Projects'); expect(view.contentEl.textContent).toContain('Favorites');
    await view.onClose(); expect(view.contentEl.childElementCount).toBe(0);
    await view.onClose(); expect((view as any).children).toHaveLength(0);
  });
  it('shows bounded statistics, handles unavailable reads and action failures visibly', async () => {
    const { view, owner, repo, add } = await fixture(); const task = await repo.create('Running'); await repo.update(task.id, t => ({ ...t, time_tracking_started_at: new Date().toISOString() })); await add(owner.service.daily.path(localDate()), '- [x] Completed today'); await view.render(); await flush(); expect(view.contentEl.textContent).toContain('1 active · 1 completed today · 1 timers');
    vi.spyOn(repo, 'list').mockRejectedValueOnce(Error('read failed')); await view.render(); await flush(); expect(view.contentEl.textContent).toContain('statistics unavailable');
    const host = createDiv(); view.button(host, 'Throws', () => { throw Error('synchronous'); }).click(); expect(Notice.instances.at(-1)?.message).toContain('synchronous'); view.button(host, 'Rejects', async () => { throw Error('asynchronous'); }).click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('asynchronous');
  });
  it('inspects canonical metadata, controls timers/status/favorites and edits without losing input focus', async () => {
    const { view, owner, repo, add, raw } = await fixture(); const task = await repo.create('Task title'); const today = localDate();
    const occurrence: any = await add('Project.md', `- [ ] Task title <!--organized:${task.id}-->`); const editor = (await import('./harness')).fakeEditor(`- [ ] Task title <!--organized:${task.id}-->`); owner.context = owner.current(editor as any, occurrence); owner.selectedTaskId = task.id; view.tab = 'Task'; view.origin = 'Projects / favorites'; view.module = 'Information';
    await repo.update(task.id, t => ({ ...t, projects: ['Project.md'], movement_history: [{ id: 'event', kind: 'forward', source: 'manual', from: '2026-01-01', to: '2026-01-02', at: '2026-01-01T00:00:00Z' }], recurrence_periods: [{ start: today, stop: null }] }));
    Setting.instances.length = 0; await view.render(); expect(view.contentEl.querySelector('input')!.value).toBe('Task title'); expect(view.contentEl.textContent).toContain('Movement history'); expect(view.contentEl.textContent).toContain('Project.md'); expect(view.contentEl.querySelector('.organized-selected-module')).toBeTruthy();
    const control = (name: string) => Setting.instances.find(s => s.nameText === name)!.controls[0];
    const input = control('Title').inputEl as HTMLInputElement; input.focus(); const original = view.contentEl.firstChild; await view.render(); expect(view.contentEl.firstChild).toBe(original); input.value = 'Draft title'; input.dispatchEvent(new Event('input')); expect(input.dataset.draft).toBe('Draft title'); input.blur(); await flush(); expect((await repo.read(task.id)).title).toBe('Draft title');
    // Each control callback is re-resolved against canonical data, not copied into an occurrence.
    Setting.instances.length = 0; await view.render(); const status = control('Status').selectEl as HTMLSelectElement; status.value = 'completed'; status.dispatchEvent(new Event('change')); await flush(); expect((await repo.read(task.id)).status).toBe('completed');
    Setting.instances.length = 0; await view.render(); const priority = control('Priority').selectEl as HTMLSelectElement; priority.value = 'low'; priority.dispatchEvent(new Event('change')); await flush(); expect((await repo.read(task.id)).priority).toBe('low');
    Setting.instances.length = 0; await view.render(); control('Favorite').toggle(); await flush(); expect((await repo.read(task.id)).starred).toBe(true);
    Setting.instances.length = 0; await view.render(); button(view.contentEl, 'Start timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).not.toBeNull();
    await view.render(); button(view.contentEl, 'Stop timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull();
    const projects = vi.spyOn(owner, 'pickProjects').mockImplementation(() => undefined); await view.render(); button(view.contentEl, 'Link projects or topics').click(); expect(projects).toHaveBeenCalled();
    const module = vi.spyOn(owner, 'editModule').mockResolvedValue(); for (const heading of ['information', 'idea', 'question', 'sources']) button(view.contentEl, `Edit ${heading}`).click(); await flush(); expect(module).toHaveBeenCalledTimes(4);
    button(view.contentEl, 'Open canonical task note').click(); await flush(); expect(raw.workspace.getLeaf).toHaveBeenCalled();
    const schedule = vi.spyOn(owner.service, 'scheduleTask').mockResolvedValue(); button(view.contentEl, 'Schedule: none').click(); const date = Modal.instances.at(-1) as DatePicker; await date.choose(today); expect(schedule).toHaveBeenCalled(); date.close();
    Setting.instances.length = 0; await view.render(); control('Recurring').toggle(); await flush(); expect((await repo.read(task.id)).recurring).toBe(true);
    button(view.contentEl, 'Back to projects').click(); await flush(); expect(view.tab).toBe('Projects');
  });
  it('shows favorites and project tasks sorted by priority, reversible canceled tasks and browse selection', async () => {
    const { view, owner, repo } = await fixture(); const low = await repo.create('Low'); const high = await repo.create('High'); const canceled = await repo.create('Canceled');
    await repo.update(low.id, t => ({ ...t, priority: 'low', starred: true, projects: ['Project.md'] })); await repo.update(high.id, t => ({ ...t, priority: 'high', starred: true, projects: ['Project.md'] })); await repo.update(canceled.id, t => ({ ...t, status: 'canceled' }));
    view.tab = 'Projects'; await view.render(); const labels = Array.from(view.contentEl.querySelectorAll('button')).map(b => b.textContent); expect(labels.indexOf('High · high')).toBeLessThan(labels.indexOf('Low · low'));
    const picker = view.contentEl.querySelector('select')!; picker.value = 'Project.md'; picker.dispatchEvent(new Event('change')); await flush(); expect(view.selectedProject).toBe('Project.md');
    button(view.contentEl, 'High · high').click(); await flush(); expect(view.tab).toBe('Task'); expect(owner.selectedTaskId).toBe(high.id); expect(view.origin).toBe('Projects / favorites');
    view.tab = 'Projects'; await view.render(); button(view.contentEl, 'Canceled').click(); await flush(); expect(owner.selectedTaskId).toBe(canceled.id);
    view.tab = 'Projects'; await view.render(); button(view.contentEl, 'Restore').click(); await flush(); expect((await repo.read(canceled.id)).status).toBe('open');
    view.tab = 'Projects'; await view.render(); Array.from(view.contentEl.querySelectorAll('button')).filter(b => b.textContent === 'Low · low').at(-1)!.click(); await flush(); expect(owner.selectedTaskId).toBe(low.id);
  });
  it('edits browse-selected scheduled tasks without editor context and preserves unchanged title drafts', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Browse'); await repo.update(task.id, t => ({ ...t, scheduled: '2099-01-01', recurring: true, recurrence_periods: [{ start: '2026-01-01', stop: null }] })); owner.selectedTaskId = task.id; owner.context = null; view.tab = 'Task';
    Setting.instances.length = 0; await view.render(); expect(view.contentEl.textContent).toContain('→ active');
    const control = (name: string) => Setting.instances.find(s => s.nameText === name)!.controls[0];
    const input = control('Title').inputEl as HTMLInputElement; input.value = task.title; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('blur')); expect((await repo.read(task.id)).title).toBe(task.title);
    const status = control('Status').selectEl as HTMLSelectElement; status.value = ''; status.dispatchEvent(new Event('change')); await flush(); expect((await repo.read(task.id)).status).toBe('open');
    const statusAction = vi.spyOn(owner.service, 'status').mockResolvedValue(); status.value = 'completed'; status.dispatchEvent(new Event('change')); button(view.contentEl, 'Start timer').click(); await flush(); expect(statusAction).toHaveBeenCalledWith(task.id, 'completed', undefined); expect(statusAction).toHaveBeenCalledWith(task.id, 'in_progress', undefined);
    const schedule = vi.spyOn(owner.service, 'scheduleTask').mockResolvedValue(); button(view.contentEl, 'Schedule: 2099-01-01').click(); const modal = Modal.instances.at(-1) as DatePicker; expect(modal.initial).toBe('2099-01-01'); await modal.choose('2099-01-02'); expect(schedule).toHaveBeenCalledWith(task.id, '2099-01-02', undefined); modal.close();
    const recurrence = vi.spyOn(owner.service, 'recurrence').mockResolvedValue(); control('Recurring').toggle(); await flush(); expect(recurrence).toHaveBeenCalledWith(task.id, undefined);
  });
  it('discards stale async renders, displays empty references and resolves navigation paths freshly', async () => {
    const { view, owner, repo, add, files } = await fixture(); const task = await repo.create('Reference'); owner.selectedTaskId = task.id; view.tab = 'Task';
    await view.render(); expect(view.contentEl.textContent).toContain('No references found');
    const file: any = await add('Other.md', `- [ ] Reference <!--organized:${task.id}-->`); await owner.service.index(file); await view.render(); const link = button(view.contentEl, 'Other.md'); expect(link).toBeTruthy(); link.click(); await flush(); files.delete('Other.md'); link.click(); expect(Notice.instances.at(-1)?.message).toContain('renamed or removed');
    const read = vi.spyOn(repo, 'read'); let release!: (t: any) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const old = view.render(); view.tab = 'Calendar'; await view.render(); release(task); await old; expect(view.tab).toBe('Calendar'); expect(view.contentEl.textContent).not.toContain('References');
    const refs = vi.spyOn(owner.service, 'refs'); let resolve!: (paths: string[]) => void; refs.mockImplementationOnce(() => new Promise(r => { resolve = r; })); view.tab = 'Task'; const pending = view.render(); await flush(); view.tab = 'Calendar'; await view.render(); resolve([]); await pending; expect(view.tab).toBe('Calendar');
    const list = vi.spyOn(repo, 'list'); let done!: (tasks: any[]) => void; list.mockImplementationOnce(() => new Promise(r => { done = r; })); view.tab = 'Projects'; const browse = view.render(); view.tab = 'Calendar'; await view.render(); done([]); await browse; expect(view.tab).toBe('Calendar');
  });
});
