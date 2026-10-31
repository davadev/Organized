// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView, VIEW_TYPE } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice, Modal } from './__mocks__/obsidian';
import { localDate } from '../model';
import { DatePicker, TextModal } from '../modals';
import { parseTasks } from '../codec';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); });
async function fixture() {
  vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  return { ...h, repo: owner.repo, service: owner.service, owner, view };
}
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;
const choose = (view: OrganizedInspectorView, label: string, value: string) => { const select = view.contentEl.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; select.value = value; select.dispatchEvent(new Event('change')); };
const titles = (view: OrganizedInspectorView) => Array.from(view.contentEl.querySelectorAll('.organized-card-title')).map(el => el.textContent);
const card = (view: OrganizedInspectorView, title: string) => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(el => el.querySelector('.organized-list-title')?.textContent === title)!;
const openCard = (view: OrganizedInspectorView, title: string) => card(view, title).querySelector<HTMLButtonElement>('.organized-list-open')!;
const listed = (view: OrganizedInspectorView) => Array.from(view.contentEl.querySelectorAll('.organized-list-title')).map(el => el.textContent);
describe('compact calendar and contextual task inspector', () => {
  it('provides accessible compact month navigation, keyboard dates and explicit creation', async () => {
    const { owner, view, raw, repo } = await fixture(); expect(view.getViewType()).toBe(VIEW_TYPE); expect(view.getDisplayText()).toBe('Organized'); expect(view.getIcon()).toBe('calendar-check');
    await view.onOpen(); await flush(); expect(view.contentEl.querySelectorAll('.organized-calendar button')).toHaveLength(42); expect(raw.vault.create).not.toHaveBeenCalled(); expect(view.contentEl.textContent).toContain('Active');
    const month = view.month.format('YYYY-MM'); button(view.contentEl, 'Next month').click(); await flush(); expect(view.month.format('YYYY-MM')).not.toBe(month); button(view.contentEl, 'Previous month').click(); await flush(); expect(view.month.format('YYYY-MM')).toBe(month);
    const days = view.contentEl.querySelectorAll<HTMLButtonElement>('.organized-calendar button');
    for (const [key, index] of [['ArrowRight', 9], ['ArrowLeft', 7], ['ArrowDown', 15], ['ArrowUp', 1], ['Enter', 8]] as const) { days[8].focus(); days[8].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); expect(document.activeElement).toBe(days[index]); }
    button(view.contentEl, 'Today').click(); await flush(); expect(repo.file(owner.service.daily.path(localDate()))).toBeTruthy(); expect(view.selectedDate).toBe(localDate()); await view.render(); expect(view.contentEl.querySelector('.organized-has-note')).toBeTruthy();
    const select = vi.spyOn(view, 'selectDay').mockResolvedValue(); view.contentEl.querySelector<HTMLButtonElement>('.organized-calendar button')!.click(); await flush(); expect(select).toHaveBeenCalled();
    button(view.contentEl, 'Task').click(); await flush(); expect(view.contentEl.textContent).toContain('Place the cursor'); button(view.contentEl, 'Projects').click(); await flush(); expect(view.tab).toBe('Projects');
    await view.onClose(); await view.onClose(); expect(view.contentEl.childElementCount).toBe(0); expect((view as any).children).toHaveLength(0);
  });
  it('renders a small statistics strip and reports action/read errors', async () => {
    const { view, owner, repo, add } = await fixture(); const task = await repo.create('Running'); await repo.update(task.id, t => ({ ...t, time_tracking_started_at: new Date().toISOString() })); await add(owner.service.daily.path(localDate()), '- [x] Done'); await view.render(); await flush();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-stat strong')).map(el => el.textContent)).toEqual(['1', '1', '1']);
    vi.spyOn(repo, 'list').mockRejectedValueOnce(Error('read failed')); await view.render(); await flush(); expect(view.contentEl.textContent).toContain('unavailable');
    const host = createDiv(); view.button(host, 'Throws', () => { throw Error('sync'); }).click(); expect(Notice.instances.at(-1)?.message).toContain('sync'); view.button(host, 'Rejects', async () => { throw Error('async'); }).click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('async');
  });
  it('shows only the requested module on a fresh task; never exposes IDs or a settings form', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Test task'); owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Information';
    const refs = vi.spyOn(owner.service, 'refs'); const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await view.render(); expect(titles(view)).toEqual(['Information']); expect(view.contentEl.textContent).not.toContain(task.id); expect(view.contentEl.querySelector('.setting-item')).toBeNull(); expect(refs).not.toHaveBeenCalled(); expect(scroll).toHaveBeenCalledOnce();
    await view.render(); expect(scroll).toHaveBeenCalledOnce();
    const edit = vi.spyOn(owner, 'editModule').mockResolvedValue(); button(view.contentEl, 'Add information').click(); await flush(); expect(edit).toHaveBeenCalledWith(task.id, 'Information');
    const editor: any = document.body.createEl('textarea'); editor.focus(); owner.refresh(); await flush(); expect(document.activeElement).toBe(editor);
    const input = view.contentEl.createEl('input'); input.focus(); const first = view.contentEl.firstChild; await view.render(); expect(view.contentEl.firstChild).toBe(first); input.blur();
    choose(view, 'Add details', ''); await flush(); expect(titles(view)).toEqual([]);
    view.module = 'Unknown'; await view.render(); expect(titles(view)).toEqual([]);
  });
  it('keeps task context while sidebar scrolling/controls receive focus', async () => {
    const { owner, view, repo, add, setActive, clearActive } = await fixture(); const task = await repo.create('Keep me'); const file: any = await add('Test.md', `- [ ] Keep me <!--organized:${task.id}-->`); const editor = setActive(file); owner.followCursor(); view.tab = 'Task'; await view.render();
    clearActive(); owner.followCursor(); expect(owner.selectedTaskId).toBe(task.id); expect(owner.context?.file).toBe(file); await view.render(); expect(view.contentEl.textContent).toContain('Keep me'); expect(view.contentEl.textContent).not.toContain('Place the cursor'); expect(editor.setSelections).not.toHaveBeenCalled();
    const favorite = button(view.contentEl, 'Favorite'); favorite.focus(); favorite.click(); await flush(); expect((await repo.read(task.id)).starred).toBe(true); expect(owner.selectedTaskId).toBe(task.id);
    const change = vi.spyOn(owner.service, 'title').mockResolvedValue(); button(view.contentEl, 'Edit title').click(); const modal = Modal.instances.at(-1) as TextModal; await modal.save('Edited'); expect(change).toHaveBeenCalledWith(task.id, 'Edited'); modal.close();
    button(view.contentEl, 'Open task note').click(); await flush(); expect(owner.app.workspace.getLeaf).toHaveBeenCalled();
  });
  it('makes optional controls available on demand and persists only deliberate actions', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Actions'); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    choose(view, 'Status', ''); await flush(); expect((await repo.read(task.id)).status).toBe('open'); choose(view, 'Status', 'completed'); await flush(); expect((await repo.read(task.id)).status).toBe('completed');
    choose(view, 'Add details', 'Priority'); await flush(); choose(view, 'Priority', 'high'); await flush(); expect((await repo.read(task.id)).priority).toBe('high');
    choose(view, 'Add details', 'Schedule'); await flush(); button(view.contentEl, 'Choose date').click(); let modal = Modal.instances.at(-1) as DatePicker; const schedule = vi.spyOn(owner.service, 'scheduleTask').mockResolvedValue(); await modal.choose('2099-01-01'); expect(schedule).toHaveBeenCalledWith(task.id, '2099-01-01', undefined); modal.close();
    await repo.update(task.id, t => ({ ...t, scheduled: '2099-01-01' })); await view.render(); button(view.contentEl, '2099-01-01').click(); modal = Modal.instances.at(-1) as DatePicker; expect(modal.initial).toBe('2099-01-01'); modal.close();
    choose(view, 'Add details', 'Timer'); await flush(); button(view.contentEl, 'Start timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).not.toBeNull(); expect(view.contentEl.textContent).toContain('running'); button(view.contentEl, 'Stop timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull();
    choose(view, 'Add details', 'Recurring'); await flush(); button(view.contentEl, 'Recurring').click(); await flush(); expect((await repo.read(task.id)).recurring).toBe(true); expect(view.contentEl.textContent).toContain('→ active'); button(view.contentEl, 'Recurring').click(); await flush(); expect((await repo.read(task.id)).recurring).toBe(false);
    choose(view, 'Add details', 'Projects'); await flush(); const projects = vi.spyOn(owner, 'pickProjects').mockImplementation(() => undefined); button(view.contentEl, 'Link projects or topics').click(); expect(projects).toHaveBeenCalled();
    await repo.update(task.id, t => ({ ...t, projects: ['Project.md'], time_tracked_seconds: 60 })); view.module = ''; await view.render(); expect(view.contentEl.textContent).toContain('Project.md'); expect(titles(view)).toContain('Timer');
    owner.context = { file: {} as any, line: parseTasks(`- [ ] Actions <!--organized:${task.id}-->`)[0] }; const status = vi.spyOn(owner.service, 'status').mockResolvedValue(); choose(view, 'Status', 'open'); await flush(); expect(status).toHaveBeenCalledWith(task.id, 'open', owner.context);
    const recurrence = vi.spyOn(owner.service, 'recurrence').mockResolvedValue(); button(view.contentEl, 'Recurring').click(); await flush(); expect(recurrence).toHaveBeenCalledWith(task.id, owner.context);
  });
  it('renders existing rich modules without duplicates and collapses history/references', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Notes'); const file = repo.file(repo.taskPath(task.id))!; const before = await repo.readText(file);
    await repo.write(file, before, before + 'Loose notes\n## Information\nOnly information\n## Idea\nAn idea\n## Question\nA question\n## Sources\nhttps://example.com\n## Notes\nMore notes\n');
    await repo.update(task.id, t => ({ ...t, movement_history: [{ id: 'move', kind: 'forward', source: 'manual', from: '2026-01-01', to: '2026-01-02', at: '2026-01-01T00:00:00Z' }] })); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    expect(titles(view)).toEqual(['Information', 'Idea', 'Question', 'Sources', 'Notes']); expect(view.contentEl.textContent!.match(/Only information/g)).toHaveLength(1); expect(view.contentEl.textContent).toContain('Loose notes'); expect(view.contentEl.querySelector('details')!.open).toBe(false);
    const edit = vi.spyOn(owner, 'editModule').mockResolvedValue(); for (const name of ['information', 'idea', 'question', 'sources', 'notes']) button(view.contentEl, `Edit ${name}`).click(); await flush(); expect(edit).toHaveBeenCalledTimes(5);
    const refs = Array.from(view.contentEl.querySelectorAll('details')).at(-1)!; refs.open = true; refs.dispatchEvent(new Event('toggle')); await flush(); expect(view.contentEl.textContent).toContain('No references found'); refs.open = false; refs.dispatchEvent(new Event('toggle')); expect(view.referencesOpen).toBe(false);
  });
  it('sorts project/favorite browsing, restores cancellation and clears stale module selection', async () => {
    const { owner, view, repo } = await fixture(); const low = await repo.create('Low'); const high = await repo.create('High'); const canceled = await repo.create('Canceled'); const plain = await repo.create('Plain');
    await repo.update(plain.id, t => ({ ...t, projects: ['Project.md'] }));
    await repo.update(low.id, t => ({ ...t, priority: 'low', starred: true, projects: ['Project.md'] })); await repo.update(high.id, t => ({ ...t, priority: 'high', starred: true, projects: ['Project.md', 'Reading list.md', 'Extra.md'], scheduled: '2026-01-02' })); await repo.update(canceled.id, t => ({ ...t, status: 'canceled' }));
    view.tab = 'Projects'; await view.render();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-section-title')).map(el => el.textContent)).toEqual(['Favorites', 'Projects', 'Canceled']);
    expect(Array.from(view.contentEl.querySelectorAll('.organized-count')).map(el => el.textContent)).toEqual(['2', '3', '1']);
    expect(listed(view).indexOf('High')).toBeLessThan(listed(view).indexOf('Low'));
    expect(card(view, 'High').querySelector('.organized-list-priority')?.textContent).toBe('high');
    expect(card(view, 'High').querySelector('.organized-list-date')?.textContent).toBe('2026-01-02');
    expect(card(view, 'High').querySelectorAll('.organized-chip')).toHaveLength(3);
    expect(card(view, 'High').querySelectorAll('.organized-chip')[2].textContent).toBe('+1');
    const picker = view.contentEl.querySelector<HTMLSelectElement>('[aria-label="Choose project"]')!; picker.value = 'Project.md'; picker.dispatchEvent(new Event('change')); await flush(); expect(view.selectedProject).toBe('Project.md'); view.module = 'Information'; openCard(view, 'High').click(); await flush(); expect(owner.selectedTaskId).toBe(high.id); expect(view.module).toBe(''); expect(view.origin).toBe('Projects / favorites');
    button(view.contentEl, 'Back to projects').click(); await flush(); openCard(view, 'Canceled').click(); await flush(); expect(owner.selectedTaskId).toBe(canceled.id);
    view.tab = 'Projects'; await view.render(); button(view.contentEl, 'Restore').click(); await flush(); expect((await repo.read(canceled.id)).status).toBe('open');
    view.tab = 'Projects'; view.selectedProject = ''; await view.render(); openCard(view, 'Low').click(); await flush(); expect(owner.selectedTaskId).toBe(low.id);
    view.tab = 'Projects'; await view.render(); openCard(view, 'Plain').click(); await flush(); expect(owner.selectedTaskId).toBe(plain.id);
  });
  it('renders empty project sections and deletes the selected task after confirmation', async () => {
    const { owner, view, repo } = await fixture(); view.tab = 'Projects'; await view.render();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-empty')).map(el => el.textContent)).toEqual([
      'No favorites yet. Use [*] on a task or star it in the Task tab.',
      'No project links yet. Use [b] on a task to link its project or topic note.',
      'No canceled tasks.',
    ]);
    view.selectedProject = 'Missing.md'; await view.render(); expect(view.contentEl.textContent).toContain('No tasks linked to Missing.md.');
    view.selectedProject = ''; const task = await repo.create('Delete me'); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    expect(button(view.contentEl, 'Delete task')).toBeTruthy();
    const remove = vi.spyOn(owner, 'deleteTask').mockResolvedValue(); button(view.contentEl, 'Delete task').click(); await flush(); expect(remove).toHaveBeenCalledWith(task.id);
  });
  it('discards stale asynchronous task/project/reference results and re-resolves deleted links', async () => {
    const { owner, view, repo, add, files } = await fixture(); const task = await repo.create('Reference'); owner.selectedTaskId = task.id; view.tab = 'Task'; view.referencesOpen = true; await view.render(); expect(view.contentEl.textContent).toContain('No references found');
    const file: any = await add('Other.md', `- [ ] Reference <!--organized:${task.id}-->`); await owner.service.index(file); await view.render(); const link = button(view.contentEl, 'Other.md'); link.click(); await flush(); files.delete(file.path); link.click(); expect(Notice.instances.at(-1)?.message).toContain('renamed or removed');
    let done!: (value: any) => void; vi.spyOn(repo, 'read').mockImplementationOnce(() => new Promise(r => { done = r; })); const old = view.render(); view.tab = 'Calendar'; await view.render(); done(task); await old; expect(view.contentEl.textContent).not.toContain('References');
    vi.spyOn(repo, 'list').mockImplementationOnce(() => new Promise(r => { done = r; })); view.tab = 'Projects'; const browse = view.render(); view.tab = 'Calendar'; await view.render(); done([]); await browse; expect(view.tab).toBe('Calendar');
    vi.spyOn(owner.service, 'refs').mockImplementationOnce(() => new Promise(r => { done = r; })); view.tab = 'Task'; const pending = view.render(); await flush(); view.tab = 'Calendar'; await view.render(); done([]); await pending; expect(view.tab).toBe('Calendar');
    vi.spyOn(owner.service, 'refs').mockImplementationOnce(() => new Promise(r => { done = r; })); view.tab = 'Task'; const closed = view.render(); await flush(); view.contentEl.querySelector('details')!.open = false; done([]); await closed; expect(view.contentEl.textContent).not.toContain('No references found');
  });
});
