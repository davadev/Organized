import { describe, expect, it } from "vitest";
import { RELEASE_NOTES, baseVersion, latestNote, notesOfLine, notesToShow, type ReleaseNote } from "../whatsNew/releaseNotes";

const note = (version: string): ReleaseNote => ({ version, title: `v${version}`, intro: "", items: [] });
const NOTES = [note("1.2.1"), note("1.2.0"), note("1.1.0"), note("not-a-version")];

describe("baseVersion", () => {
  it("reads plain, prerelease and build versions", () => {
    expect(baseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(baseVersion("1.2.3-beta.7")).toEqual([1, 2, 3]);
    expect(baseVersion(" 1.2.3+build ")).toEqual([1, 2, 3]);
  });
  it("returns null for anything else", () => {
    expect(baseVersion("")).toBeNull();
    expect(baseVersion("1.2")).toBeNull();
  });
});

describe("notesToShow", () => {
  it("shows everything newer than last seen up to the running version, oldest first", () => {
    expect(notesToShow("1.1.0", "1.2.1", NOTES).map((n) => n.version)).toEqual(["1.2.0", "1.2.1"]);
  });
  it("gives an empty or unreadable last-seen the running release only, not the whole history", () => {
    expect(notesToShow("", "1.1.0", NOTES).map((n) => n.version)).toEqual(["1.1.0"]);
    expect(notesToShow("junk", "1.2.1", NOTES).map((n) => n.version)).toEqual(["1.2.1"]);
    expect(notesToShow("", "0.1.0", NOTES)).toEqual([]);
  });
  it("does not repeat a note for a beta of a version already seen", () => {
    expect(notesToShow("1.2.0", "1.2.0-beta.3", NOTES)).toEqual([]);
  });
  it("shows nothing when the running version is unreadable", () => {
    expect(notesToShow("", "dev", NOTES)).toEqual([]);
  });
  it("uses the shipped list by default", () => {
    expect(notesToShow("", "999.0.0")).toEqual([RELEASE_NOTES[0]]);
  });
});

describe("notesOfLine / latestNote", () => {
  it("returns the note of the running release only", () => {
    expect(notesOfLine("1.2.1", NOTES).map((n) => n.version)).toEqual(["1.2.1"]);
  });
  it("falls back to the newest earlier note when the line has none", () => {
    expect(notesOfLine("1.3.0", NOTES).map((n) => n.version)).toEqual(["1.2.1"]);
  });
  it("returns nothing when there is no note at or below the version", () => {
    expect(notesOfLine("0.1.0", NOTES)).toEqual([]);
    expect(latestNote("0.1.0", NOTES)).toBeNull();
  });
  it("uses the shipped list by default", () => {
    expect(notesOfLine("999.0.0")).toHaveLength(1);
    expect(latestNote("999.0.0")).toBe(RELEASE_NOTES[0]);
  });
});

describe("the shipped RELEASE_NOTES", () => {
  it("are plain X.Y.Z, unique, and newest first", () => {
    const versions = RELEASE_NOTES.map((n) => n.version);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => {
      const [x, y] = [baseVersion(a)!, baseVersion(b)!];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
    expect(versions).toEqual(sorted);
  });
});
