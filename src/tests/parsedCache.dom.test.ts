// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { stringifyYaml } from "./__mocks__/obsidian";
import { newTask } from "../model";

installObsidianDom();
const text = (id: string, priority: "none" | "high") => `---\n${stringifyYaml({ ...newTask("Cached", id), priority })}---\n\n`;

async function fixture(count = 3) {
  const h = harness(); const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await h.repo.create(`Task ${i}`)).id);
  const reads = () => h.raw.vault.read.mock.calls.length;
  return { ...h, ids, reads, file: (id: string) => h.repo.taskFile(id)! };
}

describe("parsed task notes are read once until they change", () => {
  it("lists and reads without touching the disk again", async () => {
    const h = await fixture(); await h.repo.list(); const first = h.reads(); expect(first).toBe(3);
    await h.repo.list(); await h.repo.read(h.ids[0]); await h.repo.list(true);
    expect(h.reads()).toBe(first);
  });
  it("sees this plugin's own writes without a modify event", async () => {
    const h = await fixture(1); await h.repo.read(h.ids[0]);
    await h.repo.update(h.ids[0], task => ({ ...task, priority: "high" }));
    expect((await h.repo.read(h.ids[0])).priority).toBe("high");
    const file = h.file(h.ids[0]); const before = h.texts.get(file.path)!;
    await h.repo.write(file, before, before.replace("priority: high", "priority: low"));
    expect((await h.repo.read(h.ids[0])).priority).toBe("low");
  });
  it("sees a change made elsewhere once the file's stamp or a modify event says so", async () => {
    const h = await fixture(1); const file = h.file(h.ids[0]); await h.repo.read(h.ids[0]);
    h.texts.set(file.path, text(h.ids[0], "high")); file.stat = { ...file.stat, mtime: file.stat.mtime + 5 };
    expect((await h.repo.read(h.ids[0])).priority).toBe("high");
    h.texts.set(file.path, text(h.ids[0], "none")); await h.repo.track(file);
    expect((await h.repo.read(h.ids[0])).priority).toBe("none");
  });
  it("never caches the unsaved text of a note that is open in the editor", async () => {
    const h = await fixture(1); const file = h.file(h.ids[0]);
    h.setActive(file, text(h.ids[0], "high")); expect((await h.repo.read(h.ids[0])).priority).toBe("high");
    h.setActive(await h.add("Other.md", "x"), "x"); expect((await h.repo.read(h.ids[0])).priority).toBe("none");
  });
  it("forgets a note that moved or was deleted", async () => {
    const h = await fixture(1); const file = h.file(h.ids[0]); await h.repo.read(h.ids[0]);
    await h.repo.renameNote(file, "Tasks/Renamed.md"); h.texts.set("Tasks/Renamed.md", text(h.ids[0], "high")); file.stat = { ...file.stat, size: file.stat.size + 1 };
    expect((await h.repo.read(h.ids[0])).priority).toBe("high");
    await h.repo.trashNote(file); await expect(h.repo.read(h.ids[0])).rejects.toThrow("Missing task");
  });
});
