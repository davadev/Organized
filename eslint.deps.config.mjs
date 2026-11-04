// WHAT: lints package.json for dependencies that have a modern replacement (the plugin review's "should be replaced with an
//       alternative package" warning, from the es-tooling module-replacements list). `npm run lint:deps` runs it.
// GUARDS: `js-yaml` shipped in package.json and was flagged by the review. Keep it zero-warning, like `npm run lint`.
import depend from "eslint-plugin-depend";
import * as jsonc from "jsonc-eslint-parser";

export default [
  {
    files: ["package.json"],
    languageOptions: { parser: jsonc },
    plugins: { depend },
    // `moment` is what Obsidian itself exports as `moment`: the plugin uses the host's copy at run time and only the types and the test stub load the package. The review did not flag it.
    rules: { "depend/ban-dependencies": ["error", { allowed: ["moment"] }] },
  },
];
