// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import Organized from "../main";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { MarkdownView, Modal, Notice, TFolder } from "./__mocks__/obsidian";
import { ConfirmModal, DatePicker, KEEP_AS_TODO, NoteConversionModal, OnboardingModal, RetireModal, PriorityPicker, ProjectPicker, TaskPicker } from "../modals";
import { parseTasks } from "../codec";
import { OrganizedInspectorView, VIEW_TYPE } from "../view";
import { localDate } from '../model';

installObsidianDom();
export const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
async function loaded() {
  vi.useFakeTimers(); const h = harness();
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  await plugin.onload();
  return { h, plugin, stub: plugin as any };
}
function update(before: string, after: string, userEvent: string | null = 'input.type', selectionSet = false) {
  const startState = EditorState.create({ doc: before });
  const transaction = startState.update({ changes: { from: 0, to: before.length, insert: after }, annotations: userEvent ? Transaction.userEvent.of(userEvent) : [] });
  return { startState, state: transaction.state, transactions: [transaction], changes: transaction.changes, docChanged: before !== after, selectionSet } as any;
}
function replaceAt(before: string, from: number, to: number, insert: string, userEvent: string | null = null) {
  const startState = EditorState.create({ doc: before });
  const transaction = startState.update({ changes: { from, to, insert }, annotations: userEvent ? Transaction.userEvent.of(userEvent) : [] });
  return { startState, state: transaction.state, transactions: [transaction], changes: transaction.changes, docChanged: true, selectionSet: false } as any;
}
describe('plugin lifecycle and user-only editor actions', () => {
  it('invalidates projections only for task metadata, today or affected indexed references', async () => {
    const { h, plugin } = await loaded(); h.layout[0](); const task = await plugin.repo.create('Selected'); plugin.selectedTaskId = task.id;
    const unrelated: any = await h.add('Unrelated.md', 'text'); const reference: any = await h.add('Reference.md', `- [ ] Selected <!--organized:${task.id}-->`); await plugin.service.refs(task.id);
    const refresh = vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined);
    h.events.modify[0](unrelated); await flush(); expect(refresh).not.toHaveBeenCalled();
    h.events.modify[0](plugin.repo.file(plugin.repo.taskPath(task.id))); await flush(); expect(refresh).toHaveBeenCalledTimes(1);
    const today: any = await h.add(`Daily/${localDate()}.md`, 'ordinary text'); h.events.modify[0](today); await flush(); expect(refresh).toHaveBeenCalledTimes(2);
    h.texts.set(reference.path, 'removed reference'); h.events.modify[0](reference); await flush(); expect(refresh).toHaveBeenCalledTimes(3);
    h.texts.set(unrelated.path, `- [ ] Selected <!--organized:${task.id}-->`); h.events.modify[0](unrelated); await flush(); expect(refresh).toHaveBeenCalledTimes(4);
    expect(plugin.service.hasReference(null, unrelated.path)).toBe(false);
  });
  it('connects safety notices, section prompts, reading processors and CM refresh to the registered host', async () => {
    const { h, plugin, stub } = await loaded();
    plugin.safety.notify('Backup available'); expect(Notice.instances.at(-1)?.message).toBe('Backup available');
    const result = plugin.service.confirm('Recreate missing section?'); (Modal.instances.at(-1) as ConfirmModal).done(false); expect(await result).toBe(false);
    await stub.processors[0](createDiv(), { getSectionInfo: () => null }); expect(h.raw.vault.process).not.toHaveBeenCalled();
    const file: any = await h.add('Note.md', '- [ ] ordinary'); const editor: any = h.setActive(file); editor.cm = { dispatch: vi.fn() }; plugin.refresh(); expect(editor.cm.dispatch).toHaveBeenCalledWith(expect.objectContaining({ effects: expect.anything() }));
    h.raw.workspace.getActiveViewOfType.mockReturnValueOnce({ file, editor, getMode: () => 'preview' } as any); expect(plugin.activeEditor()).toBeNull();
    const task = await plugin.repo.create('Project'); const projects = vi.spyOn(plugin.service, 'projects').mockResolvedValue(); const clean = vi.spyOn(plugin.service, 'clean').mockResolvedValue(); plugin.pickProjects(task); const modal = Modal.instances.at(-1) as ProjectPicker; expect(modal.colorOf('Missing.md')).toBeNull(); await modal.save([]); expect(projects).toHaveBeenCalledWith(task.id, []); expect(clean).not.toHaveBeenCalled(); modal.close();
  });
  it('registers capabilities only, defers vault-create handling and cleans durable crash state', async () => {
    const { h, plugin, stub } = await loaded();
    expect(stub.commands).toHaveLength(9); expect(stub.extensions).toHaveLength(1); expect(stub.processors).toHaveLength(1); expect(stub.settingTabs).toHaveLength(1); expect(stub.views.has(VIEW_TYPE)).toBe(true); expect(h.raw.vault.read).not.toHaveBeenCalled(); expect(h.raw.vault.create).not.toHaveBeenCalled(); expect(h.events.create).toBeUndefined();
    const factory = stub.views.get(VIEW_TYPE); expect(factory({ app: h.app })).toBeInstanceOf(OrganizedInspectorView);
    h.layout[0](); expect(h.events.create).toHaveLength(1);
    const created = vi.spyOn(plugin.service, 'onDailyCreated').mockResolvedValue(); const index = vi.spyOn(plugin.service, 'index').mockResolvedValue(); const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); const refresh = vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined);
    const file: any = await h.add('Note.md'); h.events.create[0](file); h.events.modify[0](file); h.events.rename[0](file, 'Old.md'); h.events.delete[0](file); h.events['file-open'][0](file); h.events['file-open'][0](null);
    h.events.create[0]({ path: 'Folder' }); h.events.modify[0]({ path: 'Folder' }); h.events.rename[0]({ path: 'Folder' }, 'OldFolder');
    h.events['editor-change'][0](); h.events['active-leaf-change'][0](); await flush(); expect(created).toHaveBeenCalledWith(file); expect(index).toHaveBeenCalledWith(file); expect(reconcile).toHaveBeenCalledWith(file); expect(refresh).toHaveBeenCalled();
    const open = vi.spyOn(plugin, 'openInspector').mockResolvedValue(); stub.ribbon[0].cb(); stub.commands[0].callback(); await flush(); expect(open).toHaveBeenCalledTimes(2);
    open.mockRejectedValueOnce(Error('open failed')); stub.ribbon[0].cb(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('open failed');
    const pick = vi.spyOn(plugin, 'pickTask').mockResolvedValue(); stub.commands[1].editorCallback({}, { file }); stub.commands[2].editorCallback({}, { file }); stub.commands[1].editorCallback({}, {}); stub.commands[2].editorCallback({}, {}); await flush(); expect(pick).toHaveBeenCalledTimes(2);
    const convert = vi.spyOn(plugin, 'convertTodos').mockResolvedValue(); stub.commands.find((c: any) => c.id === 'convert-todos').editorCallback({}, { file }); stub.commands.find((c: any) => c.id === 'convert-todos').editorCallback({}, {}); await flush(); expect(convert).toHaveBeenCalledExactlyOnceWith(file);
    const unlink = vi.spyOn(plugin.service, 'unlinkTasks').mockResolvedValue(); stub.commands.find((c: any) => c.id === 'unlink-note-tasks').editorCallback({}, { file }); stub.commands.find((c: any) => c.id === 'unlink-note-tasks').editorCallback({}, {}); await flush();
    expect(unlink).toHaveBeenCalledExactlyOnceWith([file], 'this note');
    const undo = vi.spyOn(plugin.service, 'undo').mockResolvedValue(); stub.commands.find((c: any) => c.id === 'undo').callback(); await flush(); expect(undo).toHaveBeenCalledOnce();
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(false); const restore = vi.spyOn(plugin.safety, 'queueCompatibleRestore').mockResolvedValue(); // Find restore by stable id, not menu order.
    stub.commands.find((c: any) => c.id === 'restore-settings').callback(); await flush(); expect(restore).not.toHaveBeenCalled(); confirm.mockResolvedValue(true); stub.commands.find((c: any) => c.id === 'restore-settings').callback(); await flush(); expect(restore).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000); expect(JSON.parse(h.texts.get('.obsidian/plugins/organized/crash-state.json')!).counter).toBe(0);
    plugin.onunload(); await flush(); expect(JSON.parse(h.texts.get('.obsidian/plugins/organized/crash-state.json')!).counter).toBe(0);
    const second = await loaded(); second.plugin.onunload(); second.h.layout[0](); expect(second.h.events.create).toBeUndefined();
  });
  it('survives bad crash state, pauses repeated-crash launch and reports load failures', async () => {
    const h = harness(); h.texts.set('.obsidian/plugins/organized/crash-state.json', '{"counter":5,"autoDisabled":false}');
    const plugin = new Organized(h.app, { id: 'organized', dir: '.obsidian/plugins/organized', version: '0.0.0' } as any); await plugin.onload(); expect((plugin as any).commands).toHaveLength(0); expect(Notice.instances.at(-1)?.message).toContain('repeated');
    const failing = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); vi.spyOn(failing, 'loadData').mockRejectedValue(Error('load failed')); await expect(failing.onload()).rejects.toThrow('load failed'); expect(Notice.instances.at(-1)?.message).toContain('load failed');
  });
  it('validates persisted settings without saving on load, keeps unknown fields when explicitly changed', async () => {
    const { h, plugin, stub } = await loaded(); stub.data = { settings: { taskFolder: '../bad', autoForward: false, unknownPreference: 'preserve' }, unknownFutureField: 'preserve' };
    await plugin.onload(); expect(plugin.settings.taskFolder).toBe('Tasks'); expect(plugin.settings.autoForward).toBe(false); expect(stub.data.unknownFutureField).toBe('preserve');
    plugin.saveSettings(); await flush(); expect(stub.data.unknownFutureField).toBe('preserve'); expect(stub.data.settings.unknownPreference).toBe('preserve'); expect(stub.data.schemaVersion).toBe(1);
    plugin.safety.writable = false; const action = vi.fn(async () => undefined); await plugin.run(action); expect(action).not.toHaveBeenCalled(); expect(() => plugin.assertWritable()).toThrow('paused'); plugin.saveSettings(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('paused');
    plugin.safety.writable = true; await plugin.run(async () => { throw Error('action failed'); }); expect(Notice.instances.at(-1)?.message).toContain('action failed'); await plugin.run(action); expect(action).toHaveBeenCalledOnce();
  });
  it('opens a fresh view factory, reuses a leaf and tolerates deferred non-custom views', async () => {
    const { h, plugin } = await loaded(); await expect(plugin.openInspector()).rejects.toThrow('Cannot open');
    const leaf: any = { app: h.app, setViewState: vi.fn(async () => undefined) }; const view = new OrganizedInspectorView(leaf, plugin); leaf.view = view; vi.spyOn(view, 'render').mockResolvedValue();
    h.raw.workspace.getRightLeaf.mockReturnValue(leaf); await plugin.openInspector('Task', 'Description'); expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, active: true }); expect(view.tab).toBe('Task'); expect(view.module).toBe('Description'); expect(view.editingModule).toBe('Description');
    h.raw.workspace.getLeavesOfType.mockReturnValue([leaf, { view: {} }]); const note: any = await h.add('Open.md'); h.setActive(note); await plugin.openInspector(); expect(h.raw.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    const seen = vi.fn(); plugin.eachView(seen); expect(seen).toHaveBeenCalledExactlyOnceWith(view);
    h.raw.workspace.getLeavesOfType.mockReturnValue([{ view: {} }]); await plugin.openInspector();
  });
  it('follows cursor context without stealing sidebar tab focus or browse selection on the same task', async () => {
    const { h, plugin } = await loaded(); expect(plugin.activeEditor()).toBeNull();
    const file: any = await h.add('Note.md', '- [ ] A <!--organized:task1234-->\nplain\n- [ ] B <!--organized:task5678-->'); const editor = h.setActive(file);
    const view = new OrganizedInspectorView({ app: h.app } as any, plugin); const render = vi.spyOn(view, 'render').mockResolvedValue(); h.raw.workspace.getLeavesOfType.mockReturnValue([{ view }]);
    plugin.followCursor(); expect(plugin.selectedTaskId).toBe('task1234'); expect(plugin.context?.file).toBe(file); expect(view.tab).toBe('Calendar');
    view.origin = 'Projects / favorites'; plugin.followCursor(); expect(view.origin).toBe('Projects / favorites');
    editor.setCursor({ line: 2, ch: 1 }); plugin.followCursor(); expect(plugin.selectedTaskId).toBe('task5678'); expect(view.origin).toBe('Editor cursor');
    editor.setCursor({ line: 1, ch: 0 }); plugin.followCursor(); expect(plugin.selectedTaskId).toBeNull(); h.clearActive(); plugin.followCursor(); expect(render).toHaveBeenCalled();
    plugin.refresh(); expect(plugin.revision).toBeGreaterThan(0);
  });
  it('deletes a task only after confirmation and returns cleared views to projects', async () => {
    const { h, plugin } = await loaded(); h.layout[0](); const task = await plugin.repo.create('Delete'); const view = new OrganizedInspectorView({ app: h.app } as any, plugin);
    view.tab = 'Task'; view.module = 'Description'; h.raw.workspace.getLeavesOfType.mockReturnValue([{ view }]);
    plugin.selectedTaskId = task.id; plugin.context = { file: { path: 'Note.md' } as any, line: parseTasks(`- [ ] Delete <!--organized:${task.id}-->`)[0] };
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(false); await plugin.deleteTask(task.id);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete'), 'Delete task', 'Delete'); expect(plugin.selectedTaskId).toBe(task.id); expect(view.tab).toBe('Task');
    confirm.mockResolvedValue(true);
    const trash = h.raw.fileManager.trashFile.getMockImplementation()!;
    h.raw.fileManager.trashFile.mockImplementationOnce(async (file: any) => { await trash(file); h.events.delete[0](file); });
    const refresh = vi.spyOn(plugin, 'refresh'); await plugin.deleteTask(task.id); await flush();
    expect(plugin.selectedTaskId).toBeNull(); expect(plugin.context).toBeNull(); expect(view.tab).toBe('Projects'); expect(view.module).toBe(''); expect(refresh).toHaveBeenCalled();
    expect(Notice.instances.map(note => String(note.message)).join(' ')).not.toContain('Missing task');
    const keep = await plugin.repo.create('Keep'); const other = await plugin.repo.create('Other'); plugin.selectedTaskId = keep.id;
    plugin.context = { file: { path: 'Note.md' } as any, line: parseTasks(`- [ ] Keep <!--organized:${keep.id}-->`)[0] };
    await plugin.deleteTask(other.id); expect(plugin.selectedTaskId).toBe(keep.id); expect(plugin.context?.line.id).toBe(keep.id);
    await plugin.deleteTask('missing1');
  });
  it('picker cancel writes nothing, explicit choices attach, stale context creates no record, duplicate has a new ID', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Note.md', '- [ ] Draft'); const editor = h.setActive(file);
    await plugin.pickTask(editor as any, file); let picker = Modal.instances.at(-1) as TaskPicker; expect(picker).toBeInstanceOf(TaskPicker); picker.close(); expect(await plugin.repo.list()).toHaveLength(0);
    await plugin.pickTask(editor as any, file); picker = Modal.instances.at(-1) as TaskPicker; editor.setValue('- [ ] changed'); picker.onChooseSuggestion('New'); picker.close(); await flush(); expect(await plugin.repo.list()).toHaveLength(0); expect(editor.getValue()).toBe('- [ ] changed');
    await plugin.pickTask(editor as any, file); picker = Modal.instances.at(-1) as TaskPicker; picker.onChooseSuggestion('Canonical'); picker.close(); await flush(); expect(await plugin.repo.list()).toHaveLength(1); const first = parseTasks(editor.getValue())[0].id; expect(first).toBeTruthy();
    await expect(plugin.pickTask(editor as any, file)).rejects.toThrow('already linked');
    await plugin.pickTask(editor as any, file, true); picker = Modal.instances.at(-1) as TaskPicker; expect(picker.tasks).toHaveLength(0); picker.onChooseSuggestion('Independent'); picker.close(); await flush(); expect(parseTasks(editor.getValue())[0].id).not.toBe(first); expect(await plugin.repo.list()).toHaveLength(2);
    editor.setValue('prose'); await expect(plugin.pickTask(editor as any, file)).rejects.toThrow('Markdown task');
    const task = (await plugin.repo.list())[0]; editor.setValue('- [ ] existing'); await plugin.pickTask(editor as any, file); picker = Modal.instances.at(-1) as TaskPicker; picker.onChooseSuggestion(task); picker.close(); await flush(); expect(parseTasks(editor.getValue())[0].id).toBe(task.id);
  });
  it('closes the automatic picker while preserving a plain checkbox todo', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Todo.md', '- [ ] Keep ordinary'); const editor = h.setActive(file);
    await plugin.pickTask(editor as any, file, false, true);
    const picker = Modal.instances.at(-1) as TaskPicker;
    expect(picker.getSuggestions('')).toContainEqual(expect.objectContaining({ keepAsTodo: true }));
    picker.onChooseSuggestion(KEEP_AS_TODO); picker.close(); await flush();
    expect(editor.getValue()).toBe('- [ ] Keep ordinary'); expect(await plugin.repo.list()).toHaveLength(0);
  });
  it('routes date, priority, description, source and project markers with cancellation preserving markers', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Task'); const file: any = await h.add('Note.md', '');
    const context = (marker: string) => { const text = `- [${marker}] Task <!--organized:${task.id}-->`; h.texts.set(file.path, text); return { file, line: parseTasks(text)[0] }; };
    const schedule = vi.spyOn(plugin.service, 'schedule').mockResolvedValue(); await plugin.trigger(context('<')); let modal = Modal.instances.at(-1) as DatePicker; expect(modal).toBeInstanceOf(DatePicker); await modal.choose('2026-01-01'); expect(schedule).toHaveBeenCalled(); modal.close();
    const priority = vi.spyOn(plugin.service, 'priority').mockResolvedValue(); await plugin.trigger(context('!')); const picker = Modal.instances.at(-1) as PriorityPicker; await picker.choose('high'); expect(priority).toHaveBeenCalled(); picker.close();
    const open = vi.spyOn(plugin, 'openInspector').mockResolvedValue(); const clean = vi.spyOn(plugin.service, 'clean').mockResolvedValue(); for (const marker of ['a', 's']) await plugin.trigger(context(marker)); expect(open.mock.calls.map(c => c[1])).toEqual(['Description', 'Sources']); expect(clean).toHaveBeenCalledTimes(2);
    await plugin.trigger(context('s')); expect(open).toHaveBeenLastCalledWith('Task', 'Sources'); expect(clean).toHaveBeenCalledTimes(3);
    await plugin.trigger(context('j')); const projects = Modal.instances.at(-1) as ProjectPicker; await projects.save(['Project.md']); expect((await plugin.repo.read(task.id)).projects).toEqual(['Project.md']); projects.close();
    await plugin.trigger(context('*')); expect((await plugin.repo.read(task.id)).starred).toBe(true);
    for (const marker of ['d', 'p', 'i', 'I', '?', '"', 'b', 'f']) await plugin.trigger(context(marker));
    expect(open).toHaveBeenCalledTimes(3); expect(clean).toHaveBeenCalledTimes(4); expect((await plugin.repo.read(task.id)).recurring).toBe(false);
    await plugin.trigger({ file, line: parseTasks('- [k] visual')[0] }); expect(await plugin.repo.list()).toHaveLength(1);
    const missing = harness(); const p = new Organized(missing.app, {} as any); (p as any).repo = missing.repo; await expect(p.saveModule('missing1', 'Sources', 'text')).rejects.toThrow('missing');
    const canonical = plugin.repo.file(plugin.repo.taskPath(task.id))!; await plugin.saveModule(task.id, 'Sources', '- [Source](https://example.com)'); expect(await plugin.repo.readText(canonical)).toContain('https://example.com');
    await plugin.saveModule(task.id, 'Description', '$1 replacement'); const saved = await plugin.repo.readText(canonical); expect(saved).not.toContain('## Description'); expect(saved).toContain('$1 replacement');
    const todos: any = await h.add('Todos.md', '- [ ] Convert me'); const delegate = vi.spyOn(plugin.service, 'convertTodos').mockResolvedValue(); await plugin.convertTodos(todos); expect(delegate).toHaveBeenCalledWith(todos);
    const confirmed = plugin.confirm('Yes?'); const confirmation = Modal.instances.at(-1) as ConfirmModal; confirmation.done(true); expect(await confirmed).toBe(true); confirmation.close();
  });
  it('ignores programmatic edits, pastes, irrelevant changes and bulk blocks', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Note.md', '- [ ] A'); const editor = h.setActive(file); const pick = vi.spyOn(plugin, 'pickTask').mockResolvedValue(); const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue();
    plugin.onEditorUpdate(update('same', 'same', 'input.type', true));
    for (const event of [null, 'input.paste', 'input.drop', 'undo', 'redo', 'input.organized']) plugin.onEditorUpdate(update('old', '- [ ] A', event));
    editor.setValue('- [ ] A\n- [ ] B\n- [ ] C'); plugin.onEditorUpdate(update('', editor.getValue()));
    editor.setValue('prose'); plugin.onEditorUpdate(update('', 'prose')); h.clearActive(); plugin.onEditorUpdate(update('', '- [ ] A'));
    await flush(); expect(pick).not.toHaveBeenCalled(); expect(trigger).not.toHaveBeenCalled();
    h.setActive(file, '- [ ] '); plugin.onEditorUpdate(update('- [', '- [ ] ')); await flush(); expect(pick).toHaveBeenCalledOnce();
  });
  it('opens the task picker for the mobile checkbox toolbar insertion without a CM user event', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Toolbar.md');
    const editor = h.setActive(file, '- [ ] '); const pick = vi.spyOn(plugin, 'pickTask').mockResolvedValue();
    plugin.onEditorUpdate(update('', '- [ ] ', null)); await flush();
    expect(editor.getValue()).toBe('- [ ] '); expect(pick).toHaveBeenCalledOnce();
    (plugin as any).pickerOpen = false; pick.mockClear();
    plugin.onEditorUpdate(update('', '- [ ] ', 'input.paste')); await flush(); expect(pick).not.toHaveBeenCalled();
  });
  it('triggers only changed linked markers, first manages deliberate syntax and stops removed active timers with a notice', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Managed'); const file: any = await h.add('Note.md'); const editor = h.setActive(file);
    const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue();
    const old = `- [ ] Managed <!--organized:${task.id}-->`; const next = old.replace('[ ]', '[/]'); editor.setValue(next); plugin.onEditorUpdate(update(old, next)); await flush(); expect(trigger).toHaveBeenCalledOnce();
    editor.setValue(old.replace('Managed', 'Edited title')); plugin.onEditorUpdate(update(old, editor.getValue())); await flush(); expect(trigger).toHaveBeenCalledOnce();
    editor.setValue('- [!] First'); plugin.onEditorUpdate(update('- [ ] First', editor.getValue())); await flush(); expect(await plugin.repo.list()).toHaveLength(2); expect(parseTasks(editor.getValue())[0].id).toBeTruthy(); expect(trigger).toHaveBeenCalledTimes(2);
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(true); const status = vi.spyOn(plugin.service, 'status').mockResolvedValue();
    editor.setValue('- [ ] remains'); plugin.onEditorUpdate(update(next, editor.getValue())); await flush(); expect(confirm).not.toHaveBeenCalled(); expect(status).toHaveBeenCalledWith(task.id, 'open'); expect(Notice.instances.at(-1)?.message).toContain('Timer stopped for');
    confirm.mockResolvedValue(false); plugin.onEditorUpdate(update(next, editor.getValue())); await flush(); expect(status).toHaveBeenCalledOnce();
  });
  it('coalesces picker microtasks, handles new linked lines and never asks about a removed timer', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Note.md'); const editor = h.setActive(file, '- [ ] ');
    const picker = vi.spyOn(plugin, 'pickTask').mockImplementation(async () => { (plugin as any).pickerOpen = true; });
    plugin.onEditorUpdate(update('- [', '- [ ] ')); plugin.onEditorUpdate(update('- [', '- [ ] ')); await flush(); expect(picker).toHaveBeenCalledOnce();
    plugin.onEditorUpdate(update('- [', '- [ ] ')); await flush(); expect(picker).toHaveBeenCalledOnce(); (plugin as any).pickerOpen = false;
    const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue(); editor.setValue('- [/] Existing <!--organized:task1234-->'); plugin.onEditorUpdate(update('', editor.getValue())); await flush(); expect(trigger).toHaveBeenCalledOnce();
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(false); const status = vi.spyOn(plugin.service, 'status').mockResolvedValue(); const old = editor.getValue(); editor.setValue('ordinary prose'); plugin.onEditorUpdate(update(old, editor.getValue())); await flush(); expect(confirm).not.toHaveBeenCalled(); expect(status).toHaveBeenCalledWith('task1234', 'open');
  });
  it('migrates linked projects once after layout ready, announces it with an undo, and never moves anything when writes are paused', async () => {
    const { h, plugin } = await loaded(); const folder = plugin.repo.projectFolder();
    const task = await plugin.repo.create('Linked'); await h.add('Plan.md', 'plan'); await h.add('Other/Plan.md'); await h.add('Kept.md');
    await plugin.repo.update(task.id, t => ({ ...t, projects: ['Plan.md', 'Other/Plan.md'] })); plugin.settings.knownProjects = ['Kept.md', 'Plan.md', 'Ghost.md'];
    plugin.safety.writable = false; await plugin.migrateProjects(); expect(h.texts.has('Plan.md')).toBe(true); expect(plugin.settings.projectsMigrated).toBe(false); plugin.safety.writable = true;
    Notice.instances.length = 0; h.layout[0](); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(h.texts.get(`${folder}/Plan.md`)).toContain('plan'); expect(h.texts.get(`${folder}/Plan.md`)).toContain('organized_type: project'); expect(plugin.settings.projectStartsSet).toBe(true); expect(plugin.settings.projectNotesMarked).toBe(true); expect(plugin.settings.projectsMigrated).toBe(true); expect(plugin.settings.knownProjects).toEqual([`${folder}/Kept.md`, `${folder}/Plan.md`, 'Ghost.md']);
    const notice = Notice.instances.find(n => String(n.message instanceof DocumentFragment ? n.message.textContent : n.message).includes('Projects moved'))!; const text = (notice.message as DocumentFragment).textContent!;
    expect(text).toContain('2 project notes moved'); expect(text).toContain('1 skipped'); expect(text).toContain('Other/Plan.md');
    const undoButton = (notice.message as DocumentFragment).querySelector('button')!; undoButton.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(h.texts.get('Plan.md')).toContain('plan'); expect(plugin.settings.knownProjects).toEqual(['Kept.md', 'Plan.md', 'Ghost.md']); expect(Notice.instances.at(-1)?.message).toBe('Project notes moved back.');
    Notice.instances.length = 0; await plugin.migrateProjects(); expect(Notice.instances).toHaveLength(0); expect(h.texts.has('Plan.md')).toBe(true);
  });
  it('stays quiet when there is nothing to migrate and reports undo conflicts', async () => {
    const { h, plugin } = await loaded(); Notice.instances.length = 0; await plugin.migrateProjects(); expect(plugin.settings.projectsMigrated).toBe(true); expect(Notice.instances).toHaveLength(0);
    const task = await plugin.repo.create('Linked'); const folder = plugin.repo.projectFolder(); await h.add('Plan.md'); plugin.settings.projectsMigrated = false; await plugin.repo.update(task.id, t => ({ ...t, projects: ['Plan.md'] }));
    await plugin.migrateProjects(); const notice = Notice.instances.at(-1)!; await h.add('Plan.md'); (notice.message as DocumentFragment).querySelector('button')!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(Notice.instances.at(-1)?.message).toContain('Some projects could not move back'); expect(h.texts.has(`${folder}/Plan.md`)).toBe(true);
    plugin.settings.projectsMigrated = false; plugin.settings.knownProjects = []; const only = await h.add('Solo.md'); await plugin.repo.update(task.id, t => ({ ...t, projects: ['Solo.md'] })); h.files.set(`${folder}/Solo.md`, only); Notice.instances.length = 0; await plugin.migrateProjects(); expect(Notice.instances.at(-1)?.message).toBeTruthy();
  });
  it('finds the open note for the task list even when no editor event has fired and the panel has focus', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Daily/Today.md', '# Work\n- [ ] A'); const editor: any = { getValue: () => '# Work\n- [ ] A', getCursor: () => ({ line: 0, ch: 0 }) };
    const recent = h.raw.workspace.getMostRecentLeaf; expect(plugin.taskSourceEditor()).toBeNull();
    const view = Object.assign(new MarkdownView(), { file, editor }); recent.mockReturnValue({ view } as any);
    expect(plugin.taskSourceEditor()).toEqual({ editor, file });
    recent.mockReturnValue({ view: { file, editor } } as any); expect(plugin.taskSourceEditor()).toEqual({ editor, file });
    recent.mockReturnValue({ view: Object.assign(new MarkdownView(), { file: null, editor }) } as any); expect(plugin.taskSourceEditor()).toEqual({ editor, file });
    recent.mockReturnValue(null); h.files.delete(file.path); expect(plugin.taskSourceEditor()).toBeNull();
  });
  it('repaints the task list when the note changes even if no task is selected before or after, and on file-open', async () => {
    const { h, plugin } = await loaded(); h.layout[0]();
    const first: any = await h.add('Recovery.md', '- [ ] Plain one'); const second: any = await h.add('Daily.md', 'Intro\n- [ ] Plain two');
    const view = new OrganizedInspectorView({ app: h.app } as any, plugin); const render = vi.spyOn(view, 'render').mockResolvedValue(); h.raw.workspace.getLeavesOfType.mockReturnValue([{ view }]);
    h.setActive(first); view.tab = 'Task'; view.module = 'Sources'; plugin.followCursor(); expect(render).toHaveBeenCalledTimes(1); expect(view.module).toBe('Sources');
    plugin.followCursor(); expect(render).toHaveBeenCalledTimes(1);
    h.setActive(second); h.events['file-open'][0](second); expect(render).toHaveBeenCalledTimes(2); expect(plugin.taskSourceEditor()?.file).toBe(second);
    h.clearActive(); h.raw.workspace.getMostRecentLeaf.mockReturnValue({ view: Object.assign(new MarkdownView(), { file: first, editor: { getValue: () => '' } }) } as any);
    plugin.followCursor(); expect(render).toHaveBeenCalledTimes(3); plugin.followCursor(); expect(render).toHaveBeenCalledTimes(3);
  });
  it('propagates a checkbox ticked in Live Preview even without a user event or cursor on its line', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Clean'); const other = await plugin.repo.create('Other');
    const open = `Intro\n- [ ] Clean <!--organized:${task.id}-->\n- [x] Other <!--organized:${other.id}-->\n- [ ] Plain`; const file: any = await h.add('Daily.md', open);
    const status = vi.spyOn(plugin.service, 'status').mockResolvedValue(); const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue();
    const tick = (text: string, line: number, insert: string, event: string | null) => { const index = text.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0) + text.split('\n')[line].indexOf('[') + 1; return { index, next: text.slice(0, index) + insert + text.slice(index + 1), event }; };
    const editor = h.setActive(file, open); editor.setCursor({ line: 0, ch: 0 });
    let step = tick(open, 1, 'x', null); editor.setValue(step.next); plugin.onEditorUpdate(replaceAt(open, step.index, step.index + 1, 'x')); await flush();
    expect(status).toHaveBeenCalledTimes(1); expect(status).toHaveBeenLastCalledWith(task.id, 'completed', expect.objectContaining({ file }));
    const ticked = step.next; step = tick(ticked, 1, ' ', 'select.pointer'); editor.setValue(step.next); plugin.onEditorUpdate(replaceAt(ticked, step.index, step.index + 1, ' ', 'select.pointer')); await flush();
    expect(status).toHaveBeenCalledTimes(2); expect(status).toHaveBeenLastCalledWith(task.id, 'open', expect.anything());
    step = tick(open, 2, ' ', null); editor.setValue(step.next); plugin.onEditorUpdate(replaceAt(open, step.index, step.index + 1, ' ')); await flush(); expect(status).toHaveBeenLastCalledWith(other.id, 'open', expect.anything());
    status.mockClear(); const no = (text: string, from: number, to: number, insert: string, event: string | null = null) => { editor.setValue(text.slice(0, from) + insert + text.slice(to)); plugin.onEditorUpdate(replaceAt(text, from, to, insert, event)); };
    const plainIndex = open.indexOf('[ ] Plain') + 1; no(open, plainIndex, plainIndex + 1, 'x'); await flush();
    const inProgress = open.indexOf('[ ] Clean') + 1; no(open, inProgress, inProgress + 1, '/'); await flush();
    no(open, inProgress, inProgress + 1, 'xx'); await flush(); no(open, 0, 0, 'z'); await flush();
    no(`- [x] Same <!--organized:${task.id}-->`, 3, 4, 'X'); await flush(); expect(status).not.toHaveBeenCalled();
    editor.setCursor({ line: 1, ch: 3 }); const typed = open.indexOf('[ ] Clean') + 1; no(open, typed, typed + 1, 'x', 'input.type'); await flush(); expect(trigger).toHaveBeenCalledOnce(); expect(status).not.toHaveBeenCalled();
  });
  it('renames a linked task shortly after its todo text is edited in a note, everywhere it appears', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Old title'); const line = `- [ ] Old title <!--organized:${task.id}-->`;
    const file: any = await h.add('Daily.md', `Intro\n${line}`); const other: any = await h.add('Project.md', line);
    const editor = h.setActive(file, `Intro\n${line}`); editor.setCursor({ line: 1, ch: 8 });
    const rename = vi.spyOn(plugin.service, 'title'); const type = (text: string, from: number, to: number, insert: string, event: string | null = 'input.type') => { const before = editor.getValue(); const next = before.slice(0, from) + insert + before.slice(to); editor.setValue(next); plugin.onEditorUpdate(replaceAt(before, from, to, insert, event)); return text; };
    const at = `Intro\n- [ ] `.length; type('', at, at + 3, 'Newer'); await vi.advanceTimersByTimeAsync(500); expect(rename).not.toHaveBeenCalled();
    type('', at, at + 5, 'New'); await vi.advanceTimersByTimeAsync(799); expect(rename).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); await flush();
    expect(rename).toHaveBeenCalledOnce(); expect(rename).toHaveBeenCalledWith(task.id, 'New title'); expect((await plugin.repo.read(task.id)).title).toBe('New title'); expect(h.texts.get(other.path)).toContain('- [ ] New title <!--organized:');
    rename.mockClear(); await vi.advanceTimersByTimeAsync(2000); expect(rename).not.toHaveBeenCalled();
  });
  it('ignores edits that are not a title change on a single linked line', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Same'); const line = `- [ ] Same <!--organized:${task.id}-->`;
    const file: any = await h.add('Daily.md', `Intro\n${line}\n- [ ] Plain\n${line}`); const editor = h.setActive(file, `Intro\n${line}\n- [ ] Plain\n${line}`);
    const rename = vi.spyOn(plugin.service, 'title').mockResolvedValue(); const edit = (before: string, from: number, to: number, insert: string, event: string | null = 'input.type', cursor = 1) => { editor.setValue(before.slice(0, from) + insert + before.slice(to)); editor.setCursor({ line: cursor, ch: 0 }); plugin.onEditorUpdate(replaceAt(before, from, to, insert, event)); };
    const base = editor.getValue(); const title = base.indexOf('Same'); const run = async () => { await vi.advanceTimersByTimeAsync(1000); await flush(); };
    edit(base, title, title + 4, 'Other', 'input.organized'); await run(); expect(rename).not.toHaveBeenCalled();
    editor.setValue(base); edit(base, title, title + 4, 'Other', 'input.type', 2); await run(); expect(rename).not.toHaveBeenCalled();
    editor.setValue(base); const marker = base.indexOf('[ ]') + 1; edit(base, marker, marker + 1, 'x'); await run(); expect(rename).not.toHaveBeenCalled();
    const plain = base.indexOf('Plain'); editor.setValue(base); edit(base, plain, plain + 5, 'Changed', 'input.type', 2); await run(); expect(rename).not.toHaveBeenCalled();
    const stale = replaceAt(base, title, title + 4, 'Mismatch'); editor.setValue('something else'); plugin.onEditorUpdate(stale); await run(); expect(rename).not.toHaveBeenCalled();
    h.clearActive(); plugin.onEditorUpdate(replaceAt(base, title, title + 4, 'Inactive')); await run(); expect(rename).not.toHaveBeenCalled();
    // The same task twice in one note is ambiguous, so nothing is renamed.
    const live = h.setActive(file, base); live.setCursor({ line: 1, ch: 0 }); live.setValue(base.replace('Same', 'Other')); plugin.onEditorUpdate(replaceAt(base, title, title + 4, 'Other')); await run(); expect(rename).not.toHaveBeenCalled();
  });
  it('skips blank, unchanged and cleared-on-unload title syncs', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Keep'); const line = `- [ ] Keep <!--organized:${task.id}-->`; const file: any = await h.add('Daily.md', line); const editor = h.setActive(file, line); editor.setCursor({ line: 0, ch: 0 });
    const rename = vi.spyOn(plugin.service, 'title').mockResolvedValue(); const edit = (to: string) => { const before = editor.getValue(); const title = before.indexOf('Keep') >= 0 ? 'Keep' : before.slice(6, before.indexOf(' <!--')); const from = before.indexOf(title); editor.setValue(before.slice(0, from) + to + before.slice(from + title.length)); plugin.onEditorUpdate(replaceAt(before, from, from + title.length, to)); };
    edit(''); h.texts.set(file.path, editor.getValue()); await vi.advanceTimersByTimeAsync(1000); await flush(); expect(rename).not.toHaveBeenCalled();
    editor.setValue(line); h.texts.set(file.path, line); edit('Keep'); edit('Kee'); edit('Keep'); await vi.advanceTimersByTimeAsync(1000); await flush(); expect(rename).not.toHaveBeenCalled();
    editor.setValue(line); h.texts.set(file.path, line); edit('Pending'); plugin.onunload(); await vi.advanceTimersByTimeAsync(2000); await flush(); expect(rename).not.toHaveBeenCalled();
  });
  it('marks old project notes once, only when writes are allowed, and says nothing when there are none', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Linked'); await h.add('Old.md', 'old'); await plugin.repo.update(task.id, t => ({ ...t, projects: ['Old.md'] }));
    plugin.safety.writable = false; await plugin.markProjectNotes(); expect(plugin.settings.projectStartsSet).toBe(false); expect(h.texts.get('Old.md')).toBe('old'); plugin.safety.writable = true;
    plugin.settings.projectStartsSet = false; Notice.instances.length = 0; await plugin.markProjectNotes(); expect(h.texts.get('Old.md')).toContain('organized_type: project'); expect(Notice.instances.at(-1)?.message).toContain('1 project note updated');
    Notice.instances.length = 0; await plugin.markProjectNotes(); expect(Notice.instances).toHaveLength(0);
    plugin.settings.projectStartsSet = false; await plugin.markProjectNotes(); expect(Notice.instances).toHaveLength(0); expect(plugin.settings.projectStartsSet).toBe(true); expect(plugin.settings.projectNotesMarked).toBe(true);
    await h.add('Two.md'); await h.add('Three.md'); plugin.settings.knownProjects = ['Two.md', 'Three.md']; plugin.settings.projectStartsSet = false; await plugin.markProjectNotes(); expect(Notice.instances.at(-1)?.message).toContain('2 project notes updated');
  });
  it('refreshes every open markdown note, not only the focused one, and ignores views without an editor', async () => {
    const { h, plugin } = await loaded(); const a: any = { dispatch: vi.fn() }; const b: any = { dispatch: vi.fn() };
    const view = (cm: any) => Object.assign(Object.create(MarkdownView.prototype), { editor: { cm } }); h.raw.workspace.getLeavesOfType.mockImplementation(((type: string) => type === 'markdown' ? [{ view: view(a) }, { view: view(b) }, { view: view(undefined) }, { view: {} }] : []) as any);
    plugin.refresh(); expect(a.dispatch).toHaveBeenCalledOnce(); expect(b.dispatch).toHaveBeenCalledOnce(); h.raw.workspace.getLeavesOfType.mockReturnValue([] as any);
  });
  it('repaints when a project note changes, not for other notes', async () => {
    const { h, plugin } = await loaded(); h.layout[0](); await flush(); await vi.advanceTimersByTimeAsync(0); await flush(); const spy = vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined); const projectNote: any = await h.add('Proj.md', '---\norganized_type: project\n---\n'); const other: any = await h.add('Other.md', 'x');
    for (const fn of h.events['changed'] ?? []) { fn(other); expect(spy).not.toHaveBeenCalled(); fn(projectNote); expect(spy).toHaveBeenCalledOnce(); }
    expect(h.events['changed']?.length).toBeGreaterThan(0);
  });
});
describe('lifecycle and picker races', () => {
  it('does not register anything when disabled while onload is still awaiting settings', async () => {
    vi.useFakeTimers(); const h = harness();
    const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.0.0', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
    let release!: (value: unknown) => void; vi.spyOn(plugin, 'loadData').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const loading = plugin.onload(); await flush(); plugin.onunload(); release({}); await loading; await flush();
    expect((plugin as any).commands).toHaveLength(0); expect(h.layout).toHaveLength(0);
  });
  it('keeps editor handling enabled when the task list cannot be read for the picker', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Note.md', '- [ ] ordinary'); const editor: any = h.setActive(file);
    vi.spyOn(plugin.repo, 'list').mockRejectedValueOnce(Error('list failed'));
    await expect(plugin.pickTask(editor, file)).rejects.toThrow('list failed'); expect((plugin as any).pickerOpen).toBe(false);
  });
  it('converts a task into a standalone note from the [n] marker, offering folders and templates and remembering the folder', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Idea todo'); await h.add('Templates/Note.md', 'tpl'); await h.add('Other/Plain.md', 'x'); h.files.set('Ideas', new TFolder('Ideas')); h.files.set('/', new TFolder('/'));
    const daily: any = await h.add('Daily/Today.md', `- [n] Idea todo <!--organized:${task.id}-->`); const line = parseTasks(h.texts.get(daily.path)!)[0]; plugin.selectedTaskId = task.id;
    expect(plugin.noteFolders()).toEqual(['Ideas', 'Tasks']); expect(plugin.templateFiles()).toEqual(['Templates/Note.md']);
    (plugin.app as any).internalPlugins = { getPluginById: () => ({ instance: { options: { folder: 'Other' } } }) }; expect(plugin.templateFiles()).toEqual(['Other/Plain.md']); (plugin.app as any).internalPlugins = { getPluginById: () => null }; expect(plugin.templateFiles()).toEqual(['Templates/Note.md']); delete (plugin.app as any).internalPlugins;
    plugin.settings.noteFolder = 'Ideas'; await plugin.trigger({ file: daily, line } as any); const modal = Modal.instances.at(-1) as unknown as NoteConversionModal; expect(modal.titleEl.textContent).toBe('Make a standalone note'); expect((modal.contentEl.querySelector('input[type=text]') as HTMLInputElement).value).toBe('Ideas');
    const convert = vi.spyOn(plugin.service, 'convertToNote'); Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Create note')!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(convert).toHaveBeenCalledWith(task.id, { folder: 'Ideas', tags: [], template: null, clash: 'new' }, expect.objectContaining({ file: daily })); expect(h.texts.get('Ideas/Idea todo.md')).toBe(''); expect(h.texts.get(daily.path)).toBe('- [[Ideas/Idea todo]]'); expect(plugin.selectedTaskId).toBeNull(); expect(plugin.context).toBeNull(); expect(plugin.settings.noteFolder).toBe('Ideas');
    const timed = await plugin.repo.create('Timed todo'); await plugin.repo.update(timed.id, t => ({ ...t, work_sessions: [{ start: '2026-03-04T09:00:00.000Z', end: '2026-03-04T09:42:00.000Z' }], time_tracked_seconds: 2520 })); plugin.convertToNote(await plugin.repo.read(timed.id)); expect((Modal.instances.at(-1) as any).contentEl.textContent).toContain('42 min of tracked time'); (Modal.instances.at(-1) as any).close();
    const other = await plugin.repo.create('Panel task'); plugin.selectedTaskId = 'someone-else'; const fake: any = { module: 'x', editingModule: 'y', editingTitle: true, render: async () => undefined }; vi.spyOn(plugin, 'eachView').mockImplementation(cb => cb(fake)); plugin.convertToNote(other); const panel = Modal.instances.at(-1) as unknown as NoteConversionModal; Array.from(panel.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Create note')!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush(); expect(plugin.selectedTaskId).toBe('someone-else'); expect([fake.module, fake.editingModule, fake.editingTitle]).toEqual(['', '', false]); expect(h.texts.has('Ideas/Panel task.md')).toBe(true);
  });
});
describe('onboarding card at startup', () => {
  const cards = () => Modal.instances.filter(m => m instanceof OnboardingModal) as OnboardingModal[];
  it('opens once after layout-ready, writes nothing until it closes, then never again', async () => {
    Modal.instances.length = 0; const { h, plugin, stub } = await loaded(); const before = JSON.stringify(stub.settingsRaw);
    expect(cards()).toHaveLength(0); h.layout[0](); expect(cards()).toHaveLength(1); await flush();
    expect(plugin.settings.onboardingSeen).toBe(false); expect(JSON.stringify(stub.settingsRaw)).toBe(before);
    cards()[0].close(); await flush(); expect(plugin.settings.onboardingSeen).toBe(true);
    const saved = (await plugin.loadData()).settings; expect(saved.onboardingSeen).toBe(true);
    const second = await loaded(); (second.plugin as any).settings.onboardingSeen = true; second.h.layout[0](); expect(cards()).toHaveLength(1);
  });
  it('stays quiet when the plugin loaded late, writes are paused or the card was already seen', async () => {
    Modal.instances.length = 0;
    const late = await loaded(); late.stub.startedRecently = () => false; late.h.layout[0](); expect(cards()).toHaveLength(0);
    const paused = await loaded(); paused.stub.safety = { writable: false }; paused.h.layout[0](); expect(cards()).toHaveLength(0);
    const seen = await loaded(); seen.plugin.settings.onboardingSeen = true; seen.h.layout[0](); expect(cards()).toHaveLength(0);
    const real = await loaded(); expect(real.plugin.startedRecently()).toBe(true);
    vi.spyOn(performance, 'now').mockReturnValue(60_000); expect(real.plugin.startedRecently()).toBe(false); vi.restoreAllMocks();
  });
  it('the command and the Settings button reopen it without changing the flag', async () => {
    Modal.instances.length = 0; const { plugin, stub } = await loaded(); plugin.settings.onboardingSeen = true;
    stub.commands.find((c: any) => c.id === 'show-onboarding').callback(); expect(cards()).toHaveLength(1); cards()[0].close(); await flush();
    expect(plugin.settings.onboardingSeen).toBe(true);
    plugin.settings.onboardingSeen = false; stub.commands.find((c: any) => c.id === 'show-onboarding').callback(); cards()[1].close(); await flush(); expect(plugin.settings.onboardingSeen).toBe(false);
  });
});
describe('Retire window wiring', () => {
  const windows = () => Modal.instances.filter(m => m instanceof RetireModal) as RetireModal[];
  it('opens from the command and the Settings button with defaults taken from the cleanup settings', async () => {
    Modal.instances.length = 0; const { plugin, stub } = await loaded();
    stub.commands.find((c: any) => c.id === 'retire-tasks').callback(); expect(windows()).toHaveLength(1); expect(windows()[0].defaults).toEqual({ which: 'all', olderThanDays: 7, lines: 'plain', keep: 'title', notes: 'keep', yaml: 'keep' });
    plugin.settings.taskRetentionDays = 30; plugin.settings.retentionDetail = 'all'; plugin.retireTasks(); expect(windows()[1].defaults).toEqual({ which: 'closed', olderThanDays: 30, lines: 'plain', keep: 'all', notes: 'keep', yaml: 'keep' });
    expect(stub.commands.find((c: any) => c.id === 'unlink-vault-tasks')).toBeUndefined();
  });
  it('asks once more before removing properties or trashing notes, and not for safe choices', async () => {
    Modal.instances.length = 0; const { plugin } = await loaded(); const retire = vi.spyOn(plugin.service, 'retireTasks').mockResolvedValue(); const confirm = vi.spyOn(plugin, 'confirm');
    plugin.retireTasks(); const modal = windows()[0]; const safe = { ...modal.defaults, notes: 'rename' as const, lines: 'link' as const };
    confirm.mockResolvedValue(true); await modal.run(safe); expect(confirm).not.toHaveBeenCalled(); expect(retire).toHaveBeenCalledTimes(1);
    await modal.run({ ...safe, yaml: 'strip' }); expect(confirm.mock.calls.at(-1)![0]).toContain('properties'); expect(retire).toHaveBeenCalledTimes(2);
    await modal.run({ ...safe, notes: 'trash' }); expect(confirm.mock.calls.at(-1)![0]).toContain('trash'); expect(retire).toHaveBeenCalledTimes(3);
    confirm.mockResolvedValue(false); await modal.run({ ...safe, notes: 'trash' }); expect(retire).toHaveBeenCalledTimes(3);
    const write = vi.spyOn(plugin.safety, 'writeBackup').mockResolvedValue('saved.json'); const backup = (retire.mock.calls[0] as any)[1]; expect(await backup([{ path: 'a.md', before: 'x' }], { renames: [] })).toBe('saved.json'); expect(write).toHaveBeenCalledWith('retire', [{ path: 'a.md', before: 'x' }], { renames: [] });
  });
});
describe('renaming a note a task became', () => {
  it('updates where the task points, only for such notes and only while writes are allowed', async () => {
    const { h, plugin } = await loaded(); h.layout[0](); const task = await plugin.repo.create('Tracked'); await plugin.repo.update(task.id, t => ({ ...t, converted_to: 'Notes/Tracked.md' }));
    const note: any = await h.add('Notes/Tracked.md', 'x'); const rename = h.events.rename[0];
    const spy = vi.spyOn(plugin.service, 'followRename'); note.path = 'Notes/Tracked_v2.md'; rename(note, 'Notes/Tracked.md'); await flush();
    expect(spy).toHaveBeenCalledExactlyOnceWith('Notes/Tracked.md', 'Notes/Tracked_v2.md'); expect((await plugin.repo.read(task.id)).converted_to).toBe('Notes/Tracked_v2.md');
    rename({ ...note, path: 'Other.md' }, 'Unrelated.md'); await flush(); expect(spy).toHaveBeenCalledTimes(1);
    plugin.safety.writable = false; await plugin.repo.update(task.id, t => ({ ...t, converted_to: 'Notes/Again.md' })); rename(note, 'Notes/Again.md'); await flush(); expect(spy).toHaveBeenCalledTimes(1); expect((await plugin.repo.read(task.id)).converted_to).toBe('Notes/Again.md');
  });
});

