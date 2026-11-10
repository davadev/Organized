// @vitest-environment happy-dom
// The first-run workflow end to end with the real plugin: who gets the onboarding tour, who gets What's new, when, and how often.
import { afterEach, describe, expect, it, vi } from 'vitest';
import Organized from '../main';
import { OnboardingModal, WhatsNewModal } from '../modals';
import { notesToShow, RELEASE_NOTES } from '../whatsNew/releaseNotes';
import { harness } from './harness';
import { Modal, Notice, Setting } from './__mocks__/obsidian';
import { installObsidianDom } from './__mocks__/obsidianDom';

installObsidianDom();
afterEach(() => { vi.useRealTimers(); });
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
const cards = () => Modal.instances.filter(m => m instanceof OnboardingModal) as OnboardingModal[];
const news = () => Modal.instances.filter(m => m instanceof WhatsNewModal) as WhatsNewModal[];
const notices = () => Notice.instances.map(n => String(n.message));

interface Start { data?: Record<string, unknown> | null; version?: string; running?: boolean; writable?: boolean }
/** One start of Obsidian with Organized `version`: `data` is what data.json holds, `running` means the plugin is switched on or updated into a session that is already up. */
async function start({ data = null, version = '0.1.2-beta.7', running = false, writable = true }: Start = {}) {
  vi.useFakeTimers(); Modal.instances.length = 0; Notice.instances.length = 0;
  const h = harness(); (h.app.workspace as any).layoutReady = running;
  const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version, minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
  (plugin as any).data = data; await plugin.onload(); if (!writable) (plugin as any).safety = { writable: false };
  h.layout[0](); await vi.advanceTimersByTimeAsync(2000); await flush();
  return { h, plugin, saved: async () => (await plugin.loadData())?.settings ?? {} };
}
const stored = (settings: Record<string, unknown>) => ({ schemaVersion: 1, settings });

describe('a fresh install', () => {
  it('gets the onboarding tour and no What\'s new, and the tour is the only thing it ever sees', async () => {
    const s = await start(); expect(cards()).toHaveLength(1); expect(news()).toHaveLength(0);
    expect(s.plugin.settings.lastSeenVersion).toBe('0.1.2-beta.7'); cards()[0].close(); await flush();
    expect(await s.saved()).toMatchObject({ onboardingSeen: true, lastSeenVersion: '0.1.2-beta.7' });
    const next = await start({ data: { schemaVersion: 1, settings: await s.saved() } }); expect(cards()).toHaveLength(0); expect(news()).toHaveLength(0);
  });
  it('gets the tour right away, without a restart, when the plugin is switched on in a running session', async () => {
    const live = await start({ running: true }); expect(cards()).toHaveLength(1); expect(news()).toHaveLength(0); expect(notices()).toEqual([]);
    cards()[0].close(); await flush(); expect(live.plugin.settings.onboardingSeen).toBe(true);
  });
  it('waits a moment after the layout is ready, so it does not open under the settings window that switched the plugin on', async () => {
    vi.useFakeTimers(); Modal.instances.length = 0; const h = harness(); (h.app.workspace as any).layoutReady = true;
    const plugin = new Organized(h.app, { id: 'organized', name: 'Organized', author: 'davadev', version: '0.1.2', minAppVersion: '1.7.2', description: '', isDesktopOnly: false });
    await plugin.onload(); h.layout[0](); await flush(); expect(cards()).toHaveLength(0); await vi.advanceTimersByTimeAsync(2000); expect(cards()).toHaveLength(1);
  });
  it('is told nothing when writes are paused', async () => {
    await start({ writable: false }); expect(cards()).toHaveLength(0); expect(news()).toHaveLength(0);
  });
  it('still gets the tour, and nothing old, when it updates before the tour was ever shown', async () => {
    await start({ data: stored({ onboardingSeen: false, lastSeenVersion: '0.1.1' }), version: '0.1.2' });
    expect(cards()).toHaveLength(1); expect(news()).toHaveLength(0);
    cards()[0].close(); await flush();
  });
  it('records the version when the owed tour is finally closed, so the note for it is never shown after', async () => {
    const s = await start({ data: stored({ onboardingSeen: false, lastSeenVersion: '0.1.1' }), version: '0.1.2' }); cards()[0].close(); await flush();
    expect(await s.saved()).toMatchObject({ onboardingSeen: true, lastSeenVersion: '0.1.2' });
    const next = await start({ data: { schemaVersion: 1, settings: await s.saved() }, version: '0.1.2' }); expect(news()).toHaveLength(0); expect(cards()).toHaveLength(0);
  });
});

