// TEMPLATE: vitest.config.mts (repo root; `.mts` so it loads as ESM and may use import.meta.dirname)
// WHAT: test + coverage configuration with the 100 % gate and the `obsidian` stub alias.
// CHANGE: nothing to substitute.
// GUARDS: coverage that quietly stops counting a file. `include` covers all of src/, `exclude` holds ONLY tests and
//         declaration files, thresholds are 100 on all four metrics, and src/tests/coverageGate.test.ts pins every one
//         of those (plus "no v8/c8/istanbul ignore comment in src"). Unreachable code is deleted, never excluded; raise
//         coverage by testing, not by widening `exclude`. Incident: a vitest major that started honouring `include`
//         literally dropped the headline number by five points, because untested modules had been absent from the
//         denominator before.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["src/tests/__mocks__/setup.ts"],
    coverage: {
      // v8: fast, accurate line/branch numbers for an esbuild-compiled TypeScript project. Reporters: text in the
      // terminal, html at coverage/index.html, lcov for CI/editors, json-summary for scripts.
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/tests/**",
        "src/**/*.d.ts",
        // Nothing else: every source file is measured. src/tests/coverageGate.test.ts pins this list.
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      // The `obsidian` package ships only type definitions at runtime; tests get a stub instead.
      obsidian: path.resolve(import.meta.dirname, "src/tests/__mocks__/obsidian.ts"),
    },
  },
});
