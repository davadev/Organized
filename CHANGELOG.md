# Changelog

## Unreleased

- Quieter task cards: the project label is now a small dot in the project's colour followed by its name in muted text (instead of a solid block), so the title leads and the colour is an accent. Done cards have a fainter green wash and no left stripe; only an in-progress card keeps the green stripe and a stronger wash, so the two states read differently without another colour.
- Fix the project colour pickers on mobile, where the native control stretched into tall pills ignoring its size. Each colour is now a 22 px square swatch with the native picker laid invisibly over it, so a tap still opens the picker and the swatch updates as you choose.
- Project labels on task cards are now the project's colour itself, opaque and saturated, with white or dark text for whichever reads better, so they sit clearly on top of the status colour instead of blending into it.
- The Task tab's note list has an eye button by the note's title to hide or show done tasks. Hidden tasks are left out of the list and of the heading counts, a line says how many are hidden, and the choice is remembered.
- Task cards in the side panel are coloured by status again: done and in-progress tasks get a green wash and edge (in progress stronger), open stays neutral, canceled stays faded. The project colour now appears only as the colour of the project's name label on the card (a tinted chip, readable in light and dark themes). The calendar keeps the project colour for its Day blocks and Week bars.
- Favorites have their own tab (a star icon, after Projects) instead of sitting above the projects; the Projects tab now lists projects and canceled tasks. Opening a task from Favorites offers **Back to favorites**.
- In-progress tasks use the same green status icon as done ones (the shapes still differ: a play triangle and a tick), on cards and Day blocks.
- The colour pickers in **Project colors** are small rounded squares instead of large circles, and the Clear buttons are compact.
- Fix project colours looking off (a yellow card turning greenish): cards sat on a base that was lightly mixed with your theme's accent colour, which shifted every colour washed over it. The base is now the plain theme background, so a project colour shows as itself. Lightness also follows your pick halfway (within a narrow band) instead of being forced to one value, so a yellow stays yellow rather than turning olive next to a blue.
- Status is shown by the coloured icon alone: the outline around task cards, Day blocks and Week bars is gone, leaving the project colour (faint fill and left stripe) uncontested. Day view blocks now carry the same status icon in their corner.
- Project colours now look like one family: only the hue of the colour you pick is kept, and it is drawn at one shared lightness and a moderate strength (grays stay gray), so any pick sits well next to the others and the theme. The card fill is fainter, the project colour is the card's left stripe, and the status is a thin, quiet outline (in progress, done) plus its icon, instead of a strong coloured border. Day and Week blocks follow the same rules.
- Projects can have a colour. The **Projects** tab has a folded **Project colors** list with a colour picker per project (and Clear); the colour is stored in the project note's frontmatter as `organized_color: "#rrggbb"`. Task cards in the side panel are filled with their project's colour (the first coloured project of a task), and the Day view blocks and Week view bars use it too; without a coloured project, calendar blocks are gray and cards stay neutral.
- The status colour moved from the card fill to its outline: open stays neutral, in progress takes your accent, done is green, canceled is muted. The same applies to the blocks in the Day and Week views.
- Fix rendered task properties disappearing from the todo your cursor is on, which made the list jump as you clicked between tasks. The line being edited keeps its properties, and moving the cursor no longer redraws them.
- Rendered task properties (such as priority) now sit to the right of the title instead of on a row below, which kept lists short; notes and sources, being whole Markdown blocks, still get their own row. Applies in Live Preview and reading view.
- Switching a rendered property on or off now updates every open note at once; before, the note only changed after you clicked into it (the settings dialog had the focus).
- If a note cannot be reordered after a priority change because it changed in the meantime, a notice says so instead of failing silently.
- Task cards are more compact: the status word is replaced by one small icon at the right of the title (open, in progress, done, canceled, and a calendar tick for a recurring task done today), with the word kept as a tooltip and screen-reader label. The line of metadata only appears when there is a priority, date or star.
- Project notes now start with `organized_type: project` in their frontmatter, and the project picker lists only those notes (plus new ones you create). On first start, existing project notes (linked ones, remembered ones and everything in the project folder) are marked automatically; other properties are kept, and notes already marked are not rewritten.
- New setting **What retired tasks keep**, applied when retention turns a task into a regular checkbox: title only (as before), add description, or add everything (ideas, questions, sources, notes, days and times worked and total time tracked). Details are written once under the latest daily note as readable nested items; the Day and Week views read the time worked back from those notes, so blocks of retired tasks stay on the calendar (a block opens the note that kept it).
- Fix changing a task's priority in the side panel not reordering its list in the note when sorting is on; it now sorts like the editor's `!` marker does, and uses the priority just saved.
- Fix the Day view hiding a task that started right after a very short run: a block is drawn at least as tall as its title, so the next task now sits beside it in its own column instead of on top of it. Tasks running at the same time were already shown side by side; the hour range also grows so a short block near the end of the day is not cut off.
- Fix pressing Enter at the end of a linked todo in the editor carrying the task's hidden ID to the new line: the original task lost its link and the new todo inherited the wrong one. The caret now steps past the hidden ID comments first, so the new line is a clean todo.
- Editing the text of a linked todo in a note now renames the task once you pause typing (about 0.8 s), so the Task tab, Projects, Day view and every other occurrence show the new title. Previously only renaming from the side panel did that.
- The task list in the Calendar's Day view can be folded away: tap the **Tasks** heading to collapse or expand it. The choice is remembered, and a long list no longer pushes the time grid off screen.
- The Calendar tab has **Month / Week / Day** views. **Day** lists that day's tasks on top (tinted by status) and draws the time each task was In Progress on an hour grid; **Week** shows seven day rows with done/total task counts and a thin timeline of tracked time. Tap a block or task to open it (a Back to calendar button returns), tap a week row to open that day. Browsing never creates a daily note; a missing one offers **Create daily note**.
- Tasks now record each timer run of a minute or more as a work session (`work_sessions` in the task's frontmatter, newest 500 kept) when you stop it, complete, cancel or reopen the task. Time blocks therefore appear only for time tracked after updating this version; a timer that is still running is drawn live up to now.
- The side panel's Calendar, Task and Projects tabs are now square icon buttons (calendar, checklist, folder) aligned to the right, with the names kept as tooltips and screen-reader labels. This frees room for more tabs later.
- Fix ticking or unticking a linked task's checkbox in the editor (Live Preview) not updating the side panel: such a click changes one character, often without a user event and without the cursor on that line, so it was ignored. It now updates the task's status, its other occurrences and the panel.
- Fix the Task tab keeping the previous note's tasks after you switch notes: the panel now repaints whenever the note in the main area changes (including on file open and when the side panel has focus), not only when the task under the cursor changes.
- Fix the Task tab saying "Open a Markdown note to browse its tasks here" while a note is open: the note shown in the main area is now found directly, instead of only after you have edited or moved the cursor in it, so the daily note's tasks appear as soon as the side panel opens (also on mobile and with the note in reading view).
- Task cards are coloured by status in the side panel: done tasks get a faint green wash with a green edge, in-progress tasks take the accent of your theme, open tasks stay neutral so unfinished work stands out, and canceled tasks are struck through and faded. The status dot on cards is gone; the colours replace it. The mixes are subtle and adapt to light and dark themes, and fall back to plain edge colours on an old Android WebView that cannot mix colours.
- Android: the side panel can no longer slide sideways; tab labels no longer clip with a large system font (the tabs wrap onto a second row instead); and dialogs keep a height limit on a WebView without dynamic viewport units.
- Tighten the Task tab's heading rows (the mobile theme no longer inflates them to button height) and indent tasks inside the heading that owns them, with smaller gaps between rows.
- New project notes are created in `<task folder>/Projects/` instead of the vault root. On first launch of this version, notes already linked as projects are moved there automatically (Obsidian updates links to them); a summary notice offers Undo and reports any note skipped because a same-named note already exists in the destination. Project notes in that folder are treated as ordinary notes, not task records.
- Add an **All tasks in this note** button to the task view that moves the editor cursor off the task and returns the Task tab to the note's task overview.
- The Task tab's current-note list now shows the headings tasks sit under, nested by level. Click a heading to collapse or expand it; collapsed headings stay collapsed across restarts until you expand them.
- Tasks forwarded or scheduled into a daily note are placed directly under the previous task in their heading instead of after a blank line, and no longer add extra blank lines at the top of a new note.
- **Breaking:** action markers no longer share letters with theme icons. Use `[a]` description, `[e]` idea, `[q]` question, `[s]` sources, `[j]` projects and `[r]` recurring. `[i]`, `[I]`, `[?]`, `["]`, `[b]` and `[f]` are now formatting only (icon, no action), as is every other letter.
- Show a recurring task whose occurrence is ticked today as **done · today** in task lists and the Task tab; its stored status stays open so it recurs.
- Description, idea, question, sources and notes autosave while typing and on blur, and the editor now matches the rendered text instead of showing heavy borders.
- Remember notes once used as projects so a project stays listed after its last task is deleted (notes that no longer exist are dropped).
- Remove the large blank gap above each setting control on phones: the label area no longer reserves a fixed 180px of height.
- New **Daily-note template** setting: daily notes created by Organized start from the template instead of empty headings.
- Make Markdown links in task titles and task-note sections open reliably from the inspector.
- Group task details into one shared surface and tighten narrow-screen Settings rows to remove excess whitespace.
- Keep recurring `[r]` task occurrences out of automatic forwarding.
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
