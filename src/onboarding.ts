/**
 * What the one-time onboarding card says: the idea behind the plugin, in a few short steps.
 *
 * It is not a release-notes list. `settings.onboardingSeen` records that it was shown (or skipped); the command
 * "Show onboarding card" and the Settings button reopen it at any time. Keep the texts short and in plain language:
 * the README and docs carry the detail. The first step is what a person who skips the rest still needs. A step with a
 * `figure` draws a small illustration under its text (see `onboardingFigures.ts`); every figure id needs a builder there.
 * Backticks in a text show as code.
 */
import type { FigureId } from "./onboardingFigures";

export interface OnboardingStep {
  title: string;
  text: string;
  figure?: FigureId;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Two settings first",
    text: "Please read this short card to the end; it makes everything easier. First open Settings → Organized and match Daily-note folder and Filename format to your daily notes (and set Daily-note template if you use one). Until then Organized looks in the wrong place and seems to do nothing. Everything else is optional.",
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
    text: "A task starts as a title and a status. Priority, a date, a description, projects or a timer appear when you ask. Set a priority with `[!]` and, with sorting on, the note itself floats the important todos up, so the panel is nice to have, not required.",
    figure: "card",
  },
  {
    title: "Show details right in the note",
    text: "Under Settings → Organized → Rendered task properties you choose which details (priority, tracked time, projects, notes…) appear on the todo line itself, in Reading view and Live Preview. It is off by default, and your Markdown does not change.",
    figure: "props",
  },
  {
    title: "Type a letter in the checkbox",
    text: "No menus needed: put a letter between the brackets. `[n]` gives a todo its own note, for things that deserve more than a line. The first six are below; the README lists them all.",
    figure: "keys",
  },
  {
    title: "Starting, and leaving",
    text: "To start, run Convert unchecked todos to tasks in a note you already have. To leave after long use, run Convert all tasks in the vault back to todos before you remove Organized. Your task and project notes stay as ordinary Markdown files, safe to keep or delete.",
    figure: "commands",
  },
  {
    title: "It is still your Markdown",
    text: "Every task is a plain note (`Tasks/<id>.md`). No account, no server, no tracking. You can reopen this card any time with the command Show onboarding card, or from Settings. Found a problem in this beta? Open an issue on GitHub (davadev/Organized).",
  },
];
