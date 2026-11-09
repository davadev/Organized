// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDailyNotes } from '../daily';
import { settingsFrom, localDate, nextDate, DEFAULT_SETTINGS } from '../model';
import { harness } from './harness';
import { installObsidianDom } from './__mocks__/obsidianDom';
import { OrganizedSettingsTab } from '../settings';
import { parseTasks } from '../codec';
import { DAILY } from '../recurrence';

installObsidianDom();
const core = (h: any, options: unknown) => { h.raw.internalPlugins = { getPluginById: (id: string) => id === 'daily-notes' ? { instance: { options } } : null }; };
const periodic = (h: any, daily: unknown) => { h.raw.plugins = { plugins: { 'periodic-notes': { settings: { daily } } } }; };
const later = (n: number) => { let d = localDate(); for (let i = 0; i < n; i++) d = nextDate(d); return d; };

describe('following the Daily Notes plugin', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('reads the core plugin, treating an empty format as the default and adding .md to the template', () => {
    const h = harness(); expect(detectDailyNotes(h.app)).toBeNull();
    core(h, { folder: 'Journal', format: '', template: 'Templates/Daily' }); expect(detectDailyNotes(h.app)).toEqual({ dailyFolder: 'Journal', dailyFormat: 'YYYY-MM-DD', dailyTemplate: 'Templates/Daily.md' });
    core(h, { folder: '', format: 'YYYY/MM/DD', template: 'T/Daily.md' }); expect(detectDailyNotes(h.app)).toEqual({ dailyFolder: '', dailyFormat: 'YYYY/MM/DD', dailyTemplate: 'T/Daily.md' });
    core(h, {}); expect(detectDailyNotes(h.app)).toEqual({ dailyFolder: '', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '' });
    core(h, { folder: 5, format: 7, template: 9 }); expect(detectDailyNotes(h.app)).toEqual({ dailyFolder: '', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '' });
  });
  it('prefers an enabled Periodic Notes daily setup, and falls back to the core plugin when it is off or unusable', () => {
    const h = harness(); core(h, { folder: 'Core', format: 'YYYY-MM-DD' });
    periodic(h, { enabled: true, folder: 'Periodic', format: 'YYYYMMDD' }); expect(detectDailyNotes(h.app)?.dailyFolder).toBe('Periodic');
    periodic(h, { folder: 'Periodic', format: 'YYYYMMDD' }); expect(detectDailyNotes(h.app)?.dailyFolder).toBe('Periodic');
    periodic(h, { enabled: false, folder: 'Periodic', format: 'YYYYMMDD' }); expect(detectDailyNotes(h.app)?.dailyFolder).toBe('Core');
    periodic(h, { enabled: true, folder: 'Periodic', format: 'dddd' }); expect(detectDailyNotes(h.app)?.dailyFolder).toBe('Core');
    periodic(h, { enabled: true, folder: '../escape', format: 'YYYY-MM-DD' }); expect(detectDailyNotes(h.app)?.dailyFolder).toBe('Core');
    core(h, { folder: 'Core', format: 'nonsense' }); expect(detectDailyNotes(h.app)).toBeNull();
    core(h, { folder: '/abs/../bad', format: 'YYYY-MM-DD' }); periodic(h, undefined); expect(detectDailyNotes(h.app)).toBeNull();
  });
  it('puts every daily note where the plugin puts it, and recognises only those', async () => {
    const h = harness(); h.setSettings({ dailySource: 'plugin' }); core(h, { folder: 'Journal/Days', format: 'YYYY/MM/DD', template: '' });
    expect(h.service.daily.followed()).toBe(true); expect(h.service.daily.path('2026-03-05')).toBe('Journal/Days/2026/03/05.md'); expect(h.service.daily.date('Journal/Days/2026/03/05.md')).toBe('2026-03-05'); expect(h.service.daily.date('Daily/2026-03-05.md')).toBeNull();
    const task = await h.repo.create('Water'); await h.service.recurrence(task.id, DAILY); const file = await h.service.daily.ensure(later(2)); expect(file.path).toBe(h.service.daily.path(later(2)));
    h.setSettings({ dailySource: 'custom' }); expect(h.service.daily.followed()).toBe(false); expect(h.service.daily.path('2026-03-05')).toBe('Daily/2026-03-05.md');
  });
  it('uses the plugin template, else its own, and follows a change made later', async () => {
    const h = harness(); h.setSettings({ dailySource: 'plugin', dailyTemplate: 'Own.md' }); await h.add('Own.md', 'own {{date}}'); await h.add('Core T.md', 'core {{title}}');
    core(h, { folder: 'J', format: 'YYYY-MM-DD', template: 'Core T' }); expect((await h.service.daily.ensure('2026-04-01')).path).toBe('J/2026-04-01.md'); expect(h.texts.get('J/2026-04-01.md')).toBe('core 2026-04-01');
    core(h, { folder: 'K', format: 'YYYY-MM-DD' }); await h.service.daily.ensure('2026-04-02'); expect(h.texts.get('K/2026-04-02.md')).toBe('own 2026-04-02');
  });
  it('falls back to its own settings when neither plugin has a setup', () => {
    const h = harness(); h.setSettings({ dailySource: 'plugin', dailyFolder: 'Mine', dailyFormat: 'DD.MM.YYYY' }); expect(h.service.daily.followed()).toBe(false); expect(h.service.daily.path('2026-03-05')).toBe('Mine/05.03.2026.md');
  });
  it('a note another plugin makes where the Daily Notes plugin says still gets recurring tasks (the Garmin sync case: front matter first)', async () => {
    const h = harness(); h.setSettings({ dailySource: 'plugin' }); core(h, { folder: 'Health', format: 'YYYY-MM-DD' }); const task = await h.repo.create('Stretch'); await h.service.recurrence(task.id, DAILY);
    const path = `Health/${later(1)}.md`; const file: any = await h.add(path, '---\nsteps: 8000\nsleep_score: 81\n---\nbody'); await h.service.onDailyCreated(file);
    expect(h.texts.get(path)).toMatch(/^---\nsteps: 8000\nsleep_score: 81\n---\n/); expect(parseTasks(h.texts.get(path)!).filter(t => t.id === task.id)).toHaveLength(1); expect(h.texts.get(path)).toContain('body');
  });
});

