/**
 * What the one-time onboarding card says: the idea behind the plugin, in a few short steps.
 *
 * It is not a release-notes list. `settings.onboardingSeen` records that it was shown (or skipped); the command
 * "Show onboarding card" and the Settings button reopen it at any time. Keep the texts short and in plain language:
 * the README and docs carry the detail. A step with a `figure` draws a small illustration under its text
 * (see `onboardingFigures.ts`); every figure id needs a builder there.
 */
import type { FigureId } from "./onboardingFigures";

export interface OnboardingStep {
  title: string;
  text: string;
  figure?: FigureId;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Your daily note stays your daily note",
    text: "Write todos in it as you always did, with plain `- [ ]` checkboxes. When you type a new one, Organized asks once: link it to a task, create a task, or keep it a plain todo. Use as little or as much of it as you like.",
    figure: "note",
  },
  {
    title: "Open the side panel",
    text: "Everything else happens in the side panel. Click the calendar icon in the ribbon, or run Open inspector from the command palette. It has four tabs, shown as icons at its top right:",
    figure: "tabs",
  },
  {
    title: "The panel follows your cursor",
    text: "Put the cursor on a linked todo and the Task tab shows its details, where you change priority, date, notes or the timer. On any other line it lists the note's todos; tap one to jump to it.",
    figure: "follow",
  },
  {
    title: "Unfinished work follows you",
    text: "Open today's note and yesterday's open todos are already there. The old line is marked as forwarded, so history stays honest and nothing silently disappears.",
    figure: "forward",
  },
  {
    title: "A todo grows only when it needs to",
    text: "A task starts as a title and a status. Priority, a date, a description, projects or a timer appear only when you ask for them (Add details…), so a todo costs nothing until it deserves more.",
    figure: "card",
  },
  {
    title: "Type a letter in the checkbox",
    text: "No menus needed: put a letter between the brackets and the todo does that. The first six are below; the README lists them all.",
    figure: "keys",
  },
  {
    title: "See where your time went",
    text: "Set a task In Progress, or press `[/]`, and the Day and Week views in the Calendar tab show it as a block of time. Time worked can also be added or corrected by hand.",
    figure: "day",
  },
  {
    title: "It is still your Markdown",
    text: "Every task is a plain note (`Tasks/<id>.md`). Uninstall the plugin and you keep everything. No account, no server, no tracking. Reopen this card any time with the command Show onboarding card, or from Settings. Found a problem in this beta? Open an issue on GitHub (davadev/Organized).",
  },
];