describe('an update', () => {
  const seen = (lastSeenVersion: string, more: Record<string, unknown> = {}) => stored({ onboardingSeen: true, lastSeenVersion, ...more });
  it('shows What\'s new once, records the version first, and never again', async () => {
    const s = await start({ data: seen('0.1.1') }); expect(cards()).toHaveLength(0); expect(news()).toHaveLength(1);
    expect(news()[0].notes.map(n => n.version)).toEqual(['0.1.2']); expect((await s.saved()).lastSeenVersion).toBe('0.1.2-beta.7');
    news()[0].close(); const again = await start({ data: { schemaVersion: 1, settings: await s.saved() } }); expect(news()).toHaveLength(0);
  });
  it('tells someone who goes from 0.1.1 straight to 0.1.3 about both releases, oldest first, in one popup', async () => {
    const s = await start({ data: stored({ onboardingSeen: true, lastSeenVersion: '0.1.1' }), version: '0.1.3' });
    expect(news()).toHaveLength(1); expect(news()[0].notes.map(n => n.version)).toEqual(['0.1.2', '0.1.3']);
    expect(news()[0].contentEl.textContent).toContain('You are catching up on 2 updates: 0.1.2, then 0.1.3.');
    expect([...news()[0].contentEl.querySelectorAll('h3')].map(n => n.textContent)).toEqual(["What's new in Organized 0.1.2", "What's new in Organized 0.1.3"]);
    expect((await s.saved()).lastSeenVersion).toBe('0.1.3');
  });
  it('tells someone who already saw 0.1.2 only about 0.1.3, and a pre-feature install only about the running release', async () => {
    await start({ data: stored({ onboardingSeen: true, lastSeenVersion: '0.1.2' }), version: '0.1.3' }); expect(news()[0].notes.map(n => n.version)).toEqual(['0.1.3']);
    await start({ data: stored({ taskFolder: 'Tasks' }), version: '0.1.3' }); expect(news()[0].notes.map(n => n.version)).toEqual(['0.1.3']);
  });
  it('treats every beta of a version as that version, so later betas and the stable release stay quiet', async () => {
    for (const version of ['0.1.2-beta.8', '0.1.2-beta.99', '0.1.2']) { await start({ data: seen('0.1.2-beta.7'), version }); expect(news(), version).toHaveLength(0); }
  });
  it('shows nothing for a release without a note, and for versions it cannot read', async () => {
    await start({ data: seen('0.1.1'), version: '0.1.1' }); expect(news()).toHaveLength(0);
    await start({ data: seen('0.1.1'), version: 'dev' }); expect(news()).toHaveLength(0);
  });
  it('ignores a newer version that another device recorded', async () => {
    await start({ data: seen('9.0.0') }); expect(news()).toHaveLength(0);
  });
  it('shows What\'s new right away, without a restart, when the update arrives in a running session', async () => {
    const s = await start({ data: seen('0.1.1'), running: true }); expect(news()).toHaveLength(1); expect(notices()).toEqual([]);
    expect((await s.saved()).lastSeenVersion).toBe('0.1.2-beta.7');
    news()[0].close(); await start({ data: { schemaVersion: 1, settings: await s.saved() }, running: true }); expect(news()).toHaveLength(0);
  });
  it('stays quiet when the person turned it off, at a start or in a running session', async () => {
    await start({ data: seen('0.1.1', { showWhatsNew: false }) }); expect(news()).toHaveLength(0); expect(notices()).toEqual([]);
    await start({ data: seen('0.1.1', { showWhatsNew: false }), running: true }); expect(news()).toHaveLength(0); expect(notices()).toEqual([]);
  });
  it('shows nothing when writes are paused', async () => {
    await start({ data: seen('0.1.1'), writable: false }); expect(news()).toHaveLength(0);
  });
  it('catches up someone who updated from before What\'s new existed, without the tour', async () => {
    const s = await start({ data: stored({ taskFolder: 'Tasks', onboardingSeen: false }) }); expect(cards()).toHaveLength(0); expect(news()).toHaveLength(1);
    expect(s.plugin.settings.onboardingSeen).toBe(true); expect((await s.saved()).lastSeenVersion).toBe('0.1.2-beta.7');
  });
  it('leaves a pre-feature install alone until it has a note to show', async () => {
    const s = await start({ data: stored({ taskFolder: 'Tasks' }), version: '0.1.1' }); expect(cards()).toHaveLength(0); expect(news()).toHaveLength(0); expect(s.plugin.settings.onboardingSeen).toBe(true);
  });
});

