/**
 * What the one-time "What's new" popup says after an update, and which notes a person is shown.
 *
 * Shown once per device per release: `settings.lastSeenVersion` remembers the newest version the person has been told about
 * (never synced on purpose), and `notesToShow` picks the entries newer than that and not newer than the version that is
 * running. Only the `X.Y.Z` part is compared, so every beta of a version counts as that version: a tester sees its note on the
 * first beta that has it, not again on later betas or on the stable release. Notes stack within a minor line so a device that skipped a release is told about each: never delete an
 * earlier entry of the line you are in (`npm run check-release` fails if you do). A fresh install is told nothing, it gets the
 * onboarding card instead. See docs/onboarding-and-whats-new.md.
 */
import type { FigureId } from "../onboardingFigures";
import type { ShotId } from "./shots";

export interface ReleaseNoteItem {
  title: string;
  text: string;
  /** A small illustration drawn from real interface elements (see onboardingFigures.ts). */
  figure?: FigureId;
  /** A real crop of the plugin's panel (see shots.ts); use it where the thing is a part of the plugin's own interface. */
  shot?: ShotId;
}

export interface ReleaseNote {
  /** The release this note belongs to, `X.Y.Z` (no prerelease suffix). */
  version: string;
  title: string;
  intro: string;
  items: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.1.5",
    title: "What's new in Organized 0.1.5",
    intro: "Moving todos between headings keeps their task. These are the changes since 0.1.4.",
    items: [
      { title: "Copy or cut a todo and it stays the task", text: "Select a todo from its checkbox to the end of its title (with the handles on a phone, or a drag on a computer) and copy or cut it: pasted under another heading it is still the same task, with its status, time and projects. Selecting only words of the title copies just those words." },
      { title: "One task, one line in each note", text: "When a paste puts a task on a second line of the same note, Organized says so at once. Until you delete one copy, its status does not change: a ticked copy is unticked again and a notice names the note. For a separate task, use Duplicate as new task. If you keep the same task on two lines of one note on purpose, tell us in an issue on GitHub." },
      { title: "Planned time is tracked time", text: "With Start tasks at their planned time on, a task's timer now starts when its planned block begins and stops when the block ends, recurring tasks too, so a block you spend on it counts as worked. Stop it during the block and it stays stopped; start it again and it still stops at the end. Budgets count a minute once, and once a block is over only the time you really worked." },
      { title: "Planned times for recurring tasks", text: "Give a recurring task planned times in its Repeat dialog, like 08:00–17:00 on weekdays, and every day it repeats has that time planned, with no daily note needed: the timer starts and stops with it and project day, week and month budgets count it. Tap a block in the day view to change that day alone or every day. A recurring task now uses its projects' budgets instead of one of its own." },
      { title: "Schedule with a time", text: "The date dialog now has optional From and To fields: fill them to set that time aside on the day. Planned blocks on the old day move with a new date, clearing the date removes them, and planning time on a later day for a task without a date schedules it for that day. Each time, a notice offers Undo." },
    ],
  },
  {
    version: "0.1.4",
    title: "What's new in Organized 0.1.4",
    intro: "Repeat rules, planned time and budgets, and safer use on several devices. These are the changes since 0.1.3.",
    items: [
      { title: "Repeat rules", text: "Type [r] in a todo, or tap the Recurring pill, to choose how it repeats: one tap for every day, weekday, week, month or year, or set your own, such as every 3 weeks on Monday and Thursday, with a form that says the result in words. The rule is saved in the task note, and the task shows up in the daily notes that match it.", shot: "repeat" },
      { title: "Plan time ahead", text: "Tap an empty spot on the Day grid, or use Add time with a time still to come, to set aside time for a task today or on a day ahead. Planned blocks are dashed and never count as worked time; one that is over can be logged as worked. The task's Timer card shows Tracked so far and Planned, so you can compare your estimate with what it took. A setting under Task behavior (off by default) sets a task in progress when its planned block begins.", shot: "plan" },
      { title: "Time budgets", text: "Set a budget on a task's Timer card, or a total, daily, weekly or monthly budget on a project (Projects tab, or the project note's properties). A slim bar shows tracked and planned time against it, with what is left in words; go over and it grows red. No budget, no bar.", shot: "timer" },
      { title: "A calmer task panel", text: "Priority, schedule, recurring and projects are small pills in one row, the Timer is one line with icon buttons, and Description, Subtasks and Timer fold away and stay folded for every task. Tap a project pill to open its note." },
      { title: "Follows your daily note", text: "Organized uses the folder, filename format and template of the core Daily Notes plugin (or Periodic Notes) automatically (Settings → Organized → Daily notes switches back to custom values; installs that already set them keep them). Open or create a daily note and the side panel's calendar moves to that day; paging the day view on a desktop opens that day's note, and on a phone it opens when you close the panel." },
      { title: "Several devices without sync conflicts", text: "Settings → Organized → This device: set a phone or tablet to Secondary (it edits tasks but never creates or fills daily notes) or Mirror (view only; every change is refused with a notice). The choice stays on that device. Use it where a daily note may be opened before your main device has synced it.", figure: "devices" },
      { title: "Repairs for recurring tasks", text: "Two commands: Add missing recurring tasks to this daily note, and Remove duplicate recurring lines in this note (for a note two devices both filled). Task notes that Organized has to leave out, such as sync conflict copies, are now named in a notice instead of silently not repeating. Find both under Ctrl/Cmd+P.", figure: "repairs" },
      { title: "Project picker from the keyboard", text: "Arrow keys and Tab move through the search box, the projects and Save links, Enter ticks one, Enter in the search box picks the best match and Ctrl/Cmd+Enter saves. On a phone the list stays above the keyboard so every project can be reached." },
      { title: "Steadier on a phone", text: "Tapping outside the press-and-hold menu closes it without ticking the todo, and a todo's priority and projects that do not fit its line stay right-aligned on a row of their own." },
    ],
  },
  {
    version: "0.1.3",
    title: "What's new in Organized 0.1.3",
    intro: "A fix for subtasks.",
    items: [
      { title: "Edit checkbox marker works on subtasks", text: "The command Edit checkbox marker now selects the marker of a subtask at any depth, indented with spaces or tabs. Before, it only worked on top-level todos and said to put the cursor on a todo line." },
    ],
  },
  {
    version: "0.1.2",
    title: "What's new in Organized 0.1.2",
    intro: "Faster on your phone, and a quicker way into the checkbox from the keyboard.",
    items: [
      { title: "Press and hold a checkbox on your phone", text: "In a daily note, hold a todo's checkbox and a menu offers the markers that act: done, in progress, schedule, priority, projects, add time and more. Choosing one is the same as typing its letter. Turn it off under Settings → Task behavior.", figure: "press" },
      { title: "The [+] marker adds a subtask", text: "Type `+` in a checkbox, or choose Add subtask in the phone menu: an empty indented todo appears under it and the task picker opens." },
      { title: "Jump into a checkbox from the keyboard", text: "The command Edit checkbox marker selects the marker of the todo you are on, so the next key you type replaces it. It has no default key: bind your own under Settings → Hotkeys, for example `Alt+X`.", figure: "hotkey" },
      { title: "Projects, explained", text: "The README now has a short section on projects, and the project picker says why only notes with the property `organized_type: project` are listed." },
      { title: "A tour for new installs, this note for updates", text: "The welcome tour now appears only on a fresh install (reopen it with Show onboarding card). After an update you see a short note like this one, once. Reopen it with Show what's new, or switch it off under Settings → Help." },
    ],
  },
];

