import { describe, expect, it } from "vitest";
import { Movement, newTask } from "../model";
import { cells, heatLevel, heatScale, MIN_PROJECT_TASKS, scaleFor, slider } from "../movement";

const move = (kind: Movement["kind"], n = 1): Movement => ({ id: `m${n}`, kind, source: "manual", from: "2026-01-01", to: "2026-01-02", at: "2026-01-01T00:00:00Z" });
const task = (id: string, kinds: Movement["kind"][], projects: string[] = []) => ({ ...newTask(id, id.padEnd(8, "x")), projects, movement_history: kinds.map((kind, i) => move(kind, i)) });
const forwarded = (id: string, count: number, projects: string[] = []) => task(id, Array<Movement["kind"]>(count).fill("forward"), projects);

describe("movement heat", () => {
  it("derives the scale from the median and 90th percentile of forward counts", () => {
    expect(heatScale([])).toEqual({ yellow: 2, red: 5 });
    expect(heatScale([0, 0])).toEqual({ yellow: 2, red: 5 });
    expect(heatScale([1])).toEqual({ yellow: 1, red: 3 });
    expect(heatScale([14, 14, 14, 20])).toEqual({ yellow: 14, red: 20 });
    expect(heatScale([3, 3, 3, 3])).toEqual({ yellow: 2, red: 3 });
  });
  it("buckets a forward count into green, yellow, orange and red", () => {
    const scale = { yellow: 4, red: 10 };
    expect([0, 3, 4, 6, 7, 9, 10, 25].map(n => heatLevel(n, scale))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it("uses the project's own scale only when enough of its tasks were forwarded", () => {
    const habits = Array.from({ length: MIN_PROJECT_TASKS }, (_, i) => forwarded(`p${i}`, 20, ["Slow.md"]));
    const quick = [...habits, forwarded("q", 2, ["Fast.md"]), forwarded("r", 1)];
    const subject = task("s", ["forward"], ["Fast.md", "Slow.md"]);
    expect(scaleFor(subject, quick)).toEqual({ yellow: 19, red: 20 });
    expect(scaleFor(task("t", ["forward"], ["Fast.md"]), quick)).toEqual(heatScale(quick.map(t => t.movement_history.length)));
    expect(scaleFor(task("u", []), [])).toEqual({ yellow: 2, red: 5 });
  });
  it("colours forwards by how many forwards came before and marks picked dates", () => {
    const list = cells(task("c", ["schedule", "forward", "reschedule", "forward", "forward"]), { yellow: 2, red: 4 });
    expect(list.map(cell => [cell.deliberate, cell.level])).toEqual([[true, 0], [false, 0], [true, 0], [false, 1], [false, 2]]);
    expect(list[1].label).toBe("forward · manual · 2026-01-01 → 2026-01-02 · 2026-01-01T00:00:00Z");
  });
  it("places the slider marker between start and red and clamps it", () => {
    expect(slider(forwarded("a", 5), { yellow: 4, red: 10 })).toEqual({ position: 50, level: 1, deliberate: false, stops: [40, 70] });
    const past = slider(task("b", [...Array<Movement["kind"]>(12).fill("forward"), "reschedule"]), { yellow: 4, red: 10 });
    expect(past).toMatchObject({ position: 100, level: 3, deliberate: true });
  });
});
