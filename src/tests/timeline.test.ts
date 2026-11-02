import { describe, expect, it } from "vitest";
import { newTask } from "../model";
import { assignLanes, blocksOn, hourRange } from "../timeline";

const at = (iso: string) => new Date(iso).getTime();
const local = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();
const task = (id: string, sessions: [string, string, string, string][] = [], running: string | null = null) => ({
  ...newTask(id, id.padEnd(8, "x"), new Date("2026-01-01T00:00:00Z")),
  work_sessions: sessions.map(([d1, t1, d2, t2]) => ({ start: local(d1, t1), end: local(d2, t2) })), time_tracking_started_at: running,
});
describe("timeline", () => {
  it("draws sessions on their day, clips midnight crossings to both days and ignores other days", () => {
    const night = task("night", [["2026-03-02", "23:00:00", "2026-03-03", "01:30:00"]]);
    const first = blocksOn([night], "2026-03-02", at("2026-03-05T00:00:00")); expect(first.map(b => [b.startMin, b.endMin])).toEqual([[1380, 1440]]);
    const second = blocksOn([night], "2026-03-03", at("2026-03-05T00:00:00")); expect(second.map(b => [b.startMin, b.endMin])).toEqual([[0, 90]]);
    expect(blocksOn([night], "2026-03-04", at("2026-03-05T00:00:00"))).toEqual([]); expect(blocksOn([night], "2026-03-01", at("2026-03-05T00:00:00"))).toEqual([]);
    const tiny = task("tiny", [], local("2026-03-02", "10:00:00")); expect(blocksOn([tiny], "2026-03-02", at(local("2026-03-02", "10:00:00")) + 500)).toEqual([]);
    const sec = blocksOn([task("secs", [["2026-03-02", "09:00:30", "2026-03-02", "09:30:15"]])], "2026-03-02", 0); expect(sec[0].startMin).toBeCloseTo(540.5); expect(sec[0].endMin).toBeCloseTo(570.25);
    expect(blocksOn([task("empty", [["2026-03-02", "09:00:00", "2026-03-02", "09:00:00"]])], "2026-03-02", 0)).toEqual([]);
  });
  it("draws a running timer up to now and only on the days it covers", () => {
    const running = task("running", [], local("2026-03-02", "13:00:00"));
    expect(blocksOn([running], "2026-03-02", at(local("2026-03-02", "13:45:00")))).toMatchObject([{ startMin: 780, endMin: 825, running: true }]);
    expect(blocksOn([running], "2026-03-01", at(local("2026-03-02", "13:45:00")))).toEqual([]); expect(blocksOn([running], "2026-03-03", at(local("2026-03-02", "13:45:00")))).toEqual([]);
    expect(blocksOn([running], "2026-03-02", at(local("2026-03-02", "12:00:00")))).toEqual([]);
    expect(blocksOn([running], "2026-03-04", at(local("2026-03-04", "10:00:00")))).toMatchObject([{ startMin: 0, endMin: 600 }]);
  });
  it("packs overlapping blocks into columns per group", () => {
    const blocks = blocksOn([task("a", [["2026-03-02", "09:00:00", "2026-03-02", "11:00:00"]]), task("b", [["2026-03-02", "10:00:00", "2026-03-02", "12:00:00"]]), task("c", [["2026-03-02", "10:30:00", "2026-03-02", "11:30:00"]]), task("d", [["2026-03-02", "14:00:00", "2026-03-02", "15:00:00"]]), task("e", [["2026-03-02", "11:00:00", "2026-03-02", "13:00:00"]])], "2026-03-02", 0);
    expect(blocks.map(b => [b.task.title, b.lane, b.lanes])).toEqual([["a", 0, 3], ["b", 1, 3], ["c", 2, 3], ["e", 0, 3], ["d", 0, 1]]);
    expect(assignLanes([])).toEqual([]);
    const same = blocksOn([task("p", [["2026-03-02", "09:00:00", "2026-03-02", "10:00:00"]]), task("q", [["2026-03-02", "09:00:00", "2026-03-02", "09:30:00"]])], "2026-03-02", 0); expect(same.map(b => b.task.title)).toEqual(["q", "p"]);
  });
  it("keeps the working day and widens it only when a block falls outside", () => {
    expect(hourRange([])).toEqual([8, 18]); const block = (startMin: number, endMin: number) => ({ task: task("t"), startMin, endMin, running: false, lane: 0, lanes: 1 });
    expect(hourRange([block(600, 660)])).toEqual([8, 18]); expect(hourRange([block(330, 400), block(1100, 1250)])).toEqual([5, 21]); expect(hourRange([block(0, 1440)])).toEqual([0, 24]); expect(hourRange([], [6, 20])).toEqual([6, 20]);
  });
  it("puts a task started right after a very short run beside it, and handles several running at once", () => {
    const quick = blocksOn([task("quick", [["2026-03-02", "09:00:00", "2026-03-02", "09:01:30"]]), task("next", [["2026-03-02", "09:02:00", "2026-03-02", "10:00:00"]]), task("later", [["2026-03-02", "10:00:00", "2026-03-02", "10:30:00"]])], "2026-03-02", 0);
    expect(quick.map(b => [b.task.title, b.lane, b.lanes])).toEqual([["quick", 0, 2], ["next", 1, 2], ["later", 0, 1]]);
    const now = at(local("2026-03-02", "11:00:00")); const run = (id: string, at0: string) => task(id, [], local("2026-03-02", at0));
    expect(blocksOn([run("x", "10:00:00"), run("y", "10:30:00"), run("z", "10:45:00")], "2026-03-02", now).map(b => [b.task.title, b.lane, b.lanes])).toEqual([["x", 0, 3], ["y", 1, 3], ["z", 2, 3]]);
  });
  it("widens the hours to fit a short block drawn past its end", () => {
    const short = { task: task("t"), startMin: 1040, endMin: 1041, running: false, lane: 0, lanes: 1 }; expect(hourRange([short])).toEqual([8, 18]);
    expect(hourRange([{ ...short, startMin: 1075, endMin: 1076 }])).toEqual([8, 19]); expect(hourRange([{ ...short, startMin: 1430, endMin: 1431 }])).toEqual([8, 24]);
  });
});
