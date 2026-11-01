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
    const valid = { taskFolder: "Work", dailyFolder: "", dailyFormat: "YYYY/MM/DD", autoForward: false, missingSection: "ask", sortScope: "section", displayProperties: ["status"], showScheduledDate: true, taskRetentionDays: 45 };
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
});
