// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { TaskPicker, PriorityPicker, DatePicker, ConfirmModal, ProjectPicker, KEEP_AS_TODO } from "../modals";
import { newTask } from "../model";
import { harness } from "./harness";
import { Notice, Setting } from "./__mocks__/obsidian";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const decorated = (modal: { modalEl: HTMLElement; containerEl: HTMLElement }) => {
  expect(modal.modalEl.classList.contains("organized-modal-window")).toBe(true);
  // Top-aligned host keeps actions clear of an on-screen mobile keyboard.
  expect(modal.containerEl.classList.contains("organized-modal-host")).toBe(true);
};
describe("native task, date, source and project modals", () => {
  it("filters existing records and offers only explicit nonempty creation", async () => {
    const h = harness(); const task = newTask('A task', 'task1234'); const scheduled = { ...task, id: 'task5678', title: 'Later', scheduled: '2026-01-01' }; const choose = vi.fn(async () => undefined);
    const picker = new TaskPicker(h.app, [task, scheduled], choose);
    expect(picker.inputEl.value).toBe(''); expect(picker.getSuggestions('')).toEqual([task, scheduled]); expect(picker.getSuggestions('task')).toEqual([task, 'task']); expect(picker.getSuggestions('  ')).toEqual([task, scheduled]);
    decorated(picker);
    const host = createDiv(); picker.renderSuggestion(task, host); expect(host.textContent).toContain('open · none'); expect(host.textContent).not.toContain(task.id); picker.renderSuggestion(scheduled, host); expect(host.textContent).toContain('2026-01-01'); picker.renderSuggestion('new', host); expect(host.textContent).toContain('Create new task');
    picker.onChooseSuggestion(task); await flush(); expect(choose).toHaveBeenCalledWith(task);
    choose.mockRejectedValueOnce(Error('write failed')); picker.onChooseSuggestion('new'); await flush(); expect(Notice.instances.at(-1)?.message).toContain('write failed');
    const priority = new PriorityPicker(h.app, choose as any); expect(priority.getSuggestions('h')).toEqual(['high']); expect(priority.getSuggestions('')).toHaveLength(4); priority.renderSuggestion('none', host); expect(host.textContent).toBe('None'); priority.onChooseSuggestion('low'); await flush(); expect(choose).toHaveBeenCalledWith('low');
    choose.mockRejectedValueOnce(Error('priority failure')); priority.onChooseSuggestion('none'); await flush(); expect(Notice.instances.at(-1)?.message).toContain('priority failure');
  });
  it("offers keep-as-todo only when the automatic trigger enables it", async () => {
    const h = harness(); const task = newTask('A task', 'task1234'); const choose = vi.fn(async () => undefined);
    const regular = new TaskPicker(h.app, [task], choose);
    expect(regular.getSuggestions('task')).toEqual([task, 'task']);
    const triggered = new TaskPicker(h.app, [task], choose, '', true);
    expect(triggered.getSuggestions('')).toEqual([KEEP_AS_TODO, task]);
    const row = createDiv(); triggered.renderSuggestion(KEEP_AS_TODO, row);
    expect(row.textContent).toContain('Keep as regular todo');
    triggered.onChooseSuggestion(KEEP_AS_TODO); expect(choose).toHaveBeenCalledWith(KEEP_AS_TODO);
    const linkedTask = newTask('[[Other note]]', 'task9876'); const linkedRow = createDiv(); triggered.renderSuggestion(linkedTask, linkedRow); await flush();
    const anchor = linkedRow.querySelector<HTMLAnchorElement>('a')!; expect(anchor.getAttribute('href')).toBe('Other note.md');
    const open = vi.fn(); (h.app.workspace as any).openLinkText = open; anchor.click(); expect(open).toHaveBeenCalledWith('Other note', '');
    const externalTask = newTask('[website](https://example.com)', 'task8765'); const externalRow = createDiv(); triggered.renderSuggestion(externalTask, externalRow); await flush();
    const external = externalRow.querySelector<HTMLAnchorElement>('a')!; const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    external.click(); expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener'); windowOpen.mockRestore();
    const missingHref = vi.spyOn(anchor, 'getAttribute').mockReturnValue(null); anchor.click(); expect(open).toHaveBeenLastCalledWith('', ''); missingHref.mockRestore();
  });
  it("date confirmation validates, cancellation creates nothing, errors are visible", async () => {
    const h = harness(); const choose = vi.fn(async () => undefined); const modal = new DatePicker(h.app, '2026-01-01', choose); modal.open(); decorated(modal);
    const input = modal.contentEl.querySelector('input') as HTMLInputElement; input.value = ''; modal.contentEl.querySelector('button')!.click(); expect(choose).not.toHaveBeenCalled();
    input.value = '2026-01-02'; modal.contentEl.querySelector('button')!.click(); await flush(); expect(choose).toHaveBeenCalledWith('2026-01-02'); expect(modal.contentEl.childElementCount).toBe(0);
    const failed = new DatePicker(h.app, '2026-01-03', async () => { throw Error('date failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('date failure'); failed.close();
  });
  it("settles confirmations exactly once and flags destructive actions", async () => {
    const h = harness();
    const done = vi.fn(); const cancel = new ConfirmModal(h.app, 'Question?', done); cancel.open(); decorated(cancel); cancel.contentEl.querySelector('button')!.click(); expect(done).toHaveBeenCalledExactlyOnceWith(false);
    done.mockClear(); const confirm = new ConfirmModal(h.app, 'Question?', done); confirm.open(); confirm.contentEl.querySelectorAll('button')[1].click(); expect(done).toHaveBeenCalledExactlyOnceWith(true);
    const deleting = new ConfirmModal(h.app, 'Remove it?', done, 'Delete task', 'Delete'); deleting.open(); expect(deleting.titleEl.textContent).toBe('Delete task'); expect(deleting.contentEl.querySelectorAll('button')[1].textContent).toBe('Delete'); expect((Setting.instances.at(-1)!.controls.at(-1) as any).buttonEl.classList.contains('mod-warning')).toBe(true); deleting.close(); expect(done).toHaveBeenCalledTimes(2);
  });
  it("multi-selects projects and creates only a chosen valid root note; search keeps input focus", async () => {
    const h = harness(); const save = vi.fn(async () => undefined); const modal = new ProjectPicker(h.app, ['Existing.md', 'Other.md'], ['Selected.md'], save); modal.open(); decorated(modal);
    const input = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement; input.focus(); input.value = 'New'; input.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(input); expect(modal.contentEl.textContent).toContain('New.md (create)');
    const choice = modal.contentEl.querySelector('input[type=checkbox]') as HTMLInputElement; choice.checked = true; choice.dispatchEvent(new Event('change')); choice.checked = false; choice.dispatchEvent(new Event('change')); choice.checked = true; choice.dispatchEvent(new Event('change'));
    input.value = '../bad'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    input.value = 'bad?'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    modal.contentEl.querySelector('button')!.click(); await flush(); expect(save).toHaveBeenCalledWith(['Selected.md', 'New.md']); expect(h.files.size).toBe(0);
    const failed = new ProjectPicker(h.app, [], [], async () => { throw Error('project failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('project failure');
  });
});
