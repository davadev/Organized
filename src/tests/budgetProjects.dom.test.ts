// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OrganizedInspectorView } from '../view';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { Notice } from './__mocks__/obsidian';
import { taskFrom } from '../model';
import { projectUse } from '../planning';

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); Notice.instances.length = 0; });
const NOW = new Date(2026, 2, 11, 15, 0, 0);
async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(NOW); const h = harness(); const owner = new Organized(h.app, { id: 'organized', version: '0.0.0' } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  const project = async (name: string, budgets: Record<string, number> = {}) => h.add(`${owner.repo.projectFolder()}/${name}.md`, `---\norganized_type: project\n${Object.entries(budgets).map(([k, v]) => `${k === 'total' ? 'organized_budget' : `organized_budget_${k}`}: ${v}`).join('\n')}\n---\n`) as Promise<any>;
  const at = (hour: number, minute = 0) => new Date(2026, 2, 11, hour, minute).toISOString();
  const show = async (id: string) => { owner.selectedTaskId = id; view.tab = 'Task'; await view.render(); await flush(); };
  const lines = () => Array.from(view.contentEl.querySelectorAll('.organized-budget-label')).map(l => l.textContent);
  const texts = () => Array.from(view.contentEl.querySelectorAll('.organized-budget-text')).map(l => l.textContent);
  return { ...h, owner, view, repo: owner.repo, service: owner.service, project, at, show, lines, texts };
}

describe('a task in several projects', () => {
  it('lists a project once even when a note links it twice, and counts each task once per project', async () => {
    expect(taskFrom({ id: 'abcdefgh', title: 'x', projects: ['A.md', 'A.md', 'B.md', 'A.md'] }, 'abcdefgh').projects).toEqual(['A.md', 'B.md']);
    const { repo, project, at, show, lines, texts } = await fixture(); const a = await project('Alpha', { daily: 4 });
    const task = await repo.create('Twice'); await repo.update(task.id, t => ({ ...t, projects: [a.path, a.path], work_sessions: [{ start: at(9), end: at(10) }], time_tracked_seconds: 3600 }));
    await show(task.id); expect(lines()).toEqual(['Alpha · today']); expect(texts()).toEqual(['1h tracked · 3h left of 4h']);
  });
  it('counts a task in full toward every project it belongs to, including a running timer', async () => {
    const { repo, project, at, show, texts, lines } = await fixture(); const a = await project('Alpha', { daily: 2 }); const b = await project('Beta', { daily: 1 });
    const task = await repo.create('Both'); await repo.update(task.id, t => ({ ...t, projects: [a.path, b.path], time_tracking_started_at: at(14, 30) }));
    await show(task.id); expect(lines()).toEqual(['Alpha · today', 'Beta · today']); expect(texts()).toEqual(['30 min tracked · 1h 30min left of 2h', '30 min tracked · 30 min left of 1h']);
  });
  it('shows only the projects that have budgets, in the order the task lists them, and ignores stale paths', async () => {
    const { repo, project, show, lines, view } = await fixture(); const plain = await project('Plain'); const b = await project('Beta', { weekly: 5 }); const c = await project('Gamma', { total: 9, monthly: 3 });
    const task = await repo.create('Mixed'); await repo.update(task.id, t => ({ ...t, projects: ['Gone/Missing.md', c.path, plain.path, b.path] }));
    await show(task.id); expect(lines()).toEqual(['Gamma · all time', 'Gamma · this month', 'Beta · this week']); expect(view.contentEl.querySelector('.organized-card-summary')).not.toBeNull();
    await repo.update(task.id, t => ({ ...t, projects: ['Gone/Missing.md', plain.path] })); await show(task.id); expect(view.contentEl.querySelector('.organized-card-summary')).toBeNull();
  });
  it('draws a bar for every budget of many projects without breaking', async () => {
    const { repo, project, show, lines, view } = await fixture(); const paths: string[] = [];
    for (const name of ['One', 'Two', 'Three', 'Four']) paths.push((await project(name, { total: 100, daily: 8, weekly: 40, monthly: 160 })).path);
    const task = await repo.create('Crowded'); await repo.update(task.id, t => ({ ...t, projects: paths, time_budget_seconds: 3600 })); await show(task.id);
    expect(lines()).toHaveLength(16); expect(view.contentEl.querySelectorAll('.organized-budget-bar')).toHaveLength(17);
  });
  it('follows linking and unlinking: the bars and the other tasks of the project change at once', async () => {
    const { repo, service, project, at, show, lines, texts } = await fixture(); const a = await project('Alpha', { daily: 4 }); const b = await project('Beta', { daily: 2 });
    const mine = await repo.create('Mine'); const other = await repo.create('Other');
    await repo.update(mine.id, t => ({ ...t, projects: [a.path], work_sessions: [{ start: at(9), end: at(10) }], time_tracked_seconds: 3600 })); await repo.update(other.id, t => ({ ...t, projects: [a.path], work_sessions: [{ start: at(11), end: at(12) }], time_tracked_seconds: 3600 }));
    await show(mine.id); expect(texts()).toEqual(['2h tracked · 2h left of 4h']);
    await service.projects(other.id, [b.path]); await show(mine.id); expect(texts()).toEqual(['1h tracked · 3h left of 4h']);
    await service.projects(mine.id, [a.path, b.path]); await show(mine.id); expect(lines()).toEqual(['Alpha · today', 'Beta · today']); expect(texts()).toEqual(['1h tracked · 3h left of 4h', '2h tracked · 0 min left of 2h']);
    await service.projects(mine.id, []); await show(mine.id); expect(lines()).toEqual([]);
  });
  it('counts the worked time of canceled and done tasks in the bars', async () => {
    const { repo, project, at, show, texts } = await fixture(); const a = await project('Alpha', { daily: 8 }); const done = await repo.create('Done'); const gone = await repo.create('Canceled'); const mine = await repo.create('Mine');
    for (const [task, status] of [[done, 'completed'], [gone, 'canceled']] as const) await repo.update(task.id, t => ({ ...t, projects: [a.path], status, work_sessions: [{ start: at(9), end: at(10) }], time_tracked_seconds: 3600, planned_sessions: [{ start: at(16), end: at(18) }] }));
    await repo.update(mine.id, t => ({ ...t, projects: [a.path] })); await show(mine.id); expect(texts()).toEqual(['2h tracked · 6h left of 8h']);
  });
  it('keeps the time of a todo that became a standalone note counting toward its project', async () => {
    const { repo, project, at, show, texts } = await fixture(); const a = await project('Alpha', { total: 10, daily: 8 });
    const converted = await repo.create('Became a note'); await repo.update(converted.id, t => ({ ...t, projects: [a.path], converted_to: 'Notes/Became.md', work_sessions: [{ start: at(9), end: at(11) }], time_tracked_seconds: 7200 }));
    expect(await repo.list()).toHaveLength(0); const mine = await repo.create('Mine'); await repo.update(mine.id, t => ({ ...t, projects: [a.path] }));
    await show(mine.id); expect(texts()).toEqual(['2h tracked · 8h left of 10h', '2h tracked · 6h left of 8h']);
  });
  it('does not roll a subtask up into its parent: only tasks linked to the project count', () => {
    const P = 'Projects/P.md'; const parent = taskFrom({ id: 'parent01', title: 'Parent', projects: [P], subtasks: ['[[Child]]'] }, 'parent01');
    const child = taskFrom({ id: 'child001', title: 'Child', time_tracked_seconds: 3600, work_sessions: [{ start: new Date(2026, 2, 11, 9).toISOString(), end: new Date(2026, 2, 11, 10).toISOString() }] }, 'child001');
    expect(projectUse([parent, child], P, 'total', 36000, NOW.getTime()).tracked).toBe(0);
    expect(projectUse([parent, { ...child, projects: [P] }], P, 'total', 36000, NOW.getTime()).tracked).toBe(3600);
  });
});

