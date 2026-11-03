# Organized: design notes

Organized is a mobile-compatible Obsidian plugin that gives the todos in a daily note a memory: they carry over, can grow a priority, a date, a description, projects and tracked time, and always stay normal Markdown. Project attribution is davadev only.

## Principles

- **Your notes stay yours.** A todo is a normal `- [ ]` line. Details live in a plain note in the task folder: YAML properties, then the description as ordinary text, then an optional `## Sources` block. The plugin can be retired at any time (**Retire tasks…**) and the vault still reads naturally.
- **No surprise writes.** Nothing is written on startup, navigation or render. Writes follow an explicit action, recognised checkbox syntax, or the enabled date-flip reconciliation. Background edits use `Vault.process`, the active note uses editor transactions, metadata uses `processFrontMatter`.
- **Grow only when needed.** Level 1 forwards unfinished todos; level 2 adds priority, scheduling and sorting; level 3 adds descriptions, projects, recurrence, a timer, a calendar and standalone notes.
- **Mobile first.** No Node or Electron APIs, no network, no telemetry. Layouts use Obsidian theme variables, namespaced classes and logical properties; they are checked in Chromium and WebKit.
- **Safe by default.** Persisted data is validated; newer or ambiguous data is never overwritten; one-time migrations back up first and offer Undo; a crash-loop guard disables the plugin after repeated failed starts.

## Where things live

- `docs/architecture.md`: code layout, the task-note format, safety boundaries and migrations.
- `docs/testing.md`: automated checks, the whole-journey test and the manual device checklist.
- `docs/releasing.md`: the tag-driven beta and stable release procedure.
- `README.md`: user-facing overview, shortcuts and the Retire window.

## Behaviour in brief

- **Markers.** Type a letter in the checkbox: `[!]` priority, `[<]` schedule, `[>]` forward, `[/]` start the timer, `[x]` done, `[-]` cancel, `[*]` star, `[a]` description, `[s]` sources, `[b]` projects, `[n]` standalone note, `[r]` recurrence.
- **Sorting.** With sorting on, in-progress todos rise to the top, then open todos by priority; finished, canceled, forwarded and scheduled todos sink below every open one. Sorting never crosses a heading path.
- **Daily notes.** Opening today's note forwards yesterday's unfinished todos; the old line is marked forwarded so history stays honest.
- **Panel.** The side panel has Calendar (month, week, day), Task, Projects and Favorites views over the same Markdown.
- **Leaving.** **Retire tasks…** turns todos into plain text or links, optionally renames task notes to their titles and strips Organized's properties, with Undo for everything except trashing.
