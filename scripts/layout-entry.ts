// Browser-only harness: real inspector, real stylesheet, shared host DOM shim.
import { installObsidianDom } from '../src/tests/__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../src/view';
import { newTask } from '../src/model';
import { GLYPHS, icon } from '../src/render';
import { Setting } from '../src/tests/__mocks__/obsidian';

installObsidianDom();
const task = { ...newTask('A long task title that must remain readable at phone widths without horizontal scrolling', 'task1234'), starred: true, projects: ['Research and project notes.md'], scheduled: '2026-11-01' };
const app: any = { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } };
const owner: any = {
  app, selectedTaskId: task.id, context: null, settings: { displayProperties: [] },
  assertWritable() {}, run: async (fn: () => unknown) => fn(), contextFor: () => null,
  pickProjects() {}, editModule: async () => undefined, refresh() {},
  repo: { list: async () => [task], file: (path: string) => path.startsWith('Tasks/') ? { path } : null, read: async () => task, taskPath: () => 'Tasks/task1234.md', readText: async () => 'A detailed Markdown task note that should wrap fully on small screens.\n'.repeat(8) },
  service: { daily: { path: (d: string) => `Daily/${d}.md`, open: async () => null }, refs: async () => [], reconcile: async () => undefined },
};
const view = new OrganizedInspectorView({ app } as any, owner);
const root = document.querySelector('#app')!; root.appendChild(view.contentEl);
(window as any).scene = async (tab: 'Calendar' | 'Task' | 'Projects') => {
  view.tab = tab; await view.render(); await Promise.resolve();
  const glyphs = view.contentEl.createDiv({ cls: 'organized-glyph-sample' });
  for (const marker of Object.keys(GLYPHS)) { const label = glyphs.createSpan({ cls: 'organized-property', text: `${GLYPHS[marker]} ` }); icon(label, marker); }
};
await (window as any).scene('Calendar');
