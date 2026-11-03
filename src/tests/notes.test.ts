import { describe, expect, it } from "vitest";
import { buildNote, cleanTags, freePath, noteName } from "../notes";

describe("standalone note helpers", () => {
  it("makes a safe filename from a todo title", () => {
    expect(noteName("Plan the **launch**")).toBe("Plan the launch"); expect(noteName("Read [[Reading list|my list]] and [web](https://example.com)")).toBe("Read my list and web"); expect(noteName("a/b\\c:d*e?f\"g<h>i|j#k^l[m]n")).toBe("a b c d e f g h i j k l m n");
    expect(noteName("  ..hidden.. ")).toBe("hidden"); expect(noteName("???")).toBe("Untitled"); expect(noteName("")).toBe("Untitled"); expect(noteName("x".repeat(150))).toHaveLength(100); expect(noteName("Title <!--organized:abc12345--> more")).toBe("Title more"); expect(noteName("![[pic.png]] shot")).toBe("pic.png shot");
  });
  it("keeps underscores, tildes and backticks that belong to the title and drops only emphasis that wraps text", () => {
    expect(noteName("_")).toBe("_"); expect(noteName("__")).toBe("__"); expect(noteName("snake_case_name")).toBe("snake_case_name"); expect(noteName("_private")).toBe("_private"); expect(noteName("trailing_")).toBe("trailing_");
    expect(noteName("_emphasis_ and __strong__ text")).toBe("emphasis and strong text"); expect(noteName("see _this_.")).toBe("see this"); expect(noteName("my_file_ _a_")).toBe("my_file_ a");
    expect(noteName("~5 min and ~~gone~~")).toBe("~5 min and gone"); expect(noteName("use `code` here")).toBe("use code here"); expect(noteName("a ` b")).toBe("a ` b");
    expect(noteName("a\u0000b\tc")).toBe("a b c");
    expect(noteName("😀".repeat(150))).toBe("😀".repeat(100)); expect(noteName("  ")).toBe("Untitled"); expect(noteName("...")).toBe("Untitled"); expect(noteName("Ünï cödé")).toBe("Ünï cödé");
    expect(noteName("*bold* and ***both***")).toBe("bold and both"); expect(noteName("5*3")).toBe("5 3"); expect(noteName("**")).toBe("Untitled"); expect(noteName("日本_語")).toBe("日本_語");
  });
  it("cleans tags", () => {
    expect(cleanTags("idea, #project/alpha  idea  bad!tag 2024 #nested/ok_1")).toEqual(["idea", "project/alpha", "nested/ok_1"]); expect(cleanTags("")).toEqual([]); expect(cleanTags("##a")).toEqual(["a"]);
  });
  it("numbers a name until it is free", () => {
    const taken = new Set(["N/Plan.md", "N/Plan 2.md", "Plan.md"]); expect(freePath("N", "Plan", p => taken.has(p))).toBe("N/Plan 3.md"); expect(freePath("N", "Fresh", p => taken.has(p))).toBe("N/Fresh.md"); expect(freePath("", "Plan", p => taken.has(p))).toBe("Plan 2.md");
  });
  it("gives up numbering after a thousand clashes instead of looping forever", () => {
    expect(freePath("N", "Plan", () => true)).toMatch(/^N\/Plan \d{10,}\.md$/);
  });
  it("builds the note from description and sources, with tags and an optional template", () => {
    const parts = { title: "Launch", description: "Why\n\n## Sub\ntext", sources: "https://a.b", template: null as string | null, tags: ["idea"], today: "2026-03-04" };
    expect(buildNote(parts)).toBe("---\ntags:\n  - idea\n---\n\nWhy\n\n## Sub\ntext\n\n## Sources\nhttps://a.b\n");
    expect(buildNote({ ...parts, tags: [], sources: "" })).toBe("Why\n\n## Sub\ntext\n"); expect(buildNote({ ...parts, description: "", sources: "", tags: [] })).toBe("");
    const withTemplate = buildNote({ ...parts, template: "---\ntags: [daily]\nstatus: draft\n---\n# {{title}}\nMade {{date}}\n" }); expect(withTemplate).toContain("tags:\n  - daily\n  - idea"); expect(withTemplate).toContain("status: draft"); expect(withTemplate).toContain("# Launch\nMade 2026-03-04\n\nWhy");
    expect(buildNote({ ...parts, tags: [], template: "# {{ title }}\n\n{{content}}\n\nFooter" })).toBe("# Launch\n\nWhy\n\n## Sub\ntext\n\n## Sources\nhttps://a.b\n\nFooter\n");
    expect(buildNote({ ...parts, tags: [], template: "---\ntags: one two\n---\nBody" })).toContain("tags:\n  - one\n  - two"); expect(buildNote({ ...parts, tags: [], description: "", sources: "", template: "Only template" })).toBe("Only template\n");
  });
});
