import { describe, expect, it } from "vitest";
import { buildNote, cleanTags, freePath, noteName } from "../notes";

describe("standalone note helpers", () => {
  it("makes a safe filename from a todo title", () => {
    expect(noteName("Plan the **launch**")).toBe("Plan the launch"); expect(noteName("Read [[Reading list|my list]] and [web](https://example.com)")).toBe("Read my list and web"); expect(noteName("a/b\\c:d*e?f\"g<h>i|j#k^l[m]n")).toBe("a b c de f g h i j k l m n");
    expect(noteName("  ..hidden.. ")).toBe("hidden"); expect(noteName("???")).toBe("Untitled"); expect(noteName("")).toBe("Untitled"); expect(noteName("x".repeat(150))).toHaveLength(100); expect(noteName("Title <!--organized:abc12345--> more")).toBe("Title more"); expect(noteName("![[pic.png]] shot")).toBe("pic.png shot");
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
  it("builds the note from description, sources and notes, with tags and an optional template", () => {
    const parts = { title: "Launch", description: "Why\n\n## Sub\ntext", sources: "https://a.b", notes: "remember", template: null as string | null, tags: ["idea"], today: "2026-03-04" };
    expect(buildNote(parts)).toBe("---\ntags:\n  - idea\n---\n\nWhy\n\n## Sub\ntext\n\n## Sources\nhttps://a.b\n\n## Notes\nremember\n");
    expect(buildNote({ ...parts, tags: [], sources: "", notes: "" })).toBe("Why\n\n## Sub\ntext\n"); expect(buildNote({ ...parts, description: "", sources: "", notes: "", tags: [] })).toBe("");
    const withTemplate = buildNote({ ...parts, template: "---\ntags: [daily]\nstatus: draft\n---\n# {{title}}\nMade {{date}}\n" }); expect(withTemplate).toContain("tags:\n  - daily\n  - idea"); expect(withTemplate).toContain("status: draft"); expect(withTemplate).toContain("# Launch\nMade 2026-03-04\n\nWhy");
    expect(buildNote({ ...parts, tags: [], template: "# {{ title }}\n\n{{content}}\n\nFooter" })).toBe("# Launch\n\nWhy\n\n## Sub\ntext\n\n## Sources\nhttps://a.b\n\n## Notes\nremember\n\nFooter\n");
    expect(buildNote({ ...parts, tags: [], template: "---\ntags: one two\n---\nBody" })).toContain("tags:\n  - one\n  - two"); expect(buildNote({ ...parts, tags: [], description: "", sources: "", notes: "", template: "Only template" })).toBe("Only template\n");
  });
});
