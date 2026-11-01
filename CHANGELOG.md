# Changelog

## Unreleased

- Make Markdown links in task titles and task-note sections open reliably from the inspector.
- Group task details into one shared surface and tighten narrow-screen Settings rows to remove excess whitespace.
- Keep recurring `[f]` task occurrences out of automatic forwarding.
- Make the mobile checkbox toolbar open the task picker reliably when it inserts a new blank todo, while leaving pasted checkboxes untouched.
- Browse task lines from the current note in the Task tab when the cursor is elsewhere; selecting a linked task jumps the editor cursor to it.
- Configure retention in days for completed/canceled task notes; expired linked todos become ordinary checkboxes before task files are moved to Obsidian's trash.

## 0.1.0-beta.5

- Format forwarding and recurrence summaries as a clear title, detail and Undo action.
- Render Markdown/Obsidian links in task titles as clickable links in the inspector and picker, without activating the surrounding task card.
- Offer **Keep as regular todo** in the picker opened by typing `- [ ] `; dismissing it leaves the checkbox unlinked.
- Add a global **Show scheduled date link** setting (on by default), and tighten spacing throughout Settings.
- Keep selected task properties visible in Live Preview when the task is the final line of a note with no trailing newline.

Verified with 125 behavioral/policy tests at 100% coverage. Live Obsidian and physical-device acceptance remain manual beta checks.

## 0.1.0-beta.4

- Replace the task text popup with inline editing in the inspector for the title and every task note section. Save and Cancel sit above the field, so an on-screen mobile keyboard cannot cover Save.
- Rename the `[i]` section from Information to **Description**, render it above Idea, and migrate an existing `## Information` heading to `## Description` when it is next saved without deleting or merging other sections.
- Add **Organized: Convert unchecked todos to tasks** for the active note. It confirms first, converts only unlinked unchecked todos, preserves indentation and line endings, and leaves completed, in-progress, linked and empty todos untouched.
- Top-align native modal hosts and let modal content scroll on mobile so actions stay reachable.

Verified with 121 tests at 100% coverage and Chromium/WebKit layout checks including the inline editor and top-aligned schedule modal. Live Obsidian and physical-device acceptance remain manual beta checks.

## 0.1.0-beta.3

- Redesign the Projects tab into Favorites, Projects and Canceled sections with counts, a labeled project filter, task cards, status/priority/date/favorite metadata, project chips and clear empty states.
- Polish the Task tab with an accent-edged hero, semantic status dots, restrained accent icons and hover/focus states, and a bottom actions row.
- Add explicit task deletion on the Task tab: after confirmation, the canonical task note moves to Obsidian’s trash, every linked occurrence line is removed, and the inspector clears the deleted selection and returns to Projects.
- Bring all native modals onto the same compact accent-edged surface, give destructive confirmation its own heading and action label, and remove task IDs from picker suggestions.

Verified with 118 tests at 100% coverage and Chromium/WebKit layout checks, including the information modal. Live Obsidian and physical-device acceptance remain manual beta checks.

## 0.1.0-beta.2

- Keep the selected task while scrolling or editing the sidebar instead of reverting to “Place the cursor”. Requested sections scroll into view once, not on every refresh.
- Compact calendar navigation and a quieter card-based inspector inspired by the Garmin-Health-Sync sidebar. Optional task details appear only when populated or explicitly requested; references and history stay collapsed.
- Hide task identity and recurrence comments even on the active Live Preview line, without changing Markdown or source-mode visibility.
- Readable, wrapping mobile settings labels and proper searchable setting groups instead of nested settings rows.

Verified with 115 tests at 100% coverage and Chromium/WebKit layout checks. Live Obsidian and physical-device acceptance remain manual beta checks.

## 0.1.0-beta.1

First isolated-vault beta: Markdown task records and stable references; native task picker; calendar/task/projects sidebar; scheduling and forwarding; durable timers; priority sorting; source/project links; favorites; recurrence and date-flip forwarding with conflict-aware undo; read-only properties and bundled Things-style icons in Reading/Live Preview.

The visible default task folder is `Tasks`, correcting the plan's `.tasks` default because Obsidian's Vault/frontmatter API cannot manage hidden notes. Custom daily-note settings are required. Real-device and live Obsidian manual acceptance remain beta testing, not a stable certification.
