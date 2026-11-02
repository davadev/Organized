import { Notice, TFile } from "obsidian";
import { moment } from "./moment";
import type { Repository } from "./repository";
import { localDate, Settings, validDate } from "./model";

export class DailyNotes {
  constructor(readonly repo: Repository, readonly settings: () => Settings) {}
  path(date: string): string {
    if (!validDate(date)) throw new Error("Choose a valid date.");
    const s = this.settings(); const filename = moment(date, "YYYY-MM-DD", true).format(s.dailyFormat);
    return `${s.dailyFolder ? `${s.dailyFolder}/` : ""}${filename}.md`;
  }
  date(notePath: string): string | null {
    const s = this.settings(); const prefix = s.dailyFolder ? `${s.dailyFolder}/` : "";
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
    const configured = this.settings().dailyTemplate; if (!configured) return "";
    const file = this.repo.file(configured);
    if (!file) { new Notice(`Organized: daily-note template ${configured} was not found; created a blank note.`); return ""; }
    const day = moment(date, "YYYY-MM-DD", true); const title = day.format(this.settings().dailyFormat).split("/").at(-1)!;
    return (await this.repo.readText(file)).replace(/\{\{\s*(date|title)\s*(?::([^}]*?))?\s*\}\}/gi, (_match, kind: string, format?: string) => kind.toLowerCase() === "title" ? title : day.format(format || "YYYY-MM-DD"));
  }
  async open(date = localDate()): Promise<TFile> {
    const file = await this.ensure(date); await this.repo.app.workspace.getLeaf(false).openFile(file); return file;
  }
}
