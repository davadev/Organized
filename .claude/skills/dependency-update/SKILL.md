---
name: dependency-update
description: Rules for bumping npm dependencies, GitHub Actions, or the bundler in this repo. Use when reviewing Dependabot PRs, running npm install/update, or touching package.json, package-lock.json, .npmrc, dependabot.yml or workflow action pins.
---

# Dependency updates

- **Age**: never adopt a version younger than 14 days (`.npmrc` `min-release-age=14`, Dependabot `cooldown:`; check-release fails if either disappears). Urgent non-security exception -> `min-release-age-exclude[]` in the same PR. Security updates are not delayed.
- **Pinned EXACT, matching `obsidian`'s peers**: `@codemirror/state` and `@codemirror/view` (see `node_modules/obsidian/package.json` `peerDependencies`). A mismatch breaks `npm ci` with `ERESOLVE`. They move only when the `obsidian` devDependency moves; Dependabot-ignored.
- **Bundled into `main.js`**: anything not in esbuild's `external` list ships. Pin it exactly (and pin its transitive editor/parser packages via `overrides`). After any `npm install`, confirm the pins held; the build output hash is the real check. Reachability cannot be judged by grepping `src/`: a library may bind behaviour (keymaps, listeners) on its own.
  Current bundled parser family: `@lezer/markdown` 1.6.4 with overrides for `@lezer/common` 1.5.1 and `@lezer/highlight` 1.2.3. They are intentionally isolated from Obsidian's host parser. Preserve the bundled MIT notices. CodeMirror state/view remain external and peer-pinned.
- **esbuild** moves only on a release of its own; never entangled with other changes (its output is the shipped `main.js`).
- **eslint** is NOT Dependabot-ignored. For a major: confirm the rule count does not shrink (`npx eslint --print-config src/main.ts`) and stderr is empty (0 findings also happens when a plugin fails to load).
- **`npm ls --all` must exit 0** (check-release fails otherwise); `npm ci` succeeds even on an inconsistent tree.
- **No runtime `dependencies`** unless unavoidable; `npm audit --omit=dev` must stay clean. Dev advisories are informational and never block a release. `allowScripts` must approve no package.
- **GitHub Actions pinned to commit SHAs** with a `# vX.Y.Z` comment; bump within the current major (`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`, deref annotated tags); majors come as separate Dependabot PRs.
- Chase version constraints transitively (engines of deps, the npm shipped with each Node); defer high-risk, low-value bumps to Dependabot.
- **Dependabot PRs merge as they are** once green: `scripts/check-identity.mjs` accepts `dependabot[bot]` commits committed by GitHub. Do not rebase or amend one locally under another committer than davadev; ask Dependabot (`@dependabot rebase`) instead. Review the diff first: only `package.json`, `package-lock.json` or workflow pins may change.
- After any dependency change: `npm ci && npm run lint && npm run build && npm test && npm run check-release -- --with-build`.

## Dependabot gate (before every beta, before every stable)

1. **Open PRs.** `gh pr list --state open --author "app/dependabot"`. Fold every one into the next beta: merge it, or supersede it with your own branch (a conflicting or failing grouped PR is redone on a fresh branch and closed with a pointer), and only then tag. Never tag a beta around an open Dependabot PR. A PR that opens after a beta was tested goes into the following beta, not into the stable that promotes the tested one.
2. **Alerts.** `gh api repos/<owner>/<repo>/dependabot/alerts --jq '[.[]|select(.state=="open")]|length'`. HTTP 403 "Dependabot alerts are disabled" means they are off: turn them on with `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts` (repo admin; a GET of the same path answering 204 means on), then re-read in a few minutes. Optionally `gh api -X PUT repos/<owner>/<repo>/automated-security-fixes`. Guide: playbook `SUPPLY-CHAIN.md`, "Turning on Dependabot alerts".
3. **Fix, do not dismiss.** Lockfile first (`npm update <pkg>`, exact bump for a direct dependency), then parent-scoped `overrides`, then a clean `rm -rf node_modules && npm ci && npm ls --all && npm audit`. Never dismiss an alert to get green.
4. **Stable needs 0 open alerts.** If one cannot be fixed (no patch yet, a parent breaks under the override), tell the user which and why before tagging stable; the user decides.

## Auto-merge lane (no human needed for the boring ones)

Dependabot PRs merge themselves when every one of these holds (rules: `scripts/lib/automergePolicy.mjs`, knobs: `.github/automerge.json`):
- author `dependabot[bot]`, branch in this repo, only `package.json` + `package-lock.json` changed, and only dependency versions (and plain-semver `overrides`) moved;
- every changed lockfile entry is from `registry.npmjs.org` with a sha512 integrity, no install script, same major (0.x minors count as majors), nothing on the denylist (`esbuild`, `@codemirror/*`, `obsidian`, `typescript`, `@types/node`);
- the new versions are old enough: critical advisory 0 days, other security fix 3 days, routine bump 14 days;
- `validate` is green on the exact head commit, `main` has not moved since the build, and `sha256(main.js)` built from the PR equals the one built from `main` (`shipped-bytes` CI job; the build must also be reproducible).

Outcomes, always commented on the PR: **merge** (pinned with `--match-head-commit`, then CI is dispatched on `main` because a `GITHUB_TOKEN` merge starts no push workflow), **skip** (a human looks; the reasons are in the comment), **needs-beta** (security fix that changes shipped bytes: PR labelled, issue opened, never merged: cut a beta with `release-beta`).

- `"dryRun": true` in `.github/automerge.json` comments the verdict and never merges. Flip it only after the verdicts of 2-3 real Dependabot PRs looked right.
- Red CI on `main` after an auto-merge opens an `automerge-broke-main` issue and pauses the lane. Revert or fix forward, then close the issue.
- Never widen the lane to workflow files, `scripts`, or `src/`: a bot that may edit the code that approves it approves itself. Majors, Actions pins, `esbuild`, `@codemirror/*`, `obsidian` stay manual on purpose.
- The weekly `Dependency sweep` issue (`deps-sweep.yml`) is the one list of what is stuck; read it instead of the PR tab.
