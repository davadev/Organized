// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { DecorationSet, EditorView } from '@codemirror/view';
import Organized from '../main';
import { editorExtension, GLYPHS, icon, projection, reading, refreshEditor } from '../render';
import { Component, editorLivePreviewField, MarkdownRenderChild } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { harness } from './harness';
import { DISPLAY_PROPERTIES } from '../model';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
async function fixture() {
  vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload(); const task = await owner.repo.create('Rendered task');
  return { ...h, owner, task, repo: owner.repo, service: owner.service };
}
function widgets(state: EditorState, field: StateField<DecorationSet>) {
  const result: any[] = []; state.field(field).between(0, state.doc.length, (_from, _to, decoration) => { if (decoration.spec.widget) result.push(decoration.spec.widget); }); return result;
}
describe('read-only projections and bundled visual markers', () => {
  it('renders every glyph, all schema-selected properties and full notes/sources without writing', async () => {
    const { owner, task, repo, raw } = await fixture(); const host = createDiv(); icon(host, 'unknown'); expect(host.childElementCount).toBe(0); for (const marker of Object.keys(GLYPHS)) icon(host, marker); expect(host.childElementCount).toBe(Object.keys(GLYPHS).length);
    owner.settings.displayProperties = [...DISPLAY_PROPERTIES]; const record = await repo.update(task.id, t => ({ ...t, scheduled: '2026-01-01', starred: true }));
    const file = repo.file(repo.taskPath(task.id))!; const before = await repo.readText(file); await repo.write(file, before, before + '\n## Sources\n- [Source](https://example.com)\n');
    raw.vault.process.mockClear(); raw.fileManager.processFrontMatter.mockClear(); await projection(owner, host, record, new Component() as any);
    expect(host.textContent).toContain('2026-01-01'); expect(host.querySelector('a[href="https://example.com"]')).toBeTruthy(); expect(host.textContent).toContain('priority: none'); expect(host.textContent).toContain('starred: true'); expect(raw.vault.process).not.toHaveBeenCalled(); expect(raw.fileManager.processFrontMatter).not.toHaveBeenCalled();
    const open = vi.spyOn(owner.service.daily, 'open').mockResolvedValue(file); host.querySelector<HTMLAnchorElement>('a')!.click(); await flush(); expect(open).toHaveBeenCalledWith('2026-01-01');
    owner.safety.writable = false; host.querySelector<HTMLAnchorElement>('a')!.click(); await flush(); expect(open).toHaveBeenCalledOnce(); owner.safety.writable = true;
    owner.settings.showScheduledDate = false; const hiddenDate = createDiv(); await projection(owner, hiddenDate, record, new Component() as any); expect(hiddenDate.querySelector('.organized-date')).toBeNull();
    owner.settings.displayProperties = ['sources']; const noSources = await repo.create('Without sources'); const noSourcesHost = createDiv(); await projection(owner, noSourcesHost, noSources, new Component() as any); expect(noSourcesHost.textContent).toBe('');
    owner.settings.displayProperties = ['notes', 'sources']; const missing = { ...task, id: 'missing1' }; const empty = createDiv(); await projection(owner, empty, missing, new Component() as any); expect(empty.childElementCount).toBe(0);
  });
  it('postprocesses actual task items, leaves ordinary text alone and owns live read-only refresh lifecycle', async () => {
    const { owner, task, add, repo, files } = await fixture(); const text = `- [>] Rendered task <!--organized:${task.id}-->\n- [k] visual\n- [x] Missing <!--organized:missing1-->`;
    const file: any = await add('Note.md', text); const host = createDiv(); for (let i = 0; i < 3; i++) { const li = host.createEl('li', { cls: 'task-list-item' }); li.createEl('input', { type: 'checkbox' }); }
    const children: any[] = []; const context: any = { sourcePath: file.path, getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 2 }), addChild: (c: any) => { children.push(c); c.load(); } };
    await reading(owner, host, context); expect(host.querySelector('.organized-forwarded')).toBeTruthy(); expect(host.querySelector('input')!.dataset.organizedMarker).toBe('>'); expect(host.textContent).toContain('Missing/invalid'); expect(children).toHaveLength(2); expect(owner.projectionListeners.size).toBe(2);
    const status = vi.spyOn(owner.service, 'status').mockResolvedValue(); const checkboxes = host.querySelectorAll<HTMLInputElement>('input'); checkboxes[0].click(); checkboxes[2].click(); await flush(); expect(status).toHaveBeenCalledWith(task.id, 'completed', expect.anything()); expect(status).toHaveBeenCalledWith('missing1', 'open', expect.anything());
    files.delete(file.path); checkboxes[0].click(); await flush(); expect(status).toHaveBeenCalledTimes(2);
    owner.settings.displayProperties = ['priority']; owner.refresh(); await flush(); expect(host.textContent).toContain('priority: none');
    let resolve!: (t: any) => void; vi.spyOn(repo, 'read').mockImplementationOnce(() => new Promise(r => { resolve = r; })); const stale = children[0].draw(); children[0].unload(); resolve(task); await stale; expect(owner.projectionListeners.size).toBe(1); children[1].unload(); expect(owner.projectionListeners.size).toBe(0);
    await reading(owner, host, { ...context, getSectionInfo: () => null }); expect(status).toHaveBeenCalledTimes(2);
    const noCheckbox = createDiv(); noCheckbox.createEl('li', { cls: 'task-list-item' }); await reading(owner, noCheckbox, { ...context, getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 0 }) }); expect(noCheckbox.querySelector('.organized-properties')).toBeTruthy();
  });
  it('state-field widgets never alter source, suppress in source/cursor context and clean up async components', async () => {
    const { owner, task, repo } = await fixture(); const extension = editorExtension(owner) as any[]; const field = extension[0] as StateField<DecorationSet>; const doc = `intro\n- [ ] Rendered <!--organized:${task.id}-->\n- [ ] ordinary`;
    let state = EditorState.create({ doc, extensions: [editorLivePreviewField, field] }); const widget = widgets(state, field)[0]; expect(widget).toBeTruthy(); const host = widget.toDOM(); await flush(); expect(host.classList.contains('organized-projection')).toBe(true);
    expect(widget.eq(widget)).toBe(true); expect(widget.eq({ id: 'another1', revision: 0 })).toBe(false); expect(widget.ignoreEvent()).toBe(false);
    const unchanged = state.update({}).state; expect(unchanged.field(field)).toBe(state.field(field));
    state = state.update({ selection: { anchor: 10 } }).state; expect(widgets(state, field)).toHaveLength(0);
    state = state.update({ selection: { anchor: 0 } }).state; expect(widgets(state, field)).toHaveLength(1);
    expect(widgets(EditorState.create({ doc, extensions: [field] }), field)).toHaveLength(0);
    expect(widgets(EditorState.create({ doc, extensions: [editorLivePreviewField.init(() => false), field] }), field)).toHaveLength(0);
    widget.destroy(); expect(widget.component).toBeNull(); widget.destroy();
    const badDoc = 'intro\n- [ ] Missing <!--organized:missing1-->'; const bad = widgets(EditorState.create({ doc: badDoc, extensions: [editorLivePreviewField, field] }), field)[0]; const badHost = bad.toDOM(); await flush(); expect(badHost.textContent).toContain('Missing task'); bad.destroy();
    const disposed = widgets(EditorState.create({ doc, extensions: [editorLivePreviewField, field] }), field)[0]; const disposedHost = disposed.toDOM(); disposed.destroy(); await flush(); expect(disposedHost.childElementCount).toBe(0);
    const failed = widgets(EditorState.create({ doc: badDoc, extensions: [editorLivePreviewField, field] }), field)[0]; const failedHost = failed.toDOM(); failed.destroy(); await flush(); expect(failedHost.textContent).toBe('');
  });
  it('renders a properties widget on a final task line without a trailing newline', async () => {
    const { owner, task } = await fixture(); owner.settings.displayProperties = ['priority'];
    const doc = `intro\n- [ ] Rendered <!--organized:${task.id}-->`;
    const field = (editorExtension(owner) as any[])[0] as StateField<DecorationSet>;
    const state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [editorLivePreviewField, field] });
    expect(widgets(state, field)).toHaveLength(1);
    const editor = new EditorView({ state, parent: createDiv() });
    await flush(); expect(editor.dom.querySelector('.organized-projection')?.textContent).toContain('priority: none');
    expect(editor.state.doc.toString()).toBe(doc); editor.destroy();
  });
  it('limits icons to visible ranges, rebuilds only for relevant updates and refreshes projected data', async () => {
    const { owner, task } = await fixture(); const extensions = editorExtension(owner) as any[]; const field = extensions[0] as StateField<DecorationSet>; const icons = extensions[1];
    const doc = `intro\n- [>] Forward <!--organized:${task.id}-->\n- [k] Secret\n- [ ] Plain`;
    let state = EditorState.create({ doc, extensions: [editorLivePreviewField, field] }); const fake: any = { state, visibleRanges: [{ from: 0, to: doc.length }] }; const plugin = icons.create(fake);
    expect(plugin.decorations.size).toBe(4); const ranges: any[] = []; plugin.decorations.between(0, doc.length, (_a: number, _b: number, d: any) => { if (d.spec.widget) ranges.push(d.spec.widget); }); expect(ranges).toHaveLength(2); const iconHost = ranges[0].toDOM(); expect(iconHost.querySelector('[aria-label=Forwarded]')).toBeTruthy(); expect(ranges[0].eq(ranges[0])).toBe(true); expect(ranges[0].eq(ranges[1])).toBe(false);
    const previous = plugin.decorations; plugin.update({ docChanged: false, viewportChanged: false, selectionSet: false, transactions: [], view: fake }); expect(plugin.decorations).toBe(previous);
    fake.visibleRanges = [{ from: 0, to: 2 }]; plugin.update({ viewportChanged: true, transactions: [], view: fake }); expect(plugin.decorations.size).toBe(0);
    fake.visibleRanges = [{ from: 0, to: doc.length }]; fake.state = state.update({ selection: { anchor: 15 } }).state; plugin.update({ selectionSet: true, transactions: [], view: fake }); expect(plugin.decorations.size).toBe(2);
    fake.state = EditorState.create({ doc }); plugin.update({ docChanged: true, transactions: [], view: fake }); expect(plugin.decorations.size).toBe(0);
    const captured: any[] = []; refreshEditor({ dispatch: (spec: any) => captured.push(spec) } as any); const transaction = state.update(captured[0]); fake.state = transaction.state; plugin.update({ transactions: [transaction], view: fake }); expect(plugin.decorations.size).toBe(4); expect(widgets(transaction.state, field)).toHaveLength(1);
    // The actual CM listener is installed in a native editor and observes updates.
    const listener = vi.spyOn(owner, 'onEditorUpdate').mockImplementation(() => undefined); const view = new EditorView({ state: EditorState.create({ doc: 'plain', extensions: editorExtension(owner) }), parent: createDiv() }); view.dispatch({ changes: { from: 5, insert: ' text' } }); expect(listener).toHaveBeenCalledOnce(); refreshEditor(view); expect(listener).toHaveBeenCalledTimes(2); view.destroy();
  });
  it('hides identity and recurrence comments even on the edited Live Preview line, never in source mode', async () => {
    const { owner, task } = await fixture(); const doc = `- [ ] Test task <!--organized:${task.id}--> <!--organized:repeat-->`;
    vi.spyOn(owner, 'onEditorUpdate').mockImplementation(() => undefined);
    const state = EditorState.create({ doc, selection: { anchor: 8 }, extensions: [editorLivePreviewField, editorExtension(owner)] });
    const view = new EditorView({ state, parent: createDiv() }); expect(view.dom.textContent).not.toContain(task.id); expect(view.dom.textContent).not.toContain('organized:repeat'); expect(view.state.doc.toString()).toBe(doc);
    const atomic = state.facet(EditorView.atomicRanges)[0]; expect(atomic(view).size).toBe(2); expect(atomic({ plugin: () => null } as any).size).toBe(0); view.destroy();
    const source = new EditorView({ state: EditorState.create({ doc, extensions: editorExtension(owner) }), parent: createDiv() }); expect(source.dom.textContent).toContain(task.id); source.destroy();
  });
});
