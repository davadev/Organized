// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { DecorationSet } from '@codemirror/view';
import Organized from '../main';
import { editorExtension, reading } from '../render';
import { editorLivePreviewField, MarkdownRenderer } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); });
function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function fixture() {
  vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  return { ...h, owner, view, repo: owner.repo, task: await owner.repo.create('Raced') };
}
async function projectionChild(owner: Organized, task: { id: string }, add: (path: string, text: string) => Promise<any>) {
  const text = `- [ ] Raced <!--organized:${task.id}-->`; const file = await add('Note.md', text); const host = createDiv(); host.createEl('li', { cls: 'task-list-item' }).createEl('input', { type: 'checkbox' });
  const children: any[] = []; const context: any = { sourcePath: file.path, getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 0 }), addChild: (c: any) => { children.push(c); c.load(); } };
  await reading(owner, host, context); return { child: children[0], host };
}
const countProperty = (host: HTMLElement) => host.querySelectorAll('.organized-property').length;

describe('projection draws racing each other', () => {
  it('an older draw finishing late does not append a second copy of the properties', async () => {
    const { owner, task, add } = await fixture(); owner.settings.displayProperties = ['description', 'priority'];
    const { child, host } = await projectionChild(owner, task, add); expect(countProperty(host)).toBe(1);
    const gate = deferred(); const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementationOnce(async () => { await gate.promise; });
    const first = child.draw(); await flush(); const second = child.draw(); await second; expect(render).toHaveBeenCalledTimes(2);
    gate.resolve(); await first; expect(countProperty(host)).toBe(1);
  });
  it('an older draw stops before reading notes once a newer draw owns the host', async () => {
    const { owner, task, add, repo } = await fixture(); owner.settings.displayProperties = ['description', 'priority'];
    const { child, host } = await projectionChild(owner, task, add);
    const gate = deferred(); const original = repo.readText.bind(repo); let held = 0;
    vi.spyOn(repo, 'readText').mockImplementation(async file => { if (++held === 2) await gate.promise; return original(file); });
    const first = child.draw(); await flush(); await child.draw(); gate.resolve(); await first; expect(host.querySelectorAll('.organized-rich-property')).toHaveLength(1); expect(countProperty(host)).toBe(1);
  });
  it('an older draw that fails does not replace the newer draw with an error', async () => {
    const { owner, task, add, repo } = await fixture(); owner.settings.displayProperties = ['priority'];
    const { child, host } = await projectionChild(owner, task, add);
    const gate = deferred<any>(); const original = repo.read.bind(repo); vi.spyOn(repo, 'read').mockImplementationOnce(() => gate.promise).mockImplementation(original);
    const first = child.draw(); await child.draw(); gate.reject(new Error('gone')); await first; expect(host.textContent).not.toContain('Missing/invalid'); expect(countProperty(host)).toBe(1);
  });
  it('a destroyed editor widget stops drawing properties into its detached host', async () => {
    const { owner, task } = await fixture(); owner.settings.displayProperties = ['description', 'priority'];
    const field = (editorExtension(owner) as any[])[0] as StateField<DecorationSet>; const state = EditorState.create({ doc: `- [ ] Raced <!--organized:${task.id}-->`, extensions: [editorLivePreviewField, field] });
    let widget: any; state.field(field).between(0, 100, (_f, _t, d) => { widget = d.spec.widget; });
    const gate = deferred(); vi.spyOn(MarkdownRenderer, 'render').mockImplementationOnce(async () => { await gate.promise; });
    const host = widget.toDOM(); await flush(); widget.destroy(); gate.resolve(); await flush(); expect(countProperty(host)).toBe(0);
  });
});

describe('inspector renders racing each other', () => {
  it('a refresh skipped for a focused input does not abandon the render already in flight', async () => {
    const { owner, view, task } = await fixture(); owner.selectedTaskId = task.id; view.tab = 'Task'; view.editingTitle = true; view.referencesOpen = true;
    const gate = deferred(); const refs = vi.spyOn(owner.service, 'refs'); const original = owner.repo.readText.bind(owner.repo); let calls = 0;
    vi.spyOn(owner.repo, 'readText').mockImplementation(async file => { if (++calls === 3) await gate.promise; return original(file); });
    const first = view.render(); await flush(); expect(view.contentEl.querySelector('.organized-title-input')).toBe(document.activeElement);
    await view.render(); gate.resolve(); await first; await flush(); expect(refs).toHaveBeenCalled(); expect(view.contentEl.textContent).not.toContain('Loading references');
  });
  it('a superseded Task render never touches the DOM or scroll state after its note read', async () => {
    const { owner, view, task } = await fixture(); owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Description';
    const notePath = owner.repo.taskFile(task.id)!.path; const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView'); const gates = [deferred(), deferred()]; let reads = 0; const original = owner.repo.readText.bind(owner.repo);
    // Reads of the task note: 1 and 3 are each render's task lookup; 2 and 4 are the body read the renders park on.
    vi.spyOn(owner.repo, 'readText').mockImplementation(async file => { const text = await original(file); if (file.path === notePath) { const n = ++reads; if (n === 2) await gates[0].promise; if (n === 4) await gates[1].promise; } return text; });
    const first = view.render(); await flush(); const second = view.render(); await flush();
    gates[0].resolve(); await first; await flush(); expect(scroll).not.toHaveBeenCalled(); expect(view.contentEl.querySelectorAll('.organized-task-details')).toHaveLength(0);
    gates[1].resolve(); await second; expect(scroll).toHaveBeenCalledOnce();
  });
  it('a superseded Task render that was parked on a card does not claim the module scroll', async () => {
    const { owner, view, task } = await fixture(); owner.selectedTaskId = task.id; view.tab = 'Task'; view.module = 'Description'; await owner.saveModule(task.id, 'Description', 'Hello');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView'); const gates = [deferred(), deferred()]; let parked = 0;
    const original = MarkdownRenderer.render.bind(MarkdownRenderer);
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (app, markdown, el, path, component) => { await original(app, markdown, el, path, component); if (markdown === 'Hello') await gates[parked++].promise; });
    const first = view.render(); await flush(); const second = view.render(); await flush(); expect(parked).toBe(2);
    gates[0].resolve(); await first; expect(scroll).not.toHaveBeenCalled(); gates[1].resolve(); await second; expect(scroll).toHaveBeenCalledOnce();
  });
});
