import { DataAdapter, normalizePath } from "obsidian";
import { makeId, object } from "./model";

export function versionCompare(a: string, b: string): number {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(v);
  const x = parse(a); const y = parse(b); if (!x || !y) return Number(!!x) - Number(!!y);
  for (let i = 1; i < 4; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i];
  const rank = (v: string | undefined) => v ? ["alpha", "beta", "rc"].indexOf(v) : 3;
  return rank(x[4]) - rank(y[4]) || Number(x[5] ?? 0) - Number(y[5] ?? 0);
}
export class DataSafety {
  readonly folder: string;
  writable = true;
  constructor(readonly adapter: DataAdapter, folder: string, readonly version: string, readonly notify: (message: string) => void) { this.folder = normalizePath(folder); }
  async atomicWrite(path: string, data: string): Promise<void> {
    const target = normalizePath(path); const temp = normalizePath(`${target}.tmp`);
    try { await this.adapter.write(temp, data); await this.adapter.rename(temp, target); }
    catch {
      try { if (await this.adapter.exists(temp)) await this.adapter.remove(temp); } catch { /* Best-effort cleanup; never remove existing settings. */ }
      await this.adapter.write(target, data);
    }
  }
  async prepare(): Promise<void> {
    try {
      const pending = normalizePath(`${this.folder}/restore-pending.json`);
      if (await this.adapter.exists(pending)) {
        const name = await this.adapter.read(pending);
        if (!/^backup-[\w.-]+\.json$/.test(name)) throw new Error("Invalid restore request.");
        const snapshot = object(JSON.parse(await this.adapter.read(normalizePath(`${this.folder}/backups/${name}`))));
        if (typeof snapshot.data !== "string" || typeof snapshot.version !== "string" || versionCompare(snapshot.version, this.version) > 0) throw new Error("Backup is not compatible with this version.");
        const dataPath = normalizePath(`${this.folder}/data.json`);
        const previous = await this.adapter.exists(dataPath) ? await this.adapter.read(dataPath) : null;
        await this.snapshot("pre-restore");
        const data = snapshot.data;
        if (previous !== null && typeof this.adapter.process === "function") await this.adapter.process(dataPath, current => { if (current !== previous) throw new Error("Settings changed during restore; preserved. Retry on next restart."); return data; });
        else await this.atomicWrite(dataPath, data);
        await this.adapter.remove(pending); this.notify("Organized settings restored. Task Markdown was not changed.");
      }
      const current = normalizePath(`${this.folder}/data.json`);
      if (!(await this.adapter.exists(current))) return;
      const parsed: unknown = JSON.parse(await this.adapter.read(current));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings are not a supported object.");
      const raw = object(parsed); const previous = typeof raw.writerVersion === "string" ? raw.writerVersion : "0.0.0";
      if (versionCompare(previous, this.version) > 0 || (typeof raw.schemaVersion === "number" && raw.schemaVersion > 1)) {
        this.writable = false; this.notify("Newer Organized settings detected. Writes are paused. Use 'Restore compatible settings backup' and restart, or reinstall the newer beta."); return;
      }
      if (previous !== this.version) await this.snapshot("upgrade");
    } catch (error) {
      this.writable = false; this.notify(`Settings backup/restore failed; writes paused, notes untouched: ${String(error)}`);
    }
  }
  async snapshot(kind: string): Promise<void> {
    const current = normalizePath(`${this.folder}/data.json`); if (!(await this.adapter.exists(current))) return;
    const data = await this.adapter.read(current); const raw = object(JSON.parse(data));
    const version = typeof raw.writerVersion === "string" ? raw.writerVersion : "0.0.0";
    const folder = normalizePath(`${this.folder}/backups`); if (!(await this.adapter.exists(folder))) await this.adapter.mkdir(folder);
    const files = (await this.adapter.list(folder)).files.filter(f => /\/backup-[\w.-]+\.json$/.test(f)).sort().reverse();
    if (files.length) { const latest = object(JSON.parse(await this.adapter.read(files[0]))); if (latest.data === data && kind !== "pre-restore") return; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)))).map(b => b.toString(16).padStart(2, "0")).join("");
    const name = normalizePath(`${folder}/backup-${Date.now()}-${kind}-${makeId()}.json`);
    await this.atomicWrite(name, JSON.stringify({ version, kind, at: new Date().toISOString(), hash, size: data.length, data }));
    let stable: string | null = null;
    for (const file of files) { const entry = object(JSON.parse(await this.adapter.read(file))); if (typeof entry.version === "string" && !entry.version.includes("-")) { stable = file; break; } }
    for (const file of files.slice(9)) if (file !== stable) await this.adapter.remove(file);
  }
  async queueCompatibleRestore(): Promise<void> {
    const folder = normalizePath(`${this.folder}/backups`);
    const files = (await this.adapter.list(folder)).files.sort().reverse();
    for (const file of files) {
      const snapshot = object(JSON.parse(await this.adapter.read(file)));
      if (typeof snapshot.version === "string" && versionCompare(snapshot.version, this.version) <= 0 && typeof snapshot.data === "string") {
        await this.atomicWrite(normalizePath(`${this.folder}/restore-pending.json`), file.slice(file.lastIndexOf("/") + 1)); this.notify("Compatible settings restore queued. Restart Obsidian to apply it. Current settings will be backed up first."); return;
      }
    }
    throw new Error("No compatible settings backup is available.");
  }
}
