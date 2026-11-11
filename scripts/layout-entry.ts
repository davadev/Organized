// Browser-only harness: real inspector, real stylesheet, shared host DOM shim.
import { installObsidianDom } from '../src/tests/__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../src/view';
import { DEFAULT_SETTINGS, newTask } from '../src/model';
import { editorExtension } from '../src/render';
import { Setting, editorLivePreviewField } from '../src/tests/__mocks__/obsidian';
import { OrganizedSettingsTab } from '../src/settings';
import { NoteConversionModal, ScheduleModal, OnboardingModal, RecurrencePicker, RetireModal, SessionModal, WhatsNewModal } from '../src/modals';
import { RELEASE_NOTES } from '../src/whatsNew/releaseNotes';
import { parseTasks } from '../src/codec';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

installObsidianDom();
const task = newTask('A task title that stays readable at phone widths', 'task1234');
const at = (day: number, hour: number, minute = 0) => new Date(2026, 2, day, hour, minute).toISOString();
const browseTask = { ...task, work_sessions: [{ start: at(4, 13), end: at(4, 17, 30) }, { start: at(2, 9), end: at(2, 12) }], starred: true, projects: ['Research and project notes.md', 'Reading list.md'], priority: 'high' };
const panelTask = { ...task, priority: 'high', scheduled: '2026-03-12', recurring: true, projects: ['A project with a rather long name that has to be cut short.md', 'Reading list.md', 'Notes.md'], time_tracked_seconds: 14400, work_sessions: [{ start: at(4, 9), end: at(4, 13) }], planned_sessions: [{ start: at(12, 9), end: at(12, 10, 30) }], time_budget_seconds: 18000 };
let showPanelTask = false;
const doneTask = { ...newTask('A finished task', 'task9001'), status: 'completed', starred: true, work_sessions: [{ start: at(4, 9), end: at(4, 10, 30) }] };
const activeTask = { ...newTask('A task in progress', 'task9002'), status: 'in_progress', starred: true, work_sessions: [{ start: at(4, 10), end: at(4, 11) }, { start: at(4, 14), end: at(4, 15) }] };
const canceledTask = { ...newTask('A canceled task', 'task5678'), status: 'canceled' };
const note = '---\ntitle: A task title that stays readable at phone widths\n---\n\nA note that explains the task in enough detail to wrap cleanly on a narrow phone sidebar without clipping. See [[Another note]].\n\n## Sources\nhttps://example.com/a-source-that-should-stay-below-the-description\n';
const noteTasksDoc = `Intro\n# Mood & Focus\n- [ ] ${task.title} <!--organized:${task.id}-->\n## Daily Prep\n- [ ] A regular todo`;
const noteTasksFile = { path: 'Daily/Today.md' } as any;
const noteTasksEditor = { focus() {}, setCursor() {} } as any;
const app: any = { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } };
const owner: any = {
  role: 'main',
  app, selectedTaskId: task.id, context: null, settings: { ...DEFAULT_SETTINGS, displayProperties: [], hideClosedProjects: false }, revision: 0, rememberProjects: () => undefined, setDayTasksCollapsed(value: boolean) { owner.settings.dayTasksCollapsed = value; },
  saveSettings() {}, onEditorUpdate() {}, deleteTask: async () => undefined,
  assertWritable() {}, run: async (fn: () => unknown) => fn(), contextFor: () => null,
  pickProjects() {}, setHideClosedProjects(value: boolean) { owner.settings.hideClosedProjects = value; }, saveModule: async () => undefined, refresh() {},
  repo: { projectFolder: () => 'Tasks/Projects', taskColor: (t: any) => t.projects?.length ? '#3b82f6' : null, projectColor: () => '#3b82f6', projectBudgets: () => ({ total: null, day: null, week: null, month: null }), list: async () => [browseTask, doneTask, activeTask, canceledTask], file: (path: string) => path.startsWith('Tasks/') || path.startsWith('Daily/2026-03') ? { path } : null, read: async () => showPanelTask ? panelTask : task, taskPath: () => 'Tasks/task1234.md', sourcePath: () => 'Tasks/task1234.md', taskFile: () => ({ path: 'Tasks/task1234.md' }), resolve: async () => ({ path: 'Tasks/task1234.md' }), readText: async () => note, parentOf: async () => null, subtasksOf: async (t: any) => t.id === task.id ? [doneTask, activeTask, newTask('A third subtask whose long title has to wrap on a narrow phone', 'task9003'), canceledTask] : [], progress: async () => null },
   service: { daily: { path: (d: string) => `Daily/${d}.md`, open: async () => null, followed: () => false, setup: () => ({ dailyFolder: "Daily", dailyFormat: "YYYY-MM-DD", dailyTemplate: "" }) }, refs: async () => [], retiredWork: async () => [], reconcile: async () => undefined, resolve: async (context: any) => ({ text: noteTasksDoc, line: context.line }) },
   taskSourceEditor: () => ({ editor: noteTasksEditor, file: noteTasksFile }), taskLines: async () => parseTasks(noteTasksDoc),
};
const view = new OrganizedInspectorView({ app } as any, owner);
const root = document.querySelector('#app')!; root.appendChild(view.contentEl);
let editor: EditorView | null = null;
let modal: ScheduleModal | SessionModal | NoteConversionModal | OnboardingModal | RetireModal | WhatsNewModal | null = null;
// The check reads the note text back after typing into the real editor.
(window as any).editorText = () => editor?.state.doc.toString();
// Stand-in for Obsidian's list continuation, which handles Enter in a real note (on iOS CodeMirror relies on such a command to drop the native line break).
const continueList = Prec.low(keymap.of([{ key: 'Enter', run: view => { const at = view.state.selection.main.head; view.dispatch({ changes: { from: at, insert: '\n- [ ] ' }, selection: { anchor: at + 7 }, userEvent: 'input' }); return true; } }]));
(window as any).scene = async (tab: string) => {
  showPanelTask = tab === 'Task';
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
  } else if (tab === 'LivePreview' || tab === 'Source' || tab === 'Eof' || tab === 'AlignRight') {
    owner.settings.displayProperties = tab === 'Eof' ? ['priority'] : tab === 'AlignRight' ? ['priority', 'starred', 'recurring', 'time_tracked_seconds'] : [];
    owner.settings.propertiesAlign = tab === 'AlignRight' ? 'right' : 'text';
    const doc = tab === 'Eof' ? 'intro\n- [ ] Test task <!--organized:task1234-->' : tab === 'AlignRight' ? '- [ ] Short <!--organized:task1234-->\n- [ ] A much longer task title that wraps onto a second line on a phone screen <!--organized:task1234-->\n- [ ] Romeo Schmerzmittel <!--organized:task1234-->\n    - Proverbs 4_18' : '- [ ] Test task <!--organized:task1234--> <!--organized:repeat-->';
    editor = new EditorView({ state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [EditorView.lineWrapping, ...(tab === 'Source' ? [] : [editorLivePreviewField]), editorExtension(owner), continueList] }), parent: root });
  } else if (tab === 'ScheduleModal') {
    // Five days, one with three times and one block that has begun, under a long title: the dialog must stay inside a phone screen.
    const day = (d: number) => `2026-03-${String(d).padStart(2, '0')}`; const block = (d: number, h: number) => ({ start: at(d, h), end: at(d, h + 1) });
    modal = new ScheduleModal(app, {
      title: 'A task title that stays readable at phone widths, even when it is very long indeed', earlier: ['2026-03-01'], state: 'open', now: () => new Date(2026, 2, 4, 10).getTime(),
      days: [{ date: day(4), blocks: [block(4, 11), block(4, 14), block(4, 16)], locked: [block(4, 9)], missing: true }, { date: day(5), blocks: [], locked: [] }, { date: day(6), blocks: [block(6, 9)], locked: [] }, { date: day(9), blocks: [], locked: [] }, { date: day(12), blocks: [block(12, 13)], locked: [] }],
      load: d => ({ seconds: d === day(4) ? 5 * 3600 : 0, clash: d === day(6) ? 'A meeting with a long name that overlaps' : null }), budget: () => 'Planned 6h · 1h 30min of 7h 30min left', save: async () => undefined,
    });
    modal.open();
  } else if (tab === 'RepeatModal') {
    modal = new RecurrencePicker(app, '2026-03-04', { every: 1, unit: 'week', days: [0, 1, 2, 3, 4], monthDay: null }, async () => undefined, undefined, [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }, { start: '22:00', end: '02:00' }]);
    modal.open();
  } else if (tab === 'SessionModal') {
    modal = new SessionModal(app, { heading: 'Edit time worked', taskTitle: 'A task title that stays readable at phone widths', start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 30).toISOString(), save: async () => undefined, remove: async () => undefined, openTask: async () => undefined });
    modal.open();
  } else if (tab === 'NoteModal') {
    modal = new NoteConversionModal(app, { title: 'A task title that stays readable at phone widths', folders: ['Notes', 'Ideas'], folder: 'Notes', templates: ['Templates/Idea note.md'], exists: path => path === 'Notes/A task title that stays readable at phone widths.md', convert: async () => undefined });
    modal.open();
  } else if (tab === 'RetireModal') {
    // The longest option texts, with a scan that matches: the window must stay inside the screen and keep its buttons reachable.
    const found = { tasks: [browseTask, doneTask, activeTask, canceledTask], files: new Map(), lines: new Map() };
    modal = new RetireModal(app, { which: 'closed', olderThanDays: 7, lines: 'link', keep: 'all', notes: 'rename', yaml: 'keep' }, async () => found, async () => undefined);
    modal.open();
  } else if (tab === 'WhatsNew') {
    // The real release notes, plus a second release, as the stacked popup shows them.
    modal = new WhatsNewModal(app, [{ ...RELEASE_NOTES[0], version: '0.1.1' }, RELEASE_NOTES[0]], () => undefined); modal.open();
  } else if (tab.startsWith('Onboarding')) {
    // OnboardingN shows step N (1-based): the longest step text and every figure are checked, not just the first page.
    const card = new OnboardingModal(app, () => undefined); modal = card; card.open();
    (card as any).index = Number(tab.slice('Onboarding'.length)) - 1; (card as any).draw();
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
