---
name: dependency-update
description: Rules for bumping npm dependencies, GitHub Actions, or the bundler in this repo. Use when reviewing Dependabot PRs, running npm install/update, or touching package.json, package-lock.json, .npmrc, dependabot.yml or workflow action pins.
---

# Dependency updates

- **Age**: never adopt a version younger than 14 days (`.npmrc` `min-release-age=14`, Dependabot `cooldown:`; check-release fails if either disappears). Urgent non-security exception -> `min-release-age-exclude[]` in the same PR. Security updates are not delayed.
- **Pinned EXACT, matching `obsidian`'s peers**: `@codemirror/state` and `@codemirror/view` (see `node_modules/obsidian/package.json` `peerDependencies`). A mismatch breaks `npm ci` with `ERESOLVE`. They move only when the `obsidian` devDependency moves; Dependabot-ignored.
- **Bundled into `main.js`**: anything not in esbuild's `external` list ships. Pin it exactly (and pin its transitive editor/parser packages via `overrides`). After any `npm install`, confirm the pins held; the build output hash is the real check. Reachability cannot be judged by grepping `src/`: a library may bind behaviour (keymaps, listeners) on its own.
  Current bundled parser family: `@lezer/markdown` 1.6.3 with overrides for `@lezer/common` 1.5.1 and `@lezer/highlight` 1.2.3. They are intentionally isolated from Obsidian's host parser. Preserve the bundled MIT notices. CodeMirror state/view remain external and peer-pinned.
- **esbuild** moves only on a release of its own; never entangled with other changes (its output is the shipped `main.js`).
- **eslint** is NOT Dependabot-ignored. For a major: confirm the rule count does not shrink (`npx eslint --print-config src/main.ts`) and stderr is empty (0 findings also happens when a plugin fails to load).
- **`npm ls --all` must exit 0** (check-release fails otherwise); `npm ci` succeeds even on an inconsistent tree.
- **No runtime `dependencies`** unless unavoidable; `npm audit --omit=dev` must stay clean. Dev advisories are informational and never block a release. `allowScripts` must approve no package.
- **GitHub Actions pinned to commit SHAs** with a `# vX.Y.Z` comment; bump within the current major (`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`, deref annotated tags); majors come as separate Dependabot PRs.
- Chase version constraints transitively (engines of deps, the npm shipped with each Node); defer high-risk, low-value bumps to Dependabot.
- After any dependency change: `npm ci && npm run lint && npm run build && npm test && npm run check-release -- --with-build`.
