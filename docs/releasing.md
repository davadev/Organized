# Release procedure

Only tag-triggered `.github/workflows/release.yml` publishes artifacts. Never run `gh release create` manually or upload local builds. Work on feature branches and merge a green PR first. Project/license attribution must be davadev; Git authors may be davadev or Dany using the verified davadev GitHub no-reply address, and committers may match or be GitHub's merge service (`GitHub <noreply@github.com>`).

Browser checks are required PR checks on Ubuntu 24.04 (the supported Playwright 1.58.2 host); they never run during tag publication. Validation and release use `ubuntu-latest` and explicitly assert Node 24/npm >=11.10 before installing.

The identity gate checks the reviewed checkout's reachable commit history. Unmerged remote branches (for example dependency proposals) are not part of the released history and cannot change that verdict.

## Initial bootstrap

This repository has no stable release. Main's `0.0.0` is an unpublished bootstrap, not a version advertised in the Community Plugins directory. The first release is `0.1.0-beta.1`. Do not publish a fake stable release just to satisfy a bootstrap invariant. After the first explicit stable promotion, main must always point to an existing stable release with all three assets.

## Beta

1. Use Node 24, npm >=11.10; run `npm ci` and `npm ls --all`.
2. Run `npm run lint`, `npm run lint:css`, `npm run build`, `npm run test:cov`, `npm run check:dead-code`, `npm run lint:cloud-parity`, `npm run check:layout`, `npm run check:webkit`.
3. Run `npm run check-release -- --with-build --strict`. Inspect actual UI screenshots and document any device checks honestly.
4. Push the feature branch, open a PR, and wait for every required check before merging. If main advanced, update the feature branch and re-run CI first; never bypass required checks. No version metadata bump for a beta.
5. Tag reviewed main: `git tag 0.1.0-beta.1`, then `git push origin 0.1.0-beta.1`. No `v` prefix; use the next unused beta number on subsequent releases.
6. CI stamps the exact prerelease into its working tree, repeats deterministic checks, validates nonempty `main.js`, `manifest.json`, `styles.css`, attests those bytes and publishes a prerelease. Browsers are in CI, never in the tag workflow.
7. Verify: `gh release view 0.1.0-beta.1 --json isDraft,isPrerelease,assets,tagName`; download assets and check the manifest version equals the tag. Verify main's manifest remains 0.0.0 until a stable is explicitly approved. Verify attestation with `gh attestation verify <asset> --repo davadev/Organized`.
8. Install in BRAT using `davadev/Organized`, optionally pin the exact version. Do not submit to Community Plugins.

For a failed unpublished tag, investigate first; undo only that failed tag with `git push origin :0.1.0-beta.1` then `git tag -d 0.1.0-beta.1`. Never mutate a released tag; ship the next beta.

## Stable (separate explicit approval)

First complete desktop and real iOS/Android manual tests. On `release/0.1.0`, bump manifest/package/lock/versions to 0.1.0. Open a PR; pass every gate. Tag that release branch, verify stable assets exist, then merge with `--merge` (never squash the release commit). Only now may main advertise the stable version. The workflow checks tag ancestry; prereleases must be on main, stable tags may also be on release branches.
