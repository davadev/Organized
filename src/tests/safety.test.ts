import { describe, expect, it, vi } from "vitest";
import { DataSafety, versionCompare } from "../safety";
import { harness } from "./harness";

describe("settings backups, downgrades and queued restores", () => {
  it("compares real prerelease order and treats unparseable versions as oldest", () => {
    for (const [a, b] of [['1.0.0', '0.9.9'], ['0.1.0-beta.10', '0.1.0-beta.9'], ['0.1.0', '0.1.0-rc.1'], ['0.1.0-rc.1', '0.1.0-beta.100'], ['0.1.0-beta.1', '0.1.0-alpha.1'], ['0.1.0', 'bad']]) expect(versionCompare(a, b)).toBeGreaterThan(0);
    expect(versionCompare('bad', 'worse')).toBe(0); expect(versionCompare('bad', '0.1.0')).toBeLessThan(0); expect(versionCompare('0.1.0', '0.1.0')).toBe(0);
  });
  it("does nothing to notes or absent settings, snapshots an upgrade once", async () => {
    const h = harness(); const notify = vi.fn(); const safety = new DataSafety(h.app.vault.adapter, '.obsidian/plugins/organized', '0.1.0-beta.1', notify);
    await safety.prepare(); expect(h.raw.vault.adapter.write).not.toHaveBeenCalled();
    const dataPath = '.obsidian/plugins/organized/data.json'; h.texts.set(dataPath, JSON.stringify({ writerVersion: '0.0.0', settings: { taskFolder: 'Tasks' } }));
    await safety.prepare(); const backups = [...h.texts.keys()].filter(k => k.includes('/backups/')); expect(backups).toHaveLength(1); expect(JSON.parse(h.texts.get(backups[0])!).version).toBe('0.0.0'); expect(JSON.parse(h.texts.get(backups[0])!).hash).toMatch(/^[a-f0-9]{64}$/);
    await safety.prepare(); expect([...h.texts.keys()].filter(k => k.includes('/backups/'))).toHaveLength(1); expect(safety.writable).toBe(true);
    h.texts.set(dataPath, JSON.stringify({ writerVersion: '0.1.0-beta.1' })); await safety.prepare(); expect(safety.writable).toBe(true);
  });
  it("pauses writes on newer or malformed data and exposes repair", async () => {
    for (const raw of [{ writerVersion: '0.2.0' }, { schemaVersion: 2 }, [], null, 7, 'invalid']) {
      const h = harness(); h.texts.set('plugin/data.json', typeof raw === 'string' ? raw : JSON.stringify(raw)); const notify = vi.fn(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0', notify);
      await safety.prepare(); expect(safety.writable).toBe(false); expect(notify).toHaveBeenCalled(); expect(h.texts.size).toBe(1);
    }
  });
  it('falls back safely when mobile rename/temp support is missing, without removing the existing target', async () => {
    const h = harness(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0', vi.fn()); h.texts.set('plugin/data.json', 'original');
    h.raw.vault.adapter.rename.mockRejectedValueOnce(Error('unsupported')); await safety.atomicWrite('plugin/data.json', 'replacement'); expect(h.texts.get('plugin/data.json')).toBe('replacement'); expect(h.raw.vault.adapter.remove).toHaveBeenCalledWith('plugin/data.json.tmp'); expect(h.raw.vault.adapter.remove).not.toHaveBeenCalledWith('plugin/data.json');
    h.raw.vault.adapter.write.mockRejectedValueOnce(Error('no temp files')); await safety.atomicWrite('plugin/next.json', 'data'); expect(h.texts.get('plugin/next.json')).toBe('data');
    h.raw.vault.adapter.rename.mockRejectedValueOnce(Error('rename')); h.raw.vault.adapter.remove.mockRejectedValueOnce(Error('cleanup')); await safety.atomicWrite('plugin/again.json', 'data'); expect(h.texts.get('plugin/again.json')).toBe('data');
  });
  it('restores to an absent data file, handles mobile adapters without process, and preserves concurrent changes', async () => {
    for (const existing of [false, true]) {
      const h = harness(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0', vi.fn());
      h.texts.set('plugin/backups/backup-old.json', JSON.stringify({ version: '0.0.0', data: '{"writerVersion":"0.0.0"}' })); h.texts.set('plugin/restore-pending.json', 'backup-old.json');
      if (existing) { h.texts.set('plugin/data.json', '{}'); (h.raw.vault.adapter as any).process = undefined; }
      await safety.prepare(); expect(safety.writable).toBe(true); expect(h.texts.get('plugin/data.json')).toContain('0.0.0');
    }
    const h = harness(); const notify = vi.fn(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0', notify); h.texts.set('plugin/data.json', '{}'); h.texts.set('plugin/backups/backup-old.json', JSON.stringify({ version: '0.0.0', data: '{"restored":true}' })); h.texts.set('plugin/restore-pending.json', 'backup-old.json');
    h.raw.vault.adapter.process.mockImplementationOnce(async (p, fn) => { h.texts.set(p, '{"concurrent":true}'); return fn(h.texts.get(p)!); }); await safety.prepare(); expect(safety.writable).toBe(false); expect(h.texts.get('plugin/data.json')).toBe('{"concurrent":true}'); expect(h.texts.has('plugin/restore-pending.json')).toBe(true); expect(notify).toHaveBeenCalledWith(expect.stringContaining('changed during restore'));
  });
  it("queues only compatible backups, restores at next startup with a pre-restore snapshot", async () => {
    const h = harness(); const notify = vi.fn(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0-beta.2', notify);
    h.texts.set('plugin/backups/backup-001-upgrade.json', JSON.stringify({ version: '0.1.0-beta.1', data: '{"writerVersion":"0.1.0-beta.1","settings":{"autoForward":false}}' }));
    h.texts.set('plugin/backups/backup-002-upgrade.json', JSON.stringify({ version: '0.2.0', data: '{}' }));
    h.texts.set('plugin/data.json', '{"writerVersion":"0.2.0"}');
    await safety.queueCompatibleRestore(); expect(h.texts.get('plugin/restore-pending.json')).toBe('backup-001-upgrade.json'); expect(h.texts.get('plugin/data.json')).toContain('0.2.0');
    await safety.prepare(); expect(h.texts.get('plugin/data.json')).toContain('autoForward'); expect(h.texts.has('plugin/restore-pending.json')).toBe(false); expect([...h.texts.keys()].some(k => k.includes('pre-restore'))).toBe(true);
    const empty = harness(); await expect(new DataSafety(empty.app.vault.adapter, 'plugin', '0.1.0', notify).queueCompatibleRestore()).rejects.toThrow('No compatible');
  });
  it("rejects malformed pending restores and retains latest stable snapshot beyond ten betas", async () => {
    for (const name of ['../escape', 'backup-junk.json']) {
      const h = harness(); h.texts.set('plugin/restore-pending.json', name); h.texts.set('plugin/backups/backup-junk.json', JSON.stringify({ version: '0.9.0', data: '{}' }));
      const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0', vi.fn()); await safety.prepare(); expect(safety.writable).toBe(false);
    }
    const h = harness(); const safety = new DataSafety(h.app.vault.adapter, 'plugin', '0.1.0-beta.20', vi.fn());
    for (let i = 0; i < 15; i++) h.texts.set(`plugin/backups/backup-${String(i).padStart(3, '0')}-upgrade.json`, JSON.stringify({ version: i === 0 ? '0.0.0' : '0.1.0-beta.1', data: String(i) }));
    h.texts.set('plugin/data.json', '{"settings":{}}'); await safety.snapshot('upgrade');
    expect(h.texts.has('plugin/backups/backup-000-upgrade.json')).toBe(true); expect([...h.texts.keys()].filter(k => k.includes('/backups/'))).toHaveLength(11);
  });
});
