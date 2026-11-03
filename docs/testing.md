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
- Projects checks cover Projects/Canceled sections and a separate Favorites tab (star icon), counts, labeled filtering and empty states. Task checks cover the hero, status dots, favorite/date/project metadata and the confirmed delete action, including occurrence removal, host trash and selection cleanup.
- The information modal joins the Chromium/WebKit matrix at 240, 320, 390 and 768 pixels in light/dark and LTR/RTL. Checks enforce shared modal chrome, title integrity, an unclipped editor and no host-width overflow; the overflow canary now uses a sized host so a zero-height scene cannot mask it.
- Build, typed lint, CSS lint, dead-code checks and cloud lint parity passed. These remain shim-based checks, not live Obsidian or real-device certification.

## Fourth-beta verification (2026-11-01)

- 121 behavioral/policy tests; all 13 shipped TypeScript files at 100% statements, branches, functions and lines.
- Inline editing replaces the text popup for titles and task note sections. Tests cover Save/Cancel for both, actions rendered above the field, Description-first card order, legacy `## Information` migration, and the section helpers for read/write/loose content.
- Todo conversion tests cover confirmation, cancellation, single/plural summaries, CRLF and indentation preservation, the no-todo notice, and refusal to convert a task note. The new command is registered as `convert-todos` and delegates through the serial queue.
- The Chromium/WebKit matrix now includes the InlineEditor and ScheduleModal scenes. Checks assert the first card is Description with Sources below it, Save sits above the inline field without host overflow, and the shared modal host is top-aligned with visible actions.
- Build, typed lint, CSS lint, dead-code checks and cloud lint parity passed. These remain shim-based checks, not live Obsidian or real-device certification.

## Fifth-beta candidate verification (2026-11-01)

- 125 behavioral/policy tests; all shipped TypeScript files at 100% statements, branches, functions and lines.
- Chromium/WebKit include an EOF Live Preview scene and assert properties render for a final task line without a trailing newline. Task-title link activation, the keep-as-todo escape, the scheduled-date setting and structured Undo notice are covered by DOM tests.
- Build, review-parity lint, CSS lint, dead-code and both browser layout gates passed. UI checks use a host shim, not live Obsidian or a physical device; acceptance remains a manual beta check.

## Inspector/layout follow-up

- Verify wikilinks and Markdown links open from the inspector's task title and note sections; ordinary links in task-list cards remain separate from card activation.
- Verify the task inspector uses a single grouped details surface and that mobile Settings controls stay close to their labels at 240–390 px.
- Confirm an unfinished `[r]` recurring occurrence is not copied by automatic daily-note reconciliation.

## Mobile toolbar picker regression

- With a mobile-toolbar-like CM transaction that inserts exactly `- [ ] ` without `Transaction.userEvent`, verify the picker opens once.
- Verify paste/drop/undo/redo and multi-line task blocks still do not auto-open the picker; choosing **Keep as regular todo** leaves the checkbox unlinked.

## Current-note task browsing

- Put the cursor on prose in a note containing linked and regular checkbox tasks, then open the Task tab; verify it lists every task line from that note.
- Tap/activate a linked task and confirm the editor focuses the matching line while the Task tab shows its details. Regular todos should move the cursor and offer **Attach/create task**; orphaned IDs should offer repair.
- Open the inspector with no recent Markdown editor and verify the Task tab gives a helpful empty-state message.

## Project notes and retired-task details
- Link a project with `[j]`: the picker lists only notes with `organized_type: project`; a new note is created in `<task folder>/Projects/` with that property. After updating, existing project notes get the property once (a notice reports how many), keeping their other properties.
- Set retention to a few days, choose *Add everything*, track time on a task, complete it and open today's daily note after expiry: the latest daily note shows the description as a quote and `- Worked …` lines under a plain checkbox, and the Day/Week views still show the block.
- Change a task's priority in the side panel with *Current task list* sorting: the list in the note reorders.

## Project sections and start date
- Link a task to a new project: the note has Open / In progress / Ongoing / Done headings and the task sits under Open. Turn recurrence on for it: the line moves under Ongoing and stays there when completed; turn it off and it returns to Open. Start the timer, complete it, cancel another: each line moves under the matching heading (Canceled appears when needed). A project note without headings gets them added when a linked task changes status. After updating, every existing project note has `organized_start` set to the update date (once); notes that already had a start keep it.

## Standalone notes
- Type `[n]` in a linked todo (or press **Make standalone note** on the Task tab): pick a folder, tags and a template, and see the path preview. With a note of the same name already there, choose between a numbered new note and linking the existing one; the existing note is never changed. The note holds the description (sub-headings included), then Sources and Notes; the todo becomes one link, other copies disappear and the task note is in the trash.

## Hide done in Projects
- Projects tab: done and canceled tasks are hidden by default and a line counts them; the eye button beside the title shows them (and the Canceled section) and the choice survives a restart. With more than 50 tasks in a list, the rest sits behind **Show all N**.

## Manual time
- Day view → **+** beside Time: pick a task, set a start/end and save; a block appears and the Task tab's tracked total grows. Tap the block: change the end and save, then Delete; the total follows. Try an end before the start, 30 seconds, more than 24 hours and a future end: each shows a reason and saves nothing. A running timer's block opens the task instead of the form. The Task tab's Timer card has a folded **Sessions (N)** list: open it to see every session newest first, grouped by day with totals; tapping one edits it.

## Project colours
- Projects tab → Project colors: pick a colour for a project; its note gets `organized_color: "#rrggbb"`. A dot in it precedes the project's name on task cards, and its tasks' blocks in the Day and Week views are filled with it (gray without a coloured project). Task cards themselves are coloured by status (done and in progress green). Clear removes the property.

