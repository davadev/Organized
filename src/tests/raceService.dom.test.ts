// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";

installObsidianDom();
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe("reference index races", () => {
  it("drops an index read that finishes after the index was reset", async () => {
    const h = harness(); const task = await h.repo.create("Refs"); const line = `- [ ] Refs <!--organized:${task.id}-->`;
    const note: any = await h.add("Note.md", line); await h.service.refs(task.id);
    const slow = deferred<string>(); h.raw.vault.read.mockImplementationOnce(() => slow.promise);
    const pending = h.service.index(note); (h.service as any).references = null; slow.resolve(line);
    await expect(pending).resolves.toBeUndefined(); expect((h.service as any).references).toBeNull();
  });
  it("rebuilds when the index is reset while it is being built", async () => {
    const h = harness(); const task = await h.repo.create("Refs"); await h.add("Note.md", `- [ ] Refs <!--organized:${task.id}-->`);
    const slow = deferred<string>(); h.raw.vault.read.mockImplementationOnce(() => slow.promise);
    const pending = h.service.refs(task.id); await Promise.resolve(); (h.service as any).references = null; slow.resolve("");
    expect(await pending).toEqual(["Note.md"]);
  });
  it("keeps the newest read when an older read of the same note finishes last", async () => {
    const h = harness(); const task = await h.repo.create("Refs"); const note: any = await h.add("Note.md", "");
    await h.service.refs(task.id);
    const older = deferred<string>(); const newer = deferred<string>();
    h.raw.vault.read.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const first = h.service.index(note); const second = h.service.index(note);
    newer.resolve(""); await second; older.resolve(`- [ ] Refs <!--organized:${task.id}-->`); await first;
    expect(await h.service.refs(task.id)).toEqual([]);
  });
  it("drops an in-flight index of a note that was forgotten", async () => {
    const h = harness(); const task = await h.repo.create("Refs"); const note: any = await h.add("Note.md", "");
    await h.service.refs(task.id); const slow = deferred<string>(); h.raw.vault.read.mockImplementationOnce(() => slow.promise);
    const pending = h.service.index(note); h.service.forget("Note.md"); slow.resolve(`- [ ] Refs <!--organized:${task.id}-->`); await pending;
    expect(await h.service.refs(task.id)).toEqual([]);
  });
});
describe("convert todos race", () => {
  it("creates no task notes when the note changes while the confirmation is open", async () => {
    const h = harness(); const file: any = await h.add("Note.md", "- [ ] One");
    h.confirm.mockImplementationOnce(async () => { h.texts.set("Note.md", "- [ ] One\nedited"); return true; });
    await expect(h.service.convertTodos(file)).rejects.toThrow("changed");
    expect(await h.repo.list()).toEqual([]); expect(h.texts.get("Note.md")).toBe("- [ ] One\nedited");
  });
});
