// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { TaskPicker, PriorityPicker, DatePicker, TextModal, ConfirmModal, ProjectPicker } from "../modals";
import { newTask } from "../model";
import { harness } from "./harness";
import { Notice } from "./__mocks__/obsidian";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe("native task, date, source and project modals", () => {
  it("filters existing records and offers only explicit nonempty creation", async () => {
    const h = harness(); const task = newTask('A task', 'task1234'); const scheduled = { ...task, id: 'task5678', title: 'Later', scheduled: '2026-01-01' }; const choose = vi.fn(async () => undefined);
    const picker = new TaskPicker(h.app, [task, scheduled], choose);
    expect(picker.inputEl.value).toBe(''); expect(picker.getSuggestions('')).toEqual([task, scheduled]); expect(picker.getSuggestions('task')).toEqual([task, 'task']); expect(picker.getSuggestions('  ')).toEqual([task, scheduled]);
    const host = createDiv(); picker.renderSuggestion(task, host); expect(host.textContent).toContain('unscheduled'); picker.renderSuggestion(scheduled, host); expect(host.textContent).toContain('2026-01-01'); picker.renderSuggestion('new', host); expect(host.textContent).toContain('Create new task');
    picker.onChooseSuggestion(task); await flush(); expect(choose).toHaveBeenCalledWith(task);
    choose.mockRejectedValueOnce(Error('write failed')); picker.onChooseSuggestion('new'); await flush(); expect(Notice.instances.at(-1)?.message).toContain('write failed');
    const priority = new PriorityPicker(h.app, choose as any); expect(priority.getSuggestions('h')).toEqual(['high']); expect(priority.getSuggestions('')).toHaveLength(4); priority.renderSuggestion('none', host); expect(host.textContent).toBe('None'); priority.onChooseSuggestion('low'); await flush(); expect(choose).toHaveBeenCalledWith('low');
    choose.mockRejectedValueOnce(Error('priority failure')); priority.onChooseSuggestion('none'); await flush(); expect(Notice.instances.at(-1)?.message).toContain('priority failure');
  });
  it("date confirmation validates, cancellation creates nothing, errors are visible", async () => {
    const h = harness(); const choose = vi.fn(async () => undefined); const modal = new DatePicker(h.app, '2026-01-01', choose); modal.open();
    const input = modal.contentEl.querySelector('input') as HTMLInputElement; input.value = ''; modal.contentEl.querySelector('button')!.click(); expect(choose).not.toHaveBeenCalled();
    input.value = '2026-01-02'; modal.contentEl.querySelector('button')!.click(); await flush(); expect(choose).toHaveBeenCalledWith('2026-01-02'); expect(modal.contentEl.childElementCount).toBe(0);
    const failed = new DatePicker(h.app, '2026-01-03', async () => { throw Error('date failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('date failure');
  });
  it("keeps drafts until save and settles confirmations exactly once", async () => {
    const h = harness(); const save = vi.fn(async () => undefined);
    for (const multiline of [true, false]) { const modal = new TextModal(h.app, 'Notes', 'initial', save, multiline); modal.open(); const input = modal.contentEl.querySelector('input,textarea') as HTMLInputElement; input.value = 'edited'; expect(save).not.toHaveBeenCalledWith('edited'); modal.contentEl.querySelector('button')!.click(); await flush(); expect(save).toHaveBeenCalledWith('edited'); save.mockClear(); }
    const failed = new TextModal(h.app, 'Notes', '', async () => { throw Error('save failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('save failure');
    const done = vi.fn(); const cancel = new ConfirmModal(h.app, 'Question?', done); cancel.open(); cancel.contentEl.querySelector('button')!.click(); expect(done).toHaveBeenCalledExactlyOnceWith(false);
    done.mockClear(); const confirm = new ConfirmModal(h.app, 'Question?', done); confirm.open(); confirm.contentEl.querySelectorAll('button')[1].click(); expect(done).toHaveBeenCalledExactlyOnceWith(true);
    const escaped = new TextModal(h.app, 'Notes', 'draft', save); escaped.open(); escaped.close(); expect(save).not.toHaveBeenCalled();
  });
  it("multi-selects projects and creates only a chosen valid root note; search keeps input focus", async () => {
    const h = harness(); const save = vi.fn(async () => undefined); const modal = new ProjectPicker(h.app, ['Existing.md', 'Other.md'], ['Selected.md'], save); modal.open();
    const input = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement; input.focus(); input.value = 'New'; input.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(input); expect(modal.contentEl.textContent).toContain('New.md (create)');
    const choice = modal.contentEl.querySelector('input[type=checkbox]') as HTMLInputElement; choice.checked = true; choice.dispatchEvent(new Event('change')); choice.checked = false; choice.dispatchEvent(new Event('change')); choice.checked = true; choice.dispatchEvent(new Event('change'));
    input.value = '../bad'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    input.value = 'bad?'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    modal.contentEl.querySelector('button')!.click(); await flush(); expect(save).toHaveBeenCalledWith(['Selected.md', 'New.md']); expect(h.files.size).toBe(0);
    const failed = new ProjectPicker(h.app, [], [], async () => { throw Error('project failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('project failure');
  });
});
