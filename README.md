# Organized

Markdown-backed tasks with Things-style shortcuts, daily-note scheduling and a calendar/task/projects inspector. No service, telemetry or proprietary task database.

## Try the beta

Use a **test vault**. In BRAT, add **`davadev/Organized`** and select the beta release. Alternatively download `main.js`, `manifest.json`, `styles.css` from the same GitHub release into `<test vault>/.obsidian/plugins/organized/`, then restart and enable Organized.

Open **Settings → Organized** and match **Daily-note folder** and **Filename format** to your daily-note setup. Core configuration is not read through undocumented APIs. Task files default to `Tasks/` (visible Markdown, not a hidden `.tasks` directory).

**Auto-forward is on by default.** Opening today's daily note carries the latest unfinished non-recurring tasks forward, updates their schedule and marks prior occurrences forwarded; it does not create today's note on a timer. Turn this off in settings if unwanted. A batch summary offers Undo.

Open the ribbon calendar or run **Organized: Open inspector**. Its tabs are Calendar, Task and Projects. Selecting a day explicitly opens/creates its daily note. Merely browsing months creates nothing.

The Task tab keeps your selection while you scroll or edit the sidebar. Optional cards show populated details or the section you request with a shortcut or **Add details…**; history and references are collapsed. Beta 2 also fixes mobile settings labels. Fully restart Obsidian after updating to refresh the setting groups.

## Link or create tasks

Interactively typing a new `- [ ] ` opens Obsidian's native search picker. Choose an existing task or **Create new task**. Cancel leaves an ordinary checkbox and no task file. Existing notes and pasted task blocks are not converted. Use **Attach/create task** on an existing checkbox; **Duplicate as new task** creates an independent ID. Missing links are never silently replaced.

Each canonical task is `Tasks/<id>.md`, with standard YAML and Markdown notes. Occurrences contain `<!--organized:<id>-->`. A copied ID remains the same task. Selected properties render read-only in Reading/Live Preview; no generated dates/properties are written into occurrence source. The inspector edits the canonical note.

Identity and recurrence comments stay hidden in Live Preview, including the line being edited. Switch to source mode to inspect the original Markdown.

| Marker | Action |
|---|---|
| `[<]` | Choose schedule date; keep origin marker, link daily destination |
| `[>]` | Forward to tomorrow; daily origin stays gray, undated origin stays active |
| `[/]` | Start durable wall-clock timer; complete or clear to stop/log |
| `[!]` | High/medium/low/none priority, constrained sort, then clear |
| `[i]`, `[I]`, `[?]` | Open information/idea/question inspector section, then clear |
| `[x]`, `[ ]` | Complete/reopen; stop active timer idempotently |
| `[-]` | Reversible cancellation; recurring dates cancel independently |
| `[*]` | Toggle favorite |
| `["]` | Edit Markdown source references (URLs/Obsidian links, optional labels/citations) |
| `[b]` | Multi-select project/topic notes; create missing selected root notes |
| `[f]` | Toggle recurrence in existing/current/future and subsequently created daily notes; clear after success |

`[k]`, `[l]`, `[S]`, `[p]`, `[c]`, `[w]`, `[u]`, `[d]`, `[D]`, `[P]`, `[M]` are **visual-only**. They never trigger metadata or secret storage. Things-style glyphs are bundled, so the Things theme is not required.

Historical daily checkboxes remain historical. Non-recurring status changes propagate to today/future daily notes and undated/project references, not prior days. Recurring dates are independent; disabling recurrence removes only uniquely identified generated future copies. Multiple tasks may have running timers; no background writes or ticking process is required.

See [documentation](docs/index.md), [safety/architecture](docs/architecture.md), [testing](docs/testing.md), [release manual](docs/releasing.md) and [third-party licenses](THIRD_PARTY_NOTICES.md). MIT; project by **davadev**. Calendar Plus is the calendar design reference; Things/Minimal and credited upstream MIT icon projects supply the checkbox artwork.
