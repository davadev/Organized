// Browser-only harness: real inspector, real stylesheet, shared host DOM shim.
import { installObsidianDom } from '../src/tests/__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../src/view';
import { DEFAULT_SETTINGS, newTask } from '../src/model';
import { editorExtension } from '../src/render';
import { Setting, editorLivePreviewField } from '../src/tests/__mocks__/obsidian';
import { OrganizedSettingsTab } from '../src/settings';
import { DatePicker, SessionModal } from '../src/modals';
import { parseTasks } from '../src/codec';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

installObsidianDom();
const task = newTask('A task title that stays readable at phone widths', 'task1234');
const at = (day: number, hour: number, minute = 0) => new Date(2026, 2, day, hour, minute).toISOString();
const browseTask = { ...task, work_sessions: [{ start: at(4, 13), end: at(4, 17, 30) }, { start: at(2, 9), end: at(2, 12) }], starred: true, projects: ['Research and project notes.md', 'Reading list.md'], priority: 'high' };
const doneTask = { ...newTask('A finished task', 'task9001'), status: 'completed', starred: true, work_sessions: [{ start: at(4, 9), end: at(4, 10, 30) }] };
const activeTask = { ...newTask('A task in progress', 'task9002'), status: 'in_progress', starred: true, work_sessions: [{ start: at(4, 10), end: at(4, 11) }, { start: at(4, 14), end: at(4, 15) }] };
const canceledTask = { ...newTask('A canceled task', 'task5678'), status: 'canceled' };
const note = '---\ntitle: A task title that stays readable at phone widths\n---\n\n## Description\nA note that explains the task in enough detail to wrap cleanly on a narrow phone sidebar without clipping.\n\n## Idea\nAn idea that should stay below the description.\n';
const noteTasksDoc = `Intro\n# Mood & Focus\n- [ ] ${task.title} <!--organized:${task.id}-->\n## Daily Prep\n- [ ] A regular todo`;
const noteTasksFile = { path: 'Daily/Today.md' } as any;
const noteTasksEditor = { focus() {}, setCursor() {} } as any;
const app: any = { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } };
const owner: any = {
  app, selectedTaskId: task.id, context: null, settings: { ...DEFAULT_SETTINGS, displayProperties: [], hideClosedProjects: false }, revision: 0, rememberProjects: () => undefined, setDayTasksCollapsed(value: boolean) { owner.settings.dayTasksCollapsed = value; },
  saveSettings() {}, onEditorUpdate() {}, deleteTask: async () => undefined,
  assertWritable() {}, run: async (fn: () => unknown) => fn(), contextFor: () => null,
  pickProjects() {}, setHideClosedProjects(value: boolean) { owner.settings.hideClosedProjects = value; }, saveModule: async () => undefined, refresh() {},
  repo: { projectFolder: () => 'Tasks/Projects', taskColor: (t: any) => t.projects?.length ? '#3b82f6' : null, projectColor: () => '#3b82f6', list: async () => [browseTask, doneTask, activeTask, canceledTask], file: (path: string) => path.startsWith('Tasks/') || path.startsWith('Daily/2026-03') ? { path } : null, read: async () => task, taskPath: () => 'Tasks/task1234.md', readText: async () => note },
   service: { daily: { path: (d: string) => `Daily/${d}.md`, open: async () => null }, refs: async () => [], retiredWork: async () => [], reconcile: async () => undefined, resolve: async (context: any) => ({ text: noteTasksDoc, line: context.line }) },
   taskSourceEditor: () => ({ editor: noteTasksEditor, file: noteTasksFile }), taskLines: async () => parseTasks(noteTasksDoc),
};
const view = new OrganizedInspectorView({ app } as any, owner);
const root = document.querySelector('#app')!; root.appendChild(view.contentEl);
let editor: EditorView | null = null;
let modal: DatePicker | SessionModal | null = null;
(window as any).scene = async (tab: string) => {
  editor?.destroy(); editor = null; modal?.close(); modal = null; root.replaceChildren();
  if (tab === 'Settings' || tab === 'LegacySettings') {
    const settings = new OrganizedSettingsTab(app, owner);
    if (tab === 'LegacySettings') { root.appendChild(settings.containerEl); settings.display(); }
    else {
      const host = root.createDiv({ cls: 'vertical-tab-content' });
      for (const group of settings.getSettingDefinitions() as any[]) {
        new Setting(host).setName(group.heading).setHeading();
        for (const row of group.items) { const setting = new Setting(host).setName(row.name); if (row.desc) setting.setDesc(row.desc); row.render(setting); }
      }
    }
  } else if (tab === 'LivePreview' || tab === 'Source' || tab === 'Eof') {
    owner.settings.displayProperties = tab === 'Eof' ? ['priority'] : [];
    const doc = tab === 'Eof' ? 'intro\n- [ ] Test task <!--organized:task1234-->' : '- [ ] Test task <!--organized:task1234--> <!--organized:repeat-->';
    editor = new EditorView({ state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [EditorView.lineWrapping, ...(tab === 'Source' ? [] : [editorLivePreviewField]), editorExtension(owner)] }), parent: root });
  } else if (tab === 'ScheduleModal') {
    modal = new DatePicker(app, '2026-01-01', async () => undefined);
    modal.open();
  } else if (tab === 'SessionModal') {
    modal = new SessionModal(app, { heading: 'Edit time worked', taskTitle: 'A task title that stays readable at phone widths', start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 30).toISOString(), save: async () => undefined, remove: async () => undefined, openTask: async () => undefined });
    modal.open();
  } else if (tab === 'NoteTasks') {
    owner.selectedTaskId = null; view.module = ''; view.editingTitle = false; view.tab = 'Task';
    root.appendChild(view.contentEl); await view.render();
  } else if (tab === 'Week' || tab === 'Day') {
    owner.selectedTaskId = null; view.module = ''; view.editingTitle = false; view.tab = 'Calendar'; view.calendarMode = tab; view.selectedDate = '2026-03-04';
    root.appendChild(view.contentEl); await view.render();
  } else {
    owner.selectedTaskId = task.id; view.calendarMode = 'Month';
    root.appendChild(view.contentEl); view.module = ''; view.editingTitle = false;
    view.editingModule = tab === 'InlineEditor' ? 'Description' : '';
    view.tab = tab === 'InlineEditor' ? 'Task' : tab as typeof view.tab; await view.render();
  }
  await Promise.resolve();
};
await (window as any).scene('Calendar');