describe('renaming or moving a project note', () => {
  it('moves the links of its tasks along, so its budgets and colour keep applying', async () => {
    const f = await fixture(); const { repo, service, project, show, lines } = f; const renamed = await project('Renamed', { daily: 2 }); const other = await project('Other', { daily: 1 }); const old = `${repo.projectFolder()}/Alpha.md`;
    const task = await repo.create('Linked'); const done = await repo.create('Linked too'); const unrelated = await repo.create('Unrelated');
    await repo.update(task.id, t => ({ ...t, projects: [old, other.path] })); await repo.update(done.id, t => ({ ...t, projects: [old], status: 'completed' })); await repo.update(unrelated.id, t => ({ ...t, projects: [other.path] }));
    await show(task.id); expect(lines()).toEqual(['Other · today']);
    await service.followProjectRename(old, renamed.path);
    expect((await repo.read(task.id)).projects).toEqual([renamed.path, other.path]); expect((await repo.read(done.id)).projects).toEqual([renamed.path]); expect((await repo.read(unrelated.id)).projects).toEqual([other.path]);
    await show(task.id); expect(lines()).toEqual(['Renamed · today', 'Other · today']);
    await service.followProjectRename(renamed.path, 'Folder/NotAMarkdownFile.txt'); expect((await repo.read(task.id)).projects).toEqual([renamed.path, other.path]);
    await service.followProjectRename(renamed.path, other.path); expect((await repo.read(task.id)).projects).toEqual([other.path]);
  });
  it('is triggered by Obsidian renaming a project note, and ignores other notes', async () => {
    const f = await fixture(); f.layout[0](); const old = (await f.project('Alpha')).path; const renamed = await f.project('Renamed', { weekly: 3 }); const plain: any = await f.add('Notes/Plain.md', 'x');
    f.owner.settings.knownProjects = [old]; f.view.selectedProject = old; const task = await f.repo.create('Linked'); await f.repo.update(task.id, t => ({ ...t, projects: [old] }));
    expect(f.owner.settings.knownProjects).toEqual([old]); f.events.rename[0](renamed, old); expect(f.owner.settings.knownProjects).toEqual([renamed.path]); expect(f.view.selectedProject).toBe(renamed.path); await vi.advanceTimersByTimeAsync(0); await flush(); await flush();
    expect((await f.repo.read(task.id)).projects).toEqual([renamed.path]); expect(f.owner.settings.knownProjects).toEqual([renamed.path]);
    const before = await f.repo.read(task.id); f.events.rename[0](plain, 'Notes/Moved.md'); await vi.advanceTimersByTimeAsync(0); await flush(); expect(await f.repo.read(task.id)).toEqual(before);
  });
});
