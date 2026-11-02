import { describe, expect, it } from "vitest";
import { rgbOf, validColor } from "../colors";

describe("project colours", () => {
  it("accepts only #rrggbb and converts it to rgb channels", () => {
    for (const ok of ["#000000", "#3B82F6", "#ff8800"]) expect(validColor(ok)).toBe(true);
    for (const bad of ["3b82f6", "#fff", "#12345g", "#1234567", "red", "", null, 5, undefined]) expect(validColor(bad)).toBe(false);
    expect(rgbOf("#ff8800")).toBe("255 136 0"); expect(rgbOf("#3b82f6")).toBe("59 130 246");
  });
});
