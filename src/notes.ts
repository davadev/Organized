import { stringifyYaml } from "obsidian";
import { object } from "./model";
import { splitNote } from "./repository";

/** Emphasis markers that wrap text (`_a_`, `__a__`, `**a**`, `~~a~~`, `` `a` ``), without touching an underscore, tilde or backtick that belongs to the title (`snake_case`, `_`, `~5 min`). */
function withoutEmphasis(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}_])(_{1,2})(?=\S)(.*?\S)\2(?![\p{L}\p{N}_])/gu, "$1$3").replace(/\*{1,3}(?=\S)(.*?\S)\*{1,3}/g, "$1").replace(/~~(?=\S)(.*?\S)~~/g, "$1").replace(/`([^`]+)`/g, "$1");
}
/** A filename for a todo's title: links and emphasis reduced to their text, characters Obsidian or the OS reject removed, kept to a sensible length. */
export function noteName(title: string): string {
  const plain = withoutEmphasis(title.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<!--.*?-->/g, ""));
  const safe = plain.replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
  const short = Array.from(safe).slice(0, 100).join("").trim();
  return short || "Untitled";
}
/** `a, #b c` as tags `a`, `b`, `c`: leading # dropped, duplicates and anything Obsidian would not accept as a tag ignored. */
export function cleanTags(input: string): string[] {
  const tags = input.split(/[\s,]+/).map(tag => tag.replace(/^#+/, "")).filter(tag => /^[\p{L}\p{N}_/-]+$/u.test(tag) && /\D/.test(tag));
  return [...new Set(tags)];
}
/** The path for a new note: the name as is, or `Name 2`, `Name 3`… until it is free. */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
  const at = (suffix: string) => `${folder ? `${folder}/` : ""}${name}${suffix}.md`;
  for (let n = 1; n < 1000; n++) { const candidate = at(n === 1 ? "" : ` ${n}`); if (!taken(candidate)) return candidate; }
  return at(` ${Date.now()}`);
}
export interface NoteParts { title: string; description: string; sources: string; template: string | null; tags: string[]; today: string }
/** The content of the standalone note: the template (if any, with `{{title}}`, `{{date}}` and `{{content}}` filled in) around the description, then the task's other sections, with the tags merged into the frontmatter. */
export function buildNote(parts: NoteParts): string {
  const sections = [parts.description.trim(), ...(parts.sources.trim() ? [`## Sources\n${parts.sources.trim()}`] : [])].filter(Boolean);
  const content = sections.join("\n\n");
  const filled = parts.template === null ? null : parts.template.replace(/\{\{\s*title\s*\}\}/gi, parts.title).replace(/\{\{\s*date\s*\}\}/gi, parts.today);
  const withContent = filled === null ? content : /\{\{\s*content\s*\}\}/i.test(filled) ? filled.replace(/\{\{\s*content\s*\}\}/gi, () => content) : `${filled.replace(/\s+$/, "")}${content ? `\n\n${content}` : ""}`;
  const { frontmatter, body } = splitNote(withContent);
  const existing = frontmatter.tags; const current = Array.isArray(existing) ? existing.map(String) : typeof existing === "string" ? cleanTags(existing) : [];
  const tags = [...new Set([...current, ...parts.tags])];
  const properties = { ...object(frontmatter), ...(tags.length ? { tags } : {}) };
  const head = Object.keys(properties).length ? `---\n${stringifyYaml(properties)}---\n\n` : "";
  return `${head}${body.replace(/^\n+/, "")}${body.endsWith("\n") || !body ? "" : "\n"}`;
}
