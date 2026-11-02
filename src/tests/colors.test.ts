import { describe, expect, it } from "vitest";
import { oklchOf, SOFT, softTint, validColor } from "../colors";

const hex = (channels: number[]) => `#${channels.map(v => v.toString(16).padStart(2, "0")).join("")}`;
const soft = (color: string) => oklchOf(hex(softTint(color).split(" ").map(Number)));
describe("project colours", () => {
  it("accepts only #rrggbb", () => {
    for (const ok of ["#000000", "#3B82F6", "#ff8800"]) expect(validColor(ok)).toBe(true);
    for (const bad of ["3b82f6", "#fff", "#12345g", "#1234567", "red", "", null, 5, undefined]) expect(validColor(bad)).toBe(false);
  });
  it("converts to OKLCH", () => {
    expect(oklchOf("#ffffff").l).toBeCloseTo(1, 2); expect(oklchOf("#000000").l).toBeCloseTo(0, 2); expect(oklchOf("#808080").c).toBeLessThan(0.01);
    const red = oklchOf("#ff0000"); expect(red.h).toBeCloseTo(29.2, 0); expect(red.c).toBeCloseTo(0.2577, 2); expect(oklchOf("#0000ff").h).toBeCloseTo(264, 0);
  });
  it("keeps the hue of a picked colour and draws every colour at the same lightness and a moderate chroma", () => {
    for (const color of ["#ff0000", "#ffee00", "#3b82f6", "#22c55e", "#a21caf", "#ff8800", "#0a0a0a", "#fafafa"]) {
      const picked = oklchOf(color); const drawn = soft(color); expect(softTint(color).split(" ")).toHaveLength(3);
      expect(drawn.l).toBeGreaterThan(SOFT.lightness - 0.04); expect(drawn.l).toBeLessThan(SOFT.lightness + 0.04); expect(drawn.c).toBeLessThanOrEqual(SOFT.maxChroma + 0.01);
      if (picked.c >= SOFT.grayBelow) { expect(drawn.c).toBeGreaterThanOrEqual(SOFT.minChroma - 0.02); const gap = Math.abs(drawn.h - picked.h); expect(Math.min(gap, 360 - gap)).toBeLessThan(6); }
    }
  });
  it("leaves grays gray and fits strong colours inside the screen's gamut", () => {
    for (const gray of ["#808080", "#000000", "#ffffff"]) { const [r, g, b] = softTint(gray).split(" ").map(Number); expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(6); }
    for (const channel of softTint("#00ffff").split(" ").map(Number)) { expect(channel).toBeGreaterThanOrEqual(0); expect(channel).toBeLessThanOrEqual(255); }
  });
});
