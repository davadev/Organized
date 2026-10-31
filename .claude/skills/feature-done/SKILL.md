---
name: feature-done
description: Definition-of-done checklist for any feature or user-visible change in this plugin. Use before opening or merging a feature/fix PR, when adding a setting, command, UI element or behaviour change, or when asked "is this done?" or "what else needs updating?". Covers tests, docs, README, What's new entry, screenshots, issue.
---

# Feature done checklist

Run through every line before the PR is marked ready. Skip a line only when it truly does not apply, and say so in the PR.

1. **Branch + PR**: work on `fix/<slug>` or `feat/<slug>`, never on `main`.
2. **Tests**: new/changed code has tests; `npm run test:cov` stays at 100 % (no `v8 ignore`; unreachable code is deleted, see `plugin-design-rules`).
3. **Checks**, all with zero warnings: `npm run build` (includes tsc), `npm run lint`, `npm run check:dead-code` (new code is reachable from `src/main.ts`; nothing left half-finished), `npm run lint:css` if `styles.css` changed.
4. **Settings**: a new setting goes under a section heading (never appended flat) and is covered in `src/tests/settingsCoverage.dom.test.ts`. Remind the user a full Obsidian restart is needed to see a new group.
5. **Docs**: update the matching `docs/<page>.md` and `docs/index.md` if a page was added; `README.md` if user-visible.
6. **What's new**: add a benefit-led entry to `CHANGELOG.md`; do not remove earlier entries.
7. **UI**: run Chromium and WebKit layout gates; inspect local `test-results/` images. The harness uses actual plugin code with approximated host chrome, not a certified live-device pass.
8. **Issue**: exists, labelled, tracked (see `triage-issue`). The PR body says `Closes #N`.
9. Next step is `release-beta` once merged. Every fix ships as a beta with BRAT assets; do not leave a fix un-released.
