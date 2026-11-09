/**
 * What the one-time "What's new" popup says after an update, and which notes a person is shown.
 *
 * Shown once per device per release: `settings.lastSeenVersion` remembers the newest version the person has been told about
 * (never synced on purpose), and `notesToShow` picks the entries newer than that and not newer than the version that is
 * running. Only the `X.Y.Z` part is compared, so every beta of a version counts as that version: a tester sees its note on the
 * first beta that has it, not again on later betas or on the stable release. Notes stack within a minor line: never delete an
 * earlier entry of the line you are in (`npm run check-release` fails if you do). A fresh install is told nothing, it gets the
 * onboarding card instead. See docs/onboarding-and-whats-new.md.
 */
import type { FigureId } from "../onboardingFigures";

export interface ReleaseNoteItem {
  title: string;
  text: string;
  /** A small illustration drawn from real interface elements (see onboardingFigures.ts). */
  figure?: FigureId;
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
    version: "0.1.4",
    title: "What's new in Organized 0.1.4",
    intro: "Block time for the future, and see estimate next to actual.",
    items: [
      { title: "Plan time ahead", text: "Tap an empty spot on the Day grid, or use Add time with a time still to come, to set aside time for a task today or on a day ahead. Planned blocks are dashed and never count as worked time; one that is over can be logged as worked." },
      { title: "Tracked and planned on the task", text: "The task's Timer card shows Tracked so far and Planned, so you can compare your estimate with what it took." },
      { title: "Time budget", text: "Set a budget on the Timer card and a slim bar shows tracked and planned time against it, with what is left in words. Go over and the bar grows with the overrun in red. No budget, no bar." },
      { title: "Tasks start at their planned time", text: "A new setting under Task behavior, off by default: while Obsidian is open, a task is set in progress when its planned block begins (no timer starts) and back to open, with a notice, when it ends." },
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

/**
 * The entries to show: newer than `lastSeen`, not newer than `current`, oldest first, so someone who skipped a release is
 * told about both in the order they happened. An empty or unreadable `lastSeen` means "never told anything"; an
 * unreadable `current` shows nothing rather than guessing.
 */
export function notesToShow(lastSeen: string, current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const cur = baseVersion(current);
  if (!cur) return [];
  const seen = baseVersion(lastSeen) ?? [0, 0, 0];
  return notes
    .filter((n) => {
      const v = baseVersion(n.version);
      return v !== null && compare(v, seen) > 0 && compare(v, cur) <= 0;
    })
    .sort((a, b) => compare(baseVersion(a.version) as [number, number, number], baseVersion(b.version) as [number, number, number]));
}

/**
 * What the "Show what's new" command opens: every note of the running minor line (0.9.0 and 0.9.1 for a 0.9.1), oldest
 * first, so someone can look back at the whole line on demand. The popup after an update shows each release only once;
 * this is the way back. A version whose line has no note of its own falls back to the newest note there is.
 */
export function notesOfLine(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const cur = baseVersion(current);
  const line = notesToShow("", current, notes).filter((n) => {
    const v = baseVersion(n.version);
    return cur !== null && v !== null && v[0] === cur[0] && v[1] === cur[1];
  });
  const latest = latestNote(current, notes);
  return line.length > 0 ? line : latest ? [latest] : [];
}

/** The newest note that is not newer than `current`. */
export function latestNote(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote | null {
  const all = notesToShow("", current, notes);
  return all.length > 0 ? all[all.length - 1] : null;
}
