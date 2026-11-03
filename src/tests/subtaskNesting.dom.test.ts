// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { harness } from "./harness";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian";
import { nestUnder, parseTasks } from "../codec";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
const A = "aaaaaaaa"; const B = "bbbbbbbb"; const C = "cccccccc";
const line = (indent: number, title: string, id?: string) => `${" ".repeat(indent)}- [ ] ${title}${id ? ` <!--organized:${id}-->` : ""}`;

describe("moving a todo under another", () => {
  it("indents the todo with everything under it, below what is already nested under the parent, whichever comes first", () => {
    const text = [line(0, "Parent", A), line(2, "Old kid"), "    - note", line(0, "Loose", B), "  - detail", line(0, "Other")].join("\n");
    expect(nestUnder(text, B, A)).toBe([line(0, "Parent", A), line(2, "Old kid"), "    - note", line(2, "Loose", B), "    - detail", line(0, "Other")].join("\n"));
    const before = [line(0, "Loose", B), line(0, "Parent", A), line(2, "Old kid")].join("\n");
    expect(nestUnder(before, B, A)).toBe([line(0, "Parent", A), line(2, "Old kid"), line(2, "Loose", B)].join("\n"));
  });
  it("re-indents from any depth, keeps the line endings, and moves nothing when it should not", () => {
    const deep = [line(0, "Parent", A), line(0, "Other", C), line(4, "Deep", B), line(6, "Deeper")].join("\n"); expect(nestUnder(deep, B, A, true)).toBe([line(0, "Parent", A), line(2, "Deep", B), line(4, "Deeper"), line(0, "Other", C)].join("\n"));
    expect(nestUnder(deep, B, A)).toBeNull();
    expect(nestUnder(`${line(0, "Parent", A)}\r\n${line(0, "Loose", B)}\r\n`, B, A)).toBe(`${line(0, "Parent", A)}\n${line(2, "Loose", B)}\n`.replace(/\n/g, "\r\n"));
    const nested = [line(0, "Parent", A), line(2, "Kid", B)].join("\n"); expect(nestUnder(nested, B, A, true)).toBeNull();
    const cycle = [line(0, "Kid", B), line(2, "Parent", A)].join("\n"); expect(nestUnder(cycle, B, A)).toBeNull(); expect(nestUnder(cycle, B, A, true)).toBeNull();
    expect(nestUnder(line(0, "Only", A), B, A)).toBeNull(); expect(nestUnder([line(0, "P", A), line(0, "K", B), line(0, "K", B)].join("\n"), B, A)).toBeNull();
    expect(nestUnder([line(0, "P", A), line(0, "Q", C), line(2, "K", B)].join("\n"), B, A)).toBeNull();
    expect(nestUnder([line(0, "P", A), line(0, "Q", C), line(2, "K", B)].join("\n"), B, A, true)).toBe([line(0, "P", A), line(2, "K", B), line(0, "Q", C)].join("\n"));
  });
});

async function fixture() {
  const h = harness(); const parent = await h.repo.create("Parent"); const kid = await h.repo.create("Kid"); const other = await h.repo.create("Other");
  const text = `# Today\n- [ ] Parent <!--organized:${parent.id}-->\n- [ ] Kid <!--organized:${kid.id}-->\n  - a note\n- [ ] Other <!--organized:${other.id}-->`;
  const day: any = await h.add("Daily/2026-03-01.md", text); const nested = (path: string, id: string) => { const tasks = parseTasks(h.texts.get(path)!); const t = tasks.find(x => x.id === id)!; return t.parent === null ? null : tasks.find(x => x.line === t.parent)!.title; };
  return { ...h, parent, kid, other, day, nested, text };
}

describe("linking a subtask from the panel indents its todo", () => {
  it("moves the todo under its parent in every note that has both, with Undo, and re-nests an already linked one", async () => {
    const f = await fixture(); const second: any = await f.add("Daily/2026-03-02.md", f.text.replace("# Today", "# Next")); const lonely: any = await f.add("Daily/2026-03-03.md", `- [ ] Kid <!--organized:${f.kid.id}-->`);
    Notice.instances.length = 0; await f.service.makeSubtask(f.parent.id, f.kid.id);
    expect(f.nested(f.day.path, f.kid.id)).toBe("Parent"); expect(f.nested(second.path, f.kid.id)).toBe("Parent"); expect(f.texts.get(lonely.path)).toBe(`- [ ] Kid <!--organized:${f.kid.id}-->`);
    expect(f.texts.get(f.day.path)).toContain(`  - [ ] Kid <!--organized:${f.kid.id}-->\n    - a note`); expect(f.service.undoChanges.length).toBe(2);
    await f.service.undo(); expect(f.texts.get(f.day.path)).toBe(f.text);
    f.texts.set(f.day.path, f.text); await f.service.makeSubtask(f.parent.id, f.kid.id); expect(f.nested(f.day.path, f.kid.id)).toBe("Parent");
    Notice.instances.length = 0; await f.service.makeSubtask(f.parent.id, f.kid.id); expect(said(Notice.instances.at(-1)!)).toContain("already a subtask");
    await f.service.makeSubtask(f.other.id, f.kid.id); expect(f.nested(f.day.path, f.kid.id)).toBe("Other");
  });
});

