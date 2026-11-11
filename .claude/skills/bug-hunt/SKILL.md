---
name: bug-hunt
description: Systematic bug hunt for an Obsidian plugin diff or release line. Use before promoting a beta to stable, after a feature lands, or when asked to "find bugs", "audit", "look for races" or "review since last stable". Covers race conditions, event ordering, stale caches, new-metadata lifecycle gaps, mobile/host differences, keyboard focus, layout overflow, batch poisoning and date boundaries, each with a grep recipe and a test pattern.
---

# Bug hunt

Built from the bugs the 0.1.4 betas of this plugin shipped and then fixed, plus the incident table of the playbook (`obsidian-plugin-playbook/INCIDENTS.md`, cloned next to this repo; read it first, every row is a class that already bit once). Passing tests did not catch them: each lived in a gap the harness does not model. Hunt those gaps on purpose.

## Scope first
`L=$(git tag --sort=-creatordate | grep -v beta | head -1); git diff --stat $L..HEAD -- src ':!src/tests'`. Read changed files top-down by churn. For every changed function ask the classes below; write a failing scratch test before claiming a bug (a claim without a repro is a guess).

## The classes (and where each bit us)

1. **Async ordering / races** (new daily note filled before the template settled; sync delivering a note two devices both filled; write queue taken too early).
   - Grep: `await` between a read and a write of the same file; `vault.create` / `modify` / `process` followed by logic that assumes the result is visible; `setTimeout`/debounce; any "exists then create" pair.
   - Ask: what if the other device, a second event, or the Obsidian template plugin writes between these two lines? Is the read-modify-write inside one `vault.process` / the write queue?
   - Test: fake timers plus a promise you resolve late; fire the second event before the first awaits finish; run the same operation twice concurrently and assert idempotence (no duplicate lines, no lost edit).

2. **Event ordering and host lifecycle** (mobile: opening a note closes the drawer; `layout-change` vs `active-leaf-change`; pending state that never clears).
   - Grep: `workspace.on(`, `registerEvent`, fields named `pending*`, `current*`, `last*`.
   - Ask: who sets it, who clears it, what if the clearing event never fires, fires twice, or fires before the view exists? Does an unrelated path (user opens another note by hand) cancel it? Is the handler a no-op when the view is closed?
   - Test: drive events in the wrong order, twice, and not at all; assert state ends clean.

