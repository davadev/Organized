// TEMPLATE: src/tests/coverageGate.test.ts
// WHAT: pins the 100 % coverage ratchet in vitest.config.mts: all four thresholds are 100, `exclude` holds only the tests
//       and declaration files, `include` covers all of src/, and no source file contains a v8/c8/istanbul ignore comment.
// CHANGE: nothing. It reads vitest.config.mts at the repo root.
// GUARDS: coverage quietly loosened by a small edit (a threshold lowered, a file excluded, a branch hidden behind an ignore
//         comment). Unreachable code is DELETED; code reachable from persisted or hand-edited data is kept and tested.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const config = readFileSync(path.join(root, "vitest.config.mts"), "utf8");
/** Only the `coverage: { ... }` block: `test.include` (the test files) must not be mistaken for coverage `include`. */
const coverage = config.slice(config.indexOf("coverage: {"));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "tests" ? [] : sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/** The entries of a `key: [ ... ]` list in the config, comments and quotes stripped. */
function listOf(key: string): string[] {
  const block = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(coverage)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .join("")
    .split(",")
    .map((e) => e.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

describe("coverage gate", () => {
  it("uses the v8 provider", () => {
    expect(coverage).toMatch(/provider:\s*"v8"/);
  });

  it("fails CI below 100 on every metric", () => {
    const block = /thresholds:\s*\{([^}]*)\}/.exec(coverage)![1];
    for (const metric of ["lines", "functions", "branches", "statements"]) {
      expect(block, metric).toMatch(new RegExp(`${metric}:\\s*100\\b`));
    }
  });

  it("measures all of src/", () => {
    expect(listOf("include")).toEqual(["src/**/*.ts"]);
  });

  it("excludes nothing but the tests and the declaration files", () => {
    expect(listOf("exclude")).toEqual(["src/tests/**", "src/**/*.d.ts"]);
  });

  it("has no coverage-ignore comments in the source: unreachable code is deleted, not hidden", () => {
    const offenders = sourceFiles(path.join(root, "src")).filter((f) => /(?:\/\*|\/\/)\s*(?:v8|c8|istanbul)\s+ignore/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
