// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { OrganizedInspectorView } from "../view";
import { harness } from "./harness";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { parseTasks } from "../codec";
import { Modal, Notice } from "./__mocks__/obsidian";
import type { TaskPicker } from "../modals";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); document.body.empty(); vi.restoreAllMocks(); });
async function fixture() {
  vi.useFakeTimers(); const h = harness(); const owner = new Organized(h.app, { id: "organized", version: "0.0.0" } as any); await owner.onload();
  const leaf: any = { app: h.app }; const view = new OrganizedInspectorView(leaf, owner); leaf.view = view; document.body.appendChild(view.contentEl); h.raw.workspace.getLeavesOfType.mockReturnValue([leaf]);
  const parent = await owner.repo.create("Parent"); const a = await owner.repo.create("Sub A"); const b = await owner.repo.create("Sub B"); const c = await owner.repo.create("Sub C");
  await owner.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Sub A]]", "[[Sub B]]", "[[Sub C]]"] })); await owner.repo.update(a.id, t => ({ ...t, status: "completed" })); await owner.repo.update(c.id, t => ({ ...t, status: "canceled" }));
  const show = async (id: string) => { owner.selectedTaskId = id; view.tab = "Task"; view.module = ""; await view.render(); await flush(); };
  return { ...h, owner, view, parent, a, b, c, show };
}
const click = (host: HTMLElement, selector: string) => host.querySelector<HTMLElement>(selector)!.click();

