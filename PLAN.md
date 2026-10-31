# Organized Obsidian plugin — implementation plan

**Status:** implementation authorized by davadev; first beta requested. All project attribution and Git identities must use davadev only.

## 1. Goal

Build **Organized**, a mobile-compatible Obsidian plugin for Things-theme task shortcuts, Markdown-backed task records, daily-note scheduling, a sidebar calendar, and a context-sensitive task inspector. The canonical task data remains ordinary Markdown with standard YAML frontmatter; the plugin must not require a hosted service or proprietary database.

Develop in the GitHub repository [`davadev/Organized`](https://github.com/davadev/Organized), which was confirmed empty. Use feature branches and pull requests rather than committing directly to the default branch. Do not push, publish a release, or submit to the Community Plugins directory without explicit approval.

## 2. Product principles and playbook requirements

- Preserve user notes: no writes on startup, ordinary navigation, view render, or unrelated editor transactions, except the explicitly enabled unfinished-task date-flip reconciliation described below. Otherwise change notes only after a deliberate user action or a clearly recognized syntax trigger. Explicitly activating a calendar day whose daily note does not exist is a user-requested create action; create without overwriting an existing note.
- Use Obsidian APIs for vault files and frontmatter (`FileManager.processFrontMatter`); normalize user-entered paths. Use the `Editor` API for edits to the active note so selection, cursor, and undo are preserved. Use `Vault.process` for background read-modify-write operations.
- Keep startup lightweight; `onload` primarily registers features. Defer vault-dependent bootstrap until `onLayoutReady`; do not allow vault `create` handlers to process startup's existing-file events. Register such handlers after layout-ready or guard them until readiness is established, so startup cannot backfill recurrence or mutate notes. Handle failures visibly, and attach cleanup to the plugin/view lifecycle.
- Avoid Node/Electron APIs so the plugin can run on mobile. Choose and verify the minimum Obsidian version against iOS/Android availability and the API surface actually used. Guard APIs that may be absent on mobile.
- Build UI with Obsidian DOM helpers and theme variables. Namespace CSS classes; use logical properties for RTL; no `!important`, static inline styles, or brittle overrides of Obsidian internals.
- Adopt the playbook’s quality bar: Obsidian-review-parity lint with zero warnings, CSS lint, automated tests and coverage, dead-code checks, Chromium and WebKit layout tests, and explicit mobile device verification. Keep browser/layout checks out of the deterministic release workflow.
- Follow the playbook’s hardened, tag-driven release process: pinned GitHub Actions, scoped permissions, dependency policy, artifact validation/attestation, prereleases for BRAT, and stable promotion only after explicit approval.

### Playbook source for future coding sessions

The private playbook is the ongoing source of detailed implementation guidance; this plan summarizes the relevant constraints but does not replace the playbook. A future coding agent should fetch/read the relevant playbook documents when starting a phase or when a question arises, and check the current repository version rather than relying only on this summary.

- **Git remote:** `https://github.com/davadev/obsidian-plugin-playbook.git`
- **GitHub page:** <https://github.com/davadev/obsidian-plugin-playbook>
- **Authentication:** private repository; use the owner’s existing GitHub CLI/Git credentials. If access fails, report that and ask for access or excerpts—do not treat an anonymous 404 as proof the repo is missing.
- **Fetch when needed:** check `gh auth status`; clone the remote to a separate temporary/reference directory if no local copy is available, or update an existing copy with `git -C <playbook-path> pull --ff-only`. Do not copy the playbook repository into the plugin repository. Read `README.md` first for the adoption order and template map, then consult the specific source documents below before the corresponding work.
- **Templates:** follow the sequence in `templates/README.md`; adapt placeholders and verify each gate. Do not copy templates blindly or treat a template as a substitute for reading its linked guidance.

Relevant guidance already inspected for this plan: `PLUGIN-GUIDELINES.md`, `PLUGIN-LIFECYCLE.md`, `VAULT-AND-SECRETS.md`, `UI-API.md`, `EDITOR-EXTENSIONS.md`, `MOBILE-RULES.md`, `MOBILE-CANVAS.md`, `DATA-SAFETY.md`, `CSS-AND-THEMING.md`, `TESTING.md`, `REVIEW-PARITY.md`, `SUPPLY-CHAIN.md`, `RELEASE-CYCLE.md`, `SETTINGS-AND-UPGRADE-UX.md`, `AI-AGENT-WORKFLOW.md`, and `templates/README.md`. The copy inspected for the initial plan was cloned read-only; its temporary path is not a durable dependency.

Calendar reference inspected: public [`mattmaiorana/calendar-plus`](https://github.com/mattmaiorana/calendar-plus), MIT-licensed (see §4, “Calendar Plus reference and reuse notes”). Its source was cloned read-only for planning; re-fetch the current version and re-check license/attribution before reusing code.

## 3. Proposed architecture

Use a small, modular TypeScript codebase rather than putting all behavior in `main.ts`:

- **Plugin entry and lifecycle:** register commands, settings, editor extension, view factory, events, and cleanup; avoid retaining custom view instances on the plugin.
- **Settings:** keep the user-facing surface minimal and organized in a few clear groups/subpages. Required controls are task storage folder (default `.tasks`), daily-note source mode, auto-forward unfinished tasks (default **on**), per-property display selection (default none), missing-section handling (default recreate heading path; optional ask), and priority sort scope (default current task list; optional whole heading section, first task position in section, or no auto-sort). Group the latter two under Task behavior; do not add unrelated controls. Prefer following core Daily Notes settings through a supported API; do not inspect undocumented internal-plugin settings. Offer a “Use core settings / Use custom settings” choice; show the paired folder and filename-format controls only in custom mode. If no supported API can provide core values, custom mode is required and should be explained clearly. Inherit locale/week-start and other sensible defaults rather than adding controls preemptively. Put genuinely rare expert controls in an Advanced submenu only when a real need exists; avoid adding a setting for every internal behavior. Validate persisted settings on load as well as in the UI. Use Obsidian’s declarative settings only if the selected minimum app version supports them; otherwise use the compatible settings API without raising the minimum just for convenience.
- **Task model/repository:** types and validation for task records; ID generation; normalized paths; create/read/update operations; frontmatter schema and migration strategy. One Markdown file per task.
- **Reference index:** lazily build a rebuildable in-memory map from task IDs to Markdown note paths and occurrence kinds when task-reference UI is first needed; maintain it from file create/modify/delete events. Do not scan the vault at startup or on every render.
- **Task-line codec:** parse and serialize supported task syntax, task IDs, and date links in actual Markdown task-list items across notes, without disturbing indentation, checkbox text, or surrounding content. Do not trigger on task-looking text in YAML/frontmatter, fenced or indented code, blockquotes, or prose.
- **Editor extension/controller:** CodeMirror 6 extension for task-line/cursor observation and transient syntax actions. Use the lightest CM mechanism that works, restrict decoration work to visible ranges, and do not rebuild on irrelevant updates. Keep editor changes as single undoable transactions where possible.
- **Periodic-note service:** implement the v1 daily-note path behind a reusable date/period abstraction so later periodic-note types can be added. Do not assume undocumented access to another plugin’s settings.
- **Inspector view:** `OrganizedInspectorView` as an `ItemView` with three main tabs: Calendar, Task, and Projects. Use the Obsidian workspace APIs and fresh view factories.
- **Calendar component:** use Calendar Plus as the concrete design/implementation reference for month navigation, selected day, daily-note open/create, and optional note/task indicators; adapt the calendar surface without treating Calendar Plus’s periodic-note behavior as the specification for Organized.
- **Modals and controls:** date picker and priority chooser, with touch-friendly controls and keyboard accessibility.
- **Styles:** namespaced CSS based on Obsidian variables, responsive layout, RTL-safe logical properties, and mobile safe-area/bottom-toolbar clearance.

### Task record proposal

Each record is `<configured-task-folder>/<id>.md`, with a stable schema along these lines (optional fields are omitted when unused):

```yaml
---
id: <stable-id>
title: <task title>
status: open
priority: none
scheduled: null
created: <ISO date/time>
time_tracked_seconds: 0
time_tracking_started_at: null
recurring: false
recurrence_periods: []
starred: false
projects: []
movement_history: []
daily_note_section_path: []
---

<task notes and sub-notes>
```

Use `FileManager.processFrontMatter` for later metadata edits. Validate title, dates, status (`open`, `in_progress`, `completed`, `canceled`), priority (`high`, `medium`, `low`, `none`), IDs, recurrence flags/periods, favorite state, project links, movement history, section path, and hand-edited/missing frontmatter. New tasks default to `priority: none`; normalize legacy missing/null priority to `none`. Keep task content in the note body. Use standard YAML scalars and ISO dates; do not invent a database file or non-Markdown sidecar for task content.

### Stable identity in Markdown notes

**Chosen format:** append a compact standard Markdown HTML comment such as `<!--organized:<id>-->` to each managed task line. It is visible in source mode, hidden in Markdown rendering, short, and gives the plugin a durable link to the task file without a proprietary database. Create the ID on the first managed action (or explicit task creation), not by rewriting every checkbox in the vault. Provide a repair/attach-ID action for legacy lines. Preserve this comment when editing the task line.

Do not rely on matching task text, line numbers, or hashes as identity; those are ambiguous and unstable.

Recognize supported task syntax and IDs in **all Markdown notes**, not only daily notes. A copied task line with its existing ID is another occurrence of the same task; provide an explicit “Duplicate as new task” action for users who want an independent task and fresh ID. Do not silently assign a new ID to a copied line.

### New task and existing-task picker

- When the user interactively creates a fresh, unlinked `- [ ]` task item, open an Obsidian-native `SuggestModal` on both desktop and mobile. The modal owns the focused query input; filter existing task records by title as the user types and show enough context to distinguish similar matches. Keep typed text as an in-memory draft. Do not build a custom CodeMirror popup or use an unverified editor-suggest API.
- Selecting an existing task attaches its ID and replaces the new line’s text with the canonical task title. Do not create a provisional task file and later delete it if the user chooses a match.
- When there is no suitable match, offer an explicit **Create new task: “…”** row. Create a task file only after the user selects that row/confirms; then attach the new ID and canonical title. While the picker is open, its selection/confirmation keys belong to the picker, not normal list-newline behavior.
- Escape/cancel leaves the Markdown checkbox as an ordinary unlinked task and creates no task file. Empty titles cannot be committed. A file-write or stale-editor failure must not lose the user’s line; report the failure and provide a safe retry/repair path. Never delete a task file automatically to recover from a failed attach.
- Do not open a picker for tasks already carrying an Organized ID, existing notes on load, templates, or bulk-pasted task blocks. Those remain unchanged until the user explicitly invokes attach/create. The picker must not auto-create on typing pause or blur. Preserve the active editor, line, and selection while the modal is open; before applying a choice, revalidate that context and leave the line untouched if it has gone stale.

## 4. Feature behavior

### Calendar and daily notes

- The Calendar tab shows a clean month calendar, with previous/next month controls and an obvious selected/current day.
- Selecting a day opens its daily note; if absent, this explicit user action creates it at the active core/custom path using the active date format. Never overwrite an existing note. Ordinary month navigation and rendering do not create files.
- When a recognized daily note is created (by Organized or another supported Obsidian action), add enabled recurring tasks idempotently. Do not create future daily notes on the user’s behalf. Enabling recurrence also backfills already-existing current/future-dated daily notes; disabling it removes only generated future occurrences, not today’s or past lines.
- With the auto-forward setting enabled, reconcile unfinished tasks when the user opens or creates today’s daily note after a date change. Explain this default-on behavior clearly and provide an easy setting toggle. Never run a background timer or create a daily note automatically. Search only the configured daily-note folder, choose each task’s latest prior occurrence, and carry open/in-progress, non-recurring tasks into today once. Skip completed/canceled tasks, tasks already present today, recurring tasks, and tasks scheduled after today. This explicit setting authorizes the necessary note edits. If Obsidian was closed for several days, forward directly to today once rather than replaying every missed date. Afterward, show a concise result summary with an Undo action; if a note changed concurrently, skip that task and report it rather than overwriting.
- Make month navigation, day selection, and note creation work with mouse, keyboard, and touch. On mobile, favor a usable narrow pane over a dense desktop grid; the other sidebar functions remain available in their own tabs.
- Avoid full-vault scans in startup or render loops. Derive task indicators from targeted daily-note reads/events and cache only rebuildable view data.

#### Calendar Plus reference and reuse notes

Reference repository: [mattmaiorana/calendar-plus](https://github.com/mattmaiorana/calendar-plus). It was cloned and inspected for planning. The inspected HEAD was `48f852a2f7208bfb889c844d40a59b0ab8617cc3` (2026-07-12, release 2.1.13); re-check the repository’s current default branch and license before implementation.

- **License:** the repository has an MIT `LICENSE`, with copyright notices for Liam Cain (original Calendar plugin) and Matt Maiorana (Calendar Plus fork/modifications). MIT permits reuse, modification, distribution, and sublicensing provided the copyright and permission notice remain with copies or substantial portions. If Organized copies/adapts Calendar Plus source, preserve the full applicable notice and include third-party attribution/license information in Organized’s distribution (for example, a `THIRD_PARTY_NOTICES.md` and README attribution). Review the exact files and their history before copying; do not assume every dependency has the same license.
- **Recommended use:** base the calendar UI/interaction design on Calendar Plus and selectively adapt its month-grid components and date/navigation behavior. Do not install Calendar Plus as a runtime dependency or copy its whole plugin; Organized owns its own `ItemView`, settings, task indicators, and periodic-note behavior. Keep v1 focused on daily notes while leaving a clean extension point for later periods.
- **Useful patterns/features to evaluate:** day-cell grid with adjacent-month days, current/selected-day states, previous/next month controls, configurable week start and locale, optional weekend shading, touch-oriented day selection, and a Today action. Calendar Plus also demonstrates note-existence dots, optional open-task/word-count indicators, year navigation, and independently configured periodic notes; only adopt the pieces that serve Organized’s v1 and do not introduce expensive vault scans. Its day cells use clickable `div` elements, so implement and test keyboard semantics/accessibility explicitly rather than assuming the reference provides them.
- **Periodic-note behavior:** Calendar Plus owns its own periodic-note settings; its explicit day-selection create behavior is a useful precedent for Organized. Organized v1 should follow core Daily Notes settings only through a supported API, while allowing users to choose the paired Organized folder/format override. Do not reach into undocumented internal-plugin settings; if no supported API is available, require custom mode and explain why. Refresh current values before file operations, normalize paths, create parent folders safely, check for existing files, and guard concurrent creation. Templates and a confirmation-before-create option are possible follow-ups, not required v1 scope. The owner intends Organized to support periodic notes in a later phase, with behavior that will differ from Calendar Plus; do not assume Calendar Plus’s five periods, templates, create/open rules, or UI are the desired specification.
- **View lifecycle:** Calendar Plus uses a registered `ItemView`, mounts a Svelte calendar component, syncs active-file selection, and tears down the component on close. These are useful integration cues, but follow the playbook’s API/lifecycle guidance: use `this.app` (not global `window.app`), do not retain view instances on the plugin, keep constructors and startup light, avoid auto-opening a pane unless explicitly chosen, and unregister subscriptions/callbacks/timers on close/unload.
- **Technology choice:** Calendar Plus uses Svelte 5 with Rollup and Moment. Decide during scaffold whether to adapt the Svelte calendar UI or implement a smaller native Obsidian DOM/TypeScript calendar. If using Svelte or other packages, verify mobile compatibility, bundle/runtime behavior, package licenses, exact dependency pins, and the playbook’s supply-chain constraints. Do not copy its global `window.app` access or other patterns that conflict with Organized’s playbook requirements.

### Things-style syntax triggers

**Reference theme:** [Things 2 theme by colineckert](https://github.com/colineckert/obsidian-things). Its README documents the checkbox types below as visual task markers. Organized will preserve the theme’s syntax and add the behaviors specified here. The owner also wants the relevant Things-style checkbox/task icons bundled with Organized so they render when the Things theme is not installed; the theme itself must not be a runtime dependency. Re-check the current README, `LICENSE`, and checkbox styling before implementation.

#### Bundled Things-style icons and licensing

- The Things theme repository contains an MIT `LICENSE` (`Copyright (c) 2020-2021 Stephan Ango (@kepano)`). The README credits Minimal as a source for V1, and the checkbox CSS block explicitly credits Minimal for checkbox styling. The inspected CSS defines several checkbox glyphs with inline SVG data URIs/masks. MIT generally allows copying, modification, and redistribution of those assets if required copyright and permission notices are retained.
- Before copying any SVG/path or CSS-derived icon, verify its provenance and license at the exact source. Preserve applicable MIT notices (including Things/Minimal or any upstream icon project as required), and add a `THIRD_PARTY_NOTICES.md`/README attribution in Organized. Do not assume all icon artwork in the theme has identical licensing solely from the repository-level file.
- Bundle the Things-style checkbox glyphs for **all markers documented by the theme** as local SVGs or equivalent CSS assets; do not copy the whole theme stylesheet or rely on theme selectors/classes. Render them through Organized-owned editor decorations and Reading view styling/post-processing so task icons still appear when Things is not installed. Scope styling to these markers, use Organized’s own classes and Obsidian theme variables, and verify light/dark themes and mobile.
- Prefer accessible icon markup (decorative icons hidden from assistive technology when a text label exists; otherwise provide an accessible name). Keep syntax interpretation and icon rendering separate: extra Things markers marked “To be planned” receive their visual glyphs but no automation, metadata changes, or marker cleanup until their behavior is planned.
- If the exact desired artwork’s license/provenance cannot be established, do not bundle that artwork; ask the owner whether to use an original redraw or a clearly licensed Obsidian/Lucide alternative.

Support task lines of the form `- [marker] text` and retain the existing task text and indentation. Triggers should be recognized only for user-originated changes, debounced/guarded against duplicate execution, and applied through a predictable transaction/action flow. Handle cancellation and errors without losing the line. Never let an asynchronous modal act on a stale editor position; re-resolve the task by ID before applying the result.

#### Decided v1 behavior

These behaviors were specified by the owner and are in scope; do not downgrade them to optional suggestions:

- **`[<]` scheduling:** open a date picker. On confirmation, create or target that date’s daily note, copy/link the task into it, and store the scheduled date in the linked task record. Keep the origin line marked `[<]`; the destination occurrence uses a normal open `[ ]` marker. Do not write generated date text or a date link into daily-note source. In Reading view and Live Preview, render the scheduled date as a muted, clickable projection that opens that date’s daily note. Keep all occurrences linked to the same task ID; repeated triggers must not create duplicate copies. If rescheduled, search Markdown notes by task ID only as part of this explicit action. Proceed with the new schedule and update metadata; remove the old destination only if it is uniquely identified. If missing or ambiguous, preserve existing lines and notify the user with a repair option rather than guessing or blocking the new schedule.
- **`[>]` forwarding:** copy/forward the task to tomorrow’s daily note, set its scheduled-date metadata to tomorrow, and gray out the current/origin line while retaining `[>]` as its forwarded state. The destination occurrence uses a normal open `[ ]` marker (or `[/]` if forwarding an actively timed task) and remains linked to the same task ID. The scheduled-date projection then shows tomorrow and opens that daily note when clicked. Do not clean the origin marker after forwarding. Record the forward in task `movement_history`.
- **`[/]` in progress:** set task status to `in_progress` and persist a UTC `time_tracking_started_at` timestamp in that task’s YAML. Stop and accumulate elapsed wall-clock duration when the marker changes to `[x]` or is cleared; on stop, clear the start timestamp and set status to `completed` (`[x]`) or `open` (cleared marker).
- **`[!]` important/priority:** open a chooser with four values—High, Medium, Low, and None—save the selected value to task YAML, sort according to the configured priority-sort scope, and clean the marker back to `- [ ]`. None is the default for new tasks and clears an existing priority. Never move a task across its current heading path. The default is to reorder only sibling task lines in the same contiguous list.
- **`[i]` information, `[I]` idea, `[?]` blocker/question:** open the corresponding module/section in the side-panel inspector for the current task, then clean the marker back to `- [ ]`.
- **`[x]` done and `[ ]` open:** retain normal checkbox semantics. `[x]` also stops/logs an active timer. Clearing the active `[/]` marker also stops/logs the timer. Timer stop/log operations must be idempotent.
- **`[-]` canceled:** for an ordinary task, set task status to `canceled`, remove it from active-task views, and retain it in a reversible canceled view; do not delete the task file. For a recurring task, cancel only this date’s occurrence; leave the task record open and recurrence enabled so it appears on later dates. To stop future copies, use `[f]` to disable recurrence.
- **`[*]` star:** toggle a persistent starred flag; starred tasks appear in a Favorites list in the inspector.
- **`["]` source:** open a source-reference editor for the task. Support multiple external URLs and Obsidian links, with optional short labels/citations; store them in the task Markdown and expose them in the inspector.
- **`[b]` project/topic:** open a multi-select project-note picker. Link the task to one or more project/topic notes; create a selected note in the vault root if absent and add a linked task occurrence there. Project-note occurrences use the same task ID and are idempotent, display the task’s current status, and act as live task controls: a status change there updates the task record and follows the non-recurring/recurring propagation rules below. Removing a project link removes its unique matching project-note occurrence; if missing or ambiguous, preserve content and report the conflict.
- **`[f]` recurring:** typing `[f]` automatically toggles the task’s persistent recurring setting and clears the typed marker after success; the inspector shows the resulting toggle. On enable, add this same task (same ID and task note) to already-existing current/future daily notes and to each recognized daily note created later; do not create notes. Generated daily occurrences append `<!--organized:repeat-->` after the standard task-ID comment so Organized can identify them safely. On disable, remove only those generated occurrences from future-dated daily notes, preserving today and past occurrences. Each date’s checkbox state is independent: completing today does not complete, remove, or otherwise change another date’s occurrence. A recurring task remains `open` at the task-record level; completing an occurrence stops/accumulates any active task timer but does not mark the shared task record completed or alter other dates. Record each on/off interval in `recurrence_periods` with local start/stop dates. Shared task notes/properties remain canonical in the one task file. Recurring and auto-forwarded daily occurrences preserve their source heading path. Backfill/removal is idempotent; summarize affected-note count and offer Undo, preserving/reporting concurrent edits instead of overwriting.
- **`[k]` secret marker:** visual-only in v1; preserve and render the Things-style glyph but do not create secret references or attach metadata. Although Obsidian exposes secure storage and retrieval, its names are per-device and cannot safely be stored in synced task Markdown; a cross-device mapping/use model has not been designed. Revisit only as a separately planned feature with a tested device-local mapping, explicit retrieval/use UX, migration, and no plaintext fallback.
- **Automatic unfinished-task forwarding:** when the setting is on, the date-flip reconciliation in §4 carries open/in-progress tasks into today once and updates scheduled-date metadata to today. Mark the latest source occurrence `[>]` and add today’s occurrence with the same task ID; for an actively timed task, preserve `[/]` and its original start timestamp on today’s line without stopping/restarting the timer. Preserve the source heading path; if missing in the destination note, apply the missing-section setting. Record each event in `movement_history`; retries must be idempotent.

`movement_history` is a structured YAML list in the task file, not a prose/session log. Record each manual/automatic forward and each schedule/reschedule as an event with kind, source (`manual`/`automatic`), from/to dates (and source note where no date exists), and a UTC event timestamp. Keep reschedules distinct from forwards so procrastination counts can distinguish them; compute counts from the event list rather than maintaining a second counter. Initial scheduling may be recorded as a `schedule` event. Event identity must make retries idempotent.

For section placement, store the source occurrence’s heading path (heading level, exact text, and duplicate-sibling ordinal) in `daily_note_section_path`, refreshing it when the task is intentionally moved to another section. Recurrence and auto-forward use the latest source occurrence’s path. If it is missing from the target note, the default setting recreates the required ancestor/subheading structure at the end of the note; the optional ask mode prompts instead. A task with no source heading path is inserted in the top-level task area. `[!]` sorting is constrained by its configurable scope and never reorders heading/prose text or moves tasks across their heading path.

Task records retain metadata and note text; daily-note task lines are linked user-facing occurrences. A task record stores one optional `time_tracking_started_at` timestamp and cumulative `time_tracked_seconds`. While the timestamp exists, calculate elapsed time as cumulative seconds plus the wall-clock difference from the start timestamp. No background process or periodic writes are needed: when Obsidian is closed, the timestamp stays in the Markdown file, and the next launch calculates the elapsed interval from it. On stop, add the interval once to the cumulative value and clear the start timestamp. This keeps repeated start/stop sessions compact instead of appending a log entry per session. Store timestamps in an unambiguous UTC ISO format and handle invalid/future timestamps safely. Multiple task files may each have an active timestamp concurrently; starting one task does not silently stop another. Re-entering `[/]` on an already-active task must not reset its timestamp. Implement the task-block sort narrowly so it never reorders headings, prose, or unrelated lines.

#### Other Things theme checkbox types — selected behavior and deferred scope

The Things theme README labels identify the glyphs, not necessarily the plugin behavior. Organized v1 behavior is explicit below; deferred markers remain visual-only and must not gain inferred automation.

| Things syntax | Theme README label | Organized v1 behavior |
|---|---|---|
| `[-]` | canceled | Ordinary task: reversible canceled status/view. Recurring task: cancel only this date’s occurrence; `[f]` controls future copies. |
| `[*]` | star | Persistent favorite flag and Favorites view |
| `["]` | quote | Add multiple external/Obsidian source references, optionally with labels/citations |
| `[l]` | location | To be planned |
| `[b]` | bookmark | Link task to one or more project/topic notes; create a missing selected note and add a linked task occurrence |
| `[S]` | savings | To be planned |
| `[p]` | pros | To be planned |
| `[c]` | cons | To be planned |
| `[f]` | fire | Toggle recurring task inclusion in existing and newly created future daily notes; do not auto-create notes |
| `[k]` | key | Visual-only in v1; no secret reference until a safe per-device mapping and useful retrieval flow are designed |
| `[w]` | win | To be planned |
| `[u]` | up | To be planned |
| `[d]` | down | To be planned |
| `[D]` | draft pull request | To be planned |
| `[P]` | open pull request | To be planned |
| `[M]` | merged pull request | To be planned |

### Marker lifecycle

The marker lifecycle is deliberate and not uniform:

| Marker(s) | Lifecycle | Result |
|---|---|---|
| `[!]`, `[i]`, `[I]`, `[?]` | One-shot command; clear only after successful completion | Return the line to `- [ ]`; cancellation/failure must leave the marker available for retry. |
| `["]`, `[b]` | One-shot editor/picker action | Clear only after successful save/link; cancellation/failure leaves the marker available. |
| `[<]` | Persistent scheduled state | Keep the origin marker; destination uses `[ ]`; scheduled date is task metadata rendered as a projection, not written into source. |
| `[>]` | Persistent forwarded state | Keep the origin marker and its forwarded/gray appearance; set scheduled date to tomorrow; destination uses `[ ]` and shares the task ID. |
| `[/]` | Persistent in-progress state | Keep while `time_tracking_started_at` is active; stop on completion or clearing, then update task status and accumulated time. |
| `[-]`, `[*]` | Persistent task/occurrence state | Keep canceled marker on the affected ordinary task or recurring occurrence; canceled ordinary tasks are restorable, and favorites can be toggled from the inspector. |
| `[f]` | One-shot toggle command | Toggle persistent `recurring` metadata, then clear `[f]`; show the persistent setting as an inspector toggle. |
| `[ ]`, `[x]` | Normal checkbox states | Preserve ordinary open/completed semantics. |
| `[k]`, `[l]`, `[S]`, `[p]`, `[c]`, `[w]`, `[u]`, `[d]`, `[D]`, `[P]`, `[M]` | Unmanaged in v1 | Preserve as authored; render glyphs only; no automation, metadata changes, or cleanup. |

The task record is the source of truth for managed metadata; daily-note lines are user-facing occurrences/references. Source retains the task text and compact task-ID comment. Generated properties, including scheduled date, appear only in Reading view and Live Preview.

### Task property display and source/render separation

- The linked task Markdown file is the canonical place to edit task metadata and notes, using the side-panel inspector. In any note, the task line stays concise and contains its task-ID comment; do not copy task metadata or note-body text into that note’s source. Project-note task occurrences are intentionally generated Markdown task lines; they are not generated property projections.
- In rendered Markdown in **any note**, display selected linked-task properties as a read-only projection of the task record. This must not write generated property text into note source. Users choose which available properties to show; default selection is **none** to keep notes uncluttered. Scheduled date is the exception to the user selection default: because it is the visible counterpart to persistent `[<]`, show it as a muted clickable date by default for scheduled tasks; clicking opens the corresponding daily note.
- Support the task’s defined frontmatter properties (such as status, priority, scheduled date, created date, accumulated time, and forward/reschedule history) and its Markdown notes/body as displayable choices. Keep the display-property list tied to the task schema so newly added properties can be deliberately exposed rather than silently appearing.
- Star state, project-note links, and source references belong to the linked task record and may be selected for rendered display. There are no secret references in v1. Recurring daily occurrences reuse the same task ID and task file; a compact hidden occurrence-kind comment distinguishes generated recurring lines for safe backfill/removal.
- Render in both Reading view and Live Preview for all supported Markdown notes. Use the appropriate Obsidian markdown post-processing and CodeMirror rendering/decorations for each surface; source mode should continue to show only the authored task line and ID (plus the recurrence comment on generated recurring occurrences), never injected properties/notes. Async loading must resolve by stable task ID, avoid stale-line updates, and must not convert generated display content into a user edit/save.
- Placement is automatic to keep settings small: short scalar properties (for example, priority and scheduled date) appear in a muted compact row beside/after the task; long/rich properties, especially the notes body, render fully below it. Do not truncate an enabled property based on length. Render task notes as Markdown with Obsidian’s supported renderer and lifecycle component; editing remains in the inspector only.
- A task that occurs in multiple notes uses the same linked task record, so enabled properties stay consistent at every occurrence. Cache only safely invalidatable display data; refresh when the task record, display settings, or active note changes. Handle missing task files gracefully without writing or fabricating content.
- Treat dated daily-note lines as task occurrences with history, not as a live mirror of every current task state. For ordinary non-recurring tasks, when the task is completed, canceled/restored, or its in-progress state is cleared, update matching occurrences dated today or later; leave earlier dated notes unchanged. For recurring tasks, each date’s checkbox state is independent: completion or cancellation affects only that date and never propagates to another date or turns recurrence off. Project-note task occurrences instead reflect the task’s current status (recurring tasks remain open at task-record level). Use the vault/device’s local calendar date for the ordinary-task history boundary. Perform reconciliation only after a user action or daily-note creation event, never during startup/render; update only task-ID matches and preserve unrelated text.
- Apply that same today/future propagation rule when status is changed through the inspector, not only when a checkbox marker is edited in a daily note.
- An occurrence in a non-daily note has no date/history semantics and mirrors the task’s current status. Task status changes update those undated occurrences along with today/future daily-note occurrences; past dated daily notes remain historical. Recognize a note as a daily note only when its path/date resolves under the active Daily Notes configuration; otherwise treat its task lines as undated.
- `[>]` in a non-daily note still creates/targets tomorrow’s daily-note occurrence and updates scheduled-date metadata, but returns the source line to `[ ]` so project/reference tasks remain active. The persistent gray `[>]` origin state is reserved for a daily-note occurrence.
- `[<]` can be used from any Markdown note: it schedules the linked task into the selected daily note and keeps `[<]` on the source occurrence; its scheduled date remains a rendered projection, not source text. Other task-wide actions operate on the same linked task record regardless of the note containing the occurrence. Recurrence generation/backfill is limited to recognized daily notes, and project linking is limited to the explicitly selected project/topic notes.
- When the task title is edited in the inspector, update the visible title text in every linked occurrence, including past notes, while preserving each line’s date, marker/history policy, ID comment, indentation, and surrounding content. If a matching line is ambiguous or cannot be safely parsed, leave it untouched and report it for repair rather than guessing.
- Removing an occurrence never deletes the linked task file. If the removed line is in progress, ask whether to stop and accumulate the timer or keep it running in the task record; do not infer timer state from line deletion. If the task file itself is missing, show a repair/relink path rather than silently creating a replacement task with a new ID.

### Tabbed inspector

- The sidebar has three main tabs, in this order: **Calendar**, **Task**, and **Projects**. Calendar is the initial/default tab; changing tabs does not change editor cursor or selected day.
- **Calendar tab:** show the month calendar and its navigation/day-selection controls. Put lightweight general stats (active tasks, completed today, active timers) in a compact footer below the calendar; keep the counting scope bounded and show loading/unavailable states rather than blocking the view.
- **Task tab:** show details for the task at the current editor cursor, including title/status, scheduled date, priority, timer controls/elapsed time, recurring toggle, project links, source references, forward/reschedule history, and relevant note controls. Follow cursor/task-context changes without automatically switching tabs. If no task is selected, show a concise empty state.
- **Task references:** show a References section in Task details. Prioritize a link to today’s daily note if it contains the task, then list other Markdown notes that reference its task ID. For a recurring task, suppress all other dated daily-note links, whether generated or manually added; show today’s daily note if it contains the task, a recurrence summary (first start date and, if currently stopped, most recent stop date), and links to non-daily references such as project or ordinary notes. For non-recurring tasks, show all known note references, grouped by daily/project/other note where useful.
- Build the reference index on demand with a loading state; update it from note-change events and refresh affected results. The index is rebuildable and not a second source of truth. Re-resolve paths before navigation and handle renamed/deleted notes without stale links.
- **Projects tab:** one browse view with Favorites and a project selector/list. Sort tasks by priority in both Favorites and each project: High, Medium, Low, then None; preserve existing order among equal-priority tasks. This is display-only and does not rewrite project-note source or depend on the `[!]` editor sort-scope setting. Selecting a favorite or a task under a project opens the Task tab for that selected task, even if the editor cursor is elsewhere. That browse selection remains until the editor cursor moves to a different task context; cursor changes update Task-tab content but do not steal tab focus.
- Make the selected task’s origin clear (editor cursor vs Projects/Favorites selection) and provide a route back to its project/favorite list. Re-render only affected content when the editor, cursor, task record, selected project, or timer state changes. Do not rebuild a focused input on every keystroke.

## 5. Mobile and accessibility

- No Node/Electron imports or desktop-only dependencies. `isDesktopOnly` remains false only after dependency and bundle review confirms that.
- Test responsive/narrow pane behavior, vertical scrolling, touch targets, keyboard avoidance, and the app’s mobile bottom toolbar/safe areas. Use `dvh` where viewport-height popups are needed; clamp menus/popovers to the available viewport.
- Keep the native Obsidian editor as the editing surface; do not embed a replacement editor. Use normal workspace panes and Obsidian’s mobile keyboard bridge.
- Use the same Obsidian-native `SuggestModal` task picker on desktop and mobile. Let the modal own the search input/keyboard focus; keep the result list scrollable with touch-sized rows, avoid rebuilding the focused input per keystroke, and preserve/revalidate the editor context before applying a choice. Verify the actual keyboard and modal behavior on a real iOS/Android device.
- Ensure timer/date/priority controls are keyboard-accessible, have labels, and do not depend on color alone. Verify light/dark themes and RTL layout.
- Run desktop mobile emulation, Chromium and WebKit layout checks, then manually exercise a real iOS and/or Android device before promoting a prerelease to stable. Emulation is not a substitute for a real device.

## 6. Data safety, synchronization, and lifecycle

- Never bulk-convert existing task lines or rewrite notes during load. Only touch a line after a user-triggered action; preserve unrelated content byte-for-byte where practical.
- Use atomic/serialized read-modify-write flows where supported, with the playbook’s mobile-safe fallback for adapter operations. Do not assume `.tmp` or rename support. Use vault APIs rather than direct adapter operations unless a documented need requires otherwise.
- Handle sync conflicts by making task-file updates idempotent. Do not delete task files automatically when lines are removed; orphan cleanup should be a separate, previewed user action, if included at all.
- Add the playbook crash-loop guard before feature startup, using its small plugin-local state file (not `data.json` or `localStorage`); it must fail open and must never prevent plugin load. Snapshot plugin `data.json` before a new-version migration, keep versioned backups outside the vault with retention that preserves the newest stable-written backup, and detect downgrades. If a newer version’s data cannot safely be read, stop writes and offer restore from a compatible backup; never silently overwrite newer data. Backups, guard files, and restore failures must not write into vault notes or block startup.
- Keep settings/data migrations forward-only, idempotent, and non-destructive: validate unknown/newer shapes before writes, preserve fields the current version does not understand where possible, and do not recalculate stored values from lossy data during sync merges. Each migration requires fixtures for prior shapes and tests for repeat runs, malformed data, and downgrade/restore behavior.
- Occurrence propagation and schedule moves are explicit user-triggered multi-file edits. Resolve targets by stable task ID and daily-note date; serialize writes, preserve unrelated lines, and never silently overwrite a concurrent change. If a target line is missing, duplicated, or changed since it was read, avoid destructive cleanup and report/retry safely. A task-ID search across Markdown files is allowed only for an explicit operation such as a reschedule/title update, never during startup or rendering; require an unambiguous match before moving/deleting an occurrence.
- Decide whether duplicate task IDs discovered in hand-edited/synced files are reported and repaired interactively; never silently merge or overwrite them.
- Timer start timestamp and accumulated duration live in the task Markdown file so the timer survives plugin/Obsidian shutdown and is visible on the next launch. Do not run a background timer. Reads/rendering calculate elapsed time from the stored timestamp; stop/completion/clear writes the accumulated duration and removes the start timestamp. Serialize writes and make stop idempotent; document and test same-task sync/concurrent-edit conflicts.
- No network calls, telemetry, ads, auto-updater, or external services in v1.
- Register/unregister events, intervals, editor extensions, and view resources through Obsidian lifecycle helpers. No hidden timers or listeners after unload.

## 7. Repository setup and delivery

Once implementation is approved, first inspect the empty GitHub repository and clone it locally; work on a named feature branch. Apply the playbook templates in their documented order, adapted to this plugin. Expected baseline includes:

- Obsidian plugin source, manifest, styles, README, LICENSE, versions file, TypeScript/build config, and lockfile.
- CI, release guard, review-parity lint, CSS lint, coverage/dead-code checks, supply-chain controls, and tag-driven release workflow.
- A small `AGENTS.md` index and only the applicable repo-local skills/docs/hooks from the playbook templates. Add a standalone release manual so future sessions do not need the private playbook.
- Dedicated development vault, not the owner’s main vault.
- No generated release or plugin code committed/pushed until “go”; no GitHub release or stable promotion until separately requested.

### Proposed tooling and compatibility baseline (from the playbook)

Use the playbook template versions as the starting baseline, not a grab-bag of newer packages. Before implementation, confirm these exact template entries still install together under the supported Node/npm versions; any change must be justified by a compatibility or support issue and recorded with the lockfile.

| Package/tool | Playbook baseline | Compatibility / pin policy |
|---|---:|---|
| Node.js | 24 | Use Node 24 locally and in CI/release workflows. The playbook’s npm controls require npm >=11.10; use a Node 24 distribution that supplies that npm version and verify the actual version in CI. |
| npm | >=11.10 | Needed for `min-release-age` and install-script denial. Keep the lockfile committed; use `npm ci` in CI. |
| `obsidian` | `^1.13.0` | Type/API development dependency. Its peer dependencies determine the exact CodeMirror versions below. Select and test the minimum supported Obsidian app version separately against APIs actually used. |
| `@codemirror/state` | `6.5.0` | Exact pin to the version declared by the selected `obsidian` package’s peer dependencies; update only with that Obsidian package and verify `npm ls --all`. |
| `@codemirror/view` | `6.38.6` | Exact pin to the version declared by the selected `obsidian` package’s peer dependencies; update only with that Obsidian package and verify `npm ls --all`. |
| TypeScript | `^5.4.5` | Must remain within `typescript-eslint`’s declared supported TypeScript range; resolve and lock a compatible version. |
| ESLint | `^10.11.0` | Use the playbook’s current ESLint line, together with its flat-config template. Do not independently change the major without checking plugin compatibility and template parity. |
| `typescript-eslint` | `^8.71.0` | Its declared peer range supports ESLint `^8.57 || ^9 || ^10` and TypeScript `>=4.8.4 <6.1.0`; therefore the template ESLint 10 and TypeScript 5.x choices are compatible. |
| `eslint-plugin-obsidianmd` | `^0.4.2` | Use with the playbook’s Obsidian lint config; verify its peer dependencies and confirm the plugin loads and reports rules after any lint-tool upgrade. |
| Vitest | `5.0.2` | Exact template baseline. Requires Node `^22.12 || ^24 || >=26`; Node 24 satisfies this and the playbook npm controls. |
| `@vitest/coverage-v8` | `5.0.2` | Must exactly match Vitest (`5.0.2`); update both together. |
| `happy-dom` | `20.14.5` | Playbook test DOM baseline; behavior tests only, never layout/geometry assertions. |
| esbuild | `0.28.2` | Exact pin: its output is shipped in `main.js`. Keep it compatible with Vite/Vitest’s peer tree, inspect `npm ls --all`, and move it only in a reviewed tooling update. |
| Stylelint | `17.15.0` | Exact playbook baseline. |
| `stylelint-no-unsupported-browser-features` | `8.1.2` | Compatible with Stylelint `>=16.0.2`; use with the playbook CSS lint config. |
| Knip | `^6.38.0` | Playbook dead-code/dependency gate. |
| `@types/node` | `^24` | Match the Node 24 CI/runtime toolchain. |
| `tslib` | `^2.6.2` | Playbook template entry; retain only if required by the chosen TypeScript output/config. |

**Pinning and update policy:** preserve the playbook template’s ranges for ordinary development-only tools, with `package-lock.json` as the resolved-version record and Dependabot cooldowns (14 days; 30 for npm major updates). Exact-pin packages whose versions affect shipped output and coupled packages: at minimum esbuild, CodeMirror peers, and Vitest/coverage-v8 as a matching pair. Add npm `overrides` for any other editor/parser package bundled into `main.js`; do not override direct dependencies. After dependency changes, run `npm ci`, `npm ls --all`, the full test/lint/build/release checks, and compare the production bundle hash. Deny package install scripts via `allowScripts`; retain the playbook `.npmrc` minimum-release-age policy. CI/release Node version and npm version must be asserted, not assumed.

This is a proposed baseline, not a promise that each patch number will remain current indefinitely. On implementation, use the playbook’s then-current template and verify the declared peer ranges locally; do not “upgrade to latest” without a specific need and compatibility review.

Potential manifest decision: the display name “Organized” and ID `organized` need to be checked for uniqueness and all current Obsidian manifest constraints before finalizing. Keep the plugin ID lowercase/hyphen-only, avoid the word `plugin`, and choose an accurate minimum app version based on tested APIs/mobile installs.

## 8. Test and acceptance plan

### Unit and integration tests

- Task-line parser/serializer: supported markers in daily/project/ordinary notes, indentation, titles, comments/ID, date links, malformed lines, round trips, copied IDs, and no accidental prose matches; ignore YAML, code blocks, blockquotes, and task-like prose.
- Task picker: only a fresh interactively created unlinked checkbox opens it; incremental matching, canonical-title replacement on reuse, explicit create confirmation, Escape/cancel leaves no ID/file, paste/template/load do not trigger it, and stale editor/write failures preserve user text.
- Task repository: create/read/update, path normalization, frontmatter preservation, invalid/legacy records, duplicate IDs, write failures, and mobile fallback behavior.
- Startup/data safety: simulated create events for pre-existing files cannot generate recurring lines; no vault writes occur before layout-ready; crash-guard threshold/reset/corrupt-state/fail-open cases; plugin-data snapshot retention and downgrade restore; migration fixtures for every prior schema, idempotence, malformed/newer data, and preservation of unknown fields.
- Trigger state machine: one invocation per user action, modal cancellation, stale editor context, duplicate event prevention, safe failure, and repeatable scheduling/forwarding.
- Multi-note occurrence handling: matching by ID/date; completion/clear updates only today/future occurrences; past occurrence markers remain historical; task-title edits update all occurrences; repeated scheduling is idempotent; rescheduling searches by ID only on explicit action and moves exactly one old destination; safely handles changed daily-note settings, missing/duplicate/edited lines, and ambiguity; deleting an in-progress line prompts stop-vs-keep-running; concurrent edits and write failures never remove unrelated content.
- Timer logic: timestamp persistence, live elapsed calculation without background work, repeated start/stop accumulation, completion/clear, duplicate starts/stops, interrupted-app restart, invalid/clock-skew timestamps, and idempotence.
- Auto-forward/history: default-on setting; date-flip reconciliation on today-note open/create; no note auto-creation; open/in-progress only; recurring/future-scheduled/already-present exclusions; missed-day catch-up to today once; origin/destination marker behavior; timer continuity; manual/automatic forward and schedule/reschedule event history; retry idempotence and sync conflicts.
- Inspector tabs and selection: tab switching/default, task line vs non-task, editor switch, cursor changes without tab auto-switch, project/favorite selection opening Task tab, cursor context superseding browse selection, missing records, record updates, recurring toggle, favorites, and canceled-task restore.
- Projects/Favorites ordering: High/Medium/Low/None priority order, stable ties, project grouping, and display-only sorting that never rewrites note source.
- Reference index/details: lazy first build/loading state, file create/modify/delete/rename invalidation, today-note prioritization, recurring daily occurrence suppression, recurrence start/stop summary across multiple on/off periods, non-daily/project references, and stale/missing-link handling.
- Property projection: default none; each enabled field appears only in Reading view/Live Preview across daily, project, and ordinary notes, in the correct automatic placement; long/rich property bodies render fully; no generated content is written to or saved into note source; changing task metadata refreshes linked occurrences.
- New task actions: cancellation/restore (including canceling only one recurring occurrence), favorite toggle/list, source-link add/open, multi-project linking and safe note creation, recurring-task enable/backfill/generation/disable cleanup with per-date completion isolation; verify `[k]` is visual-only and never writes secret names or values.
- Calendar date/path behavior: month boundaries, leap days, date formatting, existing daily note, and creation without overwrite.
- Heading-context behavior: capture nested heading paths including duplicate-heading ordinals; recurrence and auto-forward preserve placement; missing-path recreate/ask modes; `[!]` sorting obeys each scope and never crosses the source heading path or reorders prose/headings.
- Settings coverage: small grouped settings surface; every user-editable setting exposed and used; core-derived settings refresh correctly; custom overrides appear only when enabled; property selection defaults to none; auto-forward defaults on; heading recovery defaults to recreate; priority sorting defaults to current contiguous task list; no unnecessary controls or duplicated settings.
- Run behavior tests for `main.ts` and views using a centralized Obsidian stub; happy-dom for DOM behavior, not layout geometry.
- Target the playbook’s 100% statement/branch/function/line coverage across source. If staged, establish an honest ratchet and raise it without exclusions or ignored branches.

### UI and platform gates

- Build/typecheck, ESLint with zero errors/warnings, CSS stylelint, dead-code check, release guard, dependency tree validation, and supply-chain checks.
- Real stylesheet layout checks in Chromium and WebKit at desktop and narrow/mobile widths; test wrapping and no horizontal overflow. Inspect rendered screenshots rather than trusting metrics alone.
- Inspect Reading view and Live Preview with Things disabled, including full task-note Markdown rendering, and verify source mode remains concise and unchanged by generated projections.
- Dedicated dev vault cold-start/load/unload test; test plugin enable/disable and restored view behavior.
- Mobile emulation plus real-device test for all three tabs, calendar, project/favorite browsing, task triggers, modal/popup positioning, timer controls, note writes, and keyboard behavior.
- No release until all applicable gates pass and documented limitations are reviewed.

## 9. Phased build sequence (after “go”)

1. **Repository and safety foundation:** branch, scaffold, manifest/settings schema, crash guard, backup/downgrade strategy, migrations, lifecycle handling, test harness, CI/tooling, and basic docs. Gate: clean mobile/desktop load-unload, no startup vault writes, and recovery/migration tests pass.
2. **Markdown task core:** task schema/validation, path handling, task-line codec, frontmatter repository, safe serialized writes, stable IDs, and migration fixtures. Gate: round trips and malformed/legacy inputs are tested; unrelated note text remains untouched; no feature-specific multi-note automation yet.
3. **Central task-creation loop and calendar shell:** picker on desktop/mobile, explicit create/reuse/cancel behavior, task inspector basics, and calendar open/create for daily notes. Gate: real-device picker and editor-context tests pass; task files are created only on explicit confirmation; daily-note creation never overwrites.
4. **Single-task actions:** status, priority, title editing, source references, timer persistence, and ordinary schedule/manual-forward actions. Add one operation at a time with idempotence, conflict handling, and undo/recovery tests before combining them. Gate: task identity and status/timer semantics hold across editor and inspector actions.
5. **Projects and reference browsing:** project links/occurrences, Favorites, lazy reference index, and the three-tab inspector. Gate: indexing is rebuildable and lazy; project writes/removals are safe; selection and cursor behavior work on desktop and mobile.
6. **Recurring-task engine:** per-date occurrence state, generation/backfill/removal, section-path preservation, summaries/undo, and startup-event guards. Gate: generated-only cleanup is proven; retries are idempotent; manually authored occurrences and concurrent edits are preserved.
7. **Auto-forward and cross-note reconciliation:** enable the default-on date-flip behavior only after the recurrence/write-safety machinery is validated; implement missed-day catch-up, movement history, timer continuity, conflict reporting, and undo. Gate: dedicated multi-day, sync-conflict, and real-vault acceptance tests pass. Keep the setting easy to disable.
8. **Rendered projections and polish:** Reading view/Live Preview properties, scheduled-date links, Things glyphs, accessibility, themes, RTL, stats, and performance. Gate: generated display never leaks into source or becomes a saved edit; Chromium/WebKit and real-device checks pass.
9. **Hardening and beta readiness:** full playbook gates, dedicated-vault regression pass, documentation/screenshots, mobile device pass, and review of known limitations. Only prepare a beta after explicit approval; stable release requires separate explicit approval.
10. **Future periodic notes (post-v1, scope to be planned):** design Organized’s own periodic-note model and behaviors. The calendar/date service should be reusable, but period types, creation/opening rules, note relationships, task interactions, settings, and templates remain undecided until separately planned.

**Ordering rationale:** establish recovery and the canonical Markdown model before adding automation; validate task creation and mobile interaction before broad UI; add multi-note side effects incrementally; prove recurrence and conflict-safe writes before enabling default-on auto-forward; leave rendering projections until their source/edit boundaries are established. If a phase gate fails, pause and fix it before layering on the next phase.

## 10. Implementation defaults and deferred scope

Treat the recommendations below as approved implementation defaults unless the owner changes them before the relevant phase. Explicitly decided behavior elsewhere in the plan takes precedence. Deferred marker automation remains out of v1.

1. **ID marker:** decided—use compact `<!--organized:<id>-->` standard Markdown comment; visible in source and hidden in rendered Markdown.
2. **`[>]` date basis:** use the vault/device’s local calendar date for “tomorrow,” including across timezone/daylight-saving changes.
3. **Priority interaction:** show the four-value High/Medium/Low/None chooser after `[!]`; the marker cleanup and configurable heading/list-bounded sorting are specified in §3/§4.
4. **Timer policy:** decided—persist start timestamp and cumulative seconds in task frontmatter; calculate elapsed wall-clock time on demand, without a background process; resume automatically after restart. Multiple task timestamps may be active concurrently. `[x]` or clearing `[/]` stops and accumulates that task’s interval.
5. **Daily notes v1:** follow core Daily Notes settings by default only through a supported API; also allow a paired custom folder/format override. If supported core access is unavailable, require custom mode rather than reading undocumented internals. Refresh current values before file operations. Future periodic-note support is intended, with behavior to be planned later.
6. **Stats scope:** use current-note/current-month context and currently loaded task records; do not scan the whole vault for stats.
7. **Calendar starting weekday:** inherit locale by default to avoid another setting.
8. **Mobile layout:** use the same three-tab sidebar on mobile; avoid stacking all tab contents at once.
9. **Playbook adoption level:** use the full applicable template suite and its 100% coverage/release bar from the first implementation, consistent with §2.
10. **Deferred Things syntax:** `[k]`, `[l]`, `[S]`, `[p]`, `[c]`, `[w]`, `[u]`, `[d]`, `[D]`, `[P]`, and `[M]` are visual-only in v1 as specified in §4. Do not add behavior for them without a later product decision.

## 11. Definition of “go”

Until the owner explicitly says “go”, this file is the planning artifact and no plugin source, build config, CI workflow, or GitHub branch/commit is to be created. Once approved, implement only the agreed scope; stop and ask if an unresolved decision blocks safe behavior. Pushing code, creating a release, and stable promotion remain separate approval points.
