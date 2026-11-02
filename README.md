# Organized

Markdown-backed tasks with Things-style shortcuts, daily-note scheduling and a calendar/task/projects inspector. No service, telemetry or proprietary task database.

## Try the beta

Use a **test vault**. In BRAT, add **`davadev/Organized`** and select the beta release. Alternatively download `main.js`, `manifest.json`, `styles.css` from the same GitHub release into `<test vault>/.obsidian/plugins/organized/`, then restart and enable Organized.

Open **Settings → Organized** and match **Daily-note folder** and **Filename format** to your daily-note setup. Core configuration is not read through undocumented APIs. Set **Daily-note template** to a note such as `Templates/Daily.md` so daily notes Organized creates (for example when scheduling to a new date) start from it; `{{date}}`, `{{date:FORMAT}}` and `{{title}}` are filled in. Task files default to `Tasks/` (visible Markdown, not a hidden `.tasks` directory).

**Auto-forward is on by default.** Opening today's daily note carries the latest unfinished non-recurring tasks forward, updates their schedule and marks prior occurrences forwarded; it does not create today's note on a timer. Recurring `[f]` occurrences are skipped because recurrence creates their next daily-note occurrence. Turn auto-forward off in settings if unwanted. A formatted batch summary offers Undo. **Show scheduled date link** controls date links globally and is on by default.

Open the ribbon calendar or run **Organized: Open inspector**. Its tabs, shown as icons at the top right, are Calendar, Task, Projects and Favorites (a star). Selecting a day in the month view explicitly opens/creates its daily note. The **Week** and **Day** views show tasks and the time they were In Progress (recorded from the moment you update); they never create notes. Merely browsing months creates nothing. Time worked can be added or corrected by hand: the **+** beside the Day view's Time heading, a tap on a block, or the Task tab's Timer card.

The Task tab keeps your selection while you scroll or edit the sidebar. When the cursor is not on a task, it lists task lines from the current note; tap a linked task to jump the editor cursor there and show its details. Optional cards show populated details or the section you request with a shortcut or **Add details…**; history and references are collapsed. Editing the title or any task note section happens inline in the sidebar, with Save and Cancel above the field so the mobile keyboard cannot cover them. **Description** sits above Idea; legacy `## Information` notes are read as Description and migrate to the canonical heading when saved. The Projects tab is grouped into Favorites, Projects and Canceled cards with a project filter and counts. Use **Delete task** on the Task tab to confirm removal of the canonical note and all linked occurrences. Fully restart Obsidian after updating to refresh the setting groups.

## Link or create tasks

Typing a new `- [ ] ` or inserting one with Obsidian's mobile checkbox toolbar opens the native task picker. Choose an existing task, **Create new task**, or **Keep as regular todo**. The last option closes the picker and leaves an ordinary unlinked checkbox. Pasted task blocks are not converted automatically. Use **Attach/create task** on an existing checkbox; **Duplicate as new task** creates an independent ID. Missing links are never silently replaced. Markdown links in task titles and task-note sections open from the picker and inspector; title editing keeps the raw Markdown syntax.

Run **Organized: Convert unchecked todos to tasks** on a regular note to convert its ordinary unchecked todos into canonical tasks. It confirms first, skips linked, completed, in-progress and empty items, and preserves indentation and line endings.

Each canonical task is `Tasks/<id>.md`, with standard YAML and Markdown notes. Occurrences contain `<!--organized:<id>-->`. A copied ID remains the same task. Selected properties render read-only in Reading/Live Preview; no generated dates/properties are written into occurrence source. The inspector edits the canonical note.

In **Settings → Task storage**, **Keep completed tasks (days)** optionally sets retention from the date a task is completed or canceled. It defaults to `0` (disabled). When enabled, cleanup runs while opening today's daily note: linked checkboxes are unlinked and the canonical task files move to Obsidian's trash. Open/in-progress, recurring, and legacy completed tasks without a recorded completion date are preserved. Keep a vault backup and confirm Obsidian's trash preference before enabling automatic cleanup.

**What retired tasks keep** chooses what the checkbox leaves behind: *the title only* (default), *add description* (the description as a quote under the checkbox) or *add everything* (also ideas, questions, sources and notes, plus one line per day of time worked, such as `- Worked 2026-03-02: 09:00–09:30, 10:00–10:20 (50 min)`). It is written under the latest daily note only and reads as ordinary nested list items. The Day and Week views read those `Worked` lines back, so time blocks of retired tasks stay on the calendar; only the daily notes of the viewed days and the following month are read, and each is read once until it changes.

Identity and recurrence comments stay hidden in Live Preview, including the line being edited. Switch to source mode to inspect the original Markdown.

| Marker | Action |
|---|---|
| `[<]` | Choose schedule date; keep origin marker, link daily destination |
| `[>]` | Forward to tomorrow; daily origin stays gray, undated origin stays active |
| `[/]` | Start durable wall-clock timer; complete or clear to stop/log |
| `[!]` | High/medium/low/none priority, constrained sort, then clear |
| `[a]`, `[e]`, `[q]` | Open description/idea/question inspector section for inline editing (autosaves), then clear |
| `[x]`, `[ ]` | Complete/reopen; stop active timer idempotently |
| `[-]` | Reversible cancellation; recurring dates cancel independently |
| `[*]` | Toggle favorite |
| `[s]` | Open the Sources section for inline Markdown references (URLs/Obsidian links, optional labels/citations) |
| `[j]` | Multi-select project notes; missing selected notes are created in `<task folder>/Projects/` with `organized_type: project` and an `organized_start` date in their frontmatter and **Open / In progress / Done** headings that linked tasks move between as their status changes, and only such notes are listed. A project can have a colour (`organized_color: "#rrggbb"`, set from the Projects tab) shown as a dot beside its name on task cards and as the fill of its blocks in the calendar |
| `[r]` | Toggle recurrence in existing/current/future and subsequently created daily notes; clear after success |

Only the markers above act. Every other character, including the old action letters `[i]`, `[I]`, `[?]`, `["]`, `[b]` and `[f]` and the theme glyphs `[d]`, `[p]`, `[k]`, `[l]`, `[S]`, `[c]`, `[w]`, `[u]`, `[D]`, `[P]`, `[M]`, is **formatting only**: it shows its icon and never changes metadata or storage. Use them freely to style a todo without side effects. Things-style glyphs are bundled, so the Things theme is not required.

Historical daily checkboxes remain historical. Non-recurring status changes propagate to today/future daily notes and undated/project references, not prior days. Recurring dates are independent; disabling recurrence removes only uniquely identified generated future copies. Multiple tasks may have running timers; no background writes or ticking process is required.

See [documentation](docs/index.md), [safety/architecture](docs/architecture.md), [testing](docs/testing.md), [release manual](docs/releasing.md) and [third-party licenses](THIRD_PARTY_NOTICES.md). MIT; project by **davadev**. Calendar Plus is the calendar design reference; Things/Minimal and credited upstream MIT icon projects supply the checkbox artwork.
