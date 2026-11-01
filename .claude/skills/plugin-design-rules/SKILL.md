---
name: plugin-design-rules
description: Starter design and code rules for an Obsidian plugin that each prevent a known regression (CSS, settings tab, mobile, data safety, tests and coverage, lint). Use before editing src/, styles.css, settings or any code that reads or writes user data; append your own hard-won rules.
---

# Plugin design rules

## CSS (`styles.css`)
- Every class the code adds starts with `organized-`; `check-release` then requires `styles.css` to ship (a release without it broke every iPad install).
- No `!important`; no `text-decoration-line/-style/-color/-thickness/-skip-ink` longhands (use the shorthand with `var()` parts). The review lints both.
- Use Obsidian theme variables (`--text-normal`, `--background-secondary`...) so themes and dark mode work. Dynamic colours go through a CSS custom property that code writes, never inline `background`.
- Check at phone width and desktop width; wide fixed-size elements are how WKWebView kills the app.
- Check: `npm run lint:css`.

## Settings tab
- Group new settings under a heading; never flat-append. Declarative `getSettingDefinitions()` (Obsidian 1.13+) makes them findable in settings search.
- Per-device state (last seen version, one-time hints) is not a preference: list it in `NOT_IN_SETTINGS_TAB` in `settingsCoverage.test.ts` with the reason.
- A new settings group needs a full Obsidian restart to appear (iPad: swipe the app away).
- Do not rebuild the DOM per keystroke in a search/filter input (it closes the phone keyboard).
- On narrow screens, explicitly stack setting labels and controls and cap their gap; host flex-wrap defaults can strand controls far below their descriptions.

## Mobile / platform
- Never auto-download large data at startup (a startup download once caused an iOS crash loop).
- Node-only modules (`fs`, `path`, `electron`) require `"isDesktopOnly": true`; `check-release` enforces it.
- Do not raise `minAppVersion` or use newer API without checking the iOS install path.
- Mobile editor toolbar commands may dispatch CodeMirror changes without a `userEvent`; support only the exact one-line blank-checkbox insertion as a fallback, while continuing to ignore paste/drop/undo/redo.
- Use `normalizePath()` for every vault path; use `app.vault` / `adapter` APIs, never hardcoded absolute paths.
- Keep the load path light: do risky or slow work after the layout is ready, and keep the crash-loop guard (`src/crashGuard.ts`) in front of it.

## Data safety
- Never rewrite the user's notes or files as a side effect of load or save. Writes are explicit, user-initiated actions.
- Settings migrations are additive and tolerate missing, extra and hand-edited values. Persisted data is untrusted input: shape-check it.
- Synced state (data.json shared across devices) must merge commutatively and idempotently; add property tests when touching it.
- Code reachable from persisted/synced/hand-edited data is kept and tested; legacy code that nothing can reach is deleted.

## Tests / coverage / lint
- 100 % coverage on all four metrics. No `v8|c8|istanbul ignore`; never widen `exclude`. `coverageGate.test.ts` pins this.
- Unreachable code is **deleted**, not ignored. A deliberate test seam gets a `@public` JSDoc tag for knip.
- `npm run check:dead-code` (knip, production mode) fails on exports and files only a test reaches: delete them, do not add ignores.
- `npm run lint` mirrors Obsidian's auto-review: **zero errors and zero warnings** before a PR is ready and before any tag. Never silence a rule to get there.
- A passing test is not evidence that something is on screen: for UI work, render it with the real stylesheet and look at it.
- Verify data and behaviour claims against the real source (real dictionary, real Obsidian docs) before implementing; do not assume.
