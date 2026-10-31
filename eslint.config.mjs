// TEMPLATE: eslint.config.mjs (repo root)
// WHAT: local mirror of the Obsidian community-plugin auto-review's lint set (eslint-plugin-obsidianmd + the relevant
//       type-aware @typescript-eslint rules). `npm run lint` runs it with --max-warnings=0.
// CHANGE: nothing to substitute. Add plugin-specific ignores only for generated files.
// GUARDS: a release with even one lint Error fails the review and risks delisting. Rules the review rates as warnings
//         are `warn` here so local output matches; the lint script's --max-warnings=0 (asserted by check-release) makes
//         every warning a failure anyway: zero warnings is the house rule.
//         Reminder: a finding count of 0/0 also happens when a plugin FAILS TO LOAD; after any eslint major, compare the
//         rule count (`npx eslint --print-config src/main.ts`) and check stderr is empty.
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "esbuild.config.mjs", "scripts/**", "src/tests/**", "src/**/*.d.ts", "node_modules", "coverage", "eslint.config.mjs", "vitest.config.mts"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Auto-review marks bare `any` as an Error.
      "@typescript-eslint/no-explicit-any": "error",

      // The auto-review surfaces these as Warnings (non-blocking there, blocking here via --max-warnings=0).
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-deprecated": "warn",

      // The auto-review DOES run this one: it is the rule behind the "'X' is an 'error' type that acts as 'any'" rows
      // that head its report (the scanner could not resolve a type). `npm run lint:cloud-parity` relies on it.
      "@typescript-eslint/no-redundant-type-constituents": "warn",

      // On: Obsidian's guideline is sentence case for all UI text.
      "obsidianmd/ui/sentence-case": [
        "warn",
        // Proper nouns and acronyms the rule would otherwise lowercase: add yours instead of rewording the text.
        { brands: ["Organized", "Markdown", "Moment", "Undo"], acronyms: ["YAML", "API", "YYYY", "MM", "DD"] },
      ],
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
