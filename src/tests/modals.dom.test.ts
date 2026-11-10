// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { TaskPicker, PriorityPicker, DatePicker, ConfirmModal, ProjectPicker, SessionModal, BudgetModal, ProjectBudgetModal, NoteConversionModal, OnboardingModal, RetireModal, KEEP_AS_TODO } from "../modals";
import { newTask } from "../model";
import { harness, sessionFields } from "./harness";
import { Notice, Setting } from "./__mocks__/obsidian";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const decorated = (modal: { modalEl: HTMLElement; containerEl: HTMLElement }) => {
  expect(modal.modalEl.classList.contains("organized-modal-window")).toBe(true);
  // Top-aligned host keeps actions clear of an on-screen mobile keyboard.
  expect(modal.containerEl.classList.contains("organized-modal-host")).toBe(true);
};
describe("native task, date, source and project modals", () => {
  it("puts the text typed before it opened back in the search box, after Obsidian cleared it, and filters by it", async () => {
    const h = harness(); const picker = new TaskPicker(h.app, [newTask("Clean kitchen", "task1234")], async () => undefined, "c", true);
    const filtered = vi.fn(); picker.inputEl.addEventListener("input", filtered);
    picker.inputEl.value = ""; picker.open();
    expect(picker.inputEl.value).toBe("c"); expect(picker.inputEl.selectionStart).toBe(1); expect(filtered).toHaveBeenCalledOnce(); picker.close();
  });
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
    const missingHref = vi.spyOn(anchor, 'getAttribute').mockReturnValue(null); anchor.click(); expect(open).toHaveBeenCalledOnce(); missingHref.mockRestore();
  });
  it("offers Clear date only when a clear action is given", async () => {
    const h = harness(); const clear = vi.fn(async () => undefined);
    const plain = new DatePicker(h.app, '2026-01-01', async () => undefined); plain.open(); expect(Array.from(plain.contentEl.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Schedule']); plain.close();
    const modal = new DatePicker(h.app, '2026-01-01', async () => undefined, clear); modal.open(); Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Clear date')!.click(); await flush(); expect(clear).toHaveBeenCalledOnce(); expect(modal.contentEl.childElementCount).toBe(0);
    const failed = new DatePicker(h.app, '2026-01-01', async () => undefined, async () => { throw Error('clear failure'); }); failed.open(); Array.from(failed.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Clear date')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('clear failure');
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
  it("lists project names with their colour dot, and the path only when two projects share a name", () => {
    const h = harness(); const colors: Record<string, string> = { 'Tasks/Projects/Alpha.md': '#3b82f6' };
    const modal = new ProjectPicker(h.app, ['Tasks/Projects/Alpha.md', 'Tasks/Projects/Beta.md', 'Work/Gamma.md', 'Home/Gamma.md'], [], async () => undefined, 'Tasks/Projects', note => colors[note] ?? null); modal.open();
    const rows = Array.from(modal.contentEl.querySelectorAll('.organized-project-choice')); expect(rows.map(r => r.textContent)).toEqual(['Alpha', 'Beta', 'Work/Gamma', 'Home/Gamma']);
    expect(rows[0].querySelector('.organized-project-dot')!.hasAttribute('data-project')).toBe(true); expect(rows[0].querySelector<HTMLElement>('.organized-project-dot')!.style.getPropertyValue('--organized-chip-bg')).toBe('59 130 246');
    expect(rows[1].querySelector('.organized-project-dot')!.hasAttribute('data-project')).toBe(false);
  });
  it("says why only some notes are listed, and where a typed name is created", () => {
    const h = harness();
    const withFolder = new ProjectPicker(h.app, [], [], async () => undefined, 'Tasks/Projects'); withFolder.open();
    const hint = withFolder.contentEl.querySelector('.organized-project-hint')!.textContent!; expect(hint).toContain('organized_type: project'); expect(hint).toContain('creates a new note in Tasks/Projects.');
    const without = new ProjectPicker(h.app, [], [], async () => undefined); without.open(); expect(without.contentEl.querySelector('.organized-project-hint')!.textContent).toContain('creates a new note.');
  });
  it("multi-selects projects and creates only a chosen valid root note; search keeps input focus", async () => {
    const h = harness(); const save = vi.fn(async () => undefined); const modal = new ProjectPicker(h.app, ['Existing.md', 'Other.md'], ['Selected.md'], save); modal.open(); decorated(modal);
    const input = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement; input.focus(); input.value = 'New'; input.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(input); expect(modal.contentEl.textContent).toContain('New (create)');
    const choice = modal.contentEl.querySelector('input[type=checkbox]') as HTMLInputElement; choice.checked = true; choice.dispatchEvent(new Event('change')); choice.checked = false; choice.dispatchEvent(new Event('change')); choice.checked = true; choice.dispatchEvent(new Event('change'));
    input.value = '../bad'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    input.value = 'bad?'; input.dispatchEvent(new Event('input')); expect(modal.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    modal.contentEl.querySelector('button')!.click(); await flush(); expect(save).toHaveBeenCalledWith(['Selected.md', 'New.md']); expect(h.files.size).toBe(0);
    const filed = new ProjectPicker(h.app, [], [], save, 'Tasks/Projects'); filed.open(); const filedInput = filed.contentEl.querySelector('input[type=search]') as HTMLInputElement; filedInput.value = 'Plan.md'; filedInput.dispatchEvent(new Event('input')); expect(filed.contentEl.textContent).toContain('Plan (create)'); filed.close();
    const failed = new ProjectPicker(h.app, [], [], async () => { throw Error('project failure'); }); failed.open(); failed.contentEl.querySelector('button')!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain('project failure');
  });
  it("is driven from the keyboard: arrows move through the list, Enter ticks, Enter in the search picks the best match, Mod+Enter saves", async () => {
    const h = harness(); const save = vi.fn(async () => undefined); const modal = new ProjectPicker(h.app, ['Alpha.md', 'Beta.md', 'Gamma.md'], [], save); modal.open();
    const search = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement; const boxes = () => Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    const key = (el: Element, k: string, extra: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }); el.dispatchEvent(e); return e; };
    boxes().forEach(box => { box.scrollIntoView = vi.fn(); });
    expect(key(search, 'ArrowDown').defaultPrevented).toBe(true); expect(document.activeElement).toBe(boxes()[0]);
    key(boxes()[0], 'ArrowDown'); expect(document.activeElement).toBe(boxes()[1]);
    key(boxes()[1], 'ArrowDown'); expect(document.activeElement).toBe(boxes()[2]);
    const saveButton = modal.contentEl.querySelector('button')!; key(boxes()[2], 'ArrowDown'); expect(document.activeElement).toBe(saveButton); key(saveButton, 'ArrowUp'); expect(document.activeElement).toBe(boxes()[2]); key(saveButton, 'x');
    key(boxes()[2], 'ArrowUp'); key(boxes()[1], 'ArrowUp'); expect(document.activeElement).toBe(boxes()[0]);
    key(boxes()[0], 'ArrowUp'); expect(document.activeElement).toBe(search);
    expect(key(search, 'Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(boxes()[0]);
    key(boxes()[0], 'Tab'); key(boxes()[1], 'Tab'); expect(document.activeElement).toBe(boxes()[2]);
    key(boxes()[2], 'Tab'); expect(document.activeElement).toBe(saveButton);
    key(saveButton, 'Tab', { shiftKey: true }); expect(document.activeElement).toBe(boxes()[2]);
    key(boxes()[2], 'Tab', { ctrlKey: true }); expect(document.activeElement).toBe(boxes()[2]);
    expect(key(saveButton, 'Tab').defaultPrevented).toBe(false); expect(key(search, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    boxes()[1].dispatchEvent(new Event('focus')); expect(boxes()[1].scrollIntoView).toHaveBeenCalled();
    key(boxes()[1], 'Enter'); expect(boxes()[1].checked).toBe(true); key(boxes()[1], 'Enter'); expect(boxes()[1].checked).toBe(false); key(boxes()[1], 'Enter'); key(boxes()[1], 'Enter', { ctrlKey: true }); expect(boxes()[1].checked).toBe(true);
    key(boxes()[1], 'x'); expect(boxes()[1].checked).toBe(true);
    key(search, 'x'); search.value = 'gam'; search.dispatchEvent(new Event('input')); key(search, 'Enter'); expect(search.value).toBe(''); expect(boxes()).toHaveLength(3); expect(boxes()[2].checked).toBe(true);
    search.value = 'zzz'; search.dispatchEvent(new Event('input')); key(search, 'Enter');
    key(search, 'Enter', { metaKey: true }); await flush(); expect(save).toHaveBeenCalledWith(['Beta.md', 'Gamma.md', 'zzz.md']);
    const empty = new ProjectPicker(h.app, [], [], save); empty.open(); const emptySearch = empty.contentEl.querySelector('input[type=search]') as HTMLInputElement;
    key(emptySearch, 'ArrowDown'); expect(document.activeElement).toBe(empty.contentEl.querySelector('button')); key(empty.contentEl.querySelector('button')!, 'ArrowUp'); expect(document.activeElement).toBe(emptySearch); key(emptySearch, 'Enter'); expect(empty.contentEl.querySelectorAll('input[type=checkbox]')).toHaveLength(0); empty.close();
  });
  it("keeps the list above the on-screen keyboard and stops listening when closed", () => {
    const h = harness(); const listeners = new Map<string, () => void>();
    const viewport = { height: 400, offsetTop: 0, addEventListener: (t: string, f: () => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) };
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    try {
      const modal = new ProjectPicker(h.app, ['Alpha.md'], [], async () => undefined); modal.open(); const list = modal.contentEl.querySelector<HTMLElement>('.organized-project-results')!;
      expect(list.style.getPropertyValue('--organized-list-max')).toMatch(/^\d+px$/); const before = list.style.getPropertyValue('--organized-list-max');
      viewport.height = 200; listeners.get('resize')!(); expect(list.style.getPropertyValue('--organized-list-max')).not.toBe(before); expect(parseInt(list.style.getPropertyValue('--organized-list-max'))).toBeGreaterThanOrEqual(120);
      expect([...listeners.keys()].sort()).toEqual(['resize', 'scroll']); modal.close(); expect(listeners.size).toBe(0);
    } finally { Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true }); }
  });
  it("adds or edits a session with a live length, refuses a bad range and offers Open task and Delete when editing", async () => {
    const h = harness(); const at = (hour: number, min = 0) => new Date(2026, 2, 4, hour, min).toISOString(); const now = new Date(2026, 2, 4, 18, 0).getTime();
    const save = vi.fn(async () => undefined); const remove = vi.fn(async () => undefined); const open = vi.fn(async () => undefined);
    const modal = new SessionModal(h.app, { heading: "Edit time worked", taskTitle: "Plan", start: at(9), end: at(10, 30), kind: "worked", save, remove, openTask: open }, () => now); modal.open(); decorated(modal);
    const [start, end] = sessionFields(modal.contentEl); const note = () => modal.contentEl.querySelector('.organized-session-note')!;
    expect(modal.contentEl.querySelector('.organized-session-task')!.textContent).toBe("Plan"); expect(start.value).toBe("2026-03-04T09:00"); expect(note().textContent).toBe("Length: 1h 30min"); expect(modal.contentEl.querySelectorAll("button")).toHaveLength(3);
    end.value = "2026-03-04T08:00"; end.dispatchEvent(new Event("input")); expect(note().textContent).toContain("after the start"); expect(note().classList.contains("organized-session-problem")).toBe(true);
    const buttons = () => Array.from(modal.contentEl.querySelectorAll("button")); buttons().find(b => b.textContent === "Save")!.click(); await flush(); expect(save).not.toHaveBeenCalled();
    end.value = "2026-03-04T09:20"; end.dispatchEvent(new Event("input")); expect(note().textContent).toBe("Length: 20 min"); expect(note().classList.contains("organized-session-problem")).toBe(false);
    buttons().find(b => b.textContent === "Save")!.click(); await flush(); expect(save).toHaveBeenCalledWith({ start: at(9), end: at(9, 20) }, "worked");
    const again = new SessionModal(h.app, { heading: "Edit", taskTitle: "Plan", start: at(9), end: at(10), kind: "worked", save, remove, openTask: open }, () => now); again.open();
    Array.from(again.contentEl.querySelectorAll("button")).find(b => b.textContent === "Open task")!.click(); await flush(); expect(open).toHaveBeenCalledOnce();
    const third = new SessionModal(h.app, { heading: "Edit", taskTitle: "Plan", start: at(9), end: at(10), kind: "worked", save, remove, openTask: open }, () => now); third.open();
    Array.from(third.contentEl.querySelectorAll("button")).find(b => b.textContent === "Delete")!.click(); await flush(); expect(remove).toHaveBeenCalledOnce();
    const fresh = new SessionModal(h.app, { heading: "Add time worked", taskTitle: "New", start: at(9), end: at(10), kind: "worked", save }); fresh.open(); expect(fresh.contentEl.querySelectorAll("button")).toHaveLength(1); fresh.close(); expect(fresh.contentEl.childElementCount).toBe(0);
    const failing = new SessionModal(h.app, { heading: "Add", taskTitle: "x", start: at(9), end: at(10), kind: "worked", save: async () => { throw Error("save failed"); } }, () => now); failing.open(); failing.contentEl.querySelector("button")!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain("save failed");
    const picker = new TaskPicker(h.app, [newTask("Alpha task", "alpha12345")], async () => undefined, "", false, false); expect(picker.getSuggestions("Alpha").length).toBe(1); expect(picker.getSuggestions("nothing like it")).toEqual([]); expect(new TaskPicker(h.app, [], async () => undefined).getSuggestions("brand new")).toEqual(["brand new"]);
  });
  it("tells the user when tracked time keeps the task note", () => {
    const h = harness(); const modal = new NoteConversionModal(h.app, { title: "Plan", folders: [], folder: "", templates: [], exists: () => false, convert: async () => undefined, tracked: "42 min" }); modal.open();
    expect(modal.contentEl.textContent).toContain("The 42 min of tracked time stays on the calendar"); const plain = new NoteConversionModal(h.app, { title: "Plan", folders: [], folder: "", templates: [], exists: () => false, convert: async () => undefined }); plain.open(); expect(plain.contentEl.textContent).not.toContain("tracked time");
  });
  it("asks for folder, tags and template, previews the result and handles a name clash", async () => {
    const h = harness(); const taken = new Set<string>(["Notes/Plan.md"]); const convert = vi.fn(async () => undefined);
    const modal = new NoteConversionModal(h.app, { title: "Plan", folders: ["Notes", "Ideas"], folder: "Ideas", templates: ["Templates/A.md"], exists: p => taken.has(p), convert }); modal.open(); decorated(modal);
    const [folder, tags] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input[type=text]')); const [template, clash] = Array.from(modal.contentEl.querySelectorAll<HTMLSelectElement>('select')); const note = () => modal.contentEl.querySelector('.organized-session-note')!.textContent; const labels = () => Array.from(modal.contentEl.querySelectorAll<HTMLElement>('.organized-modal-label'));
    expect(modal.contentEl.querySelector('datalist')!.children).toHaveLength(2); expect(folder.value).toBe("Ideas"); expect(note()).toBe("Creates “Ideas/Plan.md”."); expect(labels().at(-1)!.style.display).toBe("none"); expect(clash.style.display).toBe("none"); expect(template.options).toHaveLength(2);
    folder.value = "Notes"; folder.dispatchEvent(new Event("input")); expect(note()).toBe("Creates “Notes/Plan 2.md”."); expect(clash.style.display).not.toBe("none"); expect(labels().at(-1)!.style.display).not.toBe("none");
    clash.value = "existing"; clash.dispatchEvent(new Event("change")); expect(note()).toContain("Links to the existing “Notes/Plan.md”"); clash.value = "new"; clash.dispatchEvent(new Event("change"));
    folder.value = "../up"; folder.dispatchEvent(new Event("input")); expect(note()).toContain("relative vault folder"); const create = () => Array.from(modal.contentEl.querySelectorAll("button")).find(b => b.textContent === "Create note")!; create().click(); await flush(); expect(convert).not.toHaveBeenCalled();
    folder.value = "Notes"; folder.dispatchEvent(new Event("input")); tags.value = "idea, #project/a idea"; template.value = "Templates/A.md"; clash.value = "existing"; create().click(); await flush(); expect(convert).toHaveBeenCalledWith({ folder: "Notes", tags: ["idea", "project/a"], template: "Templates/A.md", clash: "existing" });
    const second = new NoteConversionModal(h.app, { title: "Plan", folders: [], folder: "", templates: [], exists: () => false, convert }); second.open(); const clashOn = second.contentEl.querySelectorAll<HTMLSelectElement>('select')[1]; clashOn.value = "existing"; expect(second.contentEl.querySelector('.organized-session-note')!.textContent).toBe("Creates “Plan.md”.");
    Array.from(second.contentEl.querySelectorAll("button")).find(b => b.textContent === "Create note")!.click(); await flush(); expect(convert).toHaveBeenLastCalledWith({ folder: "", tags: [], template: null, clash: "new" });
    const third = new NoteConversionModal(h.app, { title: "Plan", folders: [], folder: "", templates: [], exists: () => false, convert: async () => { throw Error("convert failed"); } }); third.open(); Array.from(third.contentEl.querySelectorAll("button")).find(b => b.textContent === "Create note")!.click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain("convert failed");
    const fourth = new NoteConversionModal(h.app, { title: "Plan", folders: [], folder: "", templates: [], exists: () => false, convert }); fourth.open(); Array.from(fourth.contentEl.querySelectorAll("button")).find(b => b.textContent === "Cancel")!.click(); expect(fourth.contentEl.childElementCount).toBe(0);
  });
});

describe("onboarding card", () => {
  const buttons = (modal: OnboardingModal) => [...modal.contentEl.querySelectorAll<HTMLElement>("button")].map(b => b.textContent);
  it("steps forward and back, shows progress and a figure, and finishes with Get started", () => {
    const h = harness(); const done = vi.fn(); const modal = new OnboardingModal(h.app, done); decorated(modal); modal.open();
    expect(modal.titleEl.textContent).toBe("Welcome to Organized");
    const total = modal.steps.length;
    expect(modal.contentEl.querySelector(".organized-welcome-progress")?.getAttribute("aria-label")).toBe(`Step 1 of ${total}`);
    expect(modal.contentEl.querySelectorAll(".organized-welcome-dot")).toHaveLength(total); expect(modal.contentEl.querySelectorAll("[aria-current=step]")).toHaveLength(1);
    expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe(modal.steps[0].title);
    expect(modal.contentEl.querySelector(".organized-welcome-figure")).not.toBeNull();
    expect(buttons(modal)).toEqual(["Skip", "Next"]);
    Setting.instances.at(-1)!.controls.at(-1)!.buttonEl.click();
    expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe(modal.steps[1].title); expect(buttons(modal)).toEqual(["Skip", "Back", "Next"]);
    Setting.instances.at(-1)!.controls[1].buttonEl.click();
    expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe(modal.steps[0].title);
    for (let i = 1; i < total; i++) modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(buttons(modal)).toEqual(["Back", "Get started"]); expect(modal.contentEl.querySelector(".organized-welcome-figure")).toBeNull();
    modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe(modal.steps[total - 1].title);
    expect(done).not.toHaveBeenCalled();
    Setting.instances.at(-1)!.controls.at(-1)!.buttonEl.click(); expect(done).toHaveBeenCalledTimes(1);
  });
  it("cannot step before the first page, shows code spans, and reports done exactly once however it closes", () => {
    const h = harness(); const done = vi.fn(); const modal = new OnboardingModal(h.app, done, [{ title: "One", text: "Use `[/]` now." }, { title: "Two", text: "Plain." }]); modal.open();
    modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe("One");
    expect(modal.contentEl.querySelector("code")?.textContent).toBe("[/]"); expect(modal.contentEl.querySelector(".organized-welcome-figure")).toBeNull();
    modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); modal.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(modal.contentEl.querySelector(".organized-welcome-title")?.textContent).toBe("One");
    modal.close(); modal.close(); modal.onClose(); expect(done).toHaveBeenCalledTimes(1);
  });
  it("Skip closes the card", () => {
    const h = harness(); const done = vi.fn(); const modal = new OnboardingModal(h.app, done); modal.open();
    Setting.instances.at(-1)!.controls[0].buttonEl.click(); expect(done).toHaveBeenCalledTimes(1); expect(modal.contentEl.children).toHaveLength(0);
  });
});

describe("Retire window", () => {
  const scan = (tasks = 2) => ({ tasks: Array.from({ length: tasks }, (_v, i) => newTask(`Task ${i}`, `task000${i}`)), files: new Map(Array.from({ length: tasks }, (_v, i) => [`task000${i}`, [{ path: `Daily/${i}.md` } as never]])), lines: new Map(Array.from({ length: tasks }, (_v, i) => [`task000${i}`, 1])), unnamed: new Set(Array.from({ length: tasks }, (_v, i) => `task000${i}`)) });
  const base = { which: "all" as const, olderThanDays: 7, lines: "plain" as const, keep: "title" as const, notes: "keep" as const, yaml: "keep" as const };
  const select = (modal: RetireModal, label: string) => modal.contentEl.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const choose = (field: HTMLSelectElement, value: string) => { field.value = value; field.dispatchEvent(new Event("change")); };
  const status = (modal: RetireModal) => modal.contentEl.querySelector('[role="status"]')!.textContent;
  const go = (modal: RetireModal) => [...modal.contentEl.querySelectorAll("button")].find(b => b.textContent === "Retire")!;
  it("waits for the scan, previews the result and switches combinations that cannot work", async () => {
    const h = harness(); const run = vi.fn(async () => undefined); let resolve!: (value: ReturnType<typeof scan>) => void;
    const modal = new RetireModal(h.app, base, () => new Promise(r => { resolve = r; }), run); decorated(modal); modal.open();
    expect(status(modal)).toBe("Reading your notes…"); expect(go(modal).disabled).toBe(true); go(modal).click(); expect(run).not.toHaveBeenCalled();
    resolve(scan()); await flush(); expect(status(modal)).toBe("2 tasks · 2 todos in 2 notes unlinked."); expect(go(modal).disabled).toBe(false);
    expect(select(modal, "Kept under the todo").style.display).toBe("none"); expect(modal.contentEl.querySelector<HTMLInputElement>('input[aria-label="Older than (days)"]')!.style.display).toBe("none"); expect([...modal.contentEl.querySelectorAll("label")].find(l => l.textContent === "Older than (days)")!.style.display).toBe("none");
    choose(select(modal, "Properties of task notes"), "strip"); expect(select(modal, "Task notes").value).toBe("rename"); expect(select(modal, "Kept under the todo").style.display).not.toBe("none"); expect(status(modal)).toContain("2 task notes stripped of properties. Status, dates and tracked time are lost");
    expect([...select(modal, "Task notes").options].map(o => o.disabled)).toEqual([true, false, true]);
    choose(select(modal, "Task notes"), "trash"); expect(select(modal, "Properties of task notes").value).toBe("keep"); expect(select(modal, "Todos in your notes become").value).toBe("plain");
    expect([...select(modal, "Properties of task notes").options].map(o => o.disabled)).toEqual([false, true]); expect([...select(modal, "Todos in your notes become").options].map(o => o.disabled)).toEqual([false, true]); expect(status(modal)).toContain("moved to Obsidian's trash");
    choose(select(modal, "Task notes"), "rename"); expect([...select(modal, "Todos in your notes become").options].map(o => o.disabled)).toEqual([false, false]);
    choose(select(modal, "Todos in your notes become"), "link"); choose(select(modal, "Kept under the todo"), "all"); choose(select(modal, "Which tasks"), "closed");
    const days = modal.contentEl.querySelector<HTMLInputElement>('input[aria-label="Older than (days)"]')!; expect(days.style.display).not.toBe("none"); days.value = "30"; days.dispatchEvent(new Event("input"));
    expect(status(modal)).toBe("No tasks match. Nothing will change."); expect(go(modal).disabled).toBe(true); choose(select(modal, "Which tasks"), "all"); expect(go(modal).disabled).toBe(false);
    go(modal).click(); await flush(); expect(run).toHaveBeenCalledWith({ which: "all", olderThanDays: 30, lines: "link", keep: "all", notes: "rename", yaml: "keep" }); expect(modal.contentEl.children).toHaveLength(0);
  });
  it("cancels, and reports a scan that failed or a run that failed", async () => {
    const h = harness(); const cancelled = new RetireModal(h.app, base, async () => scan(1), async () => undefined); cancelled.open(); await flush();
    [...cancelled.contentEl.querySelectorAll("button")].find(b => b.textContent === "Cancel")!.click(); expect(cancelled.contentEl.children).toHaveLength(0);
    const broken = new RetireModal(h.app, base, async () => { throw new Error("vault unreadable"); }, async () => undefined); broken.open(); await flush(); expect(status(broken)).toBe("Could not read your notes: vault unreadable"); expect(go(broken).disabled).toBe(true);
    const text = new RetireModal(h.app, base, async () => { throw "odd"; }, async () => undefined); text.open(); await flush(); expect(status(text)).toBe("Could not read your notes: odd");
    const failing = new RetireModal(h.app, base, async () => scan(1), async () => { throw new Error("write failed"); }); failing.open(); await flush(); go(failing).click(); await flush(); expect(Notice.instances.at(-1)?.message).toContain("write failed");
  });
  it('asks for a time budget in hours and minutes, validates it and can remove it', async () => {
    const h = harness(); const save = vi.fn().mockResolvedValue(undefined);
    const modal = new BudgetModal(h.app, 'Report', null, save); modal.open(); const [hours, mins] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); const note = modal.contentEl.querySelector('.organized-session-note')!;
    const buttons = () => Array.from(modal.contentEl.querySelectorAll('button')); const type = (a: string, b: string) => { hours.value = a; mins.value = b; hours.dispatchEvent(new Event('input')); };
    expect(modal.contentEl.querySelector('.organized-session-task')!.textContent).toBe('Report'); expect(hours.value).toBe('0'); expect(buttons().map(b => b.textContent)).toEqual(['Save']);
    buttons()[0].click(); await flush(); expect(save).not.toHaveBeenCalled(); expect(note.textContent).toContain('longer than zero');
    type('', '90'); expect(note.textContent).toContain('whole hours'); type('1.5', '0'); expect(note.textContent).toContain('whole hours'); type('10000', '0'); expect(note.textContent).toContain('9999 hours');
    type('', '30'); expect(note.textContent).toBe(''); expect(note.classList.contains('organized-session-problem')).toBe(false);
    type('2', '15'); buttons()[0].click(); await flush(); expect(save).toHaveBeenCalledWith(8100);
    const edit = new BudgetModal(h.app, 'Report', 8100, save); edit.open(); const fields = Array.from(edit.contentEl.querySelectorAll<HTMLInputElement>('input')); expect([fields[0].value, fields[1].value]).toEqual(['2', '15']);
    Array.from(edit.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Remove budget')!.click(); await flush(); expect(save).toHaveBeenLastCalledWith(null); edit.close(); expect(edit.contentEl.childElementCount).toBe(0);
  });
  it('asks for a project budget per period in hours, leaves blanks out and rejects bad values', async () => {
    const h = harness(); const save = vi.fn().mockResolvedValue(undefined);
    const modal = new ProjectBudgetModal(h.app, 'Website', { total: null, day: null, week: 36000, month: 5400 }, save); modal.open();
    const inputs = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); const note = modal.contentEl.querySelector('.organized-session-note')!; const saveButton = () => Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!;
    expect(modal.contentEl.querySelector('.organized-session-task')!.textContent).toBe('Website'); expect(inputs.map(i => i.value)).toEqual(['', '', '10', '1.5']);
    inputs[0].value = '0'; inputs[0].dispatchEvent(new Event('input')); expect(note.textContent).toContain('above 0'); expect(note.classList.contains('organized-session-problem')).toBe(true); saveButton().click(); await flush(); expect(save).not.toHaveBeenCalled();
    inputs[0].value = '10000'; inputs[0].dispatchEvent(new Event('input')); expect(note.textContent).toContain('9999');
    inputs[0].value = '120'; inputs[3].value = ''; inputs[3].dispatchEvent(new Event('input')); expect(note.textContent).toBe(''); saveButton().click(); await flush(); expect(save).toHaveBeenCalledWith({ total: 432000, day: null, week: 36000, month: null });
    modal.close(); expect(modal.contentEl.childElementCount).toBe(0);
  });
  it('takes the task budget at its limits and rejects what does not fit', async () => {
    const h = harness(); const save = vi.fn().mockResolvedValue(undefined); const modal = new BudgetModal(h.app, 'T', 3660, save); modal.open();
    const [hours, mins] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); const note = modal.contentEl.querySelector('.organized-session-note')!; const go = () => Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click();
    expect([hours.value, mins.value]).toEqual(['1', '1']);
    const type = (a: string, b: string) => { hours.value = a; mins.value = b; hours.dispatchEvent(new Event('input')); };
    for (const [a, b] of [['0', '0'], ['-1', '5'], ['1', '-5'], ['1', '60'], ['1.5', '0'], ['0', '1.5'], ['9999', '1'], ['10000', '0'], ['abc', '0'], ['1e9', '0']]) { type(a, b); expect(note.textContent, `${a}h ${b}m`).not.toBe(''); go(); }
    await flush(); expect(save).not.toHaveBeenCalled();
    for (const [a, b, seconds] of [['0', '1', 60], ['9999', '0', 9999 * 3600], ['', '59', 3540], ['24', '', 86400], ['00', '05', 300]] as const) {
      const fresh = new BudgetModal(h.app, 'T', null, save); fresh.open(); const [fh, fm] = Array.from(fresh.contentEl.querySelectorAll<HTMLInputElement>('input')); fh.value = a; fm.value = b; fh.dispatchEvent(new Event('input'));
      expect(fresh.contentEl.querySelector('.organized-session-note')!.textContent, `${a}h ${b}m`).toBe(''); Array.from(fresh.contentEl.querySelectorAll('button')).find(x => x.textContent === 'Save')!.click(); await flush(); expect(save).toHaveBeenLastCalledWith(seconds);
    }
  });
  it('shows a stored project budget the way it will be read back, including a few seconds and whole numbers', async () => {
    const h = harness(); const open = (current: any) => { const m = new ProjectBudgetModal(h.app, 'P', current, vi.fn().mockResolvedValue(undefined)); m.open(); return Array.from(m.contentEl.querySelectorAll<HTMLInputElement>('input')).map(i => i.value); };
    expect(open({ total: 4, day: 5400, week: 36000, month: null })).toEqual(['0.0011', '1.5', '10', '']); expect(open({ total: null, day: null, week: null, month: null })).toEqual(['', '', '', '']);
    expect(open({ total: 9999 * 3600, day: 1, week: 3601, month: 90 })).toEqual(['9999', '0.0003', '1.0003', '0.025']);
  });
  it('lets a project budget be cleared in every field, and rejects each bad field', async () => {
    const h = harness(); const save = vi.fn().mockResolvedValue(undefined); const modal = new ProjectBudgetModal(h.app, 'P', { total: 3600, day: 3600, week: 3600, month: 3600 }, save); modal.open();
    const inputs = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>('input')); const note = modal.contentEl.querySelector('.organized-session-note')!; const go = () => Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Save')!.click();
    for (const bad of ['0', '-1', '10000', '1e5']) for (const field of inputs) { const was = field.value; field.value = bad; field.dispatchEvent(new Event('input')); expect(note.textContent).not.toBe(''); go(); field.value = was; field.dispatchEvent(new Event('input')); expect(note.textContent).toBe(''); }
    await flush(); expect(save).not.toHaveBeenCalled();
    for (const field of inputs) field.value = '  '; go(); await flush(); expect(save).toHaveBeenCalledWith({ total: null, day: null, week: null, month: null });
  });
});
