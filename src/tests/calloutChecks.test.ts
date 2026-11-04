import { describe, expect, it } from "vitest";
import { checkCallouts, CIRCLE_DIAMETER } from "../../scripts/lib/calloutChecks.mjs";

const item = (n: number, cy: number, box = { left: 40, top: cy - 10, width: 100, height: 20 }, cx = 20) => ({ n, box, circle: { cx, cy } });
const report = (items: ReturnType<typeof item>[]) => ({ width: 200, height: 300, items });

describe("annotated screenshot callout checks", () => {
  it("accepts sound callouts, and an image without any", () => {
    expect(checkCallouts(report([item(1, 50), item(2, 120)]))).toEqual([]);
    expect(checkCallouts(report([]))).toEqual([]);
  });
  it("requires the numbers to run 1..n in order", () => {
    expect(checkCallouts(report([item(1, 50), item(3, 120)])).join()).toContain("numbers must run 1..n in order");
  });
  it("rejects an empty box and a box outside the image", () => {
    expect(checkCallouts(report([item(1, 50, { left: 40, top: 40, width: 0, height: 20 })])).join()).toContain("its box is empty");
    expect(checkCallouts(report([item(1, 50, { left: 150, top: 40, width: 100, height: 20 })])).join()).toContain("sticks out of the 200x300 image");
  });
  it("rejects a number circle outside the image", () => {
    expect(checkCallouts(report([item(1, 50, undefined, 4)])).join()).toContain("number circle sticks out");
  });
  it("rejects circles that overlap each other or cover another callout's box", () => {
    expect(checkCallouts(report([item(1, 50), item(2, 50 + CIRCLE_DIAMETER - 2)])).join()).toContain("number circles overlap");
    expect(checkCallouts(report([item(1, 50), item(2, 200, { left: 5, top: 40, width: 60, height: 20 })])).join()).toContain("covers the box of callout 2");
  });
});
