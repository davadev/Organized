/**
 * What the one-time onboarding card says: the idea behind the plugin, in a few short steps.
 *
 * It is not a release-notes list. `settings.onboardingSeen` records that it was shown (or skipped); the command
 * "Show onboarding card" and the Settings button reopen it at any time. Keep the texts short and in plain language:
 * the README and docs carry the detail. The first step is what a person who skips the rest still needs. A step with a
 * `figure` draws a small illustration under its text (see `onboardingFigures.ts`); every figure id needs a builder there. A `shot` is a real crop of the panel.
 * Backticks in a text show as code.
 */
import type { FigureId } from "./onboardingFigures";
import type { ShotId } from "./whatsNew/shots";

export interface OnboardingStep {
  title: string;
  text: string;
  figure?: FigureId;
  /** A real crop of the plugin's own panel, drawn instead of a figure where the step is about a part of that panel (see whatsNew/shots.ts). */
  shot?: ShotId;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Two settings first",
    text: "Please read this short card to the end; it makes everything easier. Organized follows your Daily Notes plugin (Settings → Organized → Daily notes shows what it found). If you keep daily notes some other way, choose Custom settings there and match Daily-note folder and Filename format, or Organized looks in the wrong place and seems to do nothing. Everything else is optional.",
    figure: "settings",
  },
  {
    title: "Your daily note stays your daily note",
    text: "Write todos in it as always. When you type a new checkbox, Organized asks once: link it to a task, create one, or keep it a plain todo. Unfinished todos follow you: open today's note and yesterday's open ones are already there, the old line marked as forwarded.",
    figure: "forward",
  },
  {
    title: "Open the side panel",
    text: "Click the calendar icon in the ribbon, or run Open inspector from the command palette. The panel has four tabs, shown as icons at its top right:",
    figure: "tabs",
  },
  {
    title: "Month, week and day",
    text: "Set a task In Progress, or type `[/]`, and its time is recorded. The Calendar tab shows your days three ways:",
    figure: "calendar",
  },
  {
    title: "The Task tab is your overview",
    text: "Put the cursor on a linked todo and the Task tab shows it in detail. On any other line it lists the note's todos, and you can hide forwarded, scheduled and done ones to see only what is left. Tap a task to see and add its properties.",
    figure: "follow",
  },
  {
    title: "A todo grows only when it needs to",
    text: "A task starts as a title and a status. Priority, a date, a description, projects or a timer appear when you ask. With `[!]` and sorting on, the note itself floats important todos up. Indent a todo under another (Tab) for a subtask: completing, canceling or forwarding the parent takes the open ones along. Three panel buttons add, link or move subtasks. Link any note with `[[Note]]`.",
    figure: "card",
  },
  {
    title: "Show details right in the note",
    text: "Under Settings → Organized → Rendered task properties you choose which details (priority, star, recurring, tracked time, projects, description…) appear on the todo line itself, in Reading view and Live Preview, as small symbols: a yellow star, a green repeat sign, a flag, a timer with the time. It is off by default, and your Markdown does not change.",
    figure: "props",
  },
  {
    title: "Type a letter in the checkbox",
    text: "No menus needed: a letter between the brackets does what the panel does. Set priority, schedule days and times, start a timer, log time worked, link projects, repeat, favorite. `[n]` gives a todo its own note, `[+]` adds a subtask. Eight are below; the README lists them all.",
    figure: "keys",
  },
  {
    title: "Repeat a todo",
    text: "Type `[r]` in a todo, or tap the Recurring pill in the Task tab, and pick how it repeats: every day, weekday, week, month or year, or your own, such as every 3 weeks on Monday and Thursday. The rule lives in the task note, and the todo appears in each daily note that matches it.",
    shot: "repeat",
  },
  {
    title: "Plan your time, and set a budget",
    text: "Tap an empty spot on the Day grid, or type `[t]` with a time still to come, to set time aside; planned blocks are dashed and never count as worked. The Timer card compares tracked and planned time, and its target button sets a budget, shown as a bar.",
    shot: "plan",
  },
  {
    title: "On your phone: press and hold",
    text: "No keyboard needed. In a daily note, press and hold a todo's checkbox and a menu lists the markers that act, with the current one ticked. Choosing one is the same as typing its letter. You can turn this off under Settings → Task behavior.",
    figure: "press",
  },
  {
    title: "On a computer: jump into the checkbox",
    text: "Run the command Edit checkbox marker on a todo line and its marker is selected, so the next key you type replaces it. It has no default key: give it one under Settings → Hotkeys (for example `Alt+X`).",
    figure: "hotkey",
  },
  {
    title: "Using several devices",
    text: "Two devices writing the same daily note before it has synced cause conflicts. On a phone or tablet that may open a note first, set Settings → Organized → This device to Secondary (edits, but never creates or fills daily notes) or Mirror (view only). The choice stays on that device.",
    figure: "devices",
  },
  {
    title: "Starting, and leaving",
    text: "To start, run Convert unchecked todos to tasks in a note you already have. To leave, or to tidy up finished tasks, run Retire tasks…: choose whether todos become plain text or links, whether task notes are renamed to their titles, trashed or kept, and whether their properties stay. Nothing changes until you confirm, and Undo helps.",
    figure: "commands",
  },
  {
    title: "It is still your Markdown",
    text: "Every task is a plain note named after your todo, in the Tasks folder. No account, no server, no tracking. This tour appears on a fresh install only; after an update you get a short What's new instead. Reopen either with the commands Show onboarding card and Show what's new, or from Settings. Found a problem? Open an issue on GitHub (davadev/Organized).",
  },
];
