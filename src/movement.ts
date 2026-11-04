import type { Movement, Task } from "./model";

/** Three rows of ten; a task that moved more often is drawn as a slider instead of squares. */
export const MAX_CELLS = 30;
/** A project needs this many tasks that were forwarded before its own habits replace the global ones. */
export const MIN_PROJECT_TASKS = 5;
/** Forwarding this often is always the red end, so one forward in a sparse vault is never alarming. */
const MIN_RED = 3;
/** Green, yellow, orange, red. */
export type HeatLevel = 0 | 1 | 2 | 3;
/** Forward counts at which a task turns yellow and red. */
export interface HeatScale { yellow: number; red: number }
export interface Cell { deliberate: boolean; level: HeatLevel; label: string }
export interface Slider { position: number; level: HeatLevel; deliberate: boolean; stops: [number, number] }

const forwards = (task: Task): number => task.movement_history.filter(event => event.kind === "forward").length;
const percentile = (sorted: number[], p: number): number => sorted[Math.ceil(p * sorted.length) - 1];
/** A date the user picked, as opposed to one the plugin carried over. */
const deliberate = (event: Movement): boolean => event.kind !== "forward";

/** Green until the user's usual (median) forward count, red from their long tail (90th percentile). Without any history the defaults are 2 and 5. */
export function heatScale(counts: number[]): HeatScale {
  const sorted = counts.filter(count => count > 0).sort((a, b) => a - b);
  if (!sorted.length) return { yellow: 2, red: 5 };
  const red = Math.max(percentile(sorted, 0.9), MIN_RED);
  return { yellow: Math.max(1, Math.min(percentile(sorted, 0.5), red - 1)), red };
}

/** The task's project decides the scale when enough of its tasks were forwarded; otherwise every task does. */
export function scaleFor(task: Task, tasks: Task[]): HeatScale {
  for (const project of task.projects) {
    const peers = tasks.filter(other => other.projects.includes(project) && forwards(other) > 0);
    if (peers.length >= MIN_PROJECT_TASKS) return heatScale(peers.map(forwards));
  }
  return heatScale(tasks.map(forwards));
}

export function heatLevel(forwarded: number, scale: HeatScale): HeatLevel {
  if (forwarded < scale.yellow) return 0;
  if (forwarded < (scale.yellow + scale.red) / 2) return 1;
  return forwarded < scale.red ? 2 : 3;
}

/** One cell per movement, oldest first; a forward is coloured by how many forwards the task had by then. */
export function cells(task: Task, scale: HeatScale): Cell[] {
  let forwarded = 0;
  return task.movement_history.map(event => {
    if (event.kind === "forward") forwarded++;
    return { deliberate: deliberate(event), level: heatLevel(forwarded, scale), label: `${event.kind} · ${event.source} · ${event.from} → ${event.to} · ${event.at}` };
  });
}

/** Where the task stands between "just started slipping" (0) and "red" (100), plus where yellow and orange start on that track. */
export function slider(task: Task, scale: HeatScale): Slider {
  const count = forwards(task);
  return {
    position: Math.min(100, count / scale.red * 100), level: heatLevel(count, scale), deliberate: deliberate(task.movement_history.at(-1)!),
    stops: [scale.yellow / scale.red * 100, (scale.yellow + scale.red) / 2 / scale.red * 100],
  };
}
