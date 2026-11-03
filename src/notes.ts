import { stringifyYaml } from "obsidian";
import { object } from "./model";
import { splitNote } from "./repository";

/** `a, #b c` as tags `a`, `b`, `c`: leading # dropped, duplicates and anything Obsidian would not accept as a tag ignored. */
export function cleanTags(input: string): string[] {
  const tags = input.split(/[\s,]+/).map(tag => tag.replace(/^#+/, "")).filter(tag => /^[\p{L}\p{N}_/-]+$/u.test(tag) && /\D/.test(tag));
  return [...new Set(tags)];
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
