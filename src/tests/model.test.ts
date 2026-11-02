import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, elapsed, localDate, newTask, nextDate, object, path, setStatus, settingsFrom, taskFrom, validDate, validId } from "../model";

describe("task model and persisted settings", () => {
  it("validates paths, dates, IDs and object shapes without guessing", () => {
    expect(object(null)).toEqual({}); expect(object([])).toEqual({}); expect(object({ a: 1 })).toEqual({ a: 1 });
    for (const p of ["../outside", "/absolute", "C:/note", "a/../b", "a?", "a\u0000b", "", "."]) expect(() => path(p)).toThrow();
    expect(path("a\\b//c")).toBe("a/b/c"); expect(path("", true)).toBe(""); expect(path(".", true)).toBe("");
    for (const date of [null, 1, "2025-02-29", "2024-13-01", "2024-02-2"]) expect(validDate(date)).toBe(false);
    expect(validDate("2024-02-29")).toBe(true); expect(nextDate("2024-02-29")).toBe("2024-03-01");
    expect(localDate(new Date("2024-01-02T12:00:00"))).toBe("2024-01-02"); expect(validId("task_1234")).toBe(true); expect(validId(12)).toBe(false); expect(validId("bad")).toBe(false);
    expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("normalizes hand-edited and legacy settings repeatedly", () => {
    expect(settingsFrom(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFrom({ taskFolder: "../bad", dailyFolder: "/bad", dailyFormat: "x", autoForward: "yes", missingSection: "bad", sortScope: "bad", displayProperties: ["notes", 5, "secret"] })).toEqual({ ...DEFAULT_SETTINGS, displayProperties: ["notes"] });
    const valid = { taskFolder: "Work", dailyFolder: "", dailyFormat: "YYYY/MM/DD", autoForward: false, missingSection: "ask", sortScope: "section", displayProperties: ["status"], showScheduledDate: true, taskRetentionDays: 45, dailyTemplate: "Templates/Daily.md", knownProjects: ["A.md", "B/C.md"], collapsedHeadings: { "Daily/Today.md": ["[{\"level\":2}]"] }, projectsMigrated: true, projectNotesMarked: true, projectStartsSet: true, retentionDetail: "all", dayTasksCollapsed: true, hideDoneTasks: true, hideClosedProjects: false };
    for (const projectsMigrated of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, projectsMigrated, dayTasksCollapsed: projectsMigrated }).projectsMigrated).toBe(false);
    for (const projectNotesMarked of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, projectNotesMarked }).projectNotesMarked).toBe(false);
    for (const projectStartsSet of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, projectStartsSet }).projectStartsSet).toBe(false);
    for (const retentionDetail of ["everything", 1, undefined]) expect(settingsFrom({ ...valid, retentionDetail }).retentionDetail).toBe("title");
    for (const hideClosedProjects of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, hideClosedProjects }).hideClosedProjects).toBe(true);
    for (const hideDoneTasks of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, hideDoneTasks }).hideDoneTasks).toBe(false);
    for (const dayTasksCollapsed of ["yes", 1, undefined]) expect(settingsFrom({ ...valid, dayTasksCollapsed }).dayTasksCollapsed).toBe(false);
    expect(settingsFrom({ ...valid, collapsedHeadings: { "Daily/Today.md": ["[{\"level\":2}]", "[{\"level\":2}]", 5], "Empty.md": [], "Bad.md": "x" } })).toEqual(valid); expect(settingsFrom({ collapsedHeadings: [1] }).collapsedHeadings).toEqual({});
    expect(settingsFrom({ ...valid, knownProjects: ["A.md", "A.md", "../x.md", "plain", 5, "B/C.md"] })).toEqual(valid);
    for (const dailyTemplate of ["../x.md", "Template", "  ", 5]) expect(settingsFrom({ dailyTemplate }).dailyTemplate).toBe("");
    expect(settingsFrom(valid)).toEqual(valid); expect(settingsFrom(settingsFrom(valid))).toEqual(valid);
    for (const taskRetentionDays of [-1, 1.5, "2", 36501]) expect(settingsFrom({ taskRetentionDays }).taskRetentionDays).toBe(0);
    for (const format of ["YYYY-MM", "YYYY-DD", "MM-DD", "YYYY/MM/DD?", "YYYY/../MM/DD"]) expect(settingsFrom({ dailyFormat: format }).dailyFormat).toBe(DEFAULT_SETTINGS.dailyFormat);
  });
  it("refuses newer or broken task records and preserves valid metadata", () => {
    for (const value of [null, {}, { id: "task1234" }, { id: "task1234", title: " " }, { id: "task1234", title: "Title", schema_version: 2 }, { id: "task1234", title: 'Hidden <!--organized:task5678-->' }]) expect(() => taskFrom(value, "task1234")).toThrow();
    const task = newTask(" A task ", "task1234", new Date("2026-01-01T00:00:00Z")); expect(task.title).toBe("A task"); expect(task.priority).toBe("none"); expect(task.status).toBe("open");
    const raw = { ...task, status: "invalid", priority: null, scheduled: "nonsense", created: "bad", time_tracked_seconds: -1, time_tracking_started_at: "bad", projects: [4, "Work.md", "../bad.md", "bad.txt"], recurrence_periods: [{ start: "2026-01-01", stop: null }, {}, { start: "2026-01-01", stop: "2026-02-01" }], movement_history: [{ id: "1", kind: "forward", source: "manual", from: "other.md", to: "2026-01-01", at: "2026-01-01T00:00:00Z" }, {}], daily_note_section_path: [{ level: 2, text: "Work", ordinal: 0 }, {}, { level: 7, text: "Bad", ordinal: 0 }] };
    const result = taskFrom(raw, task.id); expect(result.projects).toEqual(["Work.md"]); expect(result.recurrence_periods).toHaveLength(2); expect(result.movement_history).toHaveLength(1); expect(result.daily_note_section_path).toHaveLength(1); expect(result.created).toBe("1970-01-01T00:00:00.000Z"); expect(result.time_tracked_seconds).toBe(0); expect(result.time_tracking_started_at).toBeNull();
    expect(taskFrom({ ...task, scheduled: "2026-01-01", priority: "high", status: "completed", starred: true, recurring: true, time_tracked_seconds: 42, closed_at: "bad", projects: "invalid" }, task.id)).toMatchObject({ scheduled: "2026-01-01", priority: "high", status: "completed", starred: true, recurring: true, time_tracked_seconds: 42, closed_at: null, projects: [] });
  });
  it("keeps timers durable, independent, safe and idempotent", () => {
    const task = newTask("Timer", "timer123", new Date("2026-01-01T00:00:00Z"));
    const started = setStatus(task, "in_progress", new Date("2026-01-01T00:00:00Z"));
    expect(setStatus(started, "in_progress", new Date("2026-01-01T01:00:00Z"))).toEqual(started);
    expect(elapsed(started, Date.parse("2026-01-01T01:00:00Z"))).toBe(3600);
    expect(elapsed(started, 0)).toBe(0);
    const stopped = setStatus(started, "completed", new Date("2026-01-01T01:00:00Z")); expect(stopped.time_tracked_seconds).toBe(3600); expect(stopped.time_tracking_started_at).toBeNull(); expect(setStatus(stopped, "completed")).toEqual(stopped);
    expect(stopped.closed_at).toBe("2026-01-01T01:00:00.000Z");
    expect(setStatus(stopped, "open").closed_at).toBeNull();
    expect(setStatus({ ...stopped, closed_at: null }, "completed", new Date("2026-01-02T00:00:00Z")).closed_at).toBe("2026-01-02T00:00:00.000Z");
    expect(setStatus({ ...started, recurring: true }, "completed", new Date("2026-01-01T01:00:00Z")).status).toBe("open"); expect(elapsed(task)).toBe(0);
  });
  it("records timer runs of a minute or more as work sessions and validates stored sessions", () => {
    const task = newTask("Timer", "timer123", new Date("2026-01-01T00:00:00Z")); expect(task.work_sessions).toEqual([]);
    const started = setStatus(task, "in_progress", new Date("2026-01-01T09:00:00Z"));
    expect(setStatus(started, "in_progress", new Date("2026-01-01T09:30:00Z")).work_sessions).toEqual([]);
    const done = setStatus(started, "completed", new Date("2026-01-01T09:45:00Z")); expect(done.work_sessions).toEqual([{ start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T09:45:00.000Z" }]);
    const again = setStatus(setStatus(done, "in_progress", new Date("2026-01-01T11:00:00Z")), "open", new Date("2026-01-01T11:00:59Z")); expect(again.work_sessions).toHaveLength(1); expect(again.time_tracked_seconds).toBe(2700 + 59);
    const reopened = setStatus(setStatus(done, "in_progress", new Date("2026-01-01T11:00:00Z")), "open", new Date("2026-01-01T11:01:00Z")); expect(reopened.work_sessions.map(w => w.end)).toEqual(["2026-01-01T09:45:00.000Z", "2026-01-01T11:01:00.000Z"]);
    const recurring = { ...task, recurring: true }; expect(setStatus(setStatus(recurring, "in_progress", new Date("2026-01-01T09:00:00Z")), "completed", new Date("2026-01-01T10:00:00Z")).work_sessions).toHaveLength(1);
    const messy = taskFrom({ id: "timer123", title: "T", work_sessions: [{ start: "2026-01-02T10:00:00Z", end: "2026-01-02T11:00:00Z" }, { start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" }, { start: "bad", end: "2026-01-01T11:00:00Z" }, { start: "2026-01-03T11:00:00Z", end: "2026-01-03T10:00:00Z" }, { start: 5, end: 6 }, "x", null] }, "timer123");
    expect(messy.work_sessions.map(w => w.start)).toEqual(["2026-01-01T10:00:00Z", "2026-01-02T10:00:00Z"]); expect(taskFrom({ id: "timer123", title: "T", work_sessions: "nope" }, "timer123").work_sessions).toEqual([]);
    const many = Array.from({ length: 520 }, (_, i) => ({ start: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), end: new Date(Date.UTC(2026, 0, 1, 0, i, 30)).toISOString() }));
    const capped = taskFrom({ id: "timer123", title: "T", work_sessions: many }, "timer123").work_sessions; expect(capped).toHaveLength(500); expect(capped[0]).toEqual(many[20]);
    const full = setStatus({ ...task, work_sessions: many.slice(0, 500), time_tracking_started_at: "2026-02-01T00:00:00.000Z" }, "open", new Date("2026-02-01T00:05:00Z")); expect(full.work_sessions).toHaveLength(500); expect(full.work_sessions.at(-1)?.end).toBe("2026-02-01T00:05:00.000Z");
  });
});
