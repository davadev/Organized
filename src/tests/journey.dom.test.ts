// @vitest-environment happy-dom
// One user's whole life with the plugin in a throwaway in-memory vault: install, first run, every day-to-day feature, restart, upgrade of old notes, retire.
// It drives the real plugin (commands, vault events, services, modals) so a regression between features shows up here, not only in the unit tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import Organized from "../main";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { harness } from "./harness";
import { Modal, Notice, TFile } from "./__mocks__/obsidian";
import { ConfirmModal, OnboardingModal, RetireModal } from "../modals";
import { parseTasks, readNote, writeNoteSection } from "../codec";
import { splitNote } from "../repository";
import { localDate } from "../model";

installObsidianDom();
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });
const manifest = { id: "organized", name: "Organized", author: "davadev", version: "0.0.0", minAppVersion: "1.7.2", description: "", isDesktopOnly: false };

async function install(h: ReturnType<typeof harness>, data?: unknown) {
  const plugin = new Organized(h.app, manifest) as any; plugin.data = data; await plugin.onload(); h.layout.forEach(fn => fn()); await vi.advanceTimersByTimeAsync(2000); await flush();
  return plugin;
}
const command = (plugin: any, id: string) => plugin.commands.find((c: any) => c.id === id);
const ids = (text: string) => [...text.matchAll(/organized:([a-z0-9]+)/g)].map(m => m[1]);
const approve = async () => { await flush(); (Modal.instances.at(-1) as ConfirmModal).done(true); await flush(); };
const fire = (h: ReturnType<typeof harness>, name: string, ...args: unknown[]) => { for (const fn of h.events[name] ?? []) fn(...args); };