/** `[major, minor, patch]` from "0.9.0" or "0.9.0-beta.7"; null when it is not a version. */
export function baseVersion(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Every note not newer than `current`, oldest first. */
function upTo(current: string, notes: ReleaseNote[]): ReleaseNote[] {
  const cur = baseVersion(current);
  if (!cur) return [];
  return notes
    .filter((n) => {
      const v = baseVersion(n.version);
      return v !== null && compare(v, cur) <= 0;
    })
    .sort((a, b) => compare(baseVersion(a.version) as [number, number, number], baseVersion(b.version) as [number, number, number]));
}

/**
 * The entries to show: newer than `lastSeen`, not newer than `current`, oldest first, so someone who skipped a release is
 * told about both in the order they happened. An empty or unreadable `lastSeen` is not "the whole history": a device that
 * has never been told anything gets the note of the running release only. An unreadable `current` shows nothing rather
 * than guessing.
 */
export function notesToShow(lastSeen: string, current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const seen = baseVersion(lastSeen);
  if (!seen) {
    const latest = latestNote(current, notes);
    return latest ? [latest] : [];
  }
  return upTo(current, notes).filter((n) => compare(baseVersion(n.version) as [number, number, number], seen) > 0);
}

/**
 * What the "Show what's new" command opens: the note of the running release, i.e. what changed since the last stable one,
 * not the history of the line. The popup after an update shows each release only once; this is the way back. A version
 * without a note of its own falls back to the newest note there is.
 */
export function notesOfLine(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const latest = latestNote(current, notes);
  return latest ? [latest] : [];
}

/** The newest note that is not newer than `current`. */
export function latestNote(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote | null {
  const all = upTo(current, notes);
  return all.length > 0 ? all[all.length - 1] : null;
}
