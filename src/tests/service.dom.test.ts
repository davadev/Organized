// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { parseTasks } from "../codec";
import { localDate, nextDate } from "../model";
import { Notice } from "./__mocks__/obsidian";
import { byPriority, report } from "../service";
import { splitNote } from "../repository";

installObsidianDom();
beforeEach(() => { Notice.instances.length = 0; });
describe("repository and explicit task actions", () => {
  it("creates canonical Markdown once, validates metadata, preserves unknown fields", async () => {
    const h = harness(); const task = await h.repo.create('A "quoted" task');
    expect(await h.repo.read(task.id)).toEqual(task); expect(await h.repo.list()).toEqual([task]);
    await h.add('Tasks/broken.md', '---\nid: nope\n---\n'); expect(await h.repo.list()).toEqual([task]);
    await h.repo.update(task.id, t => ({ ...t, starred: true })); expect((await h.repo.read(task.id)).starred).toBe(true);
    await expect(h.repo.read('missing1')).rejects.toThrow('Missing task'); await expect(h.repo.update('missing1', t => t)).rejects.toThrow('missing');
    h.raw.fileManager.processFrontMatter.mockImplementationOnce(async () => undefined);
    await expect(h.repo.update(task.id, t => t)).rejects.toThrow('did not complete');
    expect(splitNote('plain')).toEqual({ frontmatter: {}, body: 'plain' });
    expect(splitNote('---\n[]\n---\nbody')).toEqual({ frontmatter: {}, body: 'body' });
  });
  it("serializes writes and recovers after rejection", async () => {
    const h = harness(); const order: number[] = [];
    const a = h.repo.serial(async () => { order.push(1); throw Error('failed'); });
    const b = h.repo.serial(async () => { order.push(2); return 42; });
    await expect(a).rejects.toThrow(); expect(await b).toBe(42); expect(order).toEqual([1, 2]);
  });
  it("uses Editor transactions for active notes, Vault.process otherwise, refuses concurrent edits", async () => {
    const h = harness(); const file: any = await h.add('Note.md', 'Before'); const editor = h.setActive(file);
    await h.repo.write(file, 'Before', 'Between'); expect(editor.getValue()).toBe('Between'); expect(editor.transaction).toHaveBeenCalledOnce(); expect(h.raw.vault.process).not.toHaveBeenCalled();
    await expect(h.repo.write(file, 'stale', 'bad')).rejects.toThrow('concurrently');
    await h.repo.write(file, 'Between', 'Between'); expect(editor.transaction).toHaveBeenCalledOnce();
    await h.repo.write(file, 'Between', 'Bxtween'); expect(editor.getValue()).toBe('Bxtween');
    h.clearActive(); await h.repo.write(file, 'Before', 'After'); expect(h.texts.get(file.path)).toBe('After');
    await expect(h.repo.write(file, 'Before', 'oops')).rejects.toThrow('concurrently');
    expect(h.repo.file('missing.md')).toBeNull();
  });
  it("handles racing folder and note creation without overwriting", async () => {
    const h = harness(); const file = await h.repo.ensure('Nested/Folder/Note.md', 'first');
    expect(await h.repo.ensure('Nested/Folder/Note.md', 'overwrite')).toBe(file); expect(await h.repo.readText(file)).toBe('first');
    h.raw.vault.createFolder.mockImplementationOnce(async (p: string) => { h.files.set(p, {} as any); throw Error('race'); });
    await h.repo.ensure('Race/Note.md');
    h.raw.vault.createFolder.mockRejectedValueOnce(Error('permission')); await expect(h.repo.ensure('Denied/Note.md')).rejects.toThrow('permission');
    h.raw.vault.create.mockImplementationOnce(async (p: string, text: string) => { const existing = file as any; h.files.set(p, existing); throw Error('race'); });
    expect(await h.repo.ensure('Raced.md')).toBe(file);
    h.raw.vault.create.mockRejectedValueOnce(Error('permission')); await expect(h.repo.ensure('Denied.md')).rejects.toThrow('permission');
  });
  it("attaches explicitly, never creates a provisional record, preserves a stale editor", async () => {
    const h = harness(); const file: any = await h.add('Note.md', '- [ ] Draft'); const task = await h.repo.create('Canonical');
    let context = { file, line: parseTasks(await h.repo.readText(file))[0] };
    context = await h.service.attach(context, task); expect(context.line.id).toBe(task.id); expect(h.texts.get('Note.md')).toContain('Canonical');
    await expect(h.service.attach(context, task)).rejects.toThrow('already linked');
    const independent = await h.repo.create('Independent'); context = await h.service.attach(context, independent, true); expect(context.line.id).toBe(independent.id);
    h.texts.set('Note.md', 'no task'); await expect(h.service.resolve(context)).rejects.toThrow('context changed');
    expect(await h.repo.list()).toHaveLength(2);
  });
  it("schedules/reschedules, retains identity and origin, never injects a date into task source", async () => {
    const h = harness(); const task = await h.repo.create('Schedule'); const file: any = await h.add('Daily/2026-01-01.md', `# Work\n- [<] Schedule <!--organized:${task.id}-->`);
    let context = { file, line: parseTasks(await h.repo.readText(file))[0] };
    await h.service.schedule(context, '2026-01-02');
    expect(h.texts.get(file.path)).not.toContain('2026-01-02'); expect(parseTasks(h.texts.get('Daily/2026-01-02.md')!)[0]).toMatchObject({ id: task.id, marker: ' ', section: [{ level: 1, text: 'Work', ordinal: 0 }] });
    await h.service.schedule(context, '2026-01-02'); expect(parseTasks(h.texts.get('Daily/2026-01-02.md')!)).toHaveLength(1); expect((await h.repo.read(task.id)).movement_history).toHaveLength(1);
    await h.service.schedule(context, '2026-01-03'); expect(h.texts.get('Daily/2026-01-02.md')).not.toContain(task.id); expect((await h.repo.read(task.id)).movement_history[1].kind).toBe('reschedule');
    h.texts.set('Daily/2026-01-03.md', h.texts.get('Daily/2026-01-03.md')! + `\n- [ ] Duplicate <!--organized:${task.id}-->`);
    await h.service.schedule(context, '2026-01-04'); expect(h.texts.get('Daily/2026-01-03.md')).toContain('Duplicate'); expect(Notice.instances.at(-1)?.message).toContain('ambiguous');
    const plain: any = await h.add('Plain.md', '- [<] unlinked'); await expect(h.service.schedule({ file: plain, line: parseTasks('- [<] unlinked')[0] }, '2026-01-02')).rejects.toThrow('Attach');
  });
  it("forwards from daily and undated notes; active timers keep their original timestamp", async () => {
    const h = harness(); const task = await h.repo.create('Timer'); await h.repo.update(task.id, t => ({ ...t, status: 'in_progress', time_tracking_started_at: '2026-01-01T00:00:00Z' }));
    const file: any = await h.add('Daily/2026-01-01.md', `- [>] Timer <!--organized:${task.id}-->`);
    await h.service.schedule({ file, line: parseTasks(await h.repo.readText(file))[0] }, '2026-01-02', 'forward');
    expect(h.texts.get(file.path)).toContain('[>]'); expect(h.texts.get('Daily/2026-01-02.md')).toContain('[/]');
    expect((await h.repo.read(task.id)).time_tracking_started_at).toBe('2026-01-01T00:00:00Z');
    const project: any = await h.add('Project.md', `- [>] Timer <!--organized:${task.id}-->`);
    await h.service.schedule({ file: project, line: parseTasks(await h.repo.readText(project))[0] }, '2026-01-03', 'forward'); expect(h.texts.get('Project.md')).toContain('[ ]');
    await h.service.schedule({ file, line: parseTasks(await h.repo.readText(file))[0] }, '2026-01-01'); expect(h.texts.get(file.path)).toContain('[>]');
  });
  it("status propagates only to today/future and undated notes, leaving prior daily history untouched", async () => {
    const h = harness(); const task = await h.repo.create('Status'); const today = localDate();
    for (const p of ['Daily/2020-01-01.md', `Daily/${today}.md`, `Daily/${nextDate(today)}.md`, 'Project.md']) await h.add(p, `- [ ] Status <!--organized:${task.id}-->`);
    await h.add('Forward.md', `- [>] Status <!--organized:${task.id}-->`);
    await h.service.status(task.id, 'completed'); expect(h.texts.get('Daily/2020-01-01.md')).toContain('[ ]'); expect(h.texts.get(`Daily/${today}.md`)).toContain('[x]'); expect(h.texts.get('Project.md')).toContain('[x]'); expect(h.texts.get('Forward.md')).toContain('[x]');
    await h.service.status(task.id, 'canceled'); expect(h.texts.get('Project.md')).toContain('[-]');
    await h.service.status(task.id, 'in_progress'); expect(h.texts.get('Project.md')).toContain('[/]');
    await h.service.status(task.id, 'open'); expect(h.texts.get('Project.md')).toContain('[ ]');
  });
  it("recurring occurrences are independent, generated idempotently and undoable without deleting notes", async () => {
    const h = harness(); const task = await h.repo.create('Repeat'); const today = localDate(); const tomorrow = nextDate(today);
    const file: any = await h.add(`Daily/${today}.md`, `# Work\n- [f] Repeat <!--organized:${task.id}-->`); await h.add(`Daily/${tomorrow}.md`);
    const context = { file, line: parseTasks(await h.repo.readText(file))[0] };
    await h.service.recurrence(task.id, context); expect((await h.repo.read(task.id)).recurring).toBe(true); expect(h.texts.get(`Daily/${tomorrow}.md`)).toContain('<!--organized:repeat-->');
    const current = { file, line: parseTasks(await h.repo.readText(file))[0] };
    await h.service.status(task.id, 'completed', current); expect(h.texts.get(file.path)).toContain('[x]'); expect(h.texts.get(`Daily/${tomorrow}.md`)).toContain('[ ]'); expect((await h.repo.read(task.id)).status).toBe('open');
    await h.service.status(task.id, 'canceled', current); expect(h.texts.get(file.path)).toContain('[-]');
    await h.service.status(task.id, 'in_progress', current); expect(h.texts.get(file.path)).toContain('[/]');
    await h.service.status(task.id, 'open'); expect(h.texts.get(file.path)).toContain('[/]');
    await h.service.recurrence(task.id); expect(h.texts.get(`Daily/${tomorrow}.md`)).not.toContain(task.id); expect(h.texts.get(file.path)).toContain(task.id);
    await h.service.undo(); expect((await h.repo.read(task.id)).recurring).toBe(true); expect(h.texts.get(`Daily/${tomorrow}.md`)).toContain(task.id);
    const future: any = await h.add('Daily/2099-01-01.md'); await h.service.onDailyCreated(future); await h.service.onDailyCreated(future); expect(parseTasks(await h.repo.readText(future))).toHaveLength(1);
    const other: any = await h.add('Other.md'); await h.service.onDailyCreated(other); expect(h.texts.get('Other.md')).toBe('');
    const past: any = await h.add('Daily/2020-01-01.md'); await h.service.onDailyCreated(past); expect(h.texts.get(past.path)).toBe('');
  });
  it("preserves concurrent edits during undo and missing-section cancellation", async () => {
    const h = harness(); const task = await h.repo.create('Repeat'); await h.add('Daily/2099-01-01.md'); await h.service.recurrence(task.id);
    h.texts.set('Daily/2099-01-01.md', 'Concurrent user change'); await h.service.undo(); expect(h.texts.get('Daily/2099-01-01.md')).toBe('Concurrent user change'); expect(Notice.instances.at(-1)?.message).toContain('concurrent');
    h.setSettings({ missingSection: 'ask' }); h.confirm.mockResolvedValue(false);
    const file: any = await h.add('Missing.md'); await expect(h.service.insert(file, { ...task, daily_note_section_path: [{ level: 1, text: 'Work', ordinal: 0 }] }, ' ', false)).rejects.toThrow('canceled'); expect(h.texts.get('Missing.md')).toBe('');
    h.confirm.mockResolvedValue(true); await h.service.insert(file, { ...task, daily_note_section_path: [{ level: 1, text: 'Work', ordinal: 0 }] }, ' ', false); expect(h.texts.get('Missing.md')).toContain('# Work');
  });
  it("auto-forwards latest unfinished occurrences once, respects settings, recurring/completed/future schedules", async () => {
    const h = harness(); const task = await h.repo.create('Carry');
    await h.add('Daily/2020-01-01.md', `- [ ] Carry <!--organized:${task.id}-->`); await h.add('Daily/2020-01-03.md', `# Work\n- [ ] Carry <!--organized:${task.id}-->`);
    const today: any = await h.add(`Daily/${localDate()}.md`);
    h.setSettings({ autoForward: false }); await h.service.reconcile(today); expect(h.texts.get(today.path)).toBe('');
    h.setSettings({ autoForward: true }); await h.service.reconcile(today); expect(h.texts.get(today.path)).toContain(task.id); expect(h.texts.get('Daily/2020-01-03.md')).toContain('[>]'); expect(h.texts.get('Daily/2020-01-01.md')).toContain('[ ]');
    await h.service.reconcile(today); expect(parseTasks(h.texts.get(today.path)!)).toHaveLength(1); await h.service.undo(); expect(h.texts.get(today.path)).not.toContain(task.id);
    const other = harness(); const record = await other.repo.create('Future'); await other.repo.update(record.id, t => ({ ...t, scheduled: '2099-01-01' }));
    await other.add('Daily/2020-01-01.md', `- [ ] Future <!--organized:${record.id}-->\n- [x] Done <!--organized:done1234-->\n- [ ] Broken <!--organized:broken12-->`);
    const now: any = await other.add(`Daily/${localDate()}.md`); await other.service.reconcile(now); expect(other.texts.get(now.path)).toBe('');
    const notice = Notice.instances.at(-1)?.message as DocumentFragment;
    expect(notice.querySelector('.organized-notice-title')?.textContent).toContain('Unfinished tasks carried to today');
    expect(notice.querySelector('.organized-notice-detail')?.textContent).toContain('conflict skipped');
    expect(notice.querySelector('.organized-notice-undo')?.textContent).toBe('Undo');
    const plural = harness();
    await plural.add('Daily/2020-01-01.md', '- [ ] Broken <!--organized:broken1234-->\n- [ ] Broken too <!--organized:broken3456-->');
    const pluralToday: any = await plural.add(`Daily/${localDate()}.md`); await plural.service.reconcile(pluralToday);
    expect((Notice.instances.at(-1)?.message as DocumentFragment).querySelector('.organized-notice-detail')?.textContent).toContain('2 conflicts skipped');
  });
  it("links projects idempotently, removes unique occurrences, preserves conflicts", async () => {
    const h = harness(); const task = await h.repo.create('Project task'); await h.service.projects(task.id, ['Project.md']); await h.service.projects(task.id, ['Project.md']);
    expect(parseTasks(h.texts.get('Project.md')!)).toHaveLength(1); expect((await h.repo.read(task.id)).projects).toEqual(['Project.md']);
    await h.service.projects(task.id, []); expect(h.texts.get('Project.md')).not.toContain(task.id);
    await h.service.projects(task.id, ['Project.md']); h.texts.set('Project.md', h.texts.get('Project.md')! + h.texts.get('Project.md')!); await h.service.projects(task.id, []); expect(h.texts.get('Project.md')).toContain(task.id);
  });
  it("converts only unchecked unlinked todos after confirmation and preserves the rest of the note", async () => {
    const h = harness(); const text = '# Work\n- [ ] First\n  - [ ] Nested\n- [x] Done\n- [/] Active\n- [ ] Linked <!--organized:task1234-->\n- [ ] \nprose';
    const file: any = await h.add('Note.md', text);
    h.confirm.mockResolvedValueOnce(false); await h.service.convertTodos(file);
    expect(h.confirm).toHaveBeenCalledWith('Convert 2 unchecked todos in Note.md into Organized tasks?', 'Convert todos', 'Convert');
    expect(h.texts.get('Note.md')).toBe(text); expect(await h.repo.list()).toEqual([]); expect(h.changed).not.toHaveBeenCalled();
    h.confirm.mockResolvedValueOnce(true); await h.service.convertTodos(file);
    const lines = h.texts.get('Note.md')!.split('\n');
    expect(lines[1]).toMatch(/^- \[ \] First <!--organized:[a-zA-Z0-9_-]{8,80}-->$/);
    expect(lines[2]).toMatch(/^  - \[ \] Nested <!--organized:[a-zA-Z0-9_-]{8,80}-->$/);
    expect(lines.slice(3, 8)).toEqual(['- [x] Done', '- [/] Active', '- [ ] Linked <!--organized:task1234-->', '- [ ] ', 'prose']);
    expect((await h.repo.list()).map(t => t.title).sort()).toEqual(['First', 'Nested']);
    expect(h.changed).toHaveBeenCalledOnce(); expect(Notice.instances.at(-1)?.message).toContain('Converted 2 unchecked todos');
    h.confirm.mockClear(); await h.service.convertTodos(file); expect(h.confirm).not.toHaveBeenCalled(); expect(Notice.instances.at(-1)?.message).toContain('No unchecked todos');
    const single: any = await h.add('Single.md', '- [ ] Only one'); h.confirm.mockResolvedValueOnce(true); await h.service.convertTodos(single); expect(h.confirm).toHaveBeenLastCalledWith('Convert 1 unchecked todo in Single.md into Organized tasks?', 'Convert todos', 'Convert');
  });
  it("preserves CRLF and indentation while converting and refuses task notes", async () => {
    const h = harness(); const file: any = await h.add('Crlf.md', '- [ ] One\r\n  - [ ] Two\r\n');
    h.confirm.mockResolvedValueOnce(true); await h.service.convertTodos(file);
    const out = h.texts.get('Crlf.md')!;
    expect(out).toMatch(/^- \[ \] One <!--organized:[a-zA-Z0-9_-]{8,80}-->\r\n {2}- \[ \] Two <!--organized:[a-zA-Z0-9_-]{8,80}-->\r\n$/);
    expect(out.match(/\r\n/g)).toHaveLength(2); expect(out.match(/\n/g)).toHaveLength(2);
    const task = await h.repo.create('Task note'); await expect(h.service.convertTodos(h.repo.file(h.repo.taskPath(task.id))!)).rejects.toThrow('regular note');
  });
  it("deletes a task only after confirmation, removing every occurrence and trashing its note", async () => {
    const h = harness(); const task = await h.repo.create('Delete me'); const line = `- [ ] Delete me <!--organized:${task.id}-->`;
    await h.add('Daily/2020-01-01.md', `${line}\n- [ ] Keep this`); await h.add('Project.md', line);
    h.confirm.mockResolvedValue(false); expect(await h.service.deleteTask(task.id)).toBe(false); expect(h.repo.file(h.repo.taskPath(task.id))).toBeTruthy(); expect(h.texts.get('Project.md')).toContain(task.id);
    await h.service.refs(task.id); h.confirm.mockResolvedValue(true); expect(await h.service.deleteTask(task.id)).toBe(true);
    expect(h.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Delete me'), 'Delete task', 'Delete');
    expect(h.texts.get('Daily/2020-01-01.md')).not.toContain(task.id); expect(h.texts.get('Daily/2020-01-01.md')).toContain('Keep this'); expect(h.texts.get('Project.md')).toBe('');
    expect(h.raw.fileManager.trashFile).toHaveBeenCalledOnce(); expect(await h.repo.list()).toEqual([]); expect((h.service as any).references).toBeNull();
    const missing = await h.repo.create('Missing note');
    h.confirm.mockImplementationOnce(async () => { h.files.delete(h.repo.taskPath(missing.id)); h.texts.delete(h.repo.taskPath(missing.id)); return true; });
    await expect(h.service.deleteTask(missing.id)).rejects.toThrow('missing');
  });
  it("renames all safe occurrences including history and reports duplicate repair", async () => {
    const h = harness(); const task = await h.repo.create('Old'); const line = `- [>] Old <!--organized:${task.id}-->`;
    await h.add('Daily/2020-01-01.md', line); await h.add('Duplicate.md', `${line}\n${line}`);
    await h.service.title(task.id, 'New'); expect(h.texts.get('Daily/2020-01-01.md')).toContain('[>] New'); expect(h.texts.get('Duplicate.md')).toContain('Old');
    await expect(h.service.title(task.id, '\n')).rejects.toThrow('nonempty'); await expect(h.service.title(task.id, 'a\nb')).rejects.toThrow();
  });
  it("indexes references lazily, updates deletions, suppresses other recurring daily dates", async () => {
    const h = harness(); const task = await h.repo.create('Refs'); const line = `- [ ] Refs <!--organized:${task.id}-->`;
    const project: any = await h.add('Project.md', line); await h.add('Daily/2020-01-01.md', line); await h.add(`Daily/${localDate()}.md`, line);
    await h.service.index(project); expect(h.raw.vault.read).not.toHaveBeenCalledWith(project);
    expect(await h.service.refs(task.id)).toEqual([`Daily/${localDate()}.md`, 'Daily/2020-01-01.md', 'Project.md']);
    await h.repo.update(task.id, t => ({ ...t, recurring: true })); expect(await h.service.refs(task.id)).toEqual([`Daily/${localDate()}.md`, 'Project.md']);
    h.texts.set(project.path, ''); await h.service.index(project); expect(await h.service.refs(task.id)).toEqual([`Daily/${localDate()}.md`]);
    h.service.forget(`Daily/${localDate()}.md`); expect(await h.service.refs(task.id)).toEqual([]);
  });
  it("handles marker lifecycles and priority scope without touching visual-only markers", async () => {
    const h = harness(); const task = await h.repo.create('Actions'); const file: any = await h.add('Note.md', `- [!] Actions <!--organized:${task.id}-->`);
    const context = { file, line: parseTasks(await h.repo.readText(file))[0] };
    await h.service.priority(context, 'high'); expect((await h.repo.read(task.id)).priority).toBe('high'); expect(h.texts.get('Note.md')).toContain('[ ]');
    const fresh = () => ({ file, line: parseTasks(h.texts.get('Note.md')!)[0] });
    for (const marker of ['*', '*', '/', 'x', 'X', '-', ' ', 'k']) await h.service.marker(fresh(), marker);
    expect((await h.repo.read(task.id)).starred).toBe(false); expect((await h.repo.read(task.id)).status).toBe('open');
    await h.service.marker(fresh(), '>'); expect((await h.repo.read(task.id)).scheduled).toBe(nextDate(localDate()));
    await h.service.marker(fresh(), 'f'); expect((await h.repo.read(task.id)).recurring).toBe(true);
    await h.service.marker({ file, line: parseTasks('- [k] Visual')[0] }, 'k'); expect((await h.repo.list())).toHaveLength(1);
    await expect(h.service.priority({ file, line: parseTasks('- [!] Plain')[0] }, 'low')).rejects.toThrow();
    report(Error('Visible')); report('String error'); expect(Notice.instances.at(-1)?.message).toContain('String error');
    expect(byPriority([{ ...task, priority: 'none' }, { ...task, priority: 'high' }]).map(t => t.priority)).toEqual(['high', 'none']);
  });
  it("recognizes custom nested daily paths strictly and opens/creates only on action", async () => {
    const h = harness(); h.setSettings({ dailyFolder: '', dailyFormat: 'YYYY/MM/DD' });
    expect(h.service.daily.path('2026-01-02')).toBe('2026/01/02.md'); expect(h.service.daily.date('2026/01/02.md')).toBe('2026-01-02'); expect(h.service.daily.date('2026/1/2.md')).toBeNull(); expect(h.service.daily.date('2026/02/30.md')).toBeNull(); expect(h.service.daily.date('other.txt')).toBeNull();
    expect(() => h.service.daily.path('bad')).toThrow(); await h.service.daily.open(); expect(h.raw.workspace.getLeaf).toHaveBeenCalled();
    h.setSettings({ dailyFolder: 'Daily' }); expect(h.service.daily.date('Other/2026/01/02.md')).toBeNull();
  });
});
