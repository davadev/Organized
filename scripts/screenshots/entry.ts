// Browser-only harness for the README screenshots: the real inspector and stylesheet over a fixed, tidy fixture week.
// Nothing here is user data. Scenes are listed in scripts/render-screenshots.mjs.
import { installObsidianDom } from '../../src/tests/__mocks__/obsidianDom';
import { OrganizedInspectorView } from '../../src/view';
import { DEFAULT_SETTINGS, newTask, type Task } from '../../src/model';
import { parseTasks } from '../../src/codec';
import { missingIcons } from './obsidianShim';
import { OnboardingModal, RetireModal } from '../../src/modals';

installObsidianDom();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 2, day, hour, minute).toISOString();
const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}`;
const make = (id: string, title: string, rest: Partial<Task>): Task => ({ ...newTask(title, id), created: at(2, 8), ...rest });

const review = 'Projects/Q1 review.md', lisbon = 'Projects/Lisbon trip.md', workshop = 'Projects/Workshop.md';
const tasks: Task[] = [
  make('q1review01', 'Draft the Q1 review', { status: 'in_progress', priority: 'high', starred: true, projects: [review], scheduled: day(4), time_tracking_started_at: at(4, 14, 30), time_tracked_seconds: 5400, work_sessions: [{ start: at(4, 9, 20), end: at(4, 10, 15) }, { start: at(4, 13), end: at(4, 14) }, { start: at(3, 14), end: at(3, 16, 30) }, { start: at(2, 10), end: at(2, 11, 30) }] }),
  make('anna000001', 'Reply to Anna about the offsite', { status: 'completed', closed_at: at(4, 9), work_sessions: [{ start: at(4, 8, 30), end: at(4, 9, 15) }] }),
  make('lisbon0001', 'Plan the Lisbon trip', { priority: 'medium', starred: true, projects: [lisbon], scheduled: day(4), work_sessions: [{ start: at(4, 10, 30), end: at(4, 11, 45) }, { start: at(3, 9), end: at(3, 10) }] }),
  make('dentist001', 'Book the dentist', { scheduled: day(4) }),
  make('slides0001', 'Prepare the workshop slides', { status: 'completed', projects: [workshop], closed_at: at(3, 17), work_sessions: [{ start: at(3, 11), end: at(3, 12, 45) }, { start: at(2, 15), end: at(2, 17) }] }),
  make('budget0001', 'Check the team budget', { priority: 'low', projects: [review], work_sessions: [{ start: at(4, 11, 15), end: at(4, 12, 15) }, { start: at(3, 16, 45), end: at(3, 17, 30) }] }),
  make('canceled01', 'Renew the old domain', { status: 'canceled' }),
];
const byId = new Map(tasks.map(t => [t.id, t]));
const marker = (t: Task) => ({ completed: 'x', in_progress: '/', canceled: '-' } as Record<string, string>)[t.status] ?? ' ';
const line = (t: Task) => `- [${marker(t)}] ${t.title} <!--organized:${t.id}-->`;
const dailies: Record<string, string> = {
  [day(2)]: `## Today\n${['q1review01', 'slides0001'].map(id => line(byId.get(id)!)).join('\n')}\n`,
  [day(3)]: `## Today\n${['lisbon0001', 'slides0001', 'budget0001'].map(id => line(byId.get(id)!)).join('\n')}\n`,
  [day(4)]: `## Today\n${['q1review01', 'anna000001', 'lisbon0001', 'dentist001'].map(id => line(byId.get(id)!)).join('\n')}\n- [ ] Buy oat milk\n`,
  [day(1)]: '## Today\n- [x] Water the plants\n', [day(5)]: '## Today\n',
};
const notes: Record<string, string> = {
  q1review01: '---\ntitle: Draft the Q1 review\n---\n\nSummarise what shipped, what slipped and what we learn from it. Two pages, numbers first. Ask [[Sam]] for the churn numbers before Friday.\n\n## Sources\n[Q1 metrics dashboard](https://example.com/dashboard)\n[[Q1 retro notes]]\n',
};
const colors: Record<string, string> = { [review]: '#7b6cd9', [lisbon]: '#e0852d', [workshop]: '#2f9e8f' };
const files = new Set([...Object.keys(dailies).map(d => `Daily/${d}.md`), review, lisbon, workshop, ...tasks.map(t => `Tasks/${t.id}.md`)]);
const app: any = { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } };
const owner: any = {
  app, selectedTaskId: null, context: null, settings: { ...DEFAULT_SETTINGS, knownProjects: [review, lisbon, workshop], displayProperties: [] }, revision: 0, rememberProjects: () => undefined,
  setDayTasksCollapsed() {}, saveSettings() {}, onEditorUpdate() {}, deleteTask: async () => undefined, assertWritable() {}, run: async (fn: () => unknown) => fn(), contextFor: () => null, pickProjects() {},
  setHideClosedProjects() {}, saveModule: async () => undefined, refresh() {},
  repo: {
    projectFolder: () => 'Tasks/Projects', taskColor: (t: Task) => (t.projects[0] ? colors[t.projects[0]] : null), projectColor: (p: string) => colors[p] ?? null,
    list: async () => tasks, file: (path: string) => (files.has(path) ? { path } : null), read: async (id: string) => byId.get(id)!, taskPath: (id: string) => `Tasks/${id}.md`,
    readText: async (f: { path: string }) => dailies[f.path.slice(6, 16)] ?? notes[f.path.slice(6, -3)] ?? '',
  },
  service: { daily: { path: (d: string) => `Daily/${d}.md`, open: async () => null }, refs: async () => [], retiredWork: async () => [], reconcile: async () => undefined, resolve: async () => undefined },
  taskSourceEditor: () => null, taskLines: async (f: { path: string }) => parseTasks(dailies[f.path.slice(6, 16)] ?? ''),
};
const view = new OrganizedInspectorView({ app } as any, owner);
const root = document.querySelector('#app')!;
const page = (window as any);
page.missingIcons = () => [...missingIcons];
/** scene name -> what to show */
let modal: OnboardingModal | RetireModal | null = null;
page.scene = async (name: string) => {
  modal?.close(); modal = null; root.replaceChildren();
  if (name === 'retire') {
    const found = { tasks, files: new Map(tasks.map(t => [t.id, [{ path: `Daily/2026-03-0${tasks.indexOf(t) % 4 + 1}.md` } as any]])), lines: new Map(tasks.map(t => [t.id, 2])) };
    modal = new RetireModal(app, { which: 'closed', olderThanDays: 7, lines: 'link', keep: 'all', notes: 'rename', yaml: 'keep' }, async () => found as any, async () => undefined); modal.open(); await Promise.resolve(); await Promise.resolve(); return;
  }
  if (name.startsWith('onboarding-')) { modal = new OnboardingModal(app, () => undefined); modal.open(); (modal as any).index = Number(name.slice('onboarding-'.length)) - 1; (modal as any).draw(); return; } owner.selectedTaskId = null; view.selectedDate = day(4); view.module = ''; view.editingTitle = false; view.editingModule = '';
  const [tab, mode] = ({ month: ['Calendar', 'Month'], week: ['Calendar', 'Week'], day: ['Calendar', 'Day'], task: ['Task', 'Month'], projects: ['Projects', 'Month'], favorites: ['Favorites', 'Month'] } as Record<string, [string, string]>)[name] ?? (() => { throw new Error(`unknown scene ${name}`); })();
  view.tab = tab as typeof view.tab; view.calendarMode = mode as typeof view.calendarMode;
  if (name === 'task') owner.selectedTaskId = 'q1review01';
  root.appendChild(view.contentEl); await view.render(); await Promise.resolve();
};
