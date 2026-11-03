import type { Section, Settings, Priority } from "./model";
import { PRIORITIES } from "./model";
import { parser } from "@lezer/markdown";

export interface TaskLine { line: number; raw: string; prefix: string; marker: string; title: string; id: string | null; repeat: boolean; section: Section[] }
export const ID = /<!--organized:([a-zA-Z0-9_-]{8,80})-->/g;
const TASK = /^(\s*(?:[-+*]|\d+[.)]) \[)([^\]])(\] )(.*)$/;
/** The two parts of a task note's body: the description (the text itself, no heading) and an optional `## Sources` block. */
export const NOTE_SECTIONS = ["Description", "Sources"] as const;
export type NoteSection = typeof NOTE_SECTIONS[number];
/** Markers that act when typed. Any other letter is formatting only, so themes can style it freely. */
export const SECTION_MARKERS: Record<string, NoteSection> = { a: "Description", s: "Sources" };
export const PROJECT_MARKER = "j";
export const RECURRING_MARKER = "r";
/** Turns a todo into a standalone note and leaves a link to it. */
export const NOTE_MARKER = "n";
export const ACTION_MARKERS = `<>/!xX-*${Object.keys(SECTION_MARKERS).join("")}${PROJECT_MARKER}${RECURRING_MARKER}${NOTE_MARKER}`;
/**
 * Task note body: the description is the text itself and `## Sources` is the only heading Organized writes, so the note reads
 * naturally without the plugin. Older notes used `## Description`, `## Notes` (and `## Idea`/`## Question`) headings; they are
 * still read, merged into the description with nothing dropped, and rewritten in the new shape when saved or migrated.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;
/** Legacy headings that open a section. Any other heading inside text (a `## Plan` in a description) is content. */
const LEGACY_TITLES = ["Description", "Information", "Idea", "Question", "Sources", "Notes"].join("|");
function sectionRegex(headings: string[]): RegExp { return new RegExp(`(^|\\n)## (?:${headings.join("|")})[ \\t]*(?:\\n([\\s\\S]*?))?(?=\\n## (?:${LEGACY_TITLES})[ \\t]*(?:\\n|$)|$)`, "g"); }
/** Text of every section under one of these headings, joined; a duplicated heading keeps both texts. */
function legacySections(body: string, headings: string[]): string { return [...body.matchAll(sectionRegex(headings))].map(m => (m[2] ?? "").trim()).filter(Boolean).join("\n\n"); }
/** Has a heading from the old layout that this version no longer writes (`## Notes` counts, so notes with only that heading migrate too). */
export function hasLegacyHeading(body: string): boolean { return /(^|\n)## (?:Description|Information|Notes)[ \t]*(?:\n|$)/.test(body); }
function readLegacy(body: string): { description: string; sources: string } {
  let loose = body;
  for (const headings of [["Description", "Information"], ["Sources"], ["Notes"]]) loose = loose.replace(sectionRegex(headings), "$1");
  const description = [legacySections(body, ["Description", "Information"]), legacySections(body, ["Notes"]), loose.trim()].filter(Boolean).join("\n\n");
  return { description, sources: legacySections(body, ["Sources"]) };
}
/** Description and sources of a note body, in either layout. */
export function readNote(body: string, broad = false): { description: string; sources: string } {
  const text = body.replace(/\r\n/g, "\n");
  if (broad ? hasLegacyHeading(text) : /(^|\n)## (?:Description|Information)[ \t]*(?:\n|$)/.test(text)) return readLegacy(text);
  const heading = /(^|\n)## Sources[ \t]*\n/.exec(text);
  if (!heading) return { description: text.trim(), sources: "" };
  const before = text.slice(0, heading.index), after = text.slice(heading.index + heading[0].length);
  const next = /\n## /.exec(after);
  const sources = (next ? after.slice(0, next.index) : after).trim();
  return { description: [before.trim(), next ? after.slice(next.index + 1).trim() : ""].filter(Boolean).join("\n\n"), sources };
}
export function noteSection(body: string, section: NoteSection): string { return readNote(body)[section === "Description" ? "description" : "sources"]; }
function compose(description: string, sources: string, newline: string): string {
  const parts = [description.trim(), sources.trim() ? `## Sources\n${sources.trim()}` : ""].filter(Boolean);
  return parts.length ? `${parts.join("\n\n")}\n`.replace(/\n/g, newline) : "";
}
function rebuild(text: string, broad: boolean, change: (note: { description: string; sources: string }) => { description: string; sources: string }): string {
  const front = FRONTMATTER.exec(text)?.[0] ?? ""; const body = text.slice(front.length);
  const newline = body.includes("\r\n") || (!body && front.includes("\r\n")) ? "\r\n" : "\n";
  const lead = /^(?:\r?\n)*/.exec(body)![0] || (front ? newline : "");
  const next = change(readNote(body, broad));
  return `${front}${lead}${compose(next.description, next.sources, newline)}`;
}
/** Writes one part of the note, leaving the other as it is. Any older layout is rewritten in the new one. */
export function writeNoteSection(text: string, section: NoteSection, value: string): string {
  return rebuild(text, false, note => section === "Description" ? { ...note, description: value } : { ...note, sources: value });
}
/** The body of a note written in the old layout, rewritten in the new one; null when there is nothing to change. */
export function migrateNote(text: string): string | null {
  const front = FRONTMATTER.exec(text)?.[0] ?? "";
  if (!hasLegacyHeading(text.slice(front.length).replace(/\r\n/g, "\n"))) return null;
  return rebuild(text, true, note => note);
}
const cache = new Map<string, { tasks: TaskLine[]; headings: { line: number; section: Section[] }[] }>();
export function parseTasks(text: string, onHeading?: (line: number, section: Section[]) => void): TaskLine[] {
  const cached = cache.get(text);
  if (cached) { for (const h of cached.headings) onHeading?.(h.line, h.section); return cached.tasks; }
  const tasks: TaskLine[] = []; const headings: { line: number; section: Section[] }[] = [];
  let offset = 0;
  const lines = text.split("\n").map((raw, line) => { const row = { raw, line, from: offset }; offset += raw.length + 1; return row; });
  let bodyStart = 0;
  if (lines[0].raw.replace(/\r$/, "") === "---") {
    const end = lines.findIndex((row, index) => index > 0 && /^(---|\.\.\.)\r?$/.test(row.raw));
    bodyStart = end < 0 ? text.length : lines[end].from + lines[end].raw.length + 1;
  }
  const rowAt = (position: number) => {
    let low = 0; let high = lines.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (lines[mid].from <= position) low = mid; else high = mid; }
    return lines[low];
  };
  const section: Section[] = []; const counts = new Map<string, number>();
  parser.parse(text.slice(bodyStart)).iterate({ enter(node) {
    // A real Markdown tree, not regex heuristics, defines which text is code,
    // HTML, quoted content or an actual list item (including nested fences).
    if (["FencedCode", "CodeBlock", "Blockquote", "HTMLBlock", "CommentBlock"].includes(node.name)) return false;
    const { raw, line } = rowAt(node.from + bodyStart);
    if (/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name)) {
      const level = Number(node.name.slice(-1));
      const title = raw.replace(/^ {0,3}#{1,6}(?:\s+|$)/, "").replace(/\s+#+\s*$/, "").trim();
      while (section.length && section[section.length - 1].level >= level) section.pop();
      const key = JSON.stringify(section) + level + title; const ordinal = counts.get(key) ?? 0; counts.set(key, ordinal + 1);
      section.push({ level, text: title, ordinal }); headings.push({ line, section: section.map(s => ({ ...s })) });
    }
    if (node.name !== "ListItem") return;
    const match = TASK.exec(raw.replace(/\r$/, "")); if (!match) return;
    const ids = [...match[4].matchAll(ID)]; if (ids.length > 1) return;
    tasks.push({ line, raw, prefix: match[1], marker: match[2], title: match[4].replace(ID, "").replace(/<!--organized:repeat-->/g, "").trim(), id: ids[0]?.[1] ?? null, repeat: match[4].includes("<!--organized:repeat-->"), section: section.map(s => ({ ...s })) });
  } });
  cache.set(text, { tasks, headings }); if (cache.size > 4) cache.delete(cache.keys().next().value!);
  for (const h of headings) onHeading?.(h.line, h.section);
  return tasks;
}
export function taskText(task: TaskLine, updates: { title?: string; marker?: string; id?: string | null; repeat?: boolean }): string {
  const id = Object.prototype.hasOwnProperty.call(updates, "id") ? updates.id : task.id; const repeat = updates.repeat ?? task.repeat;
  return `${task.prefix}${updates.marker ?? task.marker}] ${updates.title ?? task.title}${id ? ` <!--organized:${id}-->` : ""}${repeat ? " <!--organized:repeat-->" : ""}${task.raw.endsWith("\r") ? "\r" : ""}`;
}
export function replaceTask(text: string, task: TaskLine, updates: Parameters<typeof taskText>[1]): string {
  const lines = text.split("\n"); if (lines[task.line] !== task.raw) throw new Error("Task line changed. Retry from its current position.");
  lines[task.line] = taskText(task, updates); return lines.join("\n");
}
/** Index just after the last non-blank line before `end`, so appended items sit directly under existing ones. */
function afterContent(lines: string[], end: number, floor: number): number {
  let at = end; while (at > floor && lines[at - 1].trim() === "") at--;
  return at;
}
export function insertTask(text: string, line: string, section: Section[]): { text: string; missing: boolean } {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/); let insert = -1;
  const headings: { line: number; section: Section[] }[] = [];
  parseTasks(text, (line, section) => headings.push({ line, section }));
  if (!section.length) {
    insert = headings[0]?.line ?? lines.length;
  } else {
    const found = headings.find(h => JSON.stringify(h.section) === JSON.stringify(section));
    if (found) {
      const end = headings.find(h => h.line > found.line && h.section[h.section.length - 1].level <= section[section.length - 1].level)?.line ?? lines.length;
      insert = afterContent(lines, end, found.line + 1);
      // A heading with nothing under it keeps its blank separator above the new item.
      if (insert === found.line + 1 && insert < end) insert++;
    }
  }
  if (insert < 0) {
    let parent: { line: number; section: Section[] } | undefined;
    for (let length = section.length - 1; length > 0 && !parent; length--) parent = headings.find(h => JSON.stringify(h.section) === JSON.stringify(section.slice(0, length)));
    const generated: string[] = [];
    for (let depth = parent?.section.length ?? 0; depth < section.length; depth++) {
      const desired = section[depth];
      const existing = headings.filter(h => h.section.length === depth + 1 && h.section[depth].text === desired.text && h.section[depth].level === desired.level && JSON.stringify(h.section.slice(0, depth)) === JSON.stringify(section.slice(0, depth))).length;
      for (let ordinal = existing; ordinal <= desired.ordinal; ordinal++) generated.push(`${"#".repeat(desired.level)} ${desired.text}`, "");
    }
    const end = parent ? headings.find(h => h.line > parent.line && h.section[h.section.length - 1].level <= parent.section[parent.section.length - 1].level)?.line ?? lines.length : lines.length;
    // A trailing newline stays the last thing in the file; blank lines are added only where they separate blocks.
    const at = afterContent(lines, end === lines.length && lines[end - 1] === "" ? end - 1 : end, 0);
    const block = [...(at > 0 ? [""] : []), ...generated, line, ...(at < lines.length && lines[at].trim() !== "" ? [""] : at === lines.length ? [""] : [])];
    lines.splice(at, 0, ...block);
    return { text: lines.join(newline), missing: true };
  }
  lines.splice(insert, 0, line); return { text: lines.join(newline), missing: false };
}
/** Status sections of a project note, in the order a project reads: what is being done, what waits, what is finished. */
export const PROJECT_SECTIONS = { in_progress: "In progress", open: "Open", completed: "Done", canceled: "Canceled" } as const;
/** Recurring tasks never finish, so in a project note they live under their own heading instead of a status one. */
export const PROJECT_ONGOING = "Ongoing";
export const projectSection = (task: { recurring: boolean; status: keyof typeof PROJECT_SECTIONS }): string => task.recurring ? PROJECT_ONGOING : PROJECT_SECTIONS[task.status];
/** The heading path to use for `name` in a note: an existing heading of that name at any level, else a new level-2 heading. */
export function sectionNamed(text: string, name: string): Section[] {
  let found: Section[] | null = null;
  parseTasks(text, (_line, section) => { if (!found && section.at(-1)?.text.toLocaleLowerCase() === name.toLocaleLowerCase()) found = section; });
  return found ?? [{ level: 2, text: name, ordinal: 0 }];
}
/** Moves the single line carrying `id` under the heading `name`, creating the heading when it is missing. A line already there stays where it is. */
export function moveTask(text: string, id: string, name: string): string {
  const matches = parseTasks(text).filter(t => t.id === id); if (matches.length !== 1) throw new Error("Occurrence is missing or ambiguous; preserved for repair.");
  const target = sectionNamed(text, name); if (JSON.stringify(matches[0].section) === JSON.stringify(target)) return text;
  const lines = text.split("\n"); const [moved] = lines.splice(matches[0].line, 1);
  return insertTask(lines.join("\n"), moved.replace(/\r$/, ""), target).text;
}
export function removeUnique(text: string, id: string, repeatOnly = false): string {
  const matches = parseTasks(text).filter(t => t.id === id && (!repeatOnly || t.repeat));
  if (matches.length !== 1) throw new Error("Occurrence is missing or ambiguous; preserved for repair.");
  const lines = text.split("\n"); lines.splice(matches[0].line, 1); return lines.join("\n");
}
export function sortTasks(text: string, line: number, scope: Settings["sortScope"], priorities: Map<string, Priority>): string {
  if (scope === "none") return text;
  const tasks = parseTasks(text); const target = tasks.find(t => t.line === line); if (!target) return text;
  const lines = text.split("\n");
  const indentation = (raw: string) => /^\s*/.exec(raw)![0].replace(/\t/g, "    ").length;
  const indent = indentation(target.raw);
  let group = tasks.filter(t => JSON.stringify(t.section) === JSON.stringify(target.section) && indentation(t.raw) === indent);
  const endOfBlock = (task: TaskLine) => {
    let end = task.line + 1;
    while (end < lines.length && lines[end].trim() && indentation(lines[end]) > indent) end++;
    return end;
  };
  if (scope === "list") {
    let start = group.indexOf(target); let end = start;
    while (start > 0 && endOfBlock(group[start - 1]) === group[start].line) start--;
    while (end < group.length - 1 && endOfBlock(group[end]) === group[end + 1].line) end++;
    group = group.slice(start, end + 1);
  }
  // What is being worked on comes first; forwarded and scheduled lines are no longer today's work, so they rank as no priority whatever they were given.
  const rank = (task: TaskLine) => task.marker === "/" ? -1 : task.marker === ">" || task.marker === "<" ? PRIORITIES.indexOf("none") : PRIORITIES.indexOf(priorities.get(task.id ?? "") ?? "none");
  const sorted = [...group].sort((a, b) => rank(a) - rank(b));
  if (scope === "first") {
    const selected = group.find(t => t.line === line)!;
    sorted.splice(sorted.indexOf(selected), 1); sorted.unshift(selected);
  }
  const blocks = sorted.map(t => lines.slice(t.line, endOfBlock(t)));
  for (let i = group.length - 1; i >= 0; i--) lines.splice(group[i].line, endOfBlock(group[i]) - group[i].line, ...blocks[i]);
  return lines.join("\n");
}