## Hide done tasks
- Task tab with no task selected: the eye button beside the note title hides done tasks (headings with only done tasks disappear, counts follow) and a line reports how many are hidden; the eye-off state shows them again and the choice survives a restart.

## Completed-task retention

- Verify **Keep completed tasks (days)** defaults to `0`; blank, negative, fractional and over-limit values are rejected, and `0` disables cleanup.
- Complete/cancel a non-recurring task and set a short retention period. Confirm it remains linked before expiry; opening a non-today note must not trigger cleanup.
- After expiry, open today's daily note. Confirm linked occurrences across notes lose only Organized markers, keep their checkbox state/indentation, and the canonical Markdown task note moves to Obsidian's trash.
- Confirm open/in-progress, recurring, and legacy completed/canceled records without a `closed_at` timestamp remain. Simulate a concurrently changed reference and verify the task note is preserved; retry after resolving the conflict.
- Test with Obsidian's trash enabled and disabled as relevant to the vault, and verify behavior on desktop and mobile before stable promotion.
- Type `[a]`, `[j]`, `[r]` and confirm they act; type `[d]`, `[p]`, `[i]`, `[b]`, `[f]` and confirm only an icon appears.
- Tick a recurring task in today's note; confirm the Task and Projects tabs show **done · today** and tomorrow's occurrence is open.
- Type in a description, wait about a second, switch tabs and return; the text is saved without pressing a button.
- Set **Daily-note template**, schedule a task to a date with no note, and confirm the new note has the template content with the task under its heading.
- Delete the only task of a project and confirm the project is still listed.
- In the Task tab with the cursor off any task, confirm headings appear, collapse/expand on click, and stay collapsed after reopening the inspector or restarting Obsidian.
- Forward several tasks from one heading into a new daily note and confirm there are no blank lines between them.
- Select a task from the editor, press the list button in the Task tab header, and confirm the cursor moves to its heading and the note overview appears.
- With project notes linked from outside the task folder, update and restart; confirm they move into `Tasks/Projects/`, links in other notes still work, the notice lists any skipped name conflicts, and Undo moves them back.
- Link a task to a new project with `[j]` and confirm the note is created in `Tasks/Projects/`.
- Confirm task cards show a green wash when done, accent when in progress, neutral when open, in light and dark themes.
- On Android with the system font set to large, confirm the side panel does not slide sideways, the Calendar/Task/Projects tabs are readable, and dialogs fit the screen.
- Start a task timer (set In Progress), wait over a minute, stop it, and confirm a block appears in the Calendar tab's Day and Week views; a running timer shows a block ending now.
- Open Day for a date without a daily note and confirm browsing creates nothing and **Create daily note** works; tap a block or task to open it and use **Back to calendar**.
- Check Week and Day at phone width, in dark mode and with a large system font.
- In the Day view, collapse the **Tasks** heading, switch days and restart Obsidian; confirm it stays collapsed until expanded.
- Edit the text of a linked todo in a daily note, pause for a second, and confirm the Task tab, the task note's title and the same todo in other notes show the new text.

## README screenshots

The images in `resources/screenshots/` are rendered, not captured: `scripts/render-screenshots.mjs` bundles the real inspector view and `styles.css`, loads fixture data from `scripts/screenshots/entry.ts` in headless Chromium at 2x, and writes `<scene>-light.png` and `<scene>-dark.png`. The clock is fixed to Wed 4 March 2026, 15:20, so the output does not drift. Obsidian's own chrome is approximated (default theme variables, Lucide icons from `scripts/screenshots/icons.json`, ISC licence); the content is the plugin's.

- `npm run screenshots` rewrites the images (`npm run screenshots -- day week` for some scenes). Open every changed PNG and look at it; the check below cannot see wrong content.
- `npm run check:screenshots` renders into a temp folder and fails on a script error, horizontal overflow, an empty scene or an icon without a glyph. CI runs it in the Chromium job.
- A new icon in the UI makes the check fail with its name; add its Lucide paths to `icons.json`.
- A new scene is one entry in `SCENES` (script) and one branch in `entry.ts`; add it to the README with alt text.

## Onboarding card

- The card's content is `src/onboarding.ts`; its figures are `src/onboardingFigures.ts` (real panel classes, no images); the modal is `OnboardingModal` in `src/modals.ts`.
- Automated: step stepping, keys, once-only `done`, startup rules (only after layout-ready, only at a real start, not while writes are paused) and that every class a figure uses exists in `styles.css`; Chromium and WebKit layout scenes `Onboarding1`..`Onboarding9` at 240-768 px, light/dark, LTR/RTL and 1.3x text.
- Review the steps as pictures with `node scripts/render-screenshots.mjs --all --out <folder>` (the onboarding steps are not part of the README set) and look at them in light and dark.
- Manual (not covered by the host shim): remove `onboardingSeen` from `data.json`, fully restart Obsidian, confirm the card appears once after the workspace is ready and not during an in-session plugin update, dismiss it with Skip, Esc and Get started, confirm it does not return, then run **Show onboarding card** and the Settings button. Check phone width and a large system font.
- The reverse commands (`unlinkTasks` in `src/service.ts`) are covered for one note and the vault, CRLF, unlinked and plain notes, task notes being skipped, a stale note aborting, and Undo. Manual: convert a real daily note and back, confirm no `<!--organized:` comments remain and that Undo restores them.
- The layout check also shrinks the viewport to 600 px tall for every onboarding step and fails if the card leaves the screen, hides a button or stacks the buttons; `node scripts/render-screenshots.mjs --phone --out <folder> onboarding-8` shows a step on a 390 x 640 phone with the hostile mobile button style.

