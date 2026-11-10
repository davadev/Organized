import { describe, expect, it } from "vitest";
import { newTask } from "../model";
import { parseWorked, retiredLines } from "../retention";

const at = (y: number, m: number, d: number, h: number, min: number, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString();
const task = (extra: Record<string, unknown> = {}) => ({ ...newTask("Plan release", "abcdefgh12"), ...extra });
const body = "Ship it.\n\nSecond line\n\n## Sources\nhttps://example.com\n";
const legacy = "## Description\nShip it.\n\nSecond line\n\n## Sources\nhttps://example.com\n\n## Notes\nremember\n\nloose text\n";

describe("retention details", () => {
  it("keeps nothing for title only and the description alone for description", () => {
    expect(retiredLines(task(), body, "title", "  ")).toEqual([]);
    expect(retiredLines(task(), body, "description", "  ")).toEqual(["  > Ship it.", "  >", "  > Second line"]);
    expect(retiredLines(task(), "## Sources\nOnly a source", "description", "")).toEqual([]);
    expect(retiredLines(task(), legacy, "description", "")).toEqual(["> Ship it.", ">", "> Second line", ">", "> remember", ">", "> loose text"]);
    expect(retiredLines(task(), "## Description\r\nHas <!--organized:abcdefgh12--> id\r\n", "description", "")).toEqual(["> Has  id"]);
  });
  it("keeps every section, the days worked and the tracked total for everything", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0, 40), end: at(2026, 3, 2, 9, 30, 10) }, { start: at(2026, 3, 2, 10, 0), end: at(2026, 3, 2, 10, 20) }, { start: at(2026, 3, 2, 23, 30), end: at(2026, 3, 3, 0, 20) }, { start: at(2026, 3, 1, 8, 0), end: at(2026, 3, 1, 9, 30) }];
    const lines = retiredLines(task({ work_sessions: sessions, time_tracked_seconds: 4500 + 20 }), body, "all", "");
    expect(lines).toEqual(["> Ship it.", ">", "> Second line", "> **Sources**", "> https://example.com",
      "- Worked 2026-03-01: 08:00–09:30 (1h 30min)", "- Worked 2026-03-02: 09:00–09:30, 10:00–10:20, 23:30–2026-03-03 00:20 (1h 40min)", "- Tracked 1h 15min"]);
    expect(retiredLines(task({ time_tracked_seconds: 59 }), "", "all", "")).toEqual([]); expect(retiredLines(task({ time_tracked_seconds: 600 }), "", "all", ">")).toEqual([">- Tracked 10 min"]);
  });
  it("still reads worked lines written with the older spelling (1 h 20 min)", () => {
    const found = parseWorked(["- [x] Plan release", "  - Worked 2026-03-02: 09:00–10:20 (1 h 20 min)", "  - Worked 2026-03-03: 09:00–10:00 (1 h)", "  - Worked 2026-03-04: 09:00–09:30 (30 min)"].join("\n"));
    expect(found).toHaveLength(1); expect(found[0].work_sessions).toHaveLength(3);
  });
  it("reads the worked lines back as stand-in tasks, ignoring anything malformed", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0), end: at(2026, 3, 2, 9, 30) }, { start: at(2026, 3, 2, 23, 30), end: at(2026, 3, 3, 0, 20) }];
    const text = ["- [x] Plan release", ...retiredLines(task({ work_sessions: sessions }), "", "all", "  "), "- [ ] Untouched", "  - Worked 2026-03-02: 08:00–09:00", "- [x] Ghost <!--organized:abcdefgh12-->", "  - Worked 2026-03-05: 25:99–bad, 10:00–09:00, 11:00–2026-13-40 12:00, 12:00–13:00 (1h)", "- Worked 2026-03-06: 09:00–10:00", "  - Worked 2026-03-07: 09:00–10:00", "- [-]  <!--organized:abcdefgh12-->", "  - Worked 2026-03-08: 07:00–07:30 (30 min)"].join("\r\n");
    const found = parseWorked(text); expect(found.map(t => [t.title, t.status, t.work_sessions.length])).toEqual([["Plan release", "completed", 2], ["Untouched", "completed", 1], ["Ghost", "completed", 2], ["Untitled todo", "completed", 1]]);
    expect(found[0].work_sessions).toEqual(sessions); expect(found[2].work_sessions[0]).toEqual({ start: at(2026, 3, 5, 12, 0), end: at(2026, 3, 5, 13, 0) });
    expect(new Set(found.map(t => t.id)).size).toBe(4); expect(parseWorked("- [x] Nothing\nplain")).toEqual([]); expect(parseWorked("  - Worked 2026-03-02: 08:00–09:00")).toEqual([]);
  });
  it("keeps the projects of worked time as links, so retired time still counts toward their budgets", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0), end: at(2026, 3, 2, 9, 30) }];
    expect(retiredLines(task({ work_sessions: sessions, projects: ["Tasks/Projects/Alpha.md"] }), "", "all", "  ")).toEqual(["  - Worked 2026-03-02: 09:00–09:30 (30 min)", "  - Project: [[Tasks/Projects/Alpha]]"]);
    expect(retiredLines(task({ work_sessions: sessions, projects: ["A.md", "Tasks/B.md"] }), "", "all", "")).toEqual(["- Worked 2026-03-02: 09:00–09:30 (30 min)", "- Projects: [[A]], [[Tasks/B]]"]);
    // No time worked, no projects, or less than everything: nothing about projects is written.
    expect(retiredLines(task({ projects: ["A.md"] }), "", "all", "")).toEqual([]); expect(retiredLines(task({ work_sessions: sessions }), "", "all", "")).toEqual(["- Worked 2026-03-02: 09:00–09:30 (30 min)"]);
    expect(retiredLines(task({ work_sessions: sessions, projects: ["A.md"] }), body, "description", "")).toEqual(["> Ship it.", ">", "> Second line"]);
  });
  it("reads the projects back onto the stand-in task, in any order, with aliases and old spellings, and ignores them elsewhere", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0), end: at(2026, 3, 2, 9, 30) }];
    const written = ["- [x] Plan release", ...retiredLines(task({ work_sessions: sessions, projects: ["Tasks/Projects/Alpha.md", "Beta.md"] }), "", "all", "  ")];
    expect(parseWorked(written.join("\n"))[0].projects).toEqual(["Tasks/Projects/Alpha.md", "Beta.md"]);
    expect(parseWorked(["- [x] Late", "  - Project: [[Gamma|the G]], [[Gamma.md]], [[Delta#Heading]]", "  - Worked 2026-03-02: 09:00–09:30 (30 min)"].join("\n"))[0].projects).toEqual(["Gamma.md", "Delta.md"]);
    expect(parseWorked(["- [x] Crlf", "  - Worked 2026-03-02: 09:00–09:30 (30 min)\r", "  - Project: [[Eps]]\r"].join("\n"))[0].projects).toEqual(["Eps.md"]);
    expect(parseWorked(["- [x] Old", "  - Worked 2026-03-02: 09:00–09:30 (30 min)"].join("\n"))[0].projects).toEqual([]);
    // A project line that is not indented under a todo with time, or has no links, belongs to nothing.
    expect(parseWorked(["- Project: [[Stray]]", "- [x] Own", "- Project: [[Stray]]", "  - Project: no links here", "  - Worked 2026-03-02: 09:00–09:30 (30 min)"].join("\n"))[0].projects).toEqual([]);
  });
  it("reads the tracked total in hours, minutes or both, and ignores one that is empty, outside a todo or not under it", () => {
    const sessions = "  - Worked 2026-03-02: 09:00–09:10 (10 min)";
    const read = (...lines: string[]) => parseWorked(["- Tracked 9h", "- [x] A", ...lines].join("\n"))[0]?.time_tracked_seconds;
    expect(read(sessions, "  - Tracked 2h")).toBe(7200); expect(read(sessions, "  - Tracked 45 min")).toBe(2700); expect(read(sessions, "  - Tracked 1h 5min")).toBe(3900);
    expect(read(sessions, "  - Tracked ")).toBe(600); expect(read(sessions, "- Tracked 5h")).toBe(600); expect(read(sessions, "  - Tracked 1 min")).toBe(600); // the sessions' own total is the floor
  });
});
