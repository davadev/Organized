// Browser-only harness: real inspector, real stylesheet, shared host DOM shim.
import { installObsidianDom } from '../src/tests/__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../src/view';
import { DEFAULT_SETTINGS, newTask } from '../src/model';
import { editorExtension } from '../src/render';
import { Setting, editorLivePreviewField } from '../src/tests/__mocks__/obsidian';
import { OrganizedSettingsTab } from '../src/settings';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

installObsidianDom();
const task = newTask('A task title that stays readable at phone widths', 'task1234');
const browseTask = { ...task, starred: true, projects: ['Research and project notes.md'] };
const app: any = { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } };
const owner: any = {
  app, selectedTaskId: task.id, context: null, settings: { ...DEFAULT_SETTINGS, displayProperties: [] }, revision: 0,
  saveSettings() {}, onEditorUpdate() {},
  assertWritable() {}, run: async (fn: () => unknown) => fn(), contextFor: () => null,
  pickProjects() {}, editModule: async () => undefined, refresh() {},
  repo: { list: async () => [browseTask], file: (path: string) => path.startsWith('Tasks/') ? { path } : null, read: async () => task, taskPath: () => 'Tasks/task1234.md', readText: async () => '' },
  service: { daily: { path: (d: string) => `Daily/${d}.md`, open: async () => null }, refs: async () => [], reconcile: async () => undefined },
};
const view = new OrganizedInspectorView({ app } as any, owner);
const root = document.querySelector('#app')!; root.appendChild(view.contentEl);
let editor: EditorView | null = null;
(window as any).scene = async (tab: string) => {
  editor?.destroy(); editor = null; root.replaceChildren();
  if (tab === 'Settings' || tab === 'LegacySettings') {
    const settings = new OrganizedSettingsTab(app, owner);
    if (tab === 'LegacySettings') { root.appendChild(settings.containerEl); settings.display(); }
    else {
      const host = root.createDiv({ cls: 'organized-settings' });
      for (const group of settings.getSettingDefinitions() as any[]) {
        new Setting(host).setName(group.heading).setHeading();
        for (const row of group.items) row.render(new Setting(host).setName(row.name).setDesc(row.desc));
      }
    }
  } else if (tab === 'LivePreview' || tab === 'Source') {
    editor = new EditorView({ state: EditorState.create({ doc: '- [ ] Test task <!--organized:task1234--> <!--organized:repeat-->', selection: { anchor: 8 }, extensions: [EditorView.lineWrapping, ...(tab === 'LivePreview' ? [editorLivePreviewField] : []), editorExtension(owner)] }), parent: root });
  } else {
    root.appendChild(view.contentEl); view.module = 'Information'; view.tab = tab as typeof view.tab; await view.render();
  }
  await Promise.resolve();
};
await (window as any).scene('Calendar');
