import { App, Notice, TFile } from "obsidian";
import { moment } from "./moment";
import type { Repository } from "./repository";
import { localDate, path, Settings, settingsFrom, validDate } from "./model";

export interface DailySetup { dailyFolder: string; dailyFormat: string; dailyTemplate: string }
type Options = { folder?: unknown; format?: unknown; template?: unknown; enabled?: unknown };
/**
 * The folder, format and template that Periodic Notes or the core Daily Notes plugin hold right now, or null when neither has a usable setup. Neither has a public API,
 * so the plugin objects are read defensively and anything that is not a valid value is ignored.
 */
export function detectDailyNotes(app: App): DailySetup | null {
  const host = app as unknown as { plugins?: { plugins?: Record<string, { settings?: { daily?: Options } } | undefined> }; internalPlugins?: { getPluginById?: (id: string) => { instance?: { options?: Options } } | null | undefined } };
  const periodic = host.plugins?.plugins?.["periodic-notes"]?.settings?.daily;
  const core = host.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
  for (const options of [periodic && periodic.enabled !== false ? periodic : undefined, core]) {
    if (!options) continue;
    const format = typeof options.format === "string" && options.format.trim() ? options.format.trim() : "YYYY-MM-DD";
    const valid = settingsFrom({ dailyFormat: format }).dailyFormat === format;
    try {
      const folder = typeof options.folder === "string" ? path(options.folder, true) : ""; const template = typeof options.template === "string" && options.template.trim() ? path(options.template.trim().endsWith(".md") ? options.template.trim() : `${options.template.trim()}.md`) : "";
      if (valid) return { dailyFolder: folder, dailyFormat: format, dailyTemplate: template };
    } catch { /* A folder or template that is not a path is not a usable setup. */ }
  }
  return null;
}
export class DailyNotes {
  constructor(readonly repo: Repository, readonly settings: () => Settings) {}
  /** The folder, format and template in use: the Daily Notes plugin's when Organized is set to follow it and it has any, otherwise Organized's own. */
  setup(): DailySetup {
    const s = this.settings(); const found = s.dailySource === "plugin" ? detectDailyNotes(this.repo.app) : null;
    return found ? { ...found, dailyTemplate: found.dailyTemplate || s.dailyTemplate } : s;
  }
  /** Whether the Daily Notes plugin's setup is the one in use. */
  followed(): boolean { return this.settings().dailySource === "plugin" && detectDailyNotes(this.repo.app) !== null; }
  path(date: string): string {
    if (!validDate(date)) throw new Error("Choose a valid date.");
    const s = this.setup(); const filename = moment(date, "YYYY-MM-DD", true).format(s.dailyFormat);
    return `${s.dailyFolder ? `${s.dailyFolder}/` : ""}${filename}.md`;
  }
  date(notePath: string): string | null {
    const s = this.setup(); const prefix = s.dailyFolder ? `${s.dailyFolder}/` : "";
    if (!notePath.startsWith(prefix) || !notePath.endsWith(".md")) return null;
    const parsed = moment(notePath.slice(prefix.length, -3), s.dailyFormat, true);
    if (!parsed.isValid()) return null;
    const date = parsed.format("YYYY-MM-DD"); return this.path(date) === notePath ? date : null;
  }
  files(): { file: TFile; date: string }[] {
    return this.repo.app.vault.getMarkdownFiles().flatMap(file => { const date = this.date(file.path); return date ? [{ file, date }] : []; });
  }
  async ensure(date: string): Promise<TFile> {
    const notePath = this.path(date); const existing = this.repo.file(notePath); if (existing) return existing;
    return this.repo.ensure(notePath, await this.template(date));
  }
  /** Content for a new daily note; a missing template falls back to a blank note rather than blocking scheduling. */
  private async template(date: string): Promise<string> {
    const configured = this.setup().dailyTemplate; if (!configured) return "";
    const file = this.repo.file(configured);
    if (!file) { new Notice(`Organized: daily-note template ${configured} was not found; created a blank note.`); return ""; }
    const day = moment(date, "YYYY-MM-DD", true); const title = day.format(this.setup().dailyFormat).split("/").at(-1)!;
    return (await this.repo.readText(file)).replace(/\{\{\s*(date|time|title)\s*(?::([^}]*?))?\s*\}\}/gi, (_match, kind: string, format?: string) => kind.toLowerCase() === "title" ? title : kind.toLowerCase() === "time" ? moment().format(format || "HH:mm") : day.format(format || "YYYY-MM-DD"));
  }
  async open(date = localDate()): Promise<TFile> {
    const file = await this.ensure(date); await this.repo.app.workspace.getLeaf(false).openFile(file); return file;
  }
}