describe("subtasks in the Task tab", () => {
  it("shows the progress and every subtask with a toggle and a way in, and the way back from a subtask", async () => {
    const f = await fixture(); await f.show(f.parent.id); const host = f.view.contentEl;
    expect(Array.from(host.querySelectorAll(".organized-card-title")).map(el => el.textContent)).toContain("Subtasks"); expect(host.textContent).toContain("1 of 2 done");
    const bar = host.querySelector<HTMLElement>(".organized-progress")!; expect(bar.getAttribute("aria-valuenow")).toBe("1"); expect(bar.getAttribute("aria-valuemax")).toBe("2"); expect(bar.querySelector(".organized-progress-complete")).toBeNull();
    expect(Array.from(host.querySelectorAll(".organized-subtask")).map(row => `${row.getAttribute("data-status")}:${row.querySelector(".organized-subtask-title")!.textContent}`)).toEqual(["completed:Sub A", "open:Sub B", "canceled:Sub C"]);
    expect(host.querySelector(".organized-part-of")).toBeNull();
    click(host, '.organized-subtask-toggle[aria-label="Complete Sub B"]'); await flush(); expect((await f.owner.repo.read(f.b.id)).status).toBe("completed"); await f.view.render(); await flush();
    expect(f.view.contentEl.querySelector(".organized-progress-complete")).toBeTruthy(); click(f.view.contentEl, '.organized-subtask-toggle[aria-label="Reopen Sub A"]'); await flush(); expect((await f.owner.repo.read(f.a.id)).status).toBe("open");
    click(f.view.contentEl, '.organized-subtask-title[aria-label="Open subtask Sub B"]'); await flush(); expect(f.owner.selectedTaskId).toBe(f.b.id);
    const part = f.view.contentEl.querySelector<HTMLElement>(".organized-part-of button")!; expect(part.textContent).toBe("Part of Parent"); part.click(); await flush(); expect(f.owner.selectedTaskId).toBe(f.parent.id);
  });
  it("draws nothing for a Task render that a newer render replaced while it looked up the parent or the subtasks", async () => {
    const f = await fixture(); f.owner.selectedTaskId = f.parent.id; f.view.tab = "Task"; await f.view.render(); await flush();
    for (const lookup of ["parentOf", "subtasksOf"] as const) {
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const real = (f.owner.repo[lookup] as any).bind(f.owner.repo);
      vi.spyOn(f.owner.repo, lookup as any).mockImplementationOnce((async (...args: unknown[]) => { await gate; return real(...args); }) as any);
      const first = f.view.render(); await flush(); const second = f.view.render(); await flush(); release(); await Promise.all([first, second]); await flush();
      expect(f.view.contentEl.querySelectorAll(".organized-task-hero")).toHaveLength(1);
    }
  });
  it("links an existing task from the panel in both directions, and removes a task from its parent", async () => {
    const f = await fixture(); const loner = await f.owner.repo.create("Loner"); const finished = await f.owner.repo.create("Finished"); await f.owner.repo.update(finished.id, t => ({ ...t, status: "completed" }));
    const choose = async (title: string) => { const picker = Modal.instances.at(-1) as TaskPicker; expect((picker as any).placeholder).toBe(title); picker.onChooseSuggestion(picker.tasks.find(t => t.title === "Loner")!); picker.onChooseSuggestion("typed" as any); picker.close(); await flush(); return picker; };
    await f.show(f.parent.id); const tasks = () => (Modal.instances.at(-1) as TaskPicker).tasks.map(t => t.title).sort();
    const link = Array.from(f.view.contentEl.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "Link existing task…")!; link.click(); await flush();
    expect(tasks()).not.toContain("Finished"); expect(tasks()).not.toContain("Parent"); expect(tasks()).not.toContain("Sub B"); expect(tasks()).toContain("Loner"); await choose("Choose a task to make a subtask of this one");
    expect((await f.owner.repo.read(f.parent.id)).subtasks).toContain("[[Loner]]");
    await f.show(loner.id); expect(Array.from(f.view.contentEl.querySelectorAll("button")).some(b => b.textContent === "Make subtask of…")).toBe(false);
    const remove = Array.from(f.view.contentEl.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "Remove from parent")!; remove.click(); await flush(); expect((await f.owner.repo.read(f.parent.id)).subtasks).not.toContain("[[Loner]]");
    await f.show(loner.id); f.view.module = "Subtasks"; await f.view.render(); await flush();
    const make = Array.from(f.view.contentEl.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "Make subtask of…")!; make.click(); await flush(); expect(tasks()).not.toContain("Loner");
    const picker = Modal.instances.at(-1) as TaskPicker; picker.onChooseSuggestion(picker.tasks.find(t => t.title === "Parent")!); picker.close(); await flush(); expect((await f.owner.repo.read(f.parent.id)).subtasks).toContain("[[Loner]]");
    expect(Array.from(f.view.contentEl.querySelectorAll("button")).some(b => b.textContent === "Remove from parent")).toBe(true);
  });
  it("shows an empty Subtasks card on request, and adds a subtask under the todo in the open note", async () => {
    const f = await fixture(); const loner = await f.owner.repo.create("Loner"); await f.show(loner.id); expect(f.view.contentEl.textContent).not.toContain("Add subtask");
    f.view.module = "Subtasks"; await f.view.render(); await flush(); expect(f.view.contentEl.textContent).not.toContain("done"); const add = () => f.view.contentEl.querySelector<HTMLButtonElement>(".organized-selected-module button:last-of-type")!;
    expect(add().textContent).toBe("Add subtask");
    Notice.instances.length = 0; add().click(); await flush(); expect(String(Notice.instances.at(-1)!.message)).toContain("Open the note that holds this todo once");
    const text = `- [ ] Loner <!--organized:${loner.id}-->`; const note: any = await f.add("Daily.md", text); const editor = f.setActive(note, text); const addSubtask = vi.spyOn(f.owner, "addSubtask").mockResolvedValue();
    add().click(); await flush(); expect(addSubtask).toHaveBeenCalledWith(editor, note); expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
  });
  it("nests subtasks in the note list and keeps a finished parent while something under it is still to do", async () => {
    const f = await fixture(); const open = await f.owner.repo.create("Open kid"); await f.owner.repo.update(f.parent.id, t => ({ ...t, status: "completed" }));
    const note: any = await f.add("Daily/2026-03-04.md", `# Work\n- [x] Parent <!--organized:${f.parent.id}-->\n  - [ ] Open kid <!--organized:${open.id}-->\n    - [ ] Plain grandchild\n- [x] Plain done`);
    const editor = { getValue: () => "", getCursor: () => ({ line: 0, ch: 0 }) } as any; (f.owner as any).taskSourceEditor = () => ({ editor, file: note }); (f.owner as any).taskLines = async (file: any) => parseTasks(await f.repo.readText(file));
    f.owner.selectedTaskId = null; f.view.tab = "Task"; await f.view.render(); await flush();
    const depths = () => Object.fromEntries(Array.from(f.view.contentEl.querySelectorAll<HTMLElement>(".organized-indented")).map(row => [row.querySelector(".organized-list-title, .organized-list-label, .organized-muted")?.textContent ?? row.textContent, row.style.getPropertyValue("--organized-depth")]));
    expect(depths()).toEqual({ Parent: "1", "Open kid": "2", "Plain grandchild": "3", "Plain done": "1" });
    f.owner.settings.hideDoneTasks = true; await f.view.render(); await flush(); const titles = Array.from(f.view.contentEl.querySelectorAll(".organized-list-title")).map(el => el.textContent);
    expect(titles).toContain("Parent"); expect(titles).toContain("Open kid"); expect(titles).not.toContain("Plain done");
  });
});
