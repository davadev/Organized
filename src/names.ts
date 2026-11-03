// Pure helpers that turn a todo title into a file name every platform accepts.

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
/** The path for a new note: the name as is, or `Name 2`, `Name 3`… until it is free. */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
  const at = (suffix: string) => `${folder ? `${folder}/` : ""}${name}${suffix}.md`;
  for (let n = 1; n < 1000; n++) { const candidate = at(n === 1 ? "" : ` ${n}`); if (!taken(candidate)) return candidate; }
  return at(` ${Date.now()}`);
}
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** A file name for a task note: the title reduced to what every platform accepts (`noteName` drops reserved characters and edge dots; reserved Windows names get a suffix). */
export function readableName(title: string): string {
  const name = noteName(title);
  return RESERVED.test(name) ? `${name} (task)` : name;
}
