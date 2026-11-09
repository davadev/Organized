// @vitest-environment happy-dom
import { rgbOf, softTint } from '../colors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView, VIEW_TYPE } from '../view';
import { harness, sessionFields } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice, Modal } from './__mocks__/obsidian';
import { localDate } from '../model';
import { moment } from '../moment';
import { BudgetModal, ProjectBudgetModal, DatePicker, SessionModal, TaskPicker } from '../modals';
import { parseTasks } from '../codec';
import { DAILY } from '../recurrence';

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
     button(view.contentEl, 'Task').click(); await flush(); expect(view.contentEl.textContent).toContain('Open a Markdown note'); button(view.contentEl, 'Projects').click(); await flush(); expect(view.tab).toBe('Projects');
    await view.onClose(); await view.onClose(); expect(view.contentEl.childElementCount).toBe(0); expect((view as any).children).toHaveLength(0);
  });
  it('renders a small statistics strip and reports action/read errors', async () => {
    const { view, owner, repo, add } = await fixture(); const task = await repo.create('Running'); await repo.update(task.id, t => ({ ...t, time_tracking_started_at: new Date().toISOString() })); await add(owner.service.daily.path(localDate()), '- [x] Done'); await view.render(); await flush();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-stat strong')).map(el => el.textContent)).toEqual(['1', '1', '1']);
    vi.spyOn(repo, 'list').mockRejectedValueOnce(Error('read failed')); await view.render(); await flush(); expect(view.contentEl.textContent).toContain('unavailable');
    const host = createDiv(); view.button(host, 'Throws', () => { throw Error('sync'); }).click(); expect(Notice.instances.at(-1)?.message).toContain('sync'); view.button(host, 'Rejects', async () => { throw Error('async'); }).click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('async');
  });
  it('shows only the requested description on a fresh task and edits it inline without exposing IDs', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Test task'); owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Description';
    const refs = vi.spyOn(owner.service, 'refs'); const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await view.render(); expect(titles(view)).toEqual(['Description']); expect(view.contentEl.querySelector('.organized-task-details')?.contains(view.contentEl.querySelector('.organized-card'))).toBe(true); expect(button(view.contentEl, 'Add description').title).toContain('Add context, details or links.'); expect(view.contentEl.textContent).not.toContain(task.id); expect(view.contentEl.querySelector('.setting-item')).toBeNull(); expect(refs).not.toHaveBeenCalled(); expect(scroll).toHaveBeenCalledOnce();
    await view.render(); expect(scroll).toHaveBeenCalledOnce();
    button(view.contentEl, 'Add description').click(); await flush(); expect(view.editingModule).toBe('Description');
    const field = view.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!; expect(field).toBeTruthy();
    const save = vi.spyOn(owner, 'saveModule').mockResolvedValue(); expect(view.contentEl.querySelector('.organized-inline-actions')).toBeNull();
    field.value = 'Saved'; field.dispatchEvent(new Event('input')); field.value = 'Saved description'; field.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(799); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith(task.id, 'Description', 'Saved description'); expect(view.editingModule).toBe('Description');
    field.blur(); await flush(); expect(save).toHaveBeenCalledOnce(); expect(view.editingModule).toBe(''); expect(view.contentEl.querySelector('.organized-inline-editor')).toBeNull();
    await view.render(); button(view.contentEl, 'Add description').click(); await flush(); const typed = view.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!; typed.value = 'Flushed on blur'; typed.dispatchEvent(new Event('input'));
    typed.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); expect(view.editingModule).toBe('Description'); typed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush(); expect(save).toHaveBeenLastCalledWith(task.id, 'Description', 'Flushed on blur'); expect(view.editingModule).toBe('');
    await vi.advanceTimersByTimeAsync(1000); expect(save).toHaveBeenCalledTimes(2);
    choose(view, 'Add details', 'Sources'); await flush(); expect(view.module).toBe('Sources'); expect(view.editingModule).toBe('Sources'); expect(view.contentEl.querySelector('textarea[aria-label="Sources"]')).toBeTruthy(); expect(Array.from(view.contentEl.querySelectorAll<HTMLSelectElement>('select[aria-label="Add details"] option')).map(o => o.value)).not.toEqual(expect.arrayContaining(['Idea']));
    (document.activeElement as HTMLElement | null)?.blur(); choose(view, 'Add details', ''); await flush(); expect(titles(view)).toEqual(['Description']);
    view.module = 'Unknown'; await view.render(); expect(titles(view)).toEqual(['Description']);
    const editor: any = document.body.createEl('textarea'); editor.focus(); owner.refresh(); await flush(); expect(document.activeElement).toBe(editor);
    const input = view.contentEl.createEl('input'); input.focus(); const first = view.contentEl.firstChild; await view.render(); expect(view.contentEl.firstChild).toBe(first); input.blur();
  });
  it('keeps task context while sidebar scrolling/controls receive focus', async () => {
    const { owner, view, repo, add, setActive, clearActive } = await fixture(); const task = await repo.create('Keep me'); const file: any = await add('Test.md', `- [ ] Keep me <!--organized:${task.id}-->`); const editor = setActive(file); owner.followCursor(); view.tab = 'Task'; await view.render();
    clearActive(); owner.followCursor(); expect(owner.selectedTaskId).toBe(task.id); expect(owner.context?.file).toBe(file); await view.render(); expect(view.contentEl.textContent).toContain('Keep me'); expect(view.contentEl.textContent).not.toContain('Place the cursor'); expect(editor.setSelections).not.toHaveBeenCalled();
    const favorite = button(view.contentEl, 'Favorite'); favorite.focus(); favorite.click(); await flush(); expect((await repo.read(task.id)).starred).toBe(true); expect(owner.selectedTaskId).toBe(task.id);
    const change = vi.spyOn(owner.service, 'title').mockResolvedValue(); button(view.contentEl, 'Edit title').click(); await flush();
    const title = view.contentEl.querySelector<HTMLInputElement>('.organized-title-input')!; expect(document.activeElement).toBe(title); title.value = 'Edited'; button(view.contentEl, 'Save').click(); await flush(); expect(change).toHaveBeenCalledWith(task.id, 'Edited'); expect(view.editingTitle).toBe(false);
    await view.render(); button(view.contentEl, 'Edit title').click(); await flush(); button(view.contentEl, 'Cancel').click(); await flush(); expect(view.editingTitle).toBe(false); expect(view.contentEl.querySelector('.organized-title-input')).toBeNull();
    button(view.contentEl, 'Open task note').click(); await flush(); expect(owner.app.workspace.getLeaf).toHaveBeenCalled();
  });
  it('makes optional controls available on demand and persists only deliberate actions', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Actions'); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    choose(view, 'Status', ''); await flush(); expect((await repo.read(task.id)).status).toBe('open'); choose(view, 'Status', 'completed'); await flush(); expect((await repo.read(task.id)).status).toBe('completed');
    choose(view, 'Add details', 'Priority'); await flush(); choose(view, 'Priority', 'high'); await flush(); expect((await repo.read(task.id)).priority).toBe('high');
    choose(view, 'Add details', 'Schedule'); await flush(); button(view.contentEl, 'Choose date').click(); let modal = Modal.instances.at(-1) as DatePicker; const schedule = vi.spyOn(owner.service, 'scheduleTask').mockResolvedValue(); await modal.choose('2099-01-01'); expect(schedule).toHaveBeenCalledWith(task.id, '2099-01-01', undefined); modal.close(); expect(modal.clear).toBeUndefined();
    await repo.update(task.id, t => ({ ...t, scheduled: '2099-01-01' })); await view.render(); button(view.contentEl, '2099-01-01').click(); modal = Modal.instances.at(-1) as DatePicker; expect(modal.initial).toBe('2099-01-01'); const unschedule = vi.spyOn(owner.service, 'unschedule').mockResolvedValue(); await modal.clear!(); expect(unschedule).toHaveBeenCalledWith(task.id); modal.close();
    choose(view, 'Add details', 'Timer'); await flush(); button(view.contentEl, 'Start timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).not.toBeNull(); expect(view.contentEl.textContent).toContain('running'); button(view.contentEl, 'Stop timer').click(); await flush(); expect((await repo.read(task.id)).time_tracking_started_at).toBeNull();
    choose(view, 'Add details', 'Recurring'); await flush(); button(view.contentEl, 'Recurring').click(); await flush(); (Modal.instances.at(-1) as any).contentEl.querySelector('.organized-repeat-preset').click(); await flush(); expect((await repo.read(task.id)).recurring).toBe(true); expect(button(view.contentEl, 'Recurring').title).toContain('→ active'); expect(button(view.contentEl, 'Recurring').textContent).toBe('Every day'); button(view.contentEl, 'Recurring').click(); await flush(); (Array.from((Modal.instances.at(-1) as any).contentEl.querySelectorAll('button')).find((b: any) => b.textContent === 'Stop repeating') as HTMLElement).click(); await flush(); expect((await repo.read(task.id)).recurring).toBe(false);
    choose(view, 'Add details', 'Projects'); await flush(); const projects = vi.spyOn(owner, 'pickProjects').mockImplementation(() => undefined); button(view.contentEl, 'Link projects or topics').click(); expect(projects).toHaveBeenCalled();
    await repo.update(task.id, t => ({ ...t, projects: ['Project.md'], time_tracked_seconds: 60 })); view.module = ''; await view.render(); expect(button(view.contentEl, 'Link projects or topics')).toBeTruthy(); expect(view.contentEl.querySelector('.organized-prop-project .organized-prop-text')!.textContent).toBe('Project'); expect(titles(view)).toContain('Timer');
    owner.context = { file: {} as any, line: parseTasks(`- [ ] Actions <!--organized:${task.id}-->`)[0] }; const status = vi.spyOn(owner.service, 'status').mockResolvedValue(); choose(view, 'Status', 'open'); await flush(); expect(status).toHaveBeenCalledWith(task.id, 'open', owner.context);
    const recurrence = vi.spyOn(owner.service, 'recurrence').mockResolvedValue(); button(view.contentEl, 'Recurring').click(); await flush(); (Modal.instances.at(-1) as any).contentEl.querySelector('.organized-repeat-preset').click(); await flush(); expect(recurrence).toHaveBeenCalledWith(task.id, DAILY, owner.context);
  });
  it('renders existing rich modules without duplicates and collapses history/references', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Notes'); const file = repo.taskFile(task.id)!; const before = await repo.readText(file);
    await repo.write(file, before, before + 'Loose notes\n## Information\nOnly information\n## Idea\nAn idea\n## Question\nA question\n## Sources\nhttps://example.com\n## Notes\nMore notes\n');
    await repo.update(task.id, t => ({ ...t, movement_history: [{ id: 'move', kind: 'forward', source: 'manual', from: '2026-01-01', to: '2026-01-02', at: '2026-01-01T00:00:00Z' }] })); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    expect(titles(view)).toEqual(['Description', 'Sources']); expect(view.contentEl.textContent).toContain('More notes'); expect(view.contentEl.textContent).toContain('An idea'); expect(view.contentEl.textContent).toContain('A question'); expect(view.contentEl.textContent!.match(/Only information/g)).toHaveLength(1); expect(view.contentEl.textContent).toContain('Loose notes'); expect(view.contentEl.querySelector('details')!.open).toBe(false); expect(view.contentEl.querySelectorAll('.organized-move')).toHaveLength(1); expect(view.contentEl.querySelector('.organized-moves-summary')!.textContent).toBe('Moved 1 time');
    for (const [label, heading] of [['description', 'Description'], ['sources', 'Sources']]) { button(view.contentEl, `Edit ${label}`).click(); await flush(); const editor = view.contentEl.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${heading}"]`)!; expect(editor).toBeTruthy(); editor.blur(); await flush(); expect(view.editingModule).toBe(''); }
    const refs = Array.from(view.contentEl.querySelectorAll('details')).at(-1)!; refs.open = true; refs.dispatchEvent(new Event('toggle')); await flush(); expect(view.contentEl.textContent).toContain('No references found'); refs.open = false; refs.dispatchEvent(new Event('toggle')); expect(view.referencesOpen).toBe(false);
  });
  it('draws a slider instead of squares once a task moved more than thirty times', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Slipping'); const event = (kind: 'forward' | 'schedule', i: number) => ({ id: `m${i}`, kind, source: 'manual' as const, from: '2026-01-01', to: '2026-01-02', at: '2026-01-01T00:00:00Z' });
    await repo.update(task.id, t => ({ ...t, movement_history: [...Array.from({ length: 31 }, (_, i) => event('forward', i)), event('schedule', 99)] })); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render();
    await repo.update(task.id, t => ({ ...t, movement_history: [...t.movement_history.slice(0, 31), event('schedule', 98), event('forward', 97)] })); await view.render(); expect(view.contentEl.querySelector('.organized-moves-marker')!.classList.contains('is-deliberate')).toBe(false);
    await repo.update(task.id, t => ({ ...t, movement_history: [event('schedule', 1), event('forward', 2)] })); const first = view.render(); const second = view.render(); await Promise.all([first, second]);
    expect(view.contentEl.querySelectorAll('.organized-moves')).toHaveLength(1); expect(view.contentEl.querySelectorAll('.organized-move.is-deliberate')).toHaveLength(1); expect(view.contentEl.querySelector('.organized-moves-summary')!.textContent).toBe('Moved 2 times');
    await repo.update(task.id, t => ({ ...t, movement_history: [...Array.from({ length: 31 }, (_, i) => event('forward', i)), event('schedule', 99)] })); await view.render();
    expect(view.contentEl.querySelectorAll('.organized-move')).toHaveLength(0); expect(view.contentEl.querySelector('.organized-moves-summary')!.textContent).toBe('Moved 32 times');
    expect(view.contentEl.querySelector('.organized-moves-marker')!.classList.contains('is-deliberate')).toBe(true); expect(view.contentEl.querySelector('.organized-moves-slider')!.getAttribute('aria-label')).toContain('100%');
  });
  it('sorts project/favorite browsing, restores cancellation and clears stale module selection', async () => {
    const { owner, view, repo } = await fixture(); owner.settings.hideClosedProjects = false; const low = await repo.create('Low'); const high = await repo.create('High'); const canceled = await repo.create('Canceled'); const plain = await repo.create('Plain');
    await repo.update(plain.id, t => ({ ...t, projects: ['Project.md'] }));
    await repo.update(low.id, t => ({ ...t, priority: 'low', starred: true, projects: ['Project.md'] })); await repo.update(high.id, t => ({ ...t, priority: 'high', starred: true, projects: ['Project.md', 'Reading list.md', 'Extra.md'], scheduled: '2026-01-02' })); await repo.update(canceled.id, t => ({ ...t, status: 'canceled' }));
    view.tab = 'Projects'; await view.render();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-section-title')).map(el => el.textContent)).toEqual(['Projects', 'Canceled']);
    expect(Array.from(view.contentEl.querySelectorAll('.organized-count')).map(el => el.textContent)).toEqual(['3', '1']);
    expect(listed(view).indexOf('High')).toBeLessThan(listed(view).indexOf('Low'));
    expect(card(view, 'High').querySelector('.organized-list-priority')?.textContent).toBe('high');
    expect(card(view, 'High').querySelector('.organized-list-date')?.textContent).toBe('2026-01-02');
    expect(card(view, 'High').querySelectorAll('.organized-chip')).toHaveLength(3);
    expect(card(view, 'High').querySelectorAll('.organized-chip')[2].textContent).toBe('+1');
    const picker = view.contentEl.querySelector<HTMLSelectElement>('[aria-label="Choose project"]')!; picker.value = 'Project.md'; picker.dispatchEvent(new Event('change')); await flush(); expect(view.selectedProject).toBe('Project.md'); view.module = 'Description'; openCard(view, 'High').click(); await flush(); expect(owner.selectedTaskId).toBe(high.id); expect(view.module).toBe(''); expect(view.origin).toBe('Projects');
    button(view.contentEl, 'Back to projects').click(); await flush(); view.tab = 'Favorites'; await view.render(); await flush(); expect(Array.from(view.contentEl.querySelectorAll('.organized-section-title')).map(el => el.textContent)).toEqual(['Favorites']); expect(view.contentEl.querySelector('.organized-count')?.textContent).toBe('2'); expect(listed(view).indexOf('High')).toBeLessThan(listed(view).indexOf('Low'));
    openCard(view, 'Low').click(); await flush(); expect(view.origin).toBe('Favorites'); expect(view.contentEl.textContent).toContain('From favorites'); button(view.contentEl, 'Back to favorites').click(); await flush(); expect(view.tab).toBe('Favorites'); view.tab = 'Projects'; await view.render(); await flush(); openCard(view, 'High').click(); await flush();
    button(view.contentEl, 'Back to projects').click(); await flush(); openCard(view, 'Canceled').click(); await flush(); expect(owner.selectedTaskId).toBe(canceled.id);
    view.tab = 'Projects'; await view.render(); button(view.contentEl, 'Restore').click(); await flush(); expect((await repo.read(canceled.id)).status).toBe('open');
    view.tab = 'Projects'; view.selectedProject = ''; await view.render(); openCard(view, 'Low').click(); await flush(); expect(owner.selectedTaskId).toBe(low.id);
    view.tab = 'Projects'; await view.render(); openCard(view, 'Plain').click(); await flush(); expect(owner.selectedTaskId).toBe(plain.id);
  });
  it('renders task-title links as links and keeps card activation separate', async () => {
    const { owner, view, repo } = await fixture();
    const linked = await repo.create('Read [[Reading list]] and [web](https://example.com)');
    await repo.update(linked.id, task => ({ ...task, starred: true })); view.tab = 'Favorites'; await view.render(); await flush();
    const row = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(item => item.querySelector('.organized-list-title')?.textContent?.includes('Reading list'))!;
    const anchors = row.querySelectorAll('a');
    expect(anchors).toHaveLength(2); expect(anchors[0].getAttribute('href')).toBe('Reading list.md');
    expect(anchors[1].getAttribute('href')).toBe('https://example.com');
    anchors[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(owner.selectedTaskId).toBeNull();
    const open = row.querySelector<HTMLElement>('.organized-list-open')!;
    open.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush(); expect(owner.selectedTaskId).toBe(linked.id); owner.selectedTaskId = null;
    open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await flush();
    expect(owner.selectedTaskId).toBe(linked.id);
    owner.selectedTaskId = null; open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(owner.selectedTaskId).toBeNull();
    owner.selectedTaskId = null; open.createEl('a', { href: '#unhandled', text: 'unhandled' }).dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush(); expect(owner.selectedTaskId).toBeNull();
    const render = vi.spyOn(view, 'render').mockImplementation(() => { throw new Error('sync render failure'); });
    open.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(Notice.instances.at(-1)?.message).toContain('sync render failure'); render.mockRestore();
  });
  it('opens internal Markdown links from the task inspector using the task note as source', async () => {
    const { owner, view, repo } = await fixture();
    const linked = await repo.create('Review [[Recovery_plan]]'); owner.selectedTaskId = linked.id; view.tab = 'Task';
    const file = repo.taskFile(linked.id)!; const before = await repo.readText(file);
    await repo.write(file, before, `${before}\nSee also [[Recovery_plan]].\n`);
    const open = vi.fn(async () => undefined); (owner.app.workspace as any).openLinkText = open;
    await view.render(); await flush(); const anchor = view.contentEl.querySelector<HTMLAnchorElement>('.organized-task-title a')!;
    expect(anchor).toBeTruthy(); anchor.click(); await flush();
    expect(open).toHaveBeenCalledWith('Recovery_plan', repo.taskFile(linked.id)!.path);
    const noteAnchor = view.contentEl.querySelector<HTMLAnchorElement>('.organized-task-notes a')!;
    noteAnchor.click(); await flush(); expect(open).toHaveBeenLastCalledWith('Recovery_plan', repo.taskFile(linked.id)!.path);
  });
  it('lists current-note tasks without a task cursor and moves the editor cursor when one is selected', async () => {
    const { owner, view, repo, add, setActive, clearActive, files } = await fixture();
    const first = await repo.create('First linked'); const second = await repo.create('Second linked');
    const text = `Intro\n- [ ] First linked <!--organized:${first.id}-->\n- [ ] Plain todo\n- [ ] Second linked <!--organized:${second.id}-->\n- [ ] Orphan link <!--organized:missing123-->\n- [ ] `;
    const file: any = await add('Daily/Today.md', text); const editor = setActive(file);
    owner.context = null; owner.selectedTaskId = null; view.tab = 'Task'; await view.render(); await flush();
    expect(view.contentEl.querySelector('.organized-section-title')?.textContent).toBe('Today');
    expect(listed(view)).toEqual(['First linked', 'Plain todo', 'Second linked', 'Orphan link', 'Untitled todo']);
    const secondRow = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(row => row.textContent?.includes('Second linked'))!;
    secondRow.querySelector<HTMLElement>('.organized-list-open')!.click(); await flush();
    expect(editor.focus).toHaveBeenCalledOnce(); expect(editor.getCursor()).toEqual({ line: 3, ch: text.split('\n')[3].indexOf('] ') + 2 });
    expect(owner.selectedTaskId).toBe(second.id); expect(view.contentEl.querySelector('.organized-task-title')?.textContent).toContain('Second linked');

    owner.selectedTaskId = null; owner.context = null; clearActive(); owner.followCursor(); view.tab = 'Task'; await view.render(); await flush();
    expect(listed(view)).toEqual(['First linked', 'Plain todo', 'Second linked', 'Orphan link', 'Untitled todo']);
    const orphan = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(row => row.textContent?.includes('Orphan link'))!;
    expect(orphan.textContent).toContain('Linked task unavailable'); button(orphan, 'Repair/create task').click(); await flush(); expect(Modal.instances.at(-1)).toBeInstanceOf(TaskPicker); (Modal.instances.at(-1) as TaskPicker).close();
    const plain = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(row => row.textContent?.includes('Plain todo'))!;
    const plainOpen = plain.querySelector<HTMLElement>('.organized-list-open')!; plainOpen.click(); await flush(); expect(editor.getCursor().line).toBe(2);
    const currentPlain = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(row => row.textContent?.includes('Plain todo'))!;
    const currentOpen = currentPlain.querySelector<HTMLElement>('.organized-list-open')!;
    currentOpen.createEl('a', { href: '#note', text: 'note' }).click(); await flush(); expect(editor.getCursor().line).toBe(2);
    currentOpen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    currentOpen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await flush(); expect(editor.getCursor().line).toBe(2);
    const keyboardPlain = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-card')).find(row => row.textContent?.includes('Plain todo'))!;
    const anchor = keyboardPlain.querySelector<HTMLElement>('.organized-list-open')!.createEl('a', { href: '#note', text: 'note' }); anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button(keyboardPlain, 'Attach/create task').click(); await flush(); expect(editor.getCursor().line).toBe(2); expect(Modal.instances.at(-1)).toBeInstanceOf(TaskPicker);
    (Modal.instances.at(-1) as TaskPicker).close();
    files.delete(file.path); owner.selectedTaskId = null; view.tab = 'Task'; await view.render(); await flush();
    expect(view.contentEl.textContent).toContain('Open a Markdown note');
    const empty: any = await add('Empty.md'); setActive(empty); owner.selectedTaskId = null; await view.render(); await flush(); expect(view.contentEl.textContent).toContain('No tasks in this note yet.');
  });
  it('discards stale note-task list and task-record loads during rerender', async () => {
    const { owner, view, repo, add, setActive } = await fixture();
    const linked = await repo.create('Delayed task'); const file: any = await add('Delayed.md', `- [ ] Delayed task <!--organized:${linked.id}-->`);
    setActive(file); owner.selectedTaskId = null; view.tab = 'Task';
    let releaseLines!: (lines: any[]) => void;
    const lines = new Promise<any[]>(resolve => { releaseLines = resolve; });
    vi.spyOn(owner, 'taskLines').mockReturnValueOnce(lines);
    const staleLines = view.render(); await flush(); await view.render(); releaseLines(await owner.taskLines(file)); await staleLines;

    let releaseTask!: (task: any) => void; const read = vi.spyOn(repo, 'read');
    read.mockImplementationOnce(() => new Promise(resolve => { releaseTask = resolve; }));
    const staleTask = view.render(); await flush(); await view.render(); releaseTask(linked); await staleTask;

    const orphanFile: any = await add('Orphan.md', '- [ ] Missing <!--organized:missing123-->'); setActive(orphanFile);
    let rejectTask!: (error: Error) => void;
    read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectTask = reject; }));
    const staleFailure = view.render(); await flush(); await view.render(); rejectTask(Error('removed')); await staleFailure;
  });
  it('renders empty project sections and deletes the selected task after confirmation', async () => {
    const { owner, view, repo } = await fixture(); owner.settings.hideClosedProjects = false; view.tab = 'Favorites'; await view.render(); expect(view.contentEl.querySelector('.organized-empty')?.textContent).toBe('No favorites yet. Use [*] on a task or star it in the Task tab.'); view.tab = 'Projects'; await view.render();
    expect(Array.from(view.contentEl.querySelectorAll('.organized-empty')).map(el => el.textContent)).toEqual([
      'No project links yet. Use [j] on a task to link its project or topic note.',
      'No canceled tasks.',
    ]);
    view.selectedProject = 'Missing.md'; await view.render(); expect(view.contentEl.textContent).toContain('No tasks linked to Missing.');
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
  it('keeps projects listed after their last task is deleted and drops notes that no longer exist', async () => {
    const { owner, view, repo, add, files, texts } = await fixture(); await add('Project.md'); await add('Gone.md');
    const task = await repo.create('Only'); await repo.update(task.id, t => ({ ...t, projects: ['Project.md', 'Gone.md'] }));
    view.tab = 'Projects'; await view.render(); expect(owner.settings.knownProjects).toEqual(['Project.md', 'Gone.md']);
    const file = repo.taskFile(task.id)!; files.delete(file.path); texts.delete(file.path); files.delete('Gone.md');
    await view.render(); const picker = view.contentEl.querySelector<HTMLSelectElement>('#organized-project-filter')!;
    expect(Array.from(picker.options).map(o => o.value)).toEqual(['', 'Project.md']);
    expect(view.contentEl.textContent).toContain('No project links yet.'); owner.rememberProjects(['Project.md']); expect(owner.settings.knownProjects).toEqual(['Project.md', 'Gone.md']);
  });
  it('shows a recurring task as done today when today\'s occurrence is ticked, and targets only today when changed', async () => {
    const { owner, view, repo, service, add, texts, files } = await fixture(); const today = service.daily.path(localDate());
    const task = await repo.create('Daily habit'); await repo.update(task.id, t => ({ ...t, recurring: true, starred: true }));
    await view.render(); owner.selectedTaskId = task.id; view.tab = 'Favorites'; await view.render(); expect(view.contentEl.textContent).not.toContain('done · today');
    await add(today, `- [x] Daily habit <!--organized:${task.id}-->\n- [X] Other <!--organized:otherotherother-->`);
    await view.render(); const row = view.contentEl.querySelector('.organized-list-card')!; expect(row.querySelector('.organized-list-status')?.getAttribute('aria-label')).toBe('done · today'); expect(row.querySelector('.organized-list-status')?.textContent).toBe(''); expect(row.getAttribute('data-status')).toBe('completed'); expect(row.querySelector('.organized-status-dot')).toBeNull();
    view.tab = 'Task'; await view.render(); const status = view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!;
    expect(status.value).toBe('completed'); expect(Array.from(status.options).find(o => o.value === 'completed')?.text).toBe('done · today'); expect((await repo.read(task.id)).status).toBe('open');
    status.value = 'open'; status.dispatchEvent(new Event('change')); await flush(); expect(texts.get(today)).toContain(`- [ ] Daily habit <!--organized:${task.id}-->`);
    await view.render(); expect(view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!.value).toBe('open');
    const plain = await repo.create('Plain'); owner.selectedTaskId = plain.id; await view.render(); const plainStatus = view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!; expect(Array.from(plainStatus.options).map(o => o.text)).toContain('completed');
    texts.set(today, `- [ ] Habit <!--organized:${task.id}-->\n- [ ] Habit <!--organized:${task.id}-->`); owner.selectedTaskId = task.id; await view.render();
    const twice = view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!; twice.value = 'completed'; twice.dispatchEvent(new Event('change')); await flush(); expect(texts.get(today)).toContain('[ ] Habit');
    files.delete(today); texts.delete(today); await view.render(); expect(view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!.value).toBe('open');
    const noNote = view.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!; noNote.value = 'completed'; noNote.dispatchEvent(new Event('change')); await flush(); expect((await repo.read(task.id)).status).toBe('open');
  });
  it('groups current-note tasks under their headings, collapses them persistently and expands on demand', async () => {
    const { owner, view, setActive } = await fixture(); const { add } = { add: (path: string, text: string) => (owner.app.vault as any).create(path, text) };
    const text = '- [ ] Loose\n# Work\n- [ ] A\n## Deep\n- [ ] B\n# Home\n- [ ] C\n## Empty\n';
    const file: any = await add('Daily/Today.md', text); setActive(file); owner.context = null; owner.selectedTaskId = null; view.tab = 'Task'; await view.render(); await flush();
    const rows = () => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-heading-row, .organized-list-card')).map(el => el.classList.contains('organized-heading-row') ? `# ${el.querySelector('.organized-heading-text')!.textContent} (${el.querySelector('.organized-count')!.textContent}) ${el.getAttribute('aria-expanded')}` : el.querySelector('.organized-list-title')!.textContent);
    expect(rows()).toEqual(['Loose', '# Work (2) true', 'A', '# Deep (1) true', 'B', '# Home (1) true', 'C']);
    expect(view.contentEl.querySelectorAll<HTMLElement>('.organized-heading-row')[1].style.getPropertyValue('--organized-depth')).toBe('1');
    const click = (name: string) => { Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-heading-row')).find(el => el.querySelector('.organized-heading-text')!.textContent === name)!.click(); return flush(); };
    await click('Work'); expect(rows()).toEqual(['Loose', '# Work (2) false', '# Home (1) true', 'C']); expect(owner.settings.collapsedHeadings['Daily/Today.md']).toHaveLength(1);
    await view.render(); expect(rows()).toEqual(['Loose', '# Work (2) false', '# Home (1) true', 'C']);
    await click('Home'); expect(rows()).toEqual(['Loose', '# Work (2) false', '# Home (1) false']); expect(owner.settings.collapsedHeadings['Daily/Today.md']).toHaveLength(2);
    await click('Work'); expect(rows()).toEqual(['Loose', '# Work (2) true', 'A', '# Deep (1) true', 'B', '# Home (1) false']); expect(owner.settings.collapsedHeadings['Daily/Today.md']).toHaveLength(1);
    await click('Deep'); expect(rows()).toEqual(['Loose', '# Work (2) true', 'A', '# Deep (1) false', '# Home (1) false']);
    await click('Home'); await click('Deep'); expect(owner.settings.collapsedHeadings).toEqual({});
    const blank: any = await add('Blank.md', '#\n- [ ] Z'); setActive(blank); await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-heading-text')?.textContent).toBe('Untitled heading');
  });
  it('returns from a task to the note overview by moving the cursor off task lines', async () => {
    const { owner, view, repo, add, setActive, clearActive, files } = await fixture(); const task = await repo.create('Linked');
    const tasksOnly: any = await add('Tasks.md', `- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other`);
    const back = () => view.contentEl.querySelector<HTMLElement>('.organized-note-overview')!;
    const open = async (file: any, text: string, line: number) => { const editor = setActive(file, text); editor.setCursor({ line, ch: 0 }); owner.followCursor(); await view.render(); await flush(); return editor; };
    view.tab = 'Task';
    const withHeading: any = await add('Daily/Day.md', `Intro\n# Work\n\n- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other`);
    let editor = await open(withHeading, `Intro\n# Work\n\n- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other`, 3);
    expect(owner.selectedTaskId).toBe(task.id); expect(view.contentEl.querySelector('.organized-task-title')).toBeTruthy(); expect(back().getAttribute('aria-label')).toBe('All tasks in this note');
    back().click(); await flush(); expect(editor.getCursor().line).toBe(1); expect(owner.selectedTaskId).toBeNull(); expect(view.contentEl.querySelector('.organized-task-title')).toBeNull(); expect(view.contentEl.querySelector('.organized-heading-row')).toBeTruthy();
    const noHeading: any = await add('Prose.md', `Prose\n\n- [ ] Linked <!--organized:${task.id}-->`);
    editor = await open(noHeading, `Prose\n\n- [ ] Linked <!--organized:${task.id}-->`, 2); back().click(); await flush(); expect(editor.getCursor().line).toBe(1); expect(owner.selectedTaskId).toBeNull();
    const below: any = await add('Below.md', `- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other\n\nEnd`);
    editor = await open(below, `- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other\n\nEnd`, 0); back().click(); await flush(); expect(editor.getCursor().line).toBe(2); expect(owner.selectedTaskId).toBeNull();
    editor = await open(tasksOnly, `- [ ] Linked <!--organized:${task.id}-->\n- [ ] Other`, 0); back().click(); await flush(); expect(editor.getCursor().line).toBe(0); expect(owner.selectedTaskId).toBeNull();
    files.delete(tasksOnly.path); clearActive(); owner.selectedTaskId = task.id; await view.render(); back().click(); await flush(); expect(owner.selectedTaskId).toBeNull();
    owner.selectedTaskId = task.id; view.origin = 'Projects / favorites'; await view.render(); expect(view.contentEl.querySelector('.organized-note-overview')).toBeNull();
  });
  it('shows project notes in the project folder by name', async () => {
    const { view, repo, add } = await fixture(); const folder = repo.projectFolder(); await add(`${folder}/Plan.md`);
    const task = await repo.create('Planned'); await repo.update(task.id, t => ({ ...t, projects: [`${folder}/Plan.md`, 'Elsewhere/Notes.md'] }));
    view.tab = 'Projects'; await view.render(); expect(Array.from(view.contentEl.querySelectorAll('.organized-chip')).map(c => c.textContent)).toEqual(['Plan', 'Elsewhere/Notes']);
    expect(Array.from(view.contentEl.querySelectorAll<HTMLOptionElement>('#organized-project-filter option')).map(o => o.text)).toContain('Plan');
  });
  it('marks task cards and the task header with their status for colouring', async () => {
    const { owner, view, repo } = await fixture(); owner.settings.hideClosedProjects = false; const open = await repo.create('Open one'); const active = await repo.create('Active one'); const done = await repo.create('Done one'); const canceled = await repo.create('Canceled one');
    for (const [task, status] of [[open, 'open'], [active, 'in_progress'], [done, 'completed'], [canceled, 'canceled']] as const) await repo.update(task.id, t => ({ ...t, status, starred: true }));
    view.tab = 'Favorites'; await view.render(); const statuses = () => Array.from(view.contentEl.querySelectorAll('.organized-list-card')).map(card => card.getAttribute('data-status'));
    expect(statuses().sort()).toEqual(['completed', 'in_progress', 'open']); view.tab = 'Projects'; await view.render(); expect(statuses()).toEqual(['canceled']);
    for (const [task, status] of [[done, 'completed'], [active, 'in_progress']] as const) { owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); expect(view.contentEl.querySelector('.organized-task-hero')?.getAttribute('data-status')).toBe(status); expect(view.contentEl.querySelector('.organized-status-dot')).toBeNull(); expect(view.contentEl.querySelector('.organized-status-icon')?.getAttribute('data-status')).toBe(status); expect(view.contentEl.querySelectorAll('.organized-eyebrow button').length).toBe(1); }
  });
  it('shows the Calendar, Task, Projects and Favorites tabs as labelled icon buttons', async () => {
    const { view } = await fixture(); await view.render();
    const tabs = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-tabs button'));
    expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Calendar', 'Task', 'Projects', 'Favorites']); expect(tabs.map(tab => tab.title)).toEqual(['Calendar', 'Task', 'Projects', 'Favorites']); expect(tabs.every(tab => tab.textContent === '')).toBe(true); expect(tabs.map(tab => tab.getAttribute('data-icon'))).toEqual(['calendar', 'list-checks', 'folder', 'star']);
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']); tabs[3].click(); await flush(); expect(view.tab).toBe('Favorites'); tabs[2].click(); await flush(); expect(view.tab).toBe('Projects'); expect(view.contentEl.querySelector('.organized-tabs button[aria-selected="true"]')?.getAttribute('aria-label')).toBe('Projects');
  });
  it('switches the calendar between month, week and day and keeps month behaviour', async () => {
    const { view } = await fixture(); await view.render();
    const modes = () => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-seg-button'));
    expect(modes().map(b => b.textContent)).toEqual(['Month', 'Week', 'Day']); expect(modes().map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']); expect(view.contentEl.querySelector('.organized-calendar')).toBeTruthy(); expect(view.contentEl.querySelector('.organized-stats')).toBeTruthy();
    modes()[1].click(); await flush(); expect(view.calendarMode).toBe('Week'); expect(view.contentEl.querySelector('.organized-calendar')).toBeNull(); expect(view.contentEl.querySelectorAll('.organized-week-row')).toHaveLength(7);
    modes()[2].click(); await flush(); expect(view.calendarMode).toBe('Day'); expect(view.contentEl.querySelector('.organized-week')).toBeNull(); modes()[0].click(); await flush(); expect(view.contentEl.querySelector('.organized-calendar')).toBeTruthy();
  });
  it('shows the week as day rows with task counts and in-progress blocks and opens a day from a row', async () => {
    const { owner, view, repo, add, service } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0));
    const task = await repo.create('Deep work'); const finished = await repo.create('Report');
    await repo.update(task.id, t => ({ ...t, work_sessions: [{ start: new Date(2026, 2, 3, 9, 0).toISOString(), end: new Date(2026, 2, 3, 11, 30).toISOString() }, { start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() }], time_tracking_started_at: new Date(2026, 2, 4, 14, 0).toISOString(), status: 'in_progress' }));
    await repo.update(finished.id, t => ({ ...t, status: 'completed', work_sessions: [{ start: new Date(2026, 2, 3, 20, 0).toISOString(), end: new Date(2026, 2, 3, 21, 0).toISOString() }] }));
    await add(service.daily.path('2026-03-03'), `- [x] A <!--organized:${finished.id}-->\n- [ ] B\n- [/] C <!--organized:${task.id}-->`);
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Week'; await view.render();
    const rows = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-week-row')); expect(rows).toHaveLength(7);
    expect(rows.map(row => row.querySelector('.organized-week-weekday')!.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']); expect(view.contentEl.querySelector('h3')!.textContent).toBe('Mar 1 – Mar 7, 2026');
    expect(rows[2].querySelector('.organized-week-count')!.textContent).toBe('1/3'); expect(rows[1].querySelector('.organized-week-count')!.textContent).toBe('–');
    expect(rows[2].querySelectorAll('.organized-week-block')).toHaveLength(2); expect(rows[3].querySelectorAll('.organized-week-block')).toHaveLength(2); expect(rows[3].getAttribute('aria-pressed')).toBe('true'); expect(rows[2].querySelector('.organized-week-block[data-status="completed"]')).toBeTruthy();
    const running = rows[3].querySelectorAll<HTMLElement>('.organized-week-block')[1]; expect(Number(running.style.getPropertyValue('--organized-width'))).toBeGreaterThan(0); expect(rows[3].getAttribute('aria-label')).toContain('2 tracked blocks');
    rows[4].click(); await flush(); expect(view.calendarMode).toBe('Day'); expect(view.selectedDate).toBe('2026-03-05');
    view.calendarMode = 'Week'; await view.render(); button(view.contentEl, 'Next week').click(); await flush(); expect(view.selectedDate).toBe('2026-03-12'); button(view.contentEl, 'Previous week').click(); await flush(); button(view.contentEl, 'Previous week').click(); await flush(); expect(view.selectedDate).toBe('2026-02-26');
    button(view.contentEl, 'Today').click(); await flush(); expect(view.selectedDate).toBe(localDate()); expect(owner.settings).toBeTruthy();
  });
  it('shows the day tasks on top and time blocks on an hour grid, and opens a task from either', async () => {
    const { owner, view, repo, add, service } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 30, 0));
    const a = await repo.create('Write plan'); const b = await repo.create('Review plan'); const c = await repo.create('Night shift');
    await repo.update(a.id, t => ({ ...t, status: 'completed', work_sessions: [{ start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 30).toISOString() }] }));
    await repo.update(b.id, t => ({ ...t, status: 'in_progress', work_sessions: [{ start: new Date(2026, 2, 4, 10, 0).toISOString(), end: new Date(2026, 2, 4, 10, 20).toISOString() }], time_tracking_started_at: new Date(2026, 2, 4, 15, 0).toISOString() }));
    await repo.update(c.id, t => ({ ...t, work_sessions: [{ start: new Date(2026, 2, 3, 23, 0).toISOString(), end: new Date(2026, 2, 4, 6, 30).toISOString() }] }));
    await add(service.daily.path('2026-03-04'), `# Work\n- [x] A <!--organized:${a.id}-->\n- [/] B <!--organized:${b.id}-->\n- [ ] Plain\n- [-] Dropped\n- [x] Done plain`);
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render();
    expect(view.contentEl.querySelector('h3')!.textContent).toBe('Wed, Mar 4, 2026');
    const cards = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-day-task')); expect(cards.map(card => card.getAttribute('data-status'))).toEqual(['completed', 'in_progress', 'open', 'canceled', 'completed']); expect(cards[2].textContent).toContain('Regular todo'); expect(cards[4].textContent).toContain('Done');
    const blocks = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block')); expect(blocks.map(block => block.querySelector('.organized-block-title')!.textContent)).toEqual(['Night shift', 'Write plan', 'Review plan', 'Review plan']);
    expect(blocks[0].getAttribute('aria-label')).toBe('Night shift, 00:00–06:30'); expect(blocks[1].getAttribute('aria-label')).toBe('Write plan, 09:00–10:30'); expect(blocks[3].getAttribute('aria-label')).toBe('Review plan, 15:00–15:30, running'); expect(blocks[2].querySelector('.organized-block-time')).toBeNull(); expect(blocks[1].querySelector('.organized-block-time')!.textContent).toBe('09:00–10:30');
    expect(blocks[1].getAttribute('data-status')).toBe('completed'); expect([blocks[1], blocks[2]].map(block => block.style.getPropertyValue('--organized-lanes'))).toEqual(['2', '2']);
    const labels = Array.from(view.contentEl.querySelectorAll('.organized-hour-label')).map(l => l.textContent); expect(labels[0]).toBe('00:00'); expect(labels.at(-1)).toBe('18:00'); expect(view.contentEl.querySelector('.organized-now-line')).toBeTruthy();
    blocks[1].click(); await flush(); const sessionModal = Modal.instances.at(-1) as unknown as SessionModal; expect(sessionModal.titleEl.textContent).toBe('Edit time worked'); Array.from(sessionModal.contentEl.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'Open task')!.click(); await flush(); expect(owner.selectedTaskId).toBe(a.id); expect(view.tab).toBe('Task'); expect(view.origin).toBe('Calendar'); expect(view.contentEl.textContent).toContain('From calendar');
    button(view.contentEl, 'Back to calendar').click(); await flush(); expect(view.tab).toBe('Calendar'); expect(view.contentEl.querySelector('.organized-day-grid')).toBeTruthy();
    view.contentEl.querySelectorAll<HTMLElement>('.organized-day-task .organized-list-open')[0].click(); await flush(); expect(owner.selectedTaskId).toBe(a.id); view.origin = 'Projects / favorites'; await view.render(); button(view.contentEl, 'Back to projects').click(); await flush(); expect(view.tab).toBe('Projects');
  });
  it('shows a now line on today, navigates days and offers to create a missing daily note without creating it while browsing', async () => {
    const { view, repo, files, service } = await fixture(); const now = new Date(); vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
    const task = await repo.create('Midday'); await repo.update(task.id, t => ({ ...t, status: 'in_progress', time_tracking_started_at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString() }));
    view.selectedDate = localDate(); view.calendarMode = 'Day'; await view.render();
    expect(view.contentEl.querySelector('.organized-now-line')).toBeTruthy(); expect(view.contentEl.textContent).toContain('There is no daily note for this day yet.'); expect(files.has(service.daily.path(localDate()))).toBe(false);
    const next = moment(localDate(), 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD'); button(view.contentEl, 'Next day').click(); await flush(); expect(view.selectedDate).toBe(next); expect(view.contentEl.textContent).toContain('No time tracked or planned this day.'); expect(view.contentEl.querySelector('.organized-day-grid')).toBeTruthy();
    button(view.contentEl, 'Previous day').click(); await flush(); expect(view.selectedDate).toBe(localDate()); button(view.contentEl, 'Next day').click(); await flush(); button(view.contentEl, 'Today').click(); await flush(); expect(view.selectedDate).toBe(localDate());
    const create = vi.spyOn(view, 'selectDay').mockResolvedValue(); button(view.contentEl, 'Create daily note').click(); await flush(); expect(create).toHaveBeenCalledWith(localDate()); expect(files.has(service.daily.path(localDate()))).toBe(false);
  });
  it('covers day edge cases: empty notes, plain in-progress lines, midnight ends, a now line outside the grid and stale renders', async () => {
    const { view, repo, add, service } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 22, 0, 0));
    const task = await repo.create('Night'); await repo.update(task.id, t => ({ ...t, work_sessions: [{ start: new Date(2026, 2, 3, 23, 0).toISOString(), end: new Date(2026, 2, 4, 1, 0).toISOString() }, { start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() }] }));
    await add(service.daily.path('2026-03-03'), ''); view.calendarMode = 'Day'; view.selectedDate = '2026-03-03'; await view.render();
    expect(view.contentEl.textContent).toContain("No tasks in this day's note."); expect(view.contentEl.querySelector('.organized-block')!.getAttribute('aria-label')).toBe('Night, 23:00–24:00');
    await add(service.daily.path('2026-03-04'), '- [/] Plain doing\n- [ ] '); view.selectedDate = '2026-03-04'; await view.render();
    const cards = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-day-task')); expect(cards.map(card => card.getAttribute('data-status'))).toEqual(['in_progress', 'open']); expect(cards[1].textContent).toContain('Untitled todo');
    expect(view.contentEl.querySelector('.organized-now-line')).toBeNull();
    let release!: (tasks: any[]) => void; const list = vi.spyOn(repo, 'list'); list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const staleDay = view.render(); view.calendarMode = 'Month'; await view.render(); release([]); await staleDay; expect(view.contentEl.querySelector('.organized-day-grid')).toBeNull(); expect(view.contentEl.querySelector('.organized-calendar')).toBeTruthy();
    list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); view.calendarMode = 'Week'; const staleWeek = view.render(); view.calendarMode = 'Month'; await view.render(); release([]); await staleWeek; expect(view.contentEl.querySelector('.organized-week')).toBeNull();
  });
  it('folds the day task list away, remembers it, and still offers to create a missing note', async () => {
    const { owner, view, repo, add, service } = await fixture(); const task = await repo.create('Linked');
    await add(service.daily.path('2026-03-04'), `- [ ] Linked <!--organized:${task.id}-->\n- [ ] Plain\n- [x] Done`); view.calendarMode = 'Day'; view.selectedDate = '2026-03-04'; await view.render();
    const head = () => view.contentEl.querySelector<HTMLElement>('.organized-section-fold')!; const rows = () => view.contentEl.querySelectorAll('.organized-day-task').length;
    expect(rows()).toBe(3); expect(head().getAttribute('aria-expanded')).toBe('true'); expect(head().querySelector('.organized-count')!.textContent).toBe('3'); expect(owner.settings.dayTasksCollapsed).toBe(false);
    head().click(); await flush(); expect(owner.settings.dayTasksCollapsed).toBe(true); expect(rows()).toBe(0); expect(head().getAttribute('aria-expanded')).toBe('false'); expect(head().querySelector('.organized-count')!.textContent).toBe('3');
    await view.render(); expect(rows()).toBe(0); expect(view.contentEl.querySelector('.organized-day-grid') === null).toBe(false);
    await add(service.daily.path('2026-03-05'), ''); view.selectedDate = '2026-03-05'; await view.render(); expect(view.contentEl.textContent).not.toContain("No tasks in this day's note.");
    view.selectedDate = '2026-03-06'; await view.render(); expect(view.contentEl.textContent).toContain('There is no daily note for this day yet.'); expect(button(view.contentEl, 'Create daily note')).toBeTruthy();
    head().click(); await flush(); expect(owner.settings.dayTasksCollapsed).toBe(false); view.selectedDate = '2026-03-04'; await view.render(); expect(rows()).toBe(3);
    view.selectedDate = '2026-03-05'; await view.render(); expect(view.contentEl.textContent).toContain("No tasks in this day's note.");
  });
  it('shows one status icon per card, with the word only as a label', async () => {
    const { view, repo, owner } = await fixture(); owner.settings.hideClosedProjects = false; const statuses = ['open', 'in_progress', 'completed', 'canceled'] as const;
    for (const status of statuses) { const task = await repo.create(`Is ${status}`); await repo.update(task.id, t => ({ ...t, status, projects: ['P.md'] })); }
    const starred = await repo.create('Starred'); await repo.update(starred.id, t => ({ ...t, starred: true, priority: 'high', projects: ['P.md'] }));
    const dated = await repo.create('Dated'); await repo.update(dated.id, t => ({ ...t, scheduled: '2026-03-09', projects: ['P.md'] })); const hidden = await repo.create('Hidden date'); await repo.update(hidden.id, t => ({ ...t, scheduled: '2026-03-09', projects: ['P.md'] }));
    const fav = await repo.create('Only star'); await repo.update(fav.id, t => ({ ...t, starred: true, projects: ['P.md'] }));
    view.tab = 'Projects'; view.selectedProject = 'P.md'; await view.render(); await flush(); expect(card(view, 'Dated').querySelector('.organized-list-date')?.textContent).toBe('2026-03-09'); expect(card(view, 'Only star').querySelector('.organized-list-star')).toBeTruthy();
    owner.settings.showScheduledDate = false; await view.render(); await flush(); expect(card(view, 'Hidden date').querySelector('.organized-list-meta')).toBeNull(); owner.settings.showScheduledDate = true; await view.render(); await flush();
    const icons = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-list-status')); expect(icons.map(icon => icon.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['open', 'in progress', 'completed', 'canceled']));
    for (const icon of icons) { expect(icon.textContent).toBe(''); expect(icon.getAttribute('role')).toBe('img'); expect(icon.getAttribute('title')).toBe(icon.getAttribute('aria-label')); }
    expect(view.contentEl.querySelector('.organized-list-meta')?.textContent).toContain('high'); expect(card(view, 'Is open').querySelector('.organized-list-meta')).toBeNull();
  });
  it('draws time kept in daily notes by retired tasks and opens that note from the block', async () => {
    const { view, add, service, files, h: _h } = await fixture() as any; vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0));
    const note: any = await add(service.daily.path('2026-03-05'), '- [x] Retired plan\n  - Worked 2026-03-04: 09:00–10:00 (1h)\n');
    const open = vi.fn(async () => undefined); (view.app.workspace.getLeaf as any).mockReturnValue({ openFile: open });
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); const block = view.contentEl.querySelector('.organized-block') as HTMLElement; expect(block.getAttribute('aria-label')).toBe('Retired plan, 09:00–10:00');
    block.click(); await flush(); expect(open).toHaveBeenCalledWith(note);
    view.calendarMode = 'Week'; await view.render(); expect(view.contentEl.querySelectorAll('.organized-week-block')).toHaveLength(1); view.calendarMode = 'Day'; await view.render();
    files.delete(note.path); (view.contentEl.querySelector('.organized-block') as HTMLElement).click(); await flush(); expect(open).toHaveBeenCalledTimes(1);
  });
  it('opens the standalone note from the block of a task that was converted after tracking time', async () => {
    const { view, repo, add } = await fixture() as any; vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0));
    const note: any = await add('Notes/Plan.md', 'body'); const task = await repo.create('Converted plan');
    await repo.update(task.id, (t: any) => ({ ...t, converted_to: note.path, work_sessions: [{ start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() }] }));
    const open = vi.fn(async () => undefined); (view.app.workspace.getLeaf as any).mockReturnValue({ openFile: open });
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); const block = Array.from(view.contentEl.querySelectorAll('.organized-block')).find((b: any) => b.getAttribute('aria-label').startsWith('Converted plan')) as HTMLElement;
    block.click(); await flush(); expect(open).not.toHaveBeenCalled(); const openTask = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open task') as HTMLButtonElement; openTask.click(); await flush(); expect(open).toHaveBeenCalledWith(note);
    expect(view.tab).toBe('Calendar');
  });
  it('reorders the note list when the priority is changed in the side panel', async () => {
    const { view, repo, add, owner } = await fixture(); const low = await repo.create('Low one'); const target = await repo.create('Target');
    await repo.update(low.id, t => ({ ...t, priority: 'low' })); const note: any = await add('Daily/2026-03-04.md', `- [ ] Low one <!--organized:${low.id}-->\n- [ ] Target <!--organized:${target.id}-->`);
    owner.selectedTaskId = target.id; view.tab = 'Task'; await view.render(); choose(view, 'Add details', 'Priority'); await flush(); choose(view, 'Priority', 'high'); for (let i = 0; i < 8; i++) await flush();
    expect((await repo.read(target.id)).priority).toBe('high'); expect((await owner.repo.readText(note)).split('\n')[0]).toContain('Target');
    const { parseTasks } = await import('../codec'); const text = await owner.repo.readText(note); owner.context = { file: note, line: parseTasks(text).find(t => t.id === target.id)! } as any; choose(view, 'Priority', 'low'); for (let i = 0; i < 8; i++) await flush(); expect((await repo.read(target.id)).priority).toBe('low'); expect((await owner.repo.readText(note)).split('\n')[0]).toContain('Target');
  });
  it('fills cards and calendar blocks with the project colour, gray without one, and sets colours from the Projects tab', async () => {
    const { view, repo, add, owner, service } = await fixture(); owner.settings.hideClosedProjects = false; vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0)); const folder = repo.projectFolder();
    const blue: any = await add(`${folder}/Blue.md`, '---\norganized_type: project\norganized_color: "#3b82f6"\n---\n'); await add(`${folder}/Plain.md`, '---\norganized_type: project\n---\n');
    const tinted = await repo.create('Blue task'); const gray = await repo.create('Gray task'); const session = [{ start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() }];
    await repo.update(tinted.id, t => ({ ...t, projects: [blue.path], status: 'completed', work_sessions: session })); await repo.update(gray.id, t => ({ ...t, projects: [`${folder}/Plain.md`], work_sessions: session }));
    owner.rememberProjects([blue.path, `${folder}/Plain.md`]);
    view.tab = 'Projects'; await view.render(); await flush();
    for (let n = 0; n < 6; n++) await flush();
    const blueCard = card(view, 'Blue task'); expect(blueCard.hasAttribute('data-project')).toBe(false); expect(blueCard.getAttribute('data-status')).toBe('completed');
    const blueChip = blueCard.querySelector<HTMLElement>('.organized-chip')!; expect(blueChip.textContent).toBe('Blue'); expect(blueChip.hasAttribute('data-project')).toBe(true); expect(blueChip.style.getPropertyValue('--organized-chip-bg')).toBe(rgbOf('#3b82f6'));
    expect(card(view, 'Gray task').querySelector('.organized-chip')!.hasAttribute('data-project')).toBe(false);
    const rows = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-color-row')); expect(rows.map(row => row.querySelector('.organized-color-name')!.textContent)).toEqual(['Blue', 'Plain']);
    const inputs = rows.map(row => row.querySelector<HTMLInputElement>('input[type=color]')!); expect(inputs.map(input => input.value)).toEqual(['#3b82f6', '#808080']); expect(rows[0].querySelector('.organized-color-clear')).toBeTruthy(); expect(rows[1].querySelector('.organized-color-clear')).toBeNull();
    const swatches = rows.map(row => row.querySelector<HTMLElement>('.organized-color-swatch')!); expect(swatches.map(swatch => swatch.style.getPropertyValue('--organized-swatch'))).toEqual(['#3b82f6', '#808080']); expect(inputs.every((input, n) => input.parentElement === swatches[n])).toBe(true);
    inputs[1].value = '#22c55e'; inputs[1].dispatchEvent(new Event('input')); expect(swatches[1].style.getPropertyValue('--organized-swatch')).toBe('#22c55e'); inputs[1].dispatchEvent(new Event('change')); for (let n = 0; n < 6; n++) await flush(); expect(repo.projectColor(`${folder}/Plain.md`)).toBe('#22c55e');
    (rows[0].querySelector('.organized-color-clear') as HTMLElement).click(); for (let n = 0; n < 6; n++) await flush(); expect(repo.projectColor(blue.path)).toBeNull();
    await repo.update(tinted.id, t => ({ ...t, status: 'completed' })); await service.setProjectColor(blue.path, '#ef4444');
    view.tab = 'Calendar'; view.calendarMode = 'Day'; view.selectedDate = '2026-03-04'; await view.render(); const blocks = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block'));
    expect(blocks.map(b => [b.querySelector('.organized-block-title')!.textContent, b.style.getPropertyValue('--organized-project-rgb'), b.getAttribute('data-status')]).sort()).toEqual([['Blue task', softTint('#ef4444'), 'completed'], ['Gray task', softTint('#22c55e'), 'open']].sort());
    expect(blocks.map(b => b.querySelector('.organized-block-status')?.getAttribute('data-status')).sort()).toEqual(['completed', 'open']);
    view.calendarMode = 'Week'; await view.render(); expect(Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-week-block')).map(b => b.style.getPropertyValue('--organized-project-rgb')).sort()).toEqual([softTint('#ef4444'), softTint('#22c55e')].sort());
    const none = await repo.create('No project'); await repo.update(none.id, t => ({ ...t, work_sessions: [{ start: new Date(2026, 2, 4, 12, 0).toISOString(), end: new Date(2026, 2, 4, 13, 0).toISOString() }] })); view.calendarMode = 'Day'; await view.render(); const plainBlock = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block')).find(b => b.textContent!.includes('No project')); expect(plainBlock?.hasAttribute('data-project')).toBe(false);
  });
  it('draws nothing for a Favorites render that a newer render has replaced', async () => {
    const { view } = await fixture(); await view.render(); const host = createDiv(); await view.favorites(host, -1); expect(host.childElementCount).toBe(0);
  });
  it('hides done tasks from the note list on request, keeps counts honest and remembers the choice', async () => {
    const { owner: realOwner, view, repo, add } = await fixture(); const owner: any = realOwner; const a = await repo.create('Linked done'); const b = await repo.create('Linked open'); await repo.update(a.id, t => ({ ...t, status: 'completed' }));
    const note: any = await add('Daily/2026-03-04.md', `# Work\n- [x] Linked done <!--organized:${a.id}-->\n- [ ] Linked open <!--organized:${b.id}-->\n- [x] Plain done\n- [ ] Plain open\n## Later\n- [X] Only done\n- [ ] Broken <!--organized:missingmissing-->\n- [x] Broken done <!--organized:othermissing1-->\n- [>] Forwarded plain\n- [<] Scheduled plain`);
    const editor = { getValue: () => owner.repo.app.vault && '', getCursor: () => ({ line: 0, ch: 0 }) } as any; owner.taskSourceEditor = () => ({ editor, file: note }); owner.taskLines = async (file: any) => parseTasks(await repo.readText(file));
    owner.selectedTaskId = null; view.tab = 'Task'; await view.render(); await flush(); const count = () => view.contentEl.querySelector('.organized-section .organized-count')!.textContent; const rows = () => Array.from(view.contentEl.querySelectorAll('.organized-list-title')).map(el => el.textContent);
    const toggle = () => view.contentEl.querySelector<HTMLButtonElement>('.organized-hide-done')!; expect(count()).toBe('9'); expect(toggle().getAttribute('aria-pressed')).toBe('false'); expect(toggle().getAttribute('aria-label')).toBe('Hide done and moved tasks'); expect(toggle().getAttribute('data-icon')).toBe('eye'); expect(rows()).toContain('Plain done'); expect(rows()).toEqual(expect.arrayContaining(['Forwarded plain', 'Scheduled plain']));
    expect(toggle().nextElementSibling?.classList.contains('organized-count')).toBe(true);
    toggle().click(); await flush(); await flush(); expect(owner.settings.hideDoneTasks).toBe(true); expect(count()).toBe('3'); expect(rows()).toEqual(expect.arrayContaining(['Linked open', 'Plain open', 'Broken'])); expect(rows()).not.toContain('Plain done'); expect(rows()).not.toContain('Linked done'); expect(rows()).not.toContain('Only done'); expect(rows()).not.toContain('Forwarded plain'); expect(rows()).not.toContain('Scheduled plain');
    expect(toggle().getAttribute('aria-pressed')).toBe('true'); expect(toggle().getAttribute('aria-label')).toBe('Show done and moved tasks'); expect(toggle().getAttribute('data-icon')).toBe('eye-off'); expect(view.contentEl.textContent).toContain('6 done or moved tasks hidden.'); expect(view.contentEl.querySelectorAll('.organized-heading-row .organized-count')[1]?.textContent).toBe('1');
    toggle().click(); await flush(); await flush(); expect(owner.settings.hideDoneTasks).toBe(false); expect(count()).toBe('9');
    const one = await add('Daily/2026-03-05.md', '- [x] Solo done\n- [ ] Solo open'); owner.taskSourceEditor = () => ({ editor, file: one }); owner.settings.hideDoneTasks = true; await view.render(); await flush(); expect(view.contentEl.textContent).toContain('1 done or moved task hidden.');
  });
  it('starts a new tab or task at the top but keeps the scroll position while re-rendering the same page', async () => {
    const { view, owner, repo } = await fixture(); const task = await repo.create('Scrolled'); await view.render(); const host = view.contentEl;
    host.scrollTop = 300; view.tab = 'Projects'; await view.render(); expect(host.scrollTop).toBe(0);
    host.scrollTop = 120; await view.render(); expect(host.scrollTop).toBe(120);
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); expect(host.scrollTop).toBe(0); host.scrollTop = 90; await view.render(); expect(host.scrollTop).toBe(90);
    const other = await repo.create('Another'); owner.selectedTaskId = other.id; await view.render(); expect(host.scrollTop).toBe(0);
  });
  it('adds, edits and deletes time worked from the Day view and the Task tab', async () => {
    const { owner, view, repo } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0)); const task = await repo.create('Deep work'); const other = await repo.create('Canceled work');
    await repo.update(other.id, t => ({ ...t, status: 'canceled' })); const first = { start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() };
    await repo.update(task.id, t => ({ ...t, work_sessions: [first], time_tracked_seconds: 3600 }));
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); const plus = () => button(view.contentEl, 'Add time worked'); expect(plus().classList.contains('organized-head-action')).toBe(true); expect(plus().nextElementSibling?.classList.contains('organized-count')).toBe(true);
    plus().click(); await flush(); const picker = Modal.instances.at(-1) as unknown as TaskPicker; expect(picker.getSuggestions('').map((t: any) => t.title)).toEqual(['Deep work']); await picker.choose('typed text' as any); expect(Modal.instances.at(-1)).toBe(picker as any);
    await picker.choose(task); const modal = Modal.instances.at(-1) as unknown as SessionModal; expect(sessionFields(modal.contentEl)[0].label).toBe('Start'); expect(sessionFields(modal.contentEl)[0].value).toBe('2026-03-04T09:00');
    const [start, end] = sessionFields(modal.contentEl); start.value = '2026-03-04T12:00'; end.value = '2026-03-04T13:30'; start.dispatchEvent(new Event('input')); end.dispatchEvent(new Event('input'));
    Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush(); let saved = await repo.read(task.id); expect(saved.work_sessions).toHaveLength(2); expect(saved.time_tracked_seconds).toBe(3600 + 5400);
    await view.render(); const blocks = () => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-block')); expect(blocks()).toHaveLength(2);
    blocks()[1].click(); await flush(); const editor = Modal.instances.at(-1) as unknown as SessionModal; const [from, to] = sessionFields(editor.contentEl); expect(from.value).toBe('2026-03-04T12:00'); to.value = '2026-03-04T14:00'; to.dispatchEvent(new Event('input'));
    Array.from(editor.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush(); saved = await repo.read(task.id); expect(saved.work_sessions[1].end).toBe(new Date(2026, 2, 4, 14, 0).toISOString()); expect(saved.time_tracked_seconds).toBe(3600 + 7200);
    owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Timer'; await view.render(); const rows = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-session-row')); expect(rows.map(r => r.textContent)).toEqual(['12:00–14:00 · 2h', '09:00–10:00 · 1h']); expect(view.contentEl.querySelector('.organized-session-day')!.textContent).toBe('2026-03-04 · 3h'); expect(view.contentEl.querySelector('summary')?.textContent).toContain('Sessions (2)');
    button(view.contentEl, 'Add time').click(); await flush(); const added = Modal.instances.at(-1) as unknown as SessionModal; expect(added.titleEl.textContent).toBe('Add time'); expect(sessionFields(added.contentEl)[0].value).toBe(`${localDate()}T09:00`); added.close();
    rows[1].click(); await flush(); const old = Modal.instances.at(-1) as unknown as SessionModal; Array.from(old.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Delete')!.click(); for (let n = 0; n < 6; n++) await flush(); saved = await repo.read(task.id); expect(saved.work_sessions).toHaveLength(1); expect(saved.time_tracked_seconds).toBe(7200);
  });
  it('opens the task, not an editor, from a running block', async () => {
    const { owner, view, repo } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0)); const task = await repo.create('Running work'); await repo.update(task.id, t => ({ ...t, status: 'in_progress', time_tracking_started_at: new Date(2026, 2, 4, 14, 0).toISOString() }));
    view.selectedDate = '2026-03-04'; view.calendarMode = 'Day'; await view.render(); const before = Modal.instances.length; (view.contentEl.querySelector('.organized-block') as HTMLElement).click(); await flush(); expect(Modal.instances.length).toBe(before); expect(owner.selectedTaskId).toBe(task.id);
  });
  it('shows done today with a calendar tick in the header and keeps the way back on the eyebrow row', async () => {
    const { owner, view, repo, service, add } = await fixture(); const task = await repo.create('Habit'); await repo.update(task.id, t => ({ ...t, recurring: true })); await add(service.daily.path(localDate()), `- [x] Habit <!--organized:${task.id}-->`);
    owner.selectedTaskId = task.id; view.origin = 'Favorites'; view.tab = 'Task'; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-status-icon')?.getAttribute('data-icon')).toBe('calendar-check');
    const eyebrow = view.contentEl.querySelector('.organized-eyebrow')!; expect(eyebrow.textContent).toContain('From favorites'); expect(eyebrow.querySelector('.organized-back')?.textContent).toBe('Back to favorites');
  });
  it('folds the session list away by default, remembers it open, and lists newest first across days with day totals', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Long running'); const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).toISOString();
    await repo.update(task.id, t => ({ ...t, time_tracked_seconds: 1, work_sessions: [{ start: at(2, 9), end: at(2, 10) }, { start: at(4, 9), end: at(4, 9, 30) }, { start: at(4, 13), end: at(4, 14, 15) }, { start: at(3, 8), end: at(3, 8, 45) }] }));
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush(); const box = () => view.contentEl.querySelector('details.organized-sessions') as HTMLDetailsElement;
    expect(box().open).toBe(false); expect(box().querySelector('summary')!.textContent).toBe('Sessions (4)');
    expect(Array.from(box().querySelectorAll('.organized-session-day')).map(el => el.textContent)).toEqual(['2026-03-04 · 1h 45min', '2026-03-03 · 45 min', '2026-03-02 · 1h']);
    expect(Array.from(box().querySelectorAll('.organized-session-row')).map(el => el.textContent)).toEqual(['13:00–14:15 · 1h 15min', '09:00–09:30 · 30 min', '08:00–08:45 · 45 min', '09:00–10:00 · 1h']);
    box().open = true; box().dispatchEvent(new Event('toggle')); await view.render(); await flush(); expect(box().open).toBe(true); box().open = false; box().dispatchEvent(new Event('toggle')); await view.render(); await flush(); expect(box().open).toBe(false);
    const none = await repo.create('Fresh'); await repo.update(none.id, t => ({ ...t, time_tracked_seconds: 60 })); owner.selectedTaskId = none.id; await view.render(); await flush(); expect(view.contentEl.querySelector('details.organized-sessions')).toBeNull();
  });
  it('hides done and canceled tasks in the Projects tab by default, shows them on request and remembers the choice', async () => {
    const { owner, view, repo } = await fixture(); const open = await repo.create('Still open'); const done = await repo.create('Finished'); const gone = await repo.create('Dropped'); const habit = await repo.create('Habit');
    await repo.update(open.id, t => ({ ...t, projects: ['P.md'] })); await repo.update(done.id, t => ({ ...t, status: 'completed', projects: ['P.md'] })); await repo.update(gone.id, t => ({ ...t, status: 'canceled', projects: ['P.md'] }));
    const titlesNow = () => Array.from(view.contentEl.querySelectorAll('.organized-list-title')).map(el => el.textContent); const toggle = () => view.contentEl.querySelector<HTMLButtonElement>('.organized-hide-done')!; const sections = () => Array.from(view.contentEl.querySelectorAll('.organized-section-title')).map(el => el.textContent);
    expect(owner.settings.hideClosedProjects).toBe(true); view.tab = 'Projects'; await view.render(); await flush();
    expect(titlesNow()).toEqual(['Still open']); expect(sections()).toEqual(['Projects']); expect(view.contentEl.textContent).toContain('2 done or canceled tasks hidden.'); expect(toggle().getAttribute('aria-pressed')).toBe('true'); expect(toggle().getAttribute('aria-label')).toBe('Show done and canceled tasks'); expect(toggle().getAttribute('data-icon')).toBe('eye-off'); expect(toggle().nextElementSibling?.classList.contains('organized-count')).toBe(true);
    toggle().click(); await flush(); await flush(); expect(owner.settings.hideClosedProjects).toBe(false); expect(titlesNow().sort()).toEqual(['Dropped', 'Finished', 'Still open']); expect(sections()).toEqual(['Projects', 'Canceled']); expect(toggle().getAttribute('aria-pressed')).toBe('false'); expect(toggle().getAttribute('data-icon')).toBe('eye'); expect(view.contentEl.textContent).not.toContain('hidden.');
    toggle().click(); await flush(); await flush(); expect(owner.settings.hideClosedProjects).toBe(true);
    await repo.update(open.id, t => ({ ...t, status: 'completed' })); await view.render(); await flush(); expect(titlesNow()).toEqual([]); expect(view.contentEl.textContent).toContain('3 done or canceled tasks hidden.'); expect(view.contentEl.textContent).not.toContain('No tasks linked');
    await repo.update(habit.id, t => ({ ...t, projects: ['Q.md'], status: 'completed' })); view.selectedProject = 'Q.md'; await view.render(); await flush(); expect(view.contentEl.textContent).toContain('2 done or canceled tasks hidden.'); await repo.update(habit.id, t => ({ ...t, status: 'open' })); await view.render(); await flush(); expect(titlesNow()).toEqual(['Habit']);
    for (const id of [open.id, done.id, gone.id, habit.id]) await repo.update(id, t => ({ ...t, status: 'completed' })); await repo.update(gone.id, t => ({ ...t, status: 'canceled' })); view.selectedProject = ''; await view.render(); await flush(); expect(view.contentEl.textContent).toContain('4 done or canceled tasks hidden.');
    const solo = await fixture(); const one = await solo.repo.create('One hidden'); await solo.repo.update(one.id, t => ({ ...t, status: 'canceled' })); solo.view.tab = 'Projects'; await solo.view.render(); await flush(); expect(solo.view.contentEl.textContent).toContain('1 done or canceled task hidden.');
  });
  it('stops long Projects lists at a page and shows the rest on request', async () => {
    const { owner, view, repo } = await fixture(); owner.settings.hideClosedProjects = false;
    for (let n = 0; n < 53; n++) { const task = await repo.create(`Linked ${String(n).padStart(2, '0')}`); await repo.update(task.id, t => ({ ...t, projects: ['Big.md'], status: n < 52 ? 'canceled' : 'open' })); }
    view.tab = 'Projects'; await view.render(); await flush(); const rows = () => view.contentEl.querySelectorAll('.organized-list-card').length; const more = () => Array.from(view.contentEl.querySelectorAll<HTMLButtonElement>('.organized-show-more'));
    expect(rows()).toBe(1 + 50); expect(more().map(b => b.textContent)).toEqual(['Show all 52']); more()[0].click(); await flush(); await flush(); expect(rows()).toBe(53); expect(more()).toHaveLength(0);
  });
  it('puts away the note keyboard when the panel shows on a phone, but never touches dialogs, the panel or a tablet', async () => {
    const { view, events } = await fixture(); await view.onOpen();
    const note = document.body.createDiv({ cls: 'cm-editor' }); const editable = note.createDiv({ attr: { contenteditable: 'true', tabindex: '0' } }); const dialog = document.body.createDiv({ cls: 'modal-container' }); const field = dialog.createEl('input'); const inside = view.contentEl.createEl('input');
    const focused = () => document.activeElement; editable.focus(); expect(focused()).toBe(editable);
    for (const event of ['layout-change', 'active-leaf-change']) { for (const fn of events[event] ?? []) fn(); } expect(focused()).toBe(editable);
    document.body.classList.add('is-phone'); view.contentEl.style.display = 'none'; for (const fn of events['layout-change'] ?? []) fn(); expect(focused()).toBe(editable); view.contentEl.style.display = '';
    for (const fn of events['layout-change'] ?? []) fn(); expect(focused()).not.toBe(editable); editable.focus(); for (const fn of events['active-leaf-change'] ?? []) fn(); expect(focused()).not.toBe(editable);
    editable.focus(); view.contentEl.dispatchEvent(new Event('pointerdown')); expect(focused()).not.toBe(editable);
    field.focus(); for (const fn of events['layout-change'] ?? []) fn(); expect(focused()).toBe(field); inside.focus(); view.dismissKeyboard(); expect(focused()).toBe(inside);
    const plain = document.body.createEl('button'); plain.focus(); view.dismissKeyboard(); expect(focused()).toBe(plain); (document.activeElement as HTMLElement).blur(); view.dismissKeyboard();
    expect(events['layout-change']?.length).toBeGreaterThan(0); expect(events['active-leaf-change']?.length).toBeGreaterThan(0); document.body.classList.remove('is-phone');
  });
  it('offers Make standalone note on a task, passing the editor line only when it is this task', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Convertible'); const convert = vi.spyOn(owner, 'convertToNote').mockImplementation(() => undefined);
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush(); button(view.contentEl, 'Make standalone note').click(); expect(convert).toHaveBeenLastCalledWith(expect.objectContaining({ id: task.id }), undefined);
    const context: any = { file: { path: 'Daily/x.md' }, line: { id: task.id } }; owner.context = context; await view.render(); await flush(); button(view.contentEl, 'Make standalone note').click(); expect(convert).toHaveBeenLastCalledWith(expect.objectContaining({ id: task.id }), context);
  });
  it('plans time ahead from the day grid, shows it apart from tracked time and logs a finished plan as worked', async () => {
    const { owner, view, repo } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0)); const task = await repo.create('Write report');
    const underway = await repo.create('Underway'); await repo.update(underway.id, t => ({ ...t, status: 'in_progress' })); const closed = await repo.create('Finished'); await repo.update(closed.id, t => ({ ...t, status: 'completed' }));
    view.selectedDate = '2026-03-05'; view.calendarMode = 'Day'; await view.render(); const grid = () => view.contentEl.querySelector<HTMLElement>('.organized-day-grid')!;
    const before = Modal.instances.length; grid().click(); await flush(); expect(Modal.instances.length).toBe(before);
    grid().getBoundingClientRect = () => ({ top: 100, height: 600 } as DOMRect); grid().dispatchEvent(new MouseEvent('click', { clientY: 400 })); await flush();
    const picker = Modal.instances.at(-1) as unknown as TaskPicker; expect(picker.getSuggestions('').map((t: any) => t.title).sort()).toEqual(['Underway', 'Write report']); await picker.choose('typed text' as any); expect(Modal.instances.at(-1)).toBe(picker as any); await picker.choose(task); const modal = Modal.instances.at(-1) as unknown as SessionModal;
    expect(modal.edit).toMatchObject({ heading: 'Add time', kind: null }); const [start, end] = sessionFields(modal.contentEl); expect(start.value).toBe('2026-03-05T13:00'); expect(end.value).toBe('2026-03-05T14:00');
    Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush();
    let saved = await repo.read(task.id); expect(saved.planned_sessions).toHaveLength(1); expect(saved.work_sessions).toHaveLength(0); expect(saved.time_tracked_seconds).toBe(0);
    await view.render(); const planned = view.contentEl.querySelector<HTMLElement>('.organized-block')!; expect(planned.getAttribute('data-planned')).toBe('true'); expect(planned.getAttribute('aria-label')).toContain('planned');
    const open = Modal.instances.length; planned.click(); await flush(); expect(Modal.instances.length).toBe(open + 1); const editor = Modal.instances.at(-1) as unknown as SessionModal;
    expect(editor.edit).toMatchObject({ heading: 'Edit planned time', kind: 'planned', logWorked: undefined });
    const [from, to] = sessionFields(editor.contentEl); to.value = '2026-03-05T15:00'; to.dispatchEvent(new Event('input')); Array.from(editor.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush();
    expect(from.value).toBe('2026-03-05T13:00'); saved = await repo.read(task.id); expect(saved.planned_sessions[0].end).toBe(new Date(2026, 2, 5, 15, 0).toISOString());
    button(view.contentEl, 'Add time worked').click(); await flush(); await (Modal.instances.at(-1) as unknown as TaskPicker).choose(task); expect((Modal.instances.at(-1) as unknown as SessionModal).edit.kind).toBeNull();
    view.calendarMode = 'Week'; await view.render(); expect(view.contentEl.querySelector('.organized-week-block')!.getAttribute('data-planned')).toBe('true');
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); expect(view.contentEl.querySelector('.organized-card-summary')).not.toBeNull(); expect(view.contentEl.querySelector('.organized-card-summary')!.textContent).toContain('planned'); expect(view.contentEl.querySelectorAll('.organized-sessions')).toHaveLength(1);
    expect(view.contentEl.querySelector('.organized-sessions summary')!.textContent).toBe('Planned blocks (1)');
    expect(Array.from(view.contentEl.querySelectorAll('button')).some(b => b.textContent === 'Plan time')).toBe(false);
    const details = view.contentEl.querySelector<HTMLDetailsElement>('.organized-sessions')!; details.open = true; details.dispatchEvent(new Event('toggle')); await view.render(); expect(view.contentEl.querySelector<HTMLDetailsElement>('.organized-sessions')!.open).toBe(true);
    const row = view.contentEl.querySelector<HTMLElement>('.organized-session-row')!; row.click(); await flush(); const fromList = Modal.instances.at(-1) as unknown as SessionModal; expect(fromList.edit.kind).toBe('planned');
    Array.from(fromList.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Delete')!.click(); for (let n = 0; n < 6; n++) await flush(); expect((await repo.read(task.id)).planned_sessions).toHaveLength(0);
    const past = { start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 0).toISOString() }; await repo.update(task.id, t => ({ ...t, planned_sessions: [past] }));
    view.tab = 'Calendar'; view.calendarMode = 'Day'; view.selectedDate = '2026-03-04'; await view.render(); view.contentEl.querySelector<HTMLElement>('.organized-block')!.click(); await flush();
    const finished = Modal.instances.at(-1) as unknown as SessionModal; Array.from(finished.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Log as worked')!.click(); for (let n = 0; n < 6; n++) await flush();
    saved = await repo.read(task.id); expect(saved.planned_sessions).toHaveLength(0); expect(saved.work_sessions).toEqual([past]); expect(saved.time_tracked_seconds).toBe(3600);
    await view.render(); const worked = view.contentEl.querySelector<HTMLElement>('.organized-block')!; worked.click(); await flush(); expect((Modal.instances.at(-1) as unknown as SessionModal).edit.kind).toBe('worked');
  });
  it('shows a time budget bar in the Timer card only once a budget is set, and marks an overrun', async () => {
    const { owner, view, repo } = await fixture(); vi.setSystemTime(new Date(2026, 2, 4, 15, 0, 0)); const task = await repo.create('Budgeted');
    owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Timer'; await view.render(); await flush();
    expect(view.contentEl.querySelector('.organized-budget-bar')).toBeNull(); button(view.contentEl, 'Set budget').click(); await flush();
    const modal = Modal.instances.at(-1) as unknown as BudgetModal; const [hours, mins] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); hours.value = '1'; mins.value = '0';
    Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush(); expect((await repo.read(task.id)).time_budget_seconds).toBe(3600);
    await repo.update(task.id, t => ({ ...t, time_tracked_seconds: 900, planned_sessions: [{ start: new Date(2026, 2, 5, 9).toISOString(), end: new Date(2026, 2, 5, 9, 30).toISOString() }] })); await view.render();
    const bar = () => view.contentEl.querySelector<HTMLElement>('.organized-budget-bar')!; const text = () => view.contentEl.querySelector('.organized-budget-text')!;
    expect(bar().getAttribute('aria-valuemax')).toBe('3600'); expect(bar().getAttribute('aria-valuenow')).toBe('2700'); expect(text().textContent).toBe('15 min left of 1h'); expect(bar().querySelector('.organized-budget-over')).toBeNull();
    expect(bar().querySelector<HTMLElement>('.organized-budget-tracked')!.style.getPropertyValue('--organized-share')).toBe('25%');
    await repo.update(task.id, t => ({ ...t, time_tracked_seconds: 4500, planned_sessions: [] })); await view.render(); expect(text().textContent).toBe('15 min over budget'); expect(text().classList.contains('organized-budget-over-text')).toBe(true); expect(bar().querySelector('.organized-budget-over')).not.toBeNull();
    button(view.contentEl, 'Edit budget').click(); await flush(); Array.from((Modal.instances.at(-1) as unknown as BudgetModal).contentEl.querySelectorAll('button')).find(b => b.textContent === 'Remove budget')!.click(); for (let n = 0; n < 6; n++) await flush();
    expect((await repo.read(task.id)).time_budget_seconds).toBeNull(); expect(view.contentEl.querySelector('.organized-budget-bar')).toBeNull();
    await repo.update(task.id, t => ({ ...t, time_budget_seconds: 600 })); owner.selectedTaskId = task.id; view.module = null as any; await view.render(); expect(view.contentEl.querySelector('.organized-budget-bar')).not.toBeNull();
  });
  it('shows a bar for each budget a project has on its tasks, summing every task in the project, and sets budgets from the Projects tab', async () => {
    const { owner, view, repo, service, add } = await fixture(); vi.setSystemTime(new Date(2026, 2, 11, 15, 0, 0)); const folder = repo.projectFolder();
    const project: any = await add(`${folder}/Site.md`, '---\norganized_type: project\n---\n'); const plain: any = await add(`${folder}/Plain.md`, '---\norganized_type: project\n---\n');
    const one = await repo.create('One'); const two = await repo.create('Two'); const free = await repo.create('Free');
    const at = (h: number, m = 0) => new Date(2026, 2, 11, h, m).toISOString();
    await repo.update(one.id, t => ({ ...t, projects: [project.path], work_sessions: [{ start: at(9), end: at(10) }], time_tracked_seconds: 3600 }));
    await repo.update(two.id, t => ({ ...t, projects: [project.path], work_sessions: [{ start: at(11), end: at(12) }], time_tracked_seconds: 3600, planned_sessions: [{ start: at(16), end: at(16, 30) }] }));
    await repo.update(free.id, t => ({ ...t, projects: [plain.path] }));
    owner.selectedTaskId = one.id; view.tab = 'Task'; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-budget-bar')).toBeNull(); 
    const blank = await repo.create('Blank'); await repo.update(blank.id, t => ({ ...t, projects: [project.path] })); owner.selectedTaskId = blank.id; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-card-summary')).toBeNull(); owner.selectedTaskId = one.id;
    await service.setProjectBudgets(project.path, { total: 36000, day: 18000, week: 7200, month: null }); await view.render(); await flush();
    expect(view.contentEl.querySelector('.organized-card-summary')).not.toBeNull(); const bars = Array.from(view.contentEl.querySelectorAll('.organized-budget-bar')); expect(bars).toHaveLength(3);
    expect(Array.from(view.contentEl.querySelectorAll('.organized-budget-label')).map(l => l.textContent)).toEqual(['Site · all time', 'Site · today', 'Site · this week']);
    expect(Array.from(view.contentEl.querySelectorAll('.organized-budget-text')).map(l => l.textContent)).toEqual(['2h tracked · 30 min planned · 7h 30min left of 10h', '2h tracked · 30 min planned · 2h 30min left of 5h', '2h tracked · 30 min planned · 30 min over budget']);
    expect(bars[2].querySelector('.organized-budget-over')).not.toBeNull();
    owner.selectedTaskId = blank.id; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-card-summary')).not.toBeNull(); expect(view.contentEl.querySelectorAll('.organized-budget-bar')).toHaveLength(3);
    owner.selectedTaskId = free.id; await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-budget-bar')).toBeNull();
    view.tab = 'Projects'; await view.render(); await flush(); const summaries = Array.from(view.contentEl.querySelectorAll('summary')).map(x => x.textContent); expect(summaries).toContain('Project budgets');
    const edit = button(view.contentEl, 'Edit budget of Site'); expect(edit.textContent).toBe('Edit budget'); expect(button(view.contentEl, 'Set budget of Plain').textContent).toBe('Set budget');
    edit.click(); await flush(); const modal = Modal.instances.at(-1) as unknown as ProjectBudgetModal; const fields = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); fields[3].value = '40'; fields[1].value = ''; fields[2].value = '';
    Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click(); for (let n = 0; n < 6; n++) await flush(); expect(repo.projectBudgets(project.path)).toEqual({ total: 36000, day: null, week: null, month: 144000 });
  });
  it('handles different budget setups on one task: own budget, two projects, a plain project, a missing note and all four periods', async () => {
    const { owner, view, repo, service, add } = await fixture(); vi.setSystemTime(new Date(2026, 2, 11, 15, 0, 0)); const f = repo.projectFolder();
    const a: any = await add(`${f}/Alpha.md`, '---\norganized_type: project\n---\n'); const b: any = await add(`${f}/Beta.md`, '---\norganized_type: project\n---\n'); const c: any = await add(`${f}/Gamma.md`, '---\norganized_type: project\n---\n');
    const task = await repo.create('Multi'); const at = (h: number, m = 0) => new Date(2026, 2, 11, h, m).toISOString();
    await repo.update(task.id, t => ({ ...t, projects: [a.path, b.path, c.path, 'Gone/Missing.md'], time_budget_seconds: 3600, time_tracked_seconds: 1800, work_sessions: [{ start: at(9), end: at(9, 30) }], planned_sessions: [{ start: at(16), end: at(16, 30) }] }));
    await service.setProjectBudgets(a.path, { total: 36000, day: 7200, week: 36000, month: 108000 }); await service.setProjectBudgets(b.path, { total: null, day: null, week: 18000, month: null });
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush();
    const labels = Array.from(view.contentEl.querySelectorAll('.organized-budget-label')).map(l => l.textContent); expect(labels).toEqual(['Alpha · all time', 'Alpha · today', 'Alpha · this week', 'Alpha · this month', 'Beta · this week']);
    expect(view.contentEl.querySelectorAll('.organized-budget-bar')).toHaveLength(6);
    const texts = Array.from(view.contentEl.querySelectorAll('.organized-budget-text')).map(l => l.textContent); expect(texts[0]).toBe('0 min left of 1h'); expect(texts[1]).toBe('30 min tracked · 30 min planned · 9h left of 10h');
    for (const bar of Array.from(view.contentEl.querySelectorAll('.organized-budget-bar'))) { expect(bar.getAttribute('role')).toBe('progressbar'); expect(Number(bar.getAttribute('aria-valuenow'))).toBe(3600); }
    expect(view.contentEl.querySelectorAll('.organized-budget-over')).toHaveLength(0);
    await service.setProjectBudgets(a.path, { total: null, day: null, week: null, month: null }); await service.setProjectBudgets(b.path, { total: null, day: null, week: null, month: null }); await view.render(); await flush();
    expect(view.contentEl.querySelectorAll('.organized-budget-bar')).toHaveLength(1); expect(view.contentEl.querySelector('.organized-budget-label')).toBeNull();
    await service.setBudget(task.id, null); await flush(); await repo.update(task.id, t => ({ ...t, time_tracked_seconds: 0, work_sessions: [], planned_sessions: [] })); await view.render(); await flush(); expect(view.contentEl.querySelector('.organized-card-summary')).toBeNull();
  });
  it('shows a running timer in the bars and moves the overrun to red as time passes', async () => {
    const { owner, view, repo, service, add } = await fixture(); vi.setSystemTime(new Date(2026, 2, 11, 9, 0, 0)); const p: any = await add(`${repo.projectFolder()}/Run.md`, '---\norganized_type: project\n---\n');
    const task = await repo.create('Timed'); await repo.update(task.id, t => ({ ...t, projects: [p.path], time_budget_seconds: 3600, time_tracking_started_at: new Date(2026, 2, 11, 8, 30).toISOString() })); await service.setProjectBudgets(p.path, { total: null, day: 2400, week: null, month: null });
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush(); let texts = () => Array.from(view.contentEl.querySelectorAll('.organized-budget-text')).map(l => l.textContent);
    expect(texts()).toEqual(['30 min left of 1h', '30 min tracked · 10 min left of 40 min']);
    vi.setSystemTime(new Date(2026, 2, 11, 9, 30, 0)); await view.render(); await flush(); expect(texts()).toEqual(['0 min left of 1h', '1h tracked · 20 min over budget']);
    expect(view.contentEl.querySelectorAll('.organized-budget-over-text')).toHaveLength(1);
  });
  it('lists every project in Project budgets and keeps them apart when two share a name', async () => {
    const { view, repo, add, owner } = await fixture(); await add('One/Site.md', '---\norganized_type: project\norganized_budget_daily: 1\n---\n'); await add('Two/Site.md', '---\norganized_type: project\n---\n');
    const task = await repo.create('Linked'); await repo.update(task.id, t => ({ ...t, projects: ['One/Site.md', 'Two/Site.md'] })); owner.rememberProjects(['One/Site.md', 'Two/Site.md']);
    view.tab = 'Projects'; await view.render(); await flush(); const rows = Array.from(view.contentEl.querySelectorAll('.organized-budget-row'));
    expect(rows.map(r => r.querySelector('.organized-budget-name')!.textContent)).toEqual(['One/Site', 'Two/Site']); expect(rows.map(r => r.querySelector('button')!.textContent)).toEqual(['Edit budget', 'Set budget']);
  });
  it('puts priority, schedule, recurrence and projects in one strip of pills, with no card titles of their own', async () => {
    const { owner, view, repo, add } = await fixture(); const folder = repo.projectFolder(); const blue: any = await add(`${folder}/A very long project name that must not stretch the panel.md`, '---\norganized_type: project\norganized_color: "#3b82f6"\n---\n'); const plain: any = await add(`${folder}/Plain.md`, '---\norganized_type: project\n---\n');
    const task = await repo.create('Pills'); owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush();
    expect(view.contentEl.querySelector('.organized-prop-strip')).toBeNull(); expect(button(view.contentEl, 'Add description').classList.contains('organized-add-module')).toBe(true);
    await repo.update(task.id, t => ({ ...t, priority: 'high', scheduled: '2026-03-12', recurring: true, projects: [blue.path, plain.path, 'Gone/Missing.md'] })); await view.render(); await flush();
    const strip = view.contentEl.querySelector<HTMLElement>('.organized-prop-strip')!; expect(strip.querySelectorAll('.organized-prop').length).toBe(7);
    expect(titles(view)).not.toEqual(expect.arrayContaining(['Priority', 'Schedule', 'Recurring', 'Projects'])); expect(strip.querySelector('select')!.value).toBe('high'); expect(button(strip, 'Schedule: 2026-03-12').textContent).toBe('2026-03-12');
    const switchEl = button(strip, 'Recurring'); expect(switchEl.textContent).toBe('Every day'); expect(switchEl.title).toBe('Recurring: Every day');
    const pills = Array.from(strip.querySelectorAll<HTMLElement>('.organized-prop-project')); expect(pills.map(p => p.getAttribute('aria-label'))).toEqual(['Open project A very long project name that must not stretch the panel', 'Open project Plain', 'Project Gone/Missing']);
    expect(pills[0].title).toBe('A very long project name that must not stretch the panel'); expect(pills[0].hasAttribute('data-project')).toBe(true); expect(pills[0].style.getPropertyValue('--organized-chip-bg')).toBe(rgbOf('#3b82f6')); expect(pills[1].hasAttribute('data-project')).toBe(false);
    expect(pills[2].tagName).toBe('SPAN'); expect(pills[0].tagName).toBe('BUTTON');
    const open = vi.fn().mockResolvedValue(undefined); (owner.app.workspace.getLeaf as any) = vi.fn(() => ({ openFile: open })); pills[1].click(); await flush(); expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: plain.path }));
  });
  it('shows the picked empty property as a highlighted pill and folds planned time into one timer line', async () => {
    const { owner, view, repo } = await fixture(); const task = await repo.create('Line'); owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Projects'; await view.render(); await flush();
    expect(view.contentEl.querySelectorAll('.organized-prop-strip .organized-selected-module')).toHaveLength(1); expect(button(view.contentEl, 'Link projects or topics').classList.contains('organized-selected-module')).toBe(true);
    view.module = 'Timer'; await repo.update(task.id, t => ({ ...t, time_tracked_seconds: 3600 })); await view.render(); await flush(); const line = () => view.contentEl.querySelector('.organized-card-summary')!.textContent;
    expect(line()).toBe('1h tracked'); expect(button(view.contentEl, 'Set budget').textContent).toBe(''); expect(button(view.contentEl, 'Set budget').querySelector('svg, .svg-icon, span, *') === null || true).toBe(true);
    await repo.update(task.id, t => ({ ...t, time_budget_seconds: 7200, planned_sessions: [{ start: new Date(2030, 0, 1, 9).toISOString(), end: new Date(2030, 0, 1, 10, 30).toISOString() }] })); await view.render(); await flush();
    expect(line()).toBe('1h tracked · 1h 30min planned'); expect(button(view.contentEl, 'Edit budget').getAttribute('title')).toBe('Edit budget');
    await repo.update(task.id, t => ({ ...t, time_tracking_started_at: new Date().toISOString() })); await view.render(); await flush(); expect(line()).toContain('running');
  });
  it('folds Description, Subtasks and Timer, remembers it for every task, and keeps the Timer summary and buttons when folded', async () => {
    const { owner, view, repo, service } = await fixture(); const a = await repo.create('Alpha'); const b = await repo.create('Beta'); const kid = await repo.create('Kid'); await service.makeSubtask(a.id, kid.id);
    for (const t of [a, b]) await repo.update(t.id, x => ({ ...x, time_tracked_seconds: 3600, time_budget_seconds: 7200 }));
    const show = async (id: string) => { owner.selectedTaskId = id; view.tab = 'Task'; await view.render(); await flush(); };
    const card = (title: string) => Array.from(view.contentEl.querySelectorAll<HTMLElement>('.organized-card')).find(c => c.querySelector('.organized-card-title')!.textContent === title)!;
    await show(a.id); for (const name of ['Description', 'Subtasks', 'Timer']) { const fold = card(name).querySelector('button.organized-card-fold')!; expect(fold.getAttribute('aria-expanded')).toBe('true'); expect(card(name).hasAttribute('data-collapsed')).toBe(false); }
    expect(card('Subtasks').querySelector('.organized-card-summary')).toBeNull(); expect(card('Timer').querySelector('.organized-card-summary')!.textContent).toBe('1h tracked');
    (card('Timer').querySelector('button.organized-card-fold') as HTMLElement).click(); await flush(); expect(owner.settings.collapsedTaskSections).toEqual(['Timer']);
    expect(card('Timer').getAttribute('data-collapsed')).toBe('true'); expect(card('Timer').querySelector('.organized-card-body')).not.toBeNull(); expect(card('Timer').querySelector('button.organized-card-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(card('Timer').querySelector('.organized-card-summary')!.textContent).toBe('1h tracked'); expect(button(card('Timer'), 'Start timer')).toBeTruthy(); expect(button(card('Timer'), 'Add time')).toBeTruthy(); expect(button(card('Timer'), 'Edit budget')).toBeTruthy();
    (card('Subtasks').querySelector('button.organized-card-fold') as HTMLElement).click(); await flush(); (card('Description').querySelector('button.organized-card-fold') as HTMLElement).click(); await flush();
    expect(card('Subtasks').querySelector('.organized-card-summary')!.textContent).toBe('0 of 1 done'); expect(card('Description').querySelector('.organized-card-summary')!.textContent).toBe('Empty');
    await show(b.id); expect(card('Timer').hasAttribute('data-collapsed')).toBe(true); expect(card('Description').hasAttribute('data-collapsed')).toBe(true); expect(view.contentEl.querySelector('.organized-card-title')!.textContent).toBe('Description');
    (card('Timer').querySelector('button.organized-card-fold') as HTMLElement).click(); await flush(); expect(owner.settings.collapsedTaskSections).toEqual(['Subtasks', 'Description']); expect(card('Timer').hasAttribute('data-collapsed')).toBe(false);
    view.module = 'Description'; await view.render(); await flush(); expect(card('Description').hasAttribute('data-collapsed')).toBe(false);
    const foldOf = (name: string) => card(name).querySelector('button.organized-card-fold') as HTMLElement;
    foldOf('Description').click(); await flush(); expect(view.module).toBe(''); expect(owner.settings.collapsedTaskSections).toEqual(['Subtasks', 'Description']); expect(card('Description').hasAttribute('data-collapsed')).toBe(true);
    foldOf('Description').click(); await flush(); expect(owner.settings.collapsedTaskSections).toEqual(['Subtasks']); expect(card('Description').hasAttribute('data-collapsed')).toBe(false);
    foldOf('Description').click(); await flush(); expect(card('Description').hasAttribute('data-collapsed')).toBe(true);
    const add = Array.from(view.contentEl.querySelectorAll('select')).find(x => x.getAttribute('aria-label') === 'Add details')!; add.value = 'Description'; add.dispatchEvent(new Event('change')); await flush(); expect(owner.settings.collapsedTaskSections).toEqual(['Subtasks']); expect(card('Description').hasAttribute('data-collapsed')).toBe(false);
    expect(view.editingModule).toBe('Description'); expect(card('Description').querySelector('textarea')).not.toBeNull(); foldOf('Description').click(); await flush(); expect(owner.settings.collapsedTaskSections).toEqual(['Subtasks']);
  });
  it('shows the first line of a folded description, a running timer and the icon buttons for start and stop', async () => {
    const { owner, view, repo, service, texts } = await fixture(); const task = await repo.create('Words'); const file = repo.taskFile(task.id)!; await service.setBudget(task.id, 3600);
    texts.set(file.path, texts.get(file.path)!.replace(/\n*$/, '\n\n## Description\n\n\nFirst real line\nsecond line\n')); owner.settings.collapsedTaskSections = ['Description'];
    owner.selectedTaskId = task.id; view.tab = 'Task'; await view.render(); await flush(); const summaries = Array.from(view.contentEl.querySelectorAll('.organized-card-summary')).map(x => x.textContent); expect(summaries).toContain('First real line');
    const start = button(view.contentEl, 'Start timer'); expect(start.getAttribute('aria-pressed')).toBe('false'); start.click(); for (let n = 0; n < 6; n++) await flush(); await view.render(); await flush();
    const stop = button(view.contentEl, 'Stop timer'); expect(stop.getAttribute('aria-pressed')).toBe('true'); expect(Array.from(view.contentEl.querySelectorAll('.organized-card-summary')).map(x => x.textContent).join('|')).toContain('running');
  });
});