describe('the popup and its commands', () => {
  const click = (label: string) => { const modal = news().at(-1)!; [...modal.contentEl.querySelectorAll<HTMLElement>('button')].find(b => b.textContent === label)!.click(); };
  const seen = stored({ onboardingSeen: true, lastSeenVersion: '0.1.1' });
  it('lists every item of the release with its figure, and "Got it" just closes', async () => {
    const s = await start({ data: seen }); const modal = news()[0]; const shown = RELEASE_NOTES.find(n => n.version === '0.1.2')!;
    expect(modal.contentEl.querySelectorAll('.organized-whatsnew-item')).toHaveLength(shown.items.length);
    expect(modal.contentEl.querySelectorAll('.organized-welcome-figure').length).toBe(shown.items.filter(i => i.figure).length);
    expect(modal.contentEl.querySelector('code')).not.toBeNull(); expect(modal.contentEl.textContent).not.toContain('catching up');
    click('Got it'); await flush(); expect(s.plugin.settings.showWhatsNew).toBe(true); expect(modal.contentEl.children).toHaveLength(0);
  });
  it('"Don\'t show again" switches it off, says where to turn it on, and keeps it off', async () => {
    const s = await start({ data: seen }); click("Don't show again"); await flush();
    expect(s.plugin.settings.showWhatsNew).toBe(false); expect(notices().at(-1)).toContain('settings of Organized'); expect((await s.saved()).showWhatsNew).toBe(false);
    await start({ data: { schemaVersion: 1, settings: { ...(await s.saved()), lastSeenVersion: '0.1.1' } } }); expect(news()).toHaveLength(0);
  });
  it('tells someone who skipped releases about each, oldest first', () => {
    const h = harness(); const notes = [{ version: '0.2.0', title: 'Two', intro: 'Second', items: [] }, { version: '0.1.5', title: 'One', intro: '', items: [{ title: 'Item', text: 'Use `x`.' }] }];
    const shown = notesToShow('0.1.0', '0.2.0', notes); expect(shown.map(n => n.version)).toEqual(['0.1.5', '0.2.0']);
    const modal = new WhatsNewModal(h.app, shown, () => undefined); modal.open();
    expect(modal.contentEl.textContent).toContain('You are catching up on 2 updates: 0.1.5, then 0.2.0.'); expect([...modal.contentEl.querySelectorAll('h3')].map(n => n.textContent)).toEqual(['One', 'Two']);
  });
  it('draws a real-GUI shot under an item that has one, and a figure under one that has that', () => {
    const h = harness(); const note = { version: '0.1.5', title: 'One', intro: '', items: [{ title: 'Plain', text: 'x' }, { title: 'Shot', text: 'y', shot: 'repeat' as const }, { title: 'Figure', text: 'z', figure: 'devices' as const }] };
    const modal = new WhatsNewModal(h.app, [note], () => undefined); modal.open();
    expect(modal.contentEl.querySelectorAll('.organized-welcome-shot')).toHaveLength(1); expect(modal.contentEl.querySelectorAll('.organized-welcome-figure')).toHaveLength(1);
  });
  it('the command reopens the notes for this version at any time and says so when there are none', async () => {
    const s = await start({ data: { schemaVersion: 1, settings: { onboardingSeen: true, lastSeenVersion: '0.1.2' } } }); expect(news()).toHaveLength(0);
    (s.plugin as any).commands.find((c: any) => c.id === 'show-whats-new').callback(); expect(news()).toHaveLength(1);
    const old = await start({ data: seen, version: '0.1.1' }); (old.plugin as any).commands.find((c: any) => c.id === 'show-whats-new').callback(); expect(news()).toHaveLength(0); expect(notices().at(-1)).toContain('no release notes');
  });
  it('the onboarding command and button reopen the tour without touching what was recorded', async () => {
    const s = await start({ data: { schemaVersion: 1, settings: { onboardingSeen: true, lastSeenVersion: '0.1.2' } } });
    (s.plugin as any).commands.find((c: any) => c.id === 'show-onboarding').callback(); expect(cards()).toHaveLength(1); cards()[0].close(); await flush();
    expect(s.plugin.settings.lastSeenVersion).toBe('0.1.2');
  });
});
