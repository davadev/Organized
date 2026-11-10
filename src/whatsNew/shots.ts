/**
 * Real crops of the plugin's own panel, rendered by `npm run screenshots` (scripts/render-screenshots.mjs, the SHOTS table)
 * from the real view code and styles.css, and embedded in the bundle as data URLs so the What's new note needs no network
 * and no extra release file. Each has a light and a dark version; the theme picks which one shows.
 */
import repeatLight from "./shots/repeat-light.png";
import repeatDark from "./shots/repeat-dark.png";
import timerLight from "./shots/timer-light.png";
import timerDark from "./shots/timer-dark.png";
import planLight from "./shots/plan-light.png";
import planDark from "./shots/plan-dark.png";

export type ShotId = "repeat" | "timer" | "plan";
export const SHOTS: Record<ShotId, { light: string; dark: string; alt: string }> = {
  repeat: { light: repeatLight, dark: repeatDark, alt: "The Task tab's property pills: priority, date, the Recurring pill reading Every 3 weeks on Thu, and a project." },
  timer: { light: timerLight, dark: timerDark, alt: "The Timer card of a task: time tracked and planned, a bar against a 4 hour budget with 10 minutes left, and the icon buttons on its header." },
  plan: { light: planLight, dark: planDark, alt: "The Day grid with a block of worked time and, below it, a dashed block of planned time." },
};
