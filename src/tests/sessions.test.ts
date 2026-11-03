import { describe, expect, it } from "vitest";
import { formatMinutes, isoFromInput, lengthOf, lengthOfSeconds, localInput, seconds, sessionProblem } from "../sessions";

const at = (h: number, m = 0, d = 4) => new Date(2026, 2, d, h, m).toISOString();
const NOW = new Date(2026, 2, 4, 15, 0).getTime();
describe("manual sessions", () => {
  it("round-trips local datetime-local values", () => {
    expect(localInput(at(9, 5))).toBe("2026-03-04T09:05"); expect(isoFromInput("2026-03-04T09:05")).toBe(at(9, 5)); expect(isoFromInput("2026-03-04 09:05")).toBeNull(); expect(isoFromInput("")).toBeNull(); expect(isoFromInput("2026-13-45T99:99")).toBeNull();
  });
  it("explains why a session cannot be saved", () => {
    expect(sessionProblem(null, at(10), NOW)).toContain("both"); expect(sessionProblem(at(9), null, NOW)).toContain("both");
    expect(sessionProblem(at(10), at(9), NOW)).toContain("after the start"); expect(sessionProblem(at(9), at(9), NOW)).toContain("after the start");
    expect(sessionProblem(at(9), at(9, 0).replace(":00.000Z", ":30.000Z"), NOW)).toContain("a minute");
    expect(sessionProblem(at(0, 0, 1), at(0, 0, 3), NOW)).toContain("24 hours"); expect(sessionProblem(at(14), at(16), NOW)).toContain("future");
    expect(sessionProblem(at(9), at(10), NOW)).toBeNull(); expect(sessionProblem(at(14), at(15, 1), NOW)).toBeNull(); expect(sessionProblem(at(9), at(10))).toBeNull();
  });
  it("writes minutes the short way once they pass an hour", () => {
    expect([0, 1, 59, 60, 61, 73, 120, 605].map(formatMinutes)).toEqual(["0 min", "1 min", "59 min", "1h", "1h 1min", "1h 13min", "2h", "10h 5min"]);
    expect(lengthOfSeconds(73 * 60 + 29)).toBe("1h 13min"); expect(lengthOfSeconds(73 * 60 + 30)).toBe("1h 14min"); expect(lengthOfSeconds(3599)).toBe("1h");
  });
  it("measures and words the length", () => {
    expect(seconds({ start: at(9), end: at(10, 30) })).toBe(5400); expect(seconds({ start: at(10), end: at(9) })).toBe(0);
    expect(lengthOf({ start: at(9), end: at(9, 45) })).toBe("45 min"); expect(lengthOf({ start: at(9), end: at(11) })).toBe("2h"); expect(lengthOf({ start: at(9), end: at(10, 20) })).toBe("1h 20min"); expect(lengthOfSeconds(5400)).toBe("1h 30min"); expect(lengthOfSeconds(29)).toBe("0 min");
  });
});
