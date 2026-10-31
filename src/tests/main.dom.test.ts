// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import Organized from "../main";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Modal, Notice } from "./__mocks__/obsidian";
import { ConfirmModal, DatePicker, PriorityPicker, ProjectPicker, TaskPicker, TextModal } from "../modals";
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
    const task = await plugin.repo.create('Project'); const projects = vi.spyOn(plugin.service, 'projects').mockResolvedValue(); const clean = vi.spyOn(plugin.service, 'clean').mockResolvedValue(); plugin.pickProjects(task); const modal = Modal.instances.at(-1) as ProjectPicker; await modal.save([]); expect(projects).toHaveBeenCalledWith(task.id, []); expect(clean).not.toHaveBeenCalled(); modal.close();
  });
  it('registers capabilities only, defers vault-create handling and cleans durable crash state', async () => {
    const { h, plugin, stub } = await loaded();
    expect(stub.commands).toHaveLength(5); expect(stub.extensions).toHaveLength(1); expect(stub.processors).toHaveLength(1); expect(stub.settingTabs).toHaveLength(1); expect(stub.views.has(VIEW_TYPE)).toBe(true); expect(h.raw.vault.read).not.toHaveBeenCalled(); expect(h.raw.vault.create).not.toHaveBeenCalled(); expect(h.events.create).toBeUndefined();
    const factory = stub.views.get(VIEW_TYPE); expect(factory({ app: h.app })).toBeInstanceOf(OrganizedInspectorView);
    h.layout[0](); expect(h.events.create).toHaveLength(1);
    const created = vi.spyOn(plugin.service, 'onDailyCreated').mockResolvedValue(); const index = vi.spyOn(plugin.service, 'index').mockResolvedValue(); const reconcile = vi.spyOn(plugin.service, 'reconcile').mockResolvedValue(); const refresh = vi.spyOn(plugin, 'refresh').mockImplementation(() => undefined);
    const file: any = await h.add('Note.md'); h.events.create[0](file); h.events.modify[0](file); h.events.rename[0](file, 'Old.md'); h.events.delete[0](file); h.events['file-open'][0](file); h.events['file-open'][0](null);
    h.events.create[0]({ path: 'Folder' }); h.events.modify[0]({ path: 'Folder' }); h.events.rename[0]({ path: 'Folder' }, 'OldFolder');
    h.events['editor-change'][0](); h.events['active-leaf-change'][0](); await flush(); expect(created).toHaveBeenCalledWith(file); expect(index).toHaveBeenCalledWith(file); expect(reconcile).toHaveBeenCalledWith(file); expect(refresh).toHaveBeenCalled();
    const open = vi.spyOn(plugin, 'openInspector').mockResolvedValue(); stub.ribbon[0].cb(); stub.commands[0].callback(); await flush(); expect(open).toHaveBeenCalledTimes(2);
    open.mockRejectedValueOnce(Error('open failed')); stub.ribbon[0].cb(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('open failed');
    const pick = vi.spyOn(plugin, 'pickTask').mockResolvedValue(); stub.commands[1].editorCallback({}, { file }); stub.commands[2].editorCallback({}, { file }); stub.commands[1].editorCallback({}, {}); stub.commands[2].editorCallback({}, {}); await flush(); expect(pick).toHaveBeenCalledTimes(2);
    const undo = vi.spyOn(plugin.service, 'undo').mockResolvedValue(); stub.commands[3].callback(); await flush(); expect(undo).toHaveBeenCalledOnce();
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(false); const restore = vi.spyOn(plugin.safety, 'queueCompatibleRestore').mockResolvedValue(); stub.commands[4]?.name; // Find by stable id, not menu order.
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
    h.raw.workspace.getRightLeaf.mockReturnValue(leaf); await plugin.openInspector('Task', 'Information'); expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, active: true }); expect(view.tab).toBe('Task'); expect(view.module).toBe('Information');
    h.raw.workspace.getLeavesOfType.mockReturnValue([leaf, { view: {} }]); await plugin.openInspector(); expect(h.raw.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
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
  it('routes date, priority, information, source and project markers with cancellation preserving markers', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Task'); const file: any = await h.add('Note.md', '');
    const context = (marker: string) => { const text = `- [${marker}] Task <!--organized:${task.id}-->`; h.texts.set(file.path, text); return { file, line: parseTasks(text)[0] }; };
    const schedule = vi.spyOn(plugin.service, 'schedule').mockResolvedValue(); await plugin.trigger(context('<')); let modal = Modal.instances.at(-1) as DatePicker; expect(modal).toBeInstanceOf(DatePicker); await modal.choose('2026-01-01'); expect(schedule).toHaveBeenCalled(); modal.close();
    const priority = vi.spyOn(plugin.service, 'priority').mockResolvedValue(); await plugin.trigger(context('!')); const picker = Modal.instances.at(-1) as PriorityPicker; await picker.choose('high'); expect(priority).toHaveBeenCalled(); picker.close();
    const open = vi.spyOn(plugin, 'openInspector').mockResolvedValue(); const clean = vi.spyOn(plugin.service, 'clean').mockResolvedValue(); for (const marker of ['i', 'I', '?']) await plugin.trigger(context(marker)); expect(open.mock.calls.map(c => c[1])).toEqual(['Information', 'Idea', 'Question']); expect(clean).toHaveBeenCalledTimes(3);
    await plugin.trigger(context('"')); const source = Modal.instances.at(-1) as TextModal; expect(source).toBeInstanceOf(TextModal); await source.save('- [Source](https://example.com)'); expect(await plugin.repo.readText(plugin.repo.file(plugin.repo.taskPath(task.id))!)).toContain('https://example.com'); source.close();
    await plugin.trigger(context('b')); const projects = Modal.instances.at(-1) as ProjectPicker; await projects.save(['Project.md']); expect((await plugin.repo.read(task.id)).projects).toEqual(['Project.md']); projects.close();
    await plugin.trigger(context('*')); expect((await plugin.repo.read(task.id)).starred).toBe(true);
    await plugin.trigger({ file, line: parseTasks('- [k] visual')[0] }); expect(await plugin.repo.list()).toHaveLength(1);
    const missing = harness(); const p = new Organized(missing.app, {} as any); (p as any).repo = missing.repo; await expect(p.editModule('missing1', 'Sources')).rejects.toThrow('missing');
    const canonical = plugin.repo.file(plugin.repo.taskPath(task.id))!; await plugin.editModule(task.id, 'Sources'); const edit = Modal.instances.at(-1) as TextModal; expect(edit.value).toContain('https://example.com'); await edit.save('$1 replacement'); expect(await plugin.repo.readText(canonical)).toContain('$1 replacement'); edit.close();
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
  it('triggers only changed linked markers, first manages deliberate syntax and prompts for removed active timers', async () => {
    const { h, plugin } = await loaded(); const task = await plugin.repo.create('Managed'); const file: any = await h.add('Note.md'); const editor = h.setActive(file);
    const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue();
    const old = `- [ ] Managed <!--organized:${task.id}-->`; const next = old.replace('[ ]', '[/]'); editor.setValue(next); plugin.onEditorUpdate(update(old, next)); await flush(); expect(trigger).toHaveBeenCalledOnce();
    editor.setValue(old.replace('Managed', 'Edited title')); plugin.onEditorUpdate(update(old, editor.getValue())); await flush(); expect(trigger).toHaveBeenCalledOnce();
    editor.setValue('- [!] First'); plugin.onEditorUpdate(update('- [ ] First', editor.getValue())); await flush(); expect(await plugin.repo.list()).toHaveLength(2); expect(parseTasks(editor.getValue())[0].id).toBeTruthy(); expect(trigger).toHaveBeenCalledTimes(2);
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(true); const status = vi.spyOn(plugin.service, 'status').mockResolvedValue();
    editor.setValue('- [ ] remains'); plugin.onEditorUpdate(update(next, editor.getValue())); await flush(); expect(confirm).toHaveBeenCalled(); expect(status).toHaveBeenCalledWith(task.id, 'open');
    confirm.mockResolvedValue(false); plugin.onEditorUpdate(update(next, editor.getValue())); await flush(); expect(status).toHaveBeenCalledOnce();
  });
  it('coalesces picker microtasks, handles new linked lines and keeps timer deletion prompts optional', async () => {
    const { h, plugin } = await loaded(); const file: any = await h.add('Note.md'); const editor = h.setActive(file, '- [ ] ');
    const picker = vi.spyOn(plugin, 'pickTask').mockImplementation(async () => { (plugin as any).pickerOpen = true; });
    plugin.onEditorUpdate(update('- [', '- [ ] ')); plugin.onEditorUpdate(update('- [', '- [ ] ')); await flush(); expect(picker).toHaveBeenCalledOnce();
    plugin.onEditorUpdate(update('- [', '- [ ] ')); await flush(); expect(picker).toHaveBeenCalledOnce(); (plugin as any).pickerOpen = false;
    const trigger = vi.spyOn(plugin, 'trigger').mockResolvedValue(); editor.setValue('- [/] Existing <!--organized:task1234-->'); plugin.onEditorUpdate(update('', editor.getValue())); await flush(); expect(trigger).toHaveBeenCalledOnce();
    const confirm = vi.spyOn(plugin, 'confirm').mockResolvedValue(false); const status = vi.spyOn(plugin.service, 'status').mockResolvedValue(); const old = editor.getValue(); editor.setValue('ordinary prose'); plugin.onEditorUpdate(update(old, editor.getValue())); await flush(); expect(confirm).toHaveBeenCalledOnce(); expect(status).not.toHaveBeenCalled();
  });
});
