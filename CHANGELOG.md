# Changelog

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