describe('daily-note source setting', () => {
  it('keeps what was saved before the option existed, and follows the plugin on a fresh install', () => {
    expect(settingsFrom({}).dailySource).toBe('plugin'); expect(settingsFrom(undefined).dailySource).toBe('plugin');
    expect(settingsFrom({ dailyFolder: 'Daily' }).dailySource).toBe('custom'); expect(settingsFrom({ dailyFormat: 'YYYY-MM-DD' }).dailySource).toBe('custom');
    expect(settingsFrom({ dailySource: 'plugin', dailyFolder: 'X' }).dailySource).toBe('plugin'); expect(settingsFrom({ dailySource: 'custom' }).dailySource).toBe('custom'); expect(settingsFrom({ dailySource: 'bogus' }).dailySource).toBe('plugin');
    expect(DEFAULT_SETTINGS.dailySource).toBe('plugin');
  });
  it('offers the choice in the settings tab and says what is being followed', () => {
    const h = harness(); const saved = vi.fn(); const owner: any = { settings: { ...DEFAULT_SETTINGS }, service: h.service, saveSettings: saved };
    const tab = new OrganizedSettingsTab(h.app, owner); const host = document.createElement('div'); tab.renderInto(host); expect(host.textContent).toContain('Nothing is followed when neither plugin has a setup');
    core(h, { folder: 'Journal', format: 'YYYY-MM-DD' }); tab.renderInto(host); expect(host.textContent).toContain('Following the Daily Notes plugin: folder "Journal", format YYYY-MM-DD');
    core(h, { folder: '', format: 'YYYY-MM-DD' }); tab.renderInto(host); expect(host.textContent).toContain('folder "(vault root)"');
    const select = Array.from(host.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'plugin'))!; expect(select.value).toBe('plugin'); select.value = 'custom'; select.dispatchEvent(new Event('change')); expect(owner.settings.dailySource).toBe('custom'); expect(saved).toHaveBeenCalled();
    select.value = 'other'; select.dispatchEvent(new Event('change')); expect(owner.settings.dailySource).toBe('custom');
  });
});