describe("a user's whole journey, from install to retiring", () => {
  it("installs, converts todos, works with tasks, restarts, upgrades old notes and retires without losing anything", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] }); vi.setSystemTime(new Date(2026, 2, 4, 9, 0));
    const today = localDate();
    const h = harness();
    // The vault before the plugin: a daily note full of ordinary todos, a note to link to, and a task note an older Organized wrote.
    const daily = await h.add(`Daily/${today}.md`, "# Plan\n- [ ] Write report\n- [ ] Call _ back\n- [ ] Review snake_case names\n\n# Later\n- [x] Already done\n") as TFile;
    await h.add("Ideas.md", "Some idea\n");
    const old = await h.repo.create("Legacy task");
    await h.repo.renameNote(h.repo.taskFile(old.id)!, h.repo.taskPath(old.id)); const oldPath = h.repo.taskPath(old.id); // written by an older Organized: named after its id, body in the old layout
    h.texts.set(oldPath, `${h.texts.get(oldPath)!.replace(/\s*$/, "\n")}\n## Description\nOld description\n\n## Notes\nSee [[Ideas]]\n`);
    const before = new Map(h.texts);

    // 1. First start: the onboarding card opens once, nothing in the user's notes is written, the old task note is migrated with a backup.
    Modal.instances.length = 0; let plugin = await install(h);
    const card = Modal.instances.filter(m => m instanceof OnboardingModal); expect(card).toHaveLength(1); expect(plugin.settings.onboardingSeen).toBe(false); card[0].close(); await flush(); expect(plugin.settings.onboardingSeen).toBe(true);
    expect(h.texts.get(daily.path)).toBe(before.get(daily.path)); expect(h.texts.get("Ideas.md")).toBe(before.get("Ideas.md"));
    const migratedPath = plugin.repo.taskFile(old.id)!.path; expect(migratedPath).toBe("Tasks/Legacy task.md"); expect(h.texts.has(oldPath)).toBe(false); // renamed after its title, one-time
    expect(readNote(splitNote(h.texts.get(migratedPath)!).body)).toMatchObject({ description: "Old description\n\nSee [[Ideas]]" }); expect(h.texts.get(migratedPath)).not.toMatch(/^## (Description|Notes)/m);
    expect([...h.texts.keys()].some(k => k.includes("note-backups/task-notes"))).toBe(true); expect(plugin.settings.taskNotesMigrated).toBe(true);

    // 2. Convert the todos of the open daily note with the command; the checkbox text and state survive, each todo gets a task note.
    const editor = {}; const view = { file: daily };
    command(plugin, "convert-todos").editorCallback(editor, view); await approve();
    const converted = h.texts.get(daily.path)!; expect(converted.replace(/ <!--organized:[a-z0-9]+-->/g, "")).toBe(before.get(daily.path));
    expect(ids(converted)).toHaveLength(3); expect(converted).toContain("- [x] Already done\n");
    const [report, underscore, snake] = parseTasks(converted).map(line => line.id!);
    expect((await plugin.repo.read(underscore)).title).toBe("Call _ back"); expect((await plugin.repo.read(snake)).title).toBe("Review snake_case names");
    expect(plugin.repo.taskFile(underscore)!.path).toBe("Tasks/Call _ back.md"); expect(plugin.repo.taskFile(snake)!.path).toBe("Tasks/Review snake_case names.md"); expect(plugin.repo.taskFile(report)!.path).toBe("Tasks/Write report.md"); expect(plugin.repo.taskFile(old.id)!.path).toBe("Tasks/Legacy task.md"); // new notes carry the title, and the migrated one too

    // 3. Everyday use: description in the note body, priority, schedule, status, tracked time, projects.
    await plugin.saveModule(report, "Description", "Cover Q1.\nLink: [[Ideas]]"); await plugin.saveModule(report, "Sources", "https://example.com");
    expect(readNote(splitNote(h.texts.get(plugin.repo.taskFile(report)!.path)!).body)).toEqual({ description: "Cover Q1.\nLink: [[Ideas]]", sources: "https://example.com" });
    await plugin.run(() => plugin.service.setPriority(report, "high")); await plugin.run(() => plugin.service.status(report, "in_progress")); await plugin.run(() => plugin.service.status(report, "open"));
    await plugin.run(() => plugin.service.addSession(report, { start: new Date(2026, 2, 4, 9, 0).toISOString(), end: new Date(2026, 2, 4, 10, 30).toISOString() }));
    await plugin.run(() => plugin.service.projects(report, ["Ideas.md"]));
    const tomorrow = localDate(new Date(2026, 2, 5)); await plugin.run(() => plugin.service.scheduleTask(snake, tomorrow));
    expect((await plugin.repo.read(snake)).scheduled).toBe(tomorrow);
    expect((await plugin.repo.read(report)).time_tracked_seconds).toBe(5400);

    // 4. Title edits keep the todo line in step, a completed task closes, and a restart changes nothing on disk.
    await plugin.run(() => plugin.service.title(report, "Write the Q1 report")); expect(h.texts.get(daily.path)).toContain("Write the Q1 report"); expect(plugin.repo.taskFile(report)!.path).toBe("Tasks/Write the Q1 report.md");
    await plugin.run(() => plugin.service.status(underscore, "completed")); expect((await plugin.repo.read(underscore)).closed_at).not.toBeNull();
    plugin.onunload?.(); const snapshot = new Map(h.texts);
    const events = h.events; for (const key of Object.keys(events)) delete events[key]; h.layout.length = 0;
    plugin = await install(h, plugin.data); const changedByRestart = [...h.texts].filter(([p, t]) => p !== "Daily" && snapshot.get(p) !== t && !p.includes("crash") && !p.includes("backups") && !p.endsWith(".json"));
    expect(changedByRestart).toEqual([]);

    // 5. A todo becomes a standalone note; renaming that note keeps the tracked-time record attached.
    await plugin.run(() => plugin.service.convertToNote(report, { folder: "Notes", tags: ["work"], template: null, clash: "new" }));
    const note = h.app.vault.getMarkdownFiles().find(f => f.path.startsWith("Notes/"))!; expect(note.path).toBe("Notes/Write the Q1 report.md"); expect(h.texts.get(daily.path)).toContain("[[Notes/Write the Q1 report");
    expect(h.texts.get(note.path)).toContain("Cover Q1."); expect(h.texts.get(note.path)).toContain("work");
    await h.app.fileManager.renameFile(note, "Notes/Q1 report.md");
    for (const [path, text] of h.texts) h.texts.set(path, text.split("[[Notes/Write the Q1 report").join("[[Notes/Q1 report")); // Obsidian rewrites links when a note is renamed
    fire(h, "rename", note, "Notes/Write the Q1 report.md"); await flush();
    expect((await plugin.repo.read(report)).converted_to).toBe("Notes/Q1 report.md");

    // 6. Retire: scan, then run the window's choices (links, readable names, properties removed) and check the vault reads as plain Markdown.
    command(plugin, "retire-tasks").callback(); await flush(); const modal = Modal.instances.at(-1);
    expect(modal).toBeInstanceOf(RetireModal);
    (modal as { close(): void }).close();
    const scan = await plugin.service.scanRetire(); expect(scan.tasks.length).toBeGreaterThanOrEqual(3);
    await plugin.run(() => plugin.service.retireTasks({ which: "all", olderThanDays: 7, lines: "link", keep: "all", notes: "rename", yaml: "strip" }, (files: any, extra: any) => plugin.safety.writeBackup("retire", files, extra)));
    const after = h.texts.get(daily.path)!; expect(after).not.toMatch(/organized:/); expect(after).toMatch(/- \[x\] \[\[Tasks\/Call _ back\]\]/); expect(after).toMatch(/- \[ \] \[\[Tasks\/Review snake_case names\]\]/); expect(after).toContain("- [x] Already done\n");
    // The record behind a standalone note keeps its tracked time and is not a task any more, so retiring leaves it alone.
    for (const path of h.texts.keys()) if (path.startsWith("Tasks/") && path.endsWith(".md") && path !== plugin.repo.taskFile(report)!.path) expect(h.texts.get(path)).not.toMatch(/organized:|schema_version|work_sessions/);
    expect(h.texts.get(plugin.repo.taskFile(report)!.path)).toContain("converted_to: Notes/Q1 report.md");
    expect(h.app.vault.getMarkdownFiles().some(f => f.path === "Tasks/Call _ back.md")).toBe(true);
    // Every link left in the daily note resolves to a file that exists.
    for (const target of [...after.matchAll(/\[\[([^\]|]+)/g)].map(m => m[1])) expect(h.app.vault.getAbstractFileByPath(`${target}.md`) ?? h.app.vault.getAbstractFileByPath(target), target).not.toBeNull();
    // And Undo puts the vault back as it was before retiring.
    const linked = h.texts.get(daily.path)!; await plugin.service.undo();
    expect(ids(h.texts.get(daily.path)!)).toHaveLength(2); expect(h.texts.get(daily.path)).not.toBe(linked); expect(h.app.vault.getAbstractFileByPath("Tasks/Call _ back.md")).not.toBeNull(); // already named after its title, so Retire has nothing to rename or undo
    expect((await plugin.repo.read(underscore)).title).toBe("Call _ back");

    // 7. Subtasks: an indented todo becomes a subtask, the parent lists it, completing the parent completes what is open, and forwarding takes unfinished ones along.
    const parent = await plugin.repo.create("Plan the trip"); const flights = await plugin.repo.create("Book flights"); const hotel = await plugin.repo.create("Book hotel");
    const trip = (m: string, n: string) => `# Trip\n- [ ] Plan the trip <!--organized:${parent.id}-->\n  - [${m}] Book flights <!--organized:${flights.id}-->\n  - [${n}] Book hotel <!--organized:${hotel.id}-->`;
    const tripNote: any = await h.add("Daily/2026-03-04 trip.md", trip(" ", " ")); await plugin.run(() => plugin.service.repairSubtasks(tripNote));
    expect((await plugin.repo.read(parent.id)).subtasks).toEqual(["[[Book flights]]", "[[Book hotel]]"]); expect(await plugin.repo.progress(await plugin.repo.read(parent.id))).toEqual({ done: 0, total: 2 });
    await plugin.run(() => plugin.service.status(flights.id, "completed")); expect(await plugin.repo.progress(await plugin.repo.read(parent.id))).toEqual({ done: 1, total: 2 });
    await h.add("Daily/2026-03-09.md", ""); await plugin.run(() => plugin.service.schedule({ file: tripNote, line: parseTasks(h.texts.get(tripNote.path)!).find(t => t.id === parent.id)! }, "2026-03-09", "forward"));
    const nextDay = parseTasks(h.texts.get("Daily/2026-03-09.md")!); expect(nextDay.map(t => [t.title, t.parent === null ? null : nextDay.find(p => p.line === t.parent)!.title])).toEqual([["Plan the trip", null], ["Book hotel", "Plan the trip"]]);
    await plugin.run(() => plugin.service.status(parent.id, "completed")); expect((await plugin.repo.read(hotel.id)).status).toBe("completed"); expect((await plugin.repo.read(flights.id)).status).toBe("completed");
  });
});