async function loaded() {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] }); const h = harness(); const plugin = new Organized(h.app, { id: "organized", name: "Organized", author: "davadev", version: "0.0.0", minAppVersion: "1.7.2", description: "", isDesktopOnly: false }) as any; await plugin.onload();
  return { h, plugin };
}
const said = (n: { message: unknown }) => String((n.message as { textContent?: string }).textContent ?? n.message);
const backups = (h: ReturnType<typeof harness>) => [...h.texts.keys()].filter(p => p.includes("note-backups/subtask-indent"));

describe("fixing missing indentation once after updating", () => {
  it("indents already linked subtasks that sit at the top of their list, saves the old text first, announces it with Undo and never again", async () => {
    const { h, plugin } = await loaded(); const parent = await h.repo.create("Parent"); const kid = await h.repo.create("Kid"); const placed = await h.repo.create("Placed"); const unrelated = await h.repo.create("Unrelated");
    await h.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Kid]]", "[[Placed]]", "[[Gone]]"] }));
    const text = `- [ ] Parent <!--organized:${parent.id}-->\n- [ ] Kid <!--organized:${kid.id}-->\n  - [ ] Placed <!--organized:${placed.id}-->\n- [ ] Unrelated <!--organized:${unrelated.id}-->`; const day: any = await h.add("Daily/2026-03-01.md", text); await h.add("Plain.md", "- [ ] no ids");
    Notice.instances.length = 0; h.layout[0](); await flush(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(plugin.settings.subtaskNestingMigrated).toBe(true); const tasks = parseTasks(h.texts.get(day.path)!); const parentOf = (id: string) => { const t = tasks.find(x => x.id === id)!; return t.parent === null ? null : tasks.find(x => x.line === t.parent)!.title; };
    expect(parentOf(kid.id)).toBe("Parent"); expect(parentOf(placed.id)).toBe("Kid"); expect(parentOf(unrelated.id)).toBeNull();
    expect(backups(h)).toHaveLength(1); expect(JSON.parse(h.texts.get(backups(h)[0])!).files[0].before).toBe(text);
    const notice = Notice.instances.find(n => said(n).includes("Subtasks indented"))!; expect(notice).toBeTruthy();
    (notice.message as DocumentFragment).querySelector("button")!.click(); await flush(); await vi.advanceTimersByTimeAsync(0); await flush(); expect(h.texts.get(day.path)).toBe(text);
    Notice.instances.length = 0; await plugin.nestSubtasks(); expect(Notice.instances).toHaveLength(0); expect(h.texts.get(day.path)).toBe(text);
  });
  it("is quiet when nothing needs indenting, says so on demand, waits while writes are paused, and retries after a failed backup or write", async () => {
    const { h, plugin } = await loaded(); Notice.instances.length = 0; await plugin.nestSubtasks(); expect(plugin.settings.subtaskNestingMigrated).toBe(true); expect(Notice.instances).toHaveLength(0);
    await plugin.nestSubtasks(true); expect(said(Notice.instances.at(-1)!)).toContain("already indented");
    const parent = await h.repo.create("Parent"); const kid = await h.repo.create("Kid"); await h.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Kid]]"] }));
    const day: any = await h.add("Daily/2026-03-01.md", `- [ ] Parent <!--organized:${parent.id}-->\n- [ ] Kid <!--organized:${kid.id}-->`);
    plugin.settings.subtaskNestingMigrated = false; plugin.safety.writable = false; await plugin.nestSubtasks(); expect(h.texts.get(day.path)).not.toContain("  - [ ] Kid"); plugin.safety.writable = true;
    const failing = vi.spyOn(plugin.safety, "writeBackup").mockRejectedValueOnce(new Error("no space")); await plugin.nestSubtasks();
    expect(said(Notice.instances.at(-1)!)).toContain("nothing was changed"); expect(plugin.settings.subtaskNestingMigrated).toBe(false);
    failing.mockRejectedValueOnce("plain failure"); await plugin.nestSubtasks(); expect(said(Notice.instances.at(-1)!)).toContain("plain failure"); failing.mockRestore();
    h.raw.vault.process.mockImplementationOnce(async () => { throw new Error("busy"); });
    await plugin.nestSubtasks(); expect(plugin.settings.subtaskNestingMigrated).toBe(false); expect(said(Notice.instances.at(-1)!)).toContain("could not be updated and will be retried");
    await plugin.nestSubtasks(); expect(plugin.settings.subtaskNestingMigrated).toBe(true); expect(h.texts.get(day.path)).toContain(`  - [ ] Kid`);
  });
  it("leaves notes alone whose subtasks are already indented", async () => {
    const { h, plugin } = await loaded(); const parent = await h.repo.create("Parent"); const kid = await h.repo.create("Kid"); await h.repo.update(parent.id, t => ({ ...t, subtasks: ["[[Kid]]"] }));
    const text = `- [ ] Parent <!--organized:${parent.id}-->\n  - [ ] Kid <!--organized:${kid.id}-->`; const day: any = await h.add("Daily/2026-03-01.md", text); await h.add("Daily/2026-03-02.md", "- [ ] unlinked <!--organized:zzzzzzzz1-->");
    Notice.instances.length = 0; await plugin.nestSubtasks(true); expect(said(Notice.instances.at(-1)!)).toContain("already indented"); expect(h.texts.get(day.path)).toBe(text); expect(backups(h)).toHaveLength(0);
  });
  it("has a command that runs it again", async () => {
    const { plugin } = await loaded(); const nest = vi.spyOn(plugin, "nestSubtasks").mockResolvedValue(undefined as never); (plugin as any).commands.find((c: any) => c.id === "nest-subtasks").callback(); await flush(); expect(nest).toHaveBeenCalledWith(true);
  });
});
