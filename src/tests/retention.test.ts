import { describe, expect, it } from "vitest";
import { newTask } from "../model";
import { parseWorked, retiredLines } from "../retention";

const at = (y: number, m: number, d: number, h: number, min: number, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString();
const task = (extra: Record<string, unknown> = {}) => ({ ...newTask("Plan release", "abcdefgh12"), ...extra });
const body = "## Description\nShip it.\n\nSecond line\n\n## Sources\nhttps://example.com\n\n## Notes\nremember\n\nloose text\n";

describe("retention details", () => {
  it("keeps nothing for title only and the description alone for description", () => {
    expect(retiredLines(task(), body, "title", "  ")).toEqual([]);
    expect(retiredLines(task(), body, "description", "  ")).toEqual(["  > Ship it.", "  >", "  > Second line"]);
    expect(retiredLines(task(), "## Sources\nOnly a source", "description", "")).toEqual([]);
    expect(retiredLines(task(), "## Description\r\nHas <!--organized:abcdefgh12--> id\r\n", "description", "")).toEqual(["> Has  id"]);
  });
  it("keeps every section, the days worked and the tracked total for everything", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0, 40), end: at(2026, 3, 2, 9, 30, 10) }, { start: at(2026, 3, 2, 10, 0), end: at(2026, 3, 2, 10, 20) }, { start: at(2026, 3, 2, 23, 30), end: at(2026, 3, 3, 0, 20) }, { start: at(2026, 3, 1, 8, 0), end: at(2026, 3, 1, 9, 30) }];
    const lines = retiredLines(task({ work_sessions: sessions, time_tracked_seconds: 4500 + 20 }), body, "all", "");
    expect(lines).toEqual(["> Ship it.", ">", "> Second line", "> **Sources**", "> https://example.com", "> **Notes**", "> remember", ">", "> loose text",
      "- Worked 2026-03-01: 08:00–09:30 (1 h 30 min)", "- Worked 2026-03-02: 09:00–09:30, 10:00–10:20, 23:30–2026-03-03 00:20 (1 h 40 min)", "- Tracked 1 h 15 min"]);
    expect(retiredLines(task({ time_tracked_seconds: 59 }), "", "all", "")).toEqual([]); expect(retiredLines(task({ time_tracked_seconds: 600 }), "", "all", ">")).toEqual([">- Tracked 10 min"]);
  });
  it("reads the worked lines back as stand-in tasks, ignoring anything malformed", () => {
    const sessions = [{ start: at(2026, 3, 2, 9, 0), end: at(2026, 3, 2, 9, 30) }, { start: at(2026, 3, 2, 23, 30), end: at(2026, 3, 3, 0, 20) }];
    const text = ["- [x] Plan release", ...retiredLines(task({ work_sessions: sessions }), "", "all", "  "), "- [ ] Untouched", "  - Worked 2026-03-02: 08:00–09:00", "- [x] Ghost <!--organized:abcdefgh12-->", "  - Worked 2026-03-05: 25:99–bad, 10:00–09:00, 11:00–2026-13-40 12:00, 12:00–13:00 (1 h)", "- Worked 2026-03-06: 09:00–10:00", "  - Worked 2026-03-07: 09:00–10:00", "- [-]  <!--organized:abcdefgh12-->", "  - Worked 2026-03-08: 07:00–07:30 (30 min)"].join("\r\n");
    const found = parseWorked(text); expect(found.map(t => [t.title, t.status, t.work_sessions.length])).toEqual([["Plan release", "completed", 2], ["Untouched", "completed", 1], ["Ghost", "completed", 2], ["Untitled todo", "completed", 1]]);
    expect(found[0].work_sessions).toEqual(sessions); expect(found[2].work_sessions[0]).toEqual({ start: at(2026, 3, 5, 12, 0), end: at(2026, 3, 5, 13, 0) });
    expect(new Set(found.map(t => t.id)).size).toBe(4); expect(parseWorked("- [x] Nothing\nplain")).toEqual([]); expect(parseWorked("  - Worked 2026-03-02: 08:00–09:00")).toEqual([]);
  });
});
