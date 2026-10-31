import { TFile } from "obsidian";
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
  async ensure(date: string): Promise<TFile> { return this.repo.ensure(this.path(date)); }
  async open(date = localDate()): Promise<TFile> {
    const file = await this.ensure(date); await this.repo.app.workspace.getLeaf(false).openFile(file); return file;
  }
}
