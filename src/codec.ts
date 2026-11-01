import type { Section, Settings, Priority } from "./model";
import { PRIORITIES } from "./model";
import { parser } from "@lezer/markdown";

export interface TaskLine { line: number; raw: string; prefix: string; marker: string; title: string; id: string | null; repeat: boolean; section: Section[] }
export const ID = /<!--organized:([a-zA-Z0-9_-]{8,80})-->/g;
const TASK = /^(\s*(?:[-+*]|\d+[.)]) \[)([^\]])(\] )(.*)$/;
export const NOTE_SECTIONS = ["Description", "Idea", "Question", "Sources", "Notes"] as const;
export type NoteSection = typeof NOTE_SECTIONS[number];
const SECTION_HEADINGS: Record<NoteSection, string[]> = {
  Description: ["Description", "Information"], Idea: ["Idea"], Question: ["Question"], Sources: ["Sources"], Notes: ["Notes"],
};
function sectionRegex(heading: string): RegExp { return new RegExp(`(^|\\n)## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`); }
export function noteSection(note: string, section: NoteSection): string {
  for (const heading of SECTION_HEADINGS[section]) {
    const match = sectionRegex(heading).exec(note); if (match) return match[2].trim();
  }
  return "";
}
/** Writes a canonical heading. Legacy `## Information` is migrated to `## Description`. */
export function writeNoteSection(note: string, section: NoteSection, text: string): string {
  const content = text.endsWith("\n") ? text.slice(0, -1) : text;
  for (const heading of SECTION_HEADINGS[section]) {
    const regex = sectionRegex(heading);
    if (regex.test(note)) return note.replace(regex, (_whole, lead: string) => `${lead}## ${section}\n${content}\n`);
  }
  return `${note}${note && !note.endsWith("\n") ? "\n" : ""}## ${section}\n${content}\n`;
}
export function noteLoose(note: string): string {
  let loose = note;
  for (const heading of new Set(Object.values(SECTION_HEADINGS).flat())) loose = loose.replace(sectionRegex(heading), "$1");
  return loose.trim();
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
export function taskText(task: TaskLine, updates: { title?: string; marker?: string; id?: string; repeat?: boolean }): string {
  const id = updates.id ?? task.id; const repeat = updates.repeat ?? task.repeat;
  return `${task.prefix}${updates.marker ?? task.marker}] ${updates.title ?? task.title}${id ? ` <!--organized:${id}-->` : ""}${repeat ? " <!--organized:repeat-->" : ""}${task.raw.endsWith("\r") ? "\r" : ""}`;
}
export function replaceTask(text: string, task: TaskLine, updates: Parameters<typeof taskText>[1]): string {
  const lines = text.split("\n"); if (lines[task.line] !== task.raw) throw new Error("Task line changed. Retry from its current position.");
  lines[task.line] = taskText(task, updates); return lines.join("\n");
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
    if (found) insert = headings.find(h => h.line > found.line && h.section[h.section.length - 1].level <= section[section.length - 1].level)?.line ?? lines.length;
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
    const at = parent ? headings.find(h => h.line > parent.line && h.section[h.section.length - 1].level <= parent.section[parent.section.length - 1].level)?.line ?? lines.length : lines.length;
    lines.splice(at, 0, "", ...generated, line, "");
    return { text: lines.join(newline), missing: true };
  }
  lines.splice(insert, 0, line); return { text: lines.join(newline), missing: false };
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
  const sorted = [...group].sort((a, b) => PRIORITIES.indexOf(priorities.get(a.id ?? "") ?? "none") - PRIORITIES.indexOf(priorities.get(b.id ?? "") ?? "none"));
  if (scope === "first") {
    const selected = group.find(t => t.line === line)!;
    sorted.splice(sorted.indexOf(selected), 1); sorted.unshift(selected);
  }
  const blocks = sorted.map(t => lines.slice(t.line, endOfBlock(t)));
  for (let i = group.length - 1; i >= 0; i--) lines.splice(group[i].line, endOfBlock(group[i]) - group[i].line, ...blocks[i]);
  return lines.join("\n");
}
