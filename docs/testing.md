# Testing and compatibility

Use Node 24 and npm >=11.10. Install with `npm ci`. Dependencies are lockfile-pinned; install scripts are denied and new resolutions have a 14-day minimum age. Obsidian 1.13.1 types are pinned because its CodeMirror peer versions match the playbook; accepting a newer caret currently selects incompatible peers.

CI and release assert the actual Node/npm versions before installation (`npm run check:toolchain`). The public community-plugin registry was checked on 2026-10-31: neither the ID `organized` nor the name `Organized` was present among 9,748 entries. This is a point-in-time uniqueness check, not a reserved directory name or community submission.

Run build, lint, CSS lint, tests/coverage, dead-code, cloud lint parity and the strict release guard. Browser jobs run separately from deterministic tag publication. The shared browser harness mounts the actual inspector and stylesheet under Chromium and WebKit at narrow widths, in light/dark and RTL; its overflow canary must fail.

Browser CI uses supported Ubuntu 24.04: Playwright 1.58.2 cannot install its system dependencies on the newer Ubuntu 26.04 `ubuntu-latest` runner. This is confined to layout jobs; the browser-free validation/release jobs remain on `ubuntu-latest`. Review this compatibility pin with the next Playwright update, rather than weakening or skipping browser checks.

## Manual beta checklist (isolated development vault only)

1. Install the tagged assets via BRAT, or copy the three assets into `.obsidian/plugins/organized/`. Restart.
2. Confirm startup and ordinary navigation do not create/mutate notes.
3. Set matching daily-note folder/format; understand the default-on auto-forward toggle before opening today's note.
4. Type `- [ ] `, search/create/cancel in the native picker; choose **Keep as regular todo** and confirm the checkbox remains unlinked. Test task titles containing `[[wikilinks]]` and `[Markdown links](https://example.com)` in the picker and inspector, and verify clicking a link does not select the task card. Paste a block and verify no picker appears. Test stale-context cancellation.
5. Try all planned markers, independent timers, recurrence, project links, scheduling/rescheduling, historical propagation and undo after a concurrent edit.
6. Verify properties in Reading and Live Preview, including a task at the very end of a note without a trailing newline; toggle **Show scheduled date link** off and confirm date links disappear globally. Verify untouched source, dark/light themes and RTL.
   Confirm IDs stay hidden on the active Live Preview line but remain visible in source mode. Edit the title and Description inline, confirm Save stays above the field with the mobile keyboard open, and verify a legacy `## Information` note reads as Description and migrates when saved. Convert ordinary unchecked todos from the command palette and confirm linked, completed, in-progress and empty items are untouched. Scroll/edit the sidebar without losing the task, cancel a **Delete task** confirmation, then confirm one on a disposable task and check the canonical note reaches trash and linked occurrences disappear.
7. On real iOS/Android, verify BRAT installation, narrow sidebar, scrolling, picker keyboard ownership, touch controls, background/restart timer persistence and unload cleanup.

Real-device interaction cannot be certified by desktop emulation. Stable promotion requires the owner's real-device pass and explicit approval. The first beta is for an isolated test vault, not an assertion of stable/device certification.

## First-beta verification (2026-10-31)

- 112 behavioral/policy tests; all 13 shipped TypeScript files at 100% statements, branches, functions and lines. No coverage exclusions beyond tests/declarations.
- Typecheck/build, review-parity lint (zero warnings), CSS lint, production dead-code/dependency checks, identity/privacy check and strict release guard passed locally.
- Type-blind cloud-review reproduction: zero errors; unresolved-host-type warnings are reported separately, not suppressed in real typed lint.
- Real Chromium and WebKit: Calendar/Task/Projects at 240, 320, 390 and 768 pixels, light/dark and LTR/RTL; overflow canary detected. Internal screenshots inspected. These use actual plugin components with a host shim, not the Obsidian application.
- The desktop CLI could not connect to a running Obsidian instance. No personal vault was opened or modified; live desktop and real iOS/Android acceptance are still manual beta checks.

## Second-beta verification (2026-10-31)

- 115 behavioral/policy tests; all 13 shipped TypeScript files retain 100% statements, branches, functions and lines.
- Chromium and WebKit cover the actual Calendar/Task/Projects components, modern/legacy settings and real CodeMirror Live Preview/source at 240, 320, 390 and 768 pixels, light/dark and LTR/RTL. Host stress styles reproduce oversized mobile buttons and truncated labels; checks enforce compact calendar cells, contextual cards, readable labels and hidden-preview/visible-source IDs. Overflow canary detected; screenshots inspected.
- Sidebar tests retain selection without an active editor, edit favorite/title controls, avoid repeated module scrolling and preserve external editor focus.
- Build, typed lint, CSS lint and dead-code checks passed. Type-blind cloud parity reports zero errors; unresolved-host-type warnings remain visible rather than suppressed.
- These checks use a host shim, not a live Obsidian instance. No personal vault was modified; real-device acceptance is still required before stable promotion.

## Third-beta verification (2026-10-31)

- 118 behavioral/policy tests; all 13 shipped TypeScript files retain 100% statements, branches, functions and lines.
- Projects checks cover Favorites/Projects/Canceled sections, counts, labeled filtering and empty states. Task checks cover the hero, status dots, favorite/date/project metadata and the confirmed delete action, including occurrence removal, host trash and selection cleanup.
- The information modal joins the Chromium/WebKit matrix at 240, 320, 390 and 768 pixels in light/dark and LTR/RTL. Checks enforce shared modal chrome, title integrity, an unclipped editor and no host-width overflow; the overflow canary now uses a sized host so a zero-height scene cannot mask it.
- Build, typed lint, CSS lint, dead-code checks and cloud lint parity passed. These remain shim-based checks, not live Obsidian or real-device certification.

## Fourth-beta verification (2026-11-01)

- 121 behavioral/policy tests; all 13 shipped TypeScript files at 100% statements, branches, functions and lines.
- Inline editing replaces the text popup for titles and task note sections. Tests cover Save/Cancel for both, actions rendered above the field, Description-first card order, legacy `## Information` migration, and the section helpers for read/write/loose content.
- Todo conversion tests cover confirmation, cancellation, single/plural summaries, CRLF and indentation preservation, the no-todo notice, and refusal to convert a task note. The new command is registered as `convert-todos` and delegates through the serial queue.
- The Chromium/WebKit matrix now includes the InlineEditor and ScheduleModal scenes. Checks assert the first card is Description with Idea below it, Save sits above the inline field without host overflow, and the shared modal host is top-aligned with visible actions.
- Build, typed lint, CSS lint, dead-code checks and cloud lint parity passed. These remain shim-based checks, not live Obsidian or real-device certification.

## Fifth-beta candidate verification (2026-11-01)

- 125 behavioral/policy tests; all shipped TypeScript files at 100% statements, branches, functions and lines.
- Chromium/WebKit include an EOF Live Preview scene and assert properties render for a final task line without a trailing newline. Task-title link activation, the keep-as-todo escape, the scheduled-date setting and structured Undo notice are covered by DOM tests.
- Build, review-parity lint, CSS lint, dead-code and both browser layout gates passed. UI checks use a host shim, not live Obsidian or a physical device; acceptance remains a manual beta check.

## Inspector/layout follow-up

- Verify wikilinks and Markdown links open from the inspector's task title and note sections; ordinary links in task-list cards remain separate from card activation.
- Verify the task inspector uses a single grouped details surface and that mobile Settings controls stay close to their labels at 240–390 px.
- Confirm an unfinished `[f]` recurring occurrence is not copied by automatic daily-note reconciliation.
