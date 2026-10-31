# Testing and compatibility

Use Node 24 and npm >=11.10. Install with `npm ci`. Dependencies are lockfile-pinned; install scripts are denied and new resolutions have a 14-day minimum age. Obsidian 1.13.1 types are pinned because its CodeMirror peer versions match the playbook; accepting a newer caret currently selects incompatible peers.

CI and release assert the actual Node/npm versions before installation (`npm run check:toolchain`). The public community-plugin registry was checked on 2026-10-31: neither the ID `organized` nor the name `Organized` was present among 9,748 entries. This is a point-in-time uniqueness check, not a reserved directory name or community submission.

Run build, lint, CSS lint, tests/coverage, dead-code, cloud lint parity and the strict release guard. Browser jobs run separately from deterministic tag publication. The shared browser harness mounts the actual inspector and stylesheet under Chromium and WebKit at narrow widths, in light/dark and RTL; its overflow canary must fail.

Browser CI uses supported Ubuntu 24.04: Playwright 1.58.2 cannot install its system dependencies on the newer Ubuntu 26.04 `ubuntu-latest` runner. This is confined to layout jobs; the browser-free validation/release jobs remain on `ubuntu-latest`. Review this compatibility pin with the next Playwright update, rather than weakening or skipping browser checks.

## Manual beta checklist (isolated development vault only)

1. Install the tagged assets via BRAT, or copy the three assets into `.obsidian/plugins/organized/`. Restart.
2. Confirm startup and ordinary navigation do not create/mutate notes.
3. Set matching daily-note folder/format; understand the default-on auto-forward toggle before opening today's note.
4. Type `- [ ] `, search/create/cancel in the native picker; paste a block and verify no picker appears. Test stale-context cancellation.
5. Try all planned markers, independent timers, recurrence, project links, scheduling/rescheduling, historical propagation and undo after a concurrent edit.
6. Verify properties in Reading and Live Preview, untouched source, dark/light themes and RTL.
7. On real iOS/Android, verify BRAT installation, narrow sidebar, scrolling, picker keyboard ownership, touch controls, background/restart timer persistence and unload cleanup.

Real-device interaction cannot be certified by desktop emulation. Stable promotion requires the owner's real-device pass and explicit approval. The first beta is for an isolated test vault, not an assertion of stable/device certification.

## First-beta verification (2026-10-31)

- 111 behavioral/policy tests; all 13 shipped TypeScript files at 100% statements, branches, functions and lines. No coverage exclusions beyond tests/declarations.
- Typecheck/build, review-parity lint (zero warnings), CSS lint, production dead-code/dependency checks, identity/privacy check and strict release guard passed locally.
- Type-blind cloud-review reproduction: zero errors; unresolved-host-type warnings are reported separately, not suppressed in real typed lint.
- Real Chromium and WebKit: Calendar/Task/Projects at 240, 320, 390 and 768 pixels, light/dark and LTR/RTL; overflow canary detected. Internal screenshots inspected. These use actual plugin components with a host shim, not the Obsidian application.
- The desktop CLI could not connect to a running Obsidian instance. No personal vault was opened or modified; live desktop and real iOS/Android acceptance are still manual beta checks.