3. **Stale derived state and caches** (retired-work cache keyed by mtime; calendar showing yesterday while today's note is open).
   - Grep: `Map`/object caches, `cache`, memo keys, fields copied from settings or a note at construction time.
   - Ask: what invalidates it? Does the key change on every real change (mtime and size can both stay equal; mocks keep stat constant, so tests hide this)? Does a rename/move/delete/sync-in update it?
   - Test: change the source without changing the key; change it from another code path (rename, undo, sync).

4. **New metadata lifecycle gaps** (recurring/budget/plan fields not handled on retire, forward, convert, rename, copy, undo). Every new frontmatter key or line format is a column in a matrix of pipelines.
   - Found on 0.1.5: making a task recurring forced `status: open` but left `auto_started_block` and the `[/]` todo a planned block had written; nothing ever put the line back. Ask, for every action that sets a status by spreading a new object (not `setStatus` + `syncLines`): which markers and claims did the old status leave behind?
   - Build the matrix: rows = each new key/line (`recurring`, `recurrence_periods`, `time_budget_seconds`, `planned_sessions`, project links, worked lines); columns = create, edit, complete, cancel, forward to next day, retire/strip/trash, convert note, project rename, Undo, sync conflict copy, parser round-trip (`codec`).
   - Grep: the key name across `src/`; any pipeline that does not mention it either handles it implicitly (derived from `newTask`/`ORGANIZED_KEYS`, fine) or forgot it.
   - Test: property round-trip (write then parse equals input), and an end-to-end "task with every field set goes through the lifecycle and nothing is lost or resurrected".

5. **Host and platform differences** (button `white-space: nowrap` from host CSS; phone keyboard covering lists; long-press release ticking the checkbox; mobile vs desktop branches).
   - Grep: `Platform.is`, `isMobile`, `touch`, `pointer`, `mousedown`/`click` on the same element, `blur`/`focus` handlers.
   - Ask: what does the host stylesheet apply to this element? Which event fires after the one I handle (release after long press, click after touchend)? Is the desktop-only or mobile-only branch covered by a test that sets the platform both ways?

6. **Keyboard and focus** (Tab could not reach Save links).
   - Ask: can every control be reached and left with Tab, Shift+Tab, arrows, Enter, Escape? Does a handler `preventDefault` without moving focus? Does the first focus land somewhere sensible, and does the modal return focus when it closes?
   - Test: dispatch real `KeyboardEvent`s from the focused element and assert `document.activeElement` after each.

7. **Layout overflow** (long titles over icons, properties stranded, dialog wider than a phone).
   - Ask: what is the longest realistic text (one unbroken 60-char word, 200-char title, RTL, emoji)? Does a flex child have `min-width: 0` and `white-space: normal`?
   - Test: `npm run check:layout` with a long-content fixture in both engines; measure with Range rects, not offsetWidth alone.

8. **Batch poisoning and partial failure** (one unwritable task note kept every recurring task out of a new daily note).
   - Grep: `for ... of` / `Promise.all` / `map(async` that writes or throws per item.
   - Ask: if item 3 of 10 throws, do 4..10 still happen, is the user told which failed, and is state left consistent (no half-applied change without an Undo record)?
   - Test: make one item fail (permission, parse error, conflict copy) and assert the rest succeed and a notice names the failure.

9. **Date and time boundaries** (midnight carry-forward, invalid `day(0)`, DST, week start, timezone, planned block crossing midnight).
   - Grep: `new Date(`, `Date.now`, `moment(`, `localDate`, `getDay`, `86400`, `* 24 * 60 * 60`.
   - Ask: what runs at 23:59:59 vs 00:00:01? What if the clock jumps (sleep/wake) or the device timezone differs from the sync partner? Is `86400` ever used as "one day" across a DST change?
   - Test: fake timers at boundary instants; DST dates; month ends; Feb 29; Monday/Sunday week start.

10. **Data safety on load/save** (writes as a side effect, hand-edited or foreign data, sync conflict copies).
    - Ask: is anything written without a user action? Does a parser throw on a half-written, reordered, or foreign-plugin note? Does a merge stay commutative and idempotent?

11. **Doc and asset drift** (onboarding and What's new out of date, screenshots stale).
    - Check: `releaseNotes.ts`, `onboarding.ts`, README, CHANGELOG, screenshots all mention each user-visible change since the last stable; `render-screenshots --check` passes.

12. **Test blind spots** (the meta class; see also the playbook TESTING.md: WebKit layout, property tests, upgrade fixtures). A green suite only means the modelled world works.
    - List what the harness fakes (constant `stat`, immediate events, no host CSS, no sync, one device, no real clock) and ask which claimed behaviour depends on exactly that. Say so in the report; do not call it verified.

13. **Swapped source of truth and fire-once automation** (found by running this skill on 0.1.4).
    - A helper changed from reading field A to field B (`time_tracking_started_at` -> `status === "in_progress"`). Find every caller and every state where A and B diverge (recurring tasks keep `status: "open"` while a timer runs, so the marker became " " for a running timer).
    - An automatic action keyed on current state alone (`dueStarts`: open + block covers now) re-fires after the person undoes it, because undoing clears the memory that it already fired. Ask: what remembers "already done for this trigger"? Test: fire, let the person revert, tick again, assert it stays reverted.
    - An automation that runs only on a timer leaves the state it should react to visibly stale until the next tick (a planned block added while already under way left the task open for up to a minute, which reads as "it does not work"). Ask: which of the person's own actions change the automation's input (`addPlanned`, `changePlanned`)? Run the check right after each, and test without advancing the clock.
    - A handler that reacts to a host event (`create`) cannot see the caller's intent (a command that creates the note itself on a secondary device got "did not add recurring tasks" while adding them). Ask which of our own code paths also raise this event, and whether the handler's message is true for them.
    - Late `onLayoutReady` blocks: every one needs the same `loaded`/`unloaded` guard as the first, or a plugin disabled during startup leaks timers and listeners that still write.

14. **Hidden or stale views** (panel stale after the phone drawer was closed, search box rebuilt per keystroke closing the keyboard, leaf reuse saving an empty buffer over a note).
    - Ask: what draws the view while it is hidden, and what redraws it on reveal (`layout-change`, `active-leaf-change`, `onResize`)? Does a refresh ever rebuild an element that has focus? Does navigation (open, reuse leaf, close) trigger a save?
    - Test: change data while the view is hidden, then reveal; focus an input, trigger a refresh, assert the element and caret survive.

15. **Clocks, zones and "empty" vs "failed"** (mtime gates skipped a remote version forever; UTC dates off by a day in the evening; failed sync reported as "no data"; progress marked before data was stored).
   - Same shape for "unclear" vs "gone": `parentIds` leaves out a task on two lines, and the nesting watcher read the missing entry as a deleted line, so pasting a copy of a subtask or its parent unlinked it. Test: paste a copy, delete either copy, delete the whole block; assert the parent's list after each.
    - Grep: `mtime`, `ctime`, `toISOString().slice(0, 10)`, `Date.parse` on date-only strings, `catch { return [] }`, "mark done" before the write has resolved.
    - Ask: does a skipped, failed or partial read look identical to a legitimate empty result? Is anything marked done before the data it describes is durable? Do dates shown to a person come from local fields?
    - Test: run the date suite under three `TZ` values (e.g. `UTC`, `Pacific/Auckland`, `America/Los_Angeles`) at 23:30 and 00:30 local; make the read fail and assert the UI says failed, not empty.

16. **Transient states** (a hidden task id flashed for one keystroke while a marker was retyped; a line parsed as non-task for one transaction).
    - Ask: between two user keystrokes or two awaits, is there a state in which the model, parser or decoration is wrong for a moment? Test the intermediate document, not only the final one.

17. **Shared mutable defaults and sticky state** (nested objects shared between loaded settings and `DEFAULT_SETTINGS`; one-time flags never reset).
    - Grep: spread of an object containing arrays/objects (`{ ...DEFAULT }`), module-level `let`/`Map`/`Set` that survives plugin disable/enable.
    - Test: load settings twice and mutate one; disable then re-enable the plugin in the harness and assert no old listener, timer or cache remains.

18. **Structural edits that drop or move a line** (deleting or unscheduling a parent left its subtasks indented under nothing, which Markdown reads as a code block, so the plugin lost them; sorting a CRLF note whose last line has no line break mixed endings).
    - Grep: `splice(`, `.filter((_, index)` / `.filter((_line, index)` (convert-to-note dropped the other copies' lines this way), `join("\n")` on text from a note, `split("\n")` where the code elsewhere uses `split(/\r?\n/)`.
    - Ask: what hangs off the line (children, continuation lines, blank-line separators, `\r`)? Does the result still parse to the same tasks (`parseTasks` before and after)? Can the block you move contain the anchor you move it to?
    - Test: a property check over random notes (CRLF and LF, tabs and spaces, headings, fences, prose between items): run every codec edit and assert the multiset of task ids and the newline style survive and nothing throws. Then a model-based run: random service operations (create, schedule, status, subtask, recurrence, rename) on a harness vault, with the invariants "no `organized:` id without a task note", "no non-recurring id twice in a note", "a scheduled task has a line on its day".

19. **Panel actions use the panel's task, not the cursor's** (the Timer card passed the editor cursor's todo, which can be another task in another note, to the status change of a recurring task).
    - Grep: `this.owner.context` in `view.ts`; every use must be guarded by `context?.line.id === id`, or go through `contextFor`.
    - Test: put the cursor context on a different task in a different note, act from the panel, assert only the panel's task changed.

20. **Links by name outlive the note** (a subtask cleaned up after it expired, retired to the trash or turned into a note stayed in its parent's `subtasks` list as `[[Name]]`; the next task with that title got the name and was adopted as the subtask).
    - Grep: `trashNote`, `converted_to`, every place a task note stops being a task (trash, strip, convert); `nameTaken` / `freePath` for who hands out names. Only `deleteTask` used to drop the parent's link.
    - Ask: who else refers to this note by name or path (parent lists, project links, `converted_to`)? When the note goes, is each reference removed, and if it cannot be (deleted by hand, sync), can a new note take the name and inherit the reference?
    - Test: remove the child through every pipeline, create a task with the same title, assert `parentOf` is null and the parent's list no longer holds the link.

21. **Input dropped instead of queued, and the host's edits that carry no user event** (a `busy` counter made `onEditorUpdate` ignore every tick while any action was running, so a todo ticked right after another one, or during the minute check, stayed open in the panel; a Live Preview click on `[/]` or `[-]` makes `[ ]` with no user event and no cursor on the line, and nothing handled it).
    - Grep: `if (this.busy`, `if (this.pickerOpen`, every early `return` in an event handler (`onEditorUpdate`, vault events, `render`) that depends on "something else is going on"; `userEvent`, `!user`.
    - Ask: is the person's action lost for good when this returns, or done later? A guard against the plugin's own writes must recognise that write (`Repository.ownText`), not a time window in which the person may act too. Which host actions change the note without a user event (checkbox click, mobile toolbar, a second pane), and for each marker, what does a click turn it into?
    - Test: start an action that does not finish (`plugin.run(() => promise)`), send the edit, then let it finish and assert the edit took effect; click every marker with no user event and the cursor elsewhere.

22. **Hidden text left out of what the person selects** (Live Preview hides each todo's `<!--organized:id-->` comment with a replace decoration; a selection made with a phone's handles or a mouse drag ends at the visible end of the title, before the comment, so a copied or cut todo was pasted as a plain todo and the task lost its line).
    - Grep: `Decoration.replace`, `atomicRanges`, `display: none` on anything that carries identity or structure; `copy`, `cut`, `drop`, `clipboard`.
    - Ask: what does a selection that looks whole on screen actually contain? Which hidden text must travel with the visible text (copy, cut, drag), and which must stay behind (a word of the title)?
    - Test: put a real DOM selection over the visible text only and fire the browser's own copy (`document.execCommand('copy')` in `scripts/check-layout.mjs`, both engines); in jsdom, dispatch `copy`/`cut` on `contentDOM` with a fake `clipboardData` and the page selection inside the editor.

## Method
1. Scope the diff; list changed behaviours.
2. For each, walk every class; write the question down only if it could apply.
3. Repro with a scratch test (`src/tests/*.dom.test.ts` patterns, `harness()`); keep it only if it becomes a real regression test with 100 % coverage.
4. Rank by user damage: data loss or duplication > wrong data shown > stuck UI > cosmetics.
5. Report: file:line, trigger, effect, repro status (reproduced / reasoned only), suggested fix and the regression test that will guard it. Separate "reproduced" from "suspected".
6. Fix each reproduced bug with its regression test (see Rules); a suspected bug gets a reproducing test first or is dropped.

## Rules
- **No fix without a regression test.** Every bug this skill finds is fixed together with a test that fails on the old code and passes on the new: write the repro first, watch it fail for the right reason, fix, watch it pass, and say so in the PR ("reverted the fix, test failed: <message>"). The test lives in the permanent suite (100 % coverage rules apply), is named after the behaviour, and covers the whole class where cheap (the other states, the other pipelines), not only the one input that bit. A fix without such a test is not done; `feature-done` and `release-stable` both check for it.
- Never fix and release inside the hunt; report first unless told to fix. Fixes follow `feature-done` and `release-beta`.
- When a bug is fixed, add its class and the repro pattern here if it was not covered.
- State what you could not verify (real device, real sync, real Obsidian).
