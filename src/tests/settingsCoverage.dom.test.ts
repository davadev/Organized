// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Setting, Notice } from "./__mocks__/obsidian";
import { OrganizedSettingsTab, PROPERTY_LABELS } from "../settings";
import { DEFAULT_SETTINGS, DISPLAY_PROPERTIES } from "../model";
import { harness } from "./harness";

installObsidianDom();
describe('settings completeness and validation', () => {
  it('renders every setting in classic and modern hosts, validates changes before save', () => {
    const h = harness(); const owner = { settings: { ...DEFAULT_SETTINGS, displayProperties: [] }, service: h.service, saveSettings: vi.fn(), role: 'main', refresh: vi.fn() } as any;
    const tab = new OrganizedSettingsTab(h.app, owner); Setting.instances.length = 0; tab.display();
    expect(Setting.instances.filter(s => s.controls.length)).toHaveLength(19 + DISPLAY_PROPERTIES.length - 1);
    const controls = (name: string) => Setting.instances.find(s => s.nameText === name)!.controls[0];
    const type = (control: any, value: string) => { control.inputEl.value = value; control.inputEl.dispatchEvent(new Event('input')); };
    type(controls('Task folder'), 'Work'); expect(owner.settings.taskFolder).toBe('Work'); type(controls('Task folder'), '.tasks'); expect(owner.settings.taskFolder).toBe('Work'); expect(Notice.instances.at(-1)?.message).toContain('visible');
    type(controls('Daily-note folder'), 'Notes'); expect(owner.settings.dailyFolder).toBe('Notes'); type(controls('Daily-note folder'), '../outside'); expect(owner.settings.dailyFolder).toBe('Notes');
    type(controls('Daily-note template'), 'Templates/Daily.md'); expect(owner.settings.dailyTemplate).toBe('Templates/Daily.md'); type(controls('Daily-note template'), 'Template'); expect(owner.settings.dailyTemplate).toBe('Templates/Daily.md'); type(controls('Daily-note template'), ''); expect(owner.settings.dailyTemplate).toBe('');
    type(controls('Filename format'), 'YYYY/MM/DD'); expect(owner.settings.dailyFormat).toBe('YYYY/MM/DD'); type(controls('Filename format'), 'invalid'); expect(owner.settings.dailyFormat).toBe('YYYY/MM/DD');
    type(controls('Completed/canceled task retention (days)'), '45'); expect(owner.settings.taskRetentionDays).toBe(45); type(controls('Completed/canceled task retention (days)'), '-2'); expect(owner.settings.taskRetentionDays).toBe(45); type(controls('Completed/canceled task retention (days)'), '1.5'); expect(owner.settings.taskRetentionDays).toBe(45); type(controls('Completed/canceled task retention (days)'), ''); expect(owner.settings.taskRetentionDays).toBe(45);
    const role = controls('Role of this device'); role.selectEl.value = 'mirror'; role.selectEl.dispatchEvent(new Event('change')); expect(owner.role).toBe('mirror'); expect(window.localStorage.getItem('organized-device-role:Vault')).toBe('mirror'); expect(owner.refresh).toHaveBeenCalled(); role.selectEl.value = 'main'; role.selectEl.dispatchEvent(new Event('change')); expect(owner.role).toBe('main'); expect(window.localStorage.getItem('organized-device-role:Vault')).toBeNull();
    controls('Auto-forward unfinished tasks').toggle(); expect(owner.settings.autoForward).toBe(false);
    const select = (name: string, value: string) => { const c = controls(name); c.selectEl.value = value; c.selectEl.dispatchEvent(new Event('change')); };
    select('What retired tasks keep', 'all'); expect(owner.settings.retentionDetail).toBe('all'); select('What retired tasks keep', 'bogus'); expect(owner.settings.retentionDetail).toBe('all'); select('What retired tasks keep', 'description'); expect(owner.settings.retentionDetail).toBe('description');
    select('Missing sections', 'ask'); expect(owner.settings.missingSection).toBe('ask'); select('Missing sections', 'recreate'); expect(owner.settings.missingSection).toBe('recreate');
    select('Priority sort scope', 'none'); expect(owner.settings.sortScope).toBe('none');
    select('Alignment', 'right'); expect(owner.settings.propertiesAlign).toBe('right'); select('Alignment', 'bogus'); expect(owner.settings.propertiesAlign).toBe('text');
    const news = "Show what's new after updates"; owner.settings.lastSeenVersion = '0.1.1'; controls(news).toggle(); expect(owner.settings.showWhatsNew).toBe(false); expect(owner.settings.lastSeenVersion).toBe('0.1.1');
    controls(news).toggle(); expect(owner.settings.showWhatsNew).toBe(true); expect(owner.settings.lastSeenVersion).toBe(''); // switching it back on tells the person again
    owner.showWhatsNew = vi.fn(); owner.showOnboarding = vi.fn(); controls("What's new").buttonEl.click(); expect(owner.showWhatsNew).toHaveBeenCalledOnce(); controls('Onboarding card').buttonEl.click(); expect(owner.showOnboarding).toHaveBeenCalledWith(false);
    controls('Long-press marker menu').toggle(); expect(owner.settings.longPressMenu).toBe(false); controls('Long-press marker menu').toggle(); expect(owner.settings.longPressMenu).toBe(true);
    owner.planningTick = vi.fn(); controls('Start tasks at their planned time').toggle(); expect(owner.settings.startAtPlannedTime).toBe(true); expect(owner.planningTick).toHaveBeenCalledOnce(); controls('Start tasks at their planned time').toggle(); expect(owner.settings.startAtPlannedTime).toBe(false); expect(owner.planningTick).toHaveBeenCalledOnce();
    controls('Show scheduled date link').toggle(); expect(owner.settings.showScheduledDate).toBe(false); controls('Show scheduled date link').toggle(); expect(owner.settings.showScheduledDate).toBe(true);
    for (const p of DISPLAY_PROPERTIES.filter(p => p !== 'scheduled')) { controls(PROPERTY_LABELS[p]).toggle(); expect(owner.settings.displayProperties).toContain(p); controls(PROPERTY_LABELS[p]).toggle(); expect(owner.settings.displayProperties).not.toContain(p); }
    const retire = vi.fn(); owner.retireTasks = retire; const showCard = vi.fn(); owner.showOnboarding = showCard; Setting.instances.length = 0; tab.display(); Setting.instances.find(s => s.nameText === 'Onboarding card')!.controls[0].buttonEl.click(); expect(showCard).toHaveBeenCalledWith(false); Setting.instances.find(s => s.nameText === 'Retire tasks')!.controls[0].buttonEl.click(); expect(retire).toHaveBeenCalledOnce();
    expect(owner.saveSettings).toHaveBeenCalled();
    const definitions = tab.getSettingDefinitions() as any[]; expect(definitions).toHaveLength(6);
    for (const group of definitions) for (const row of group.items) { const setting = new Setting(createDiv()); row.render(setting); expect(setting.settingEl.classList.contains('organized-setting-row')).toBe(true); expect(setting.settingEl.querySelector('.setting-item')).toBeNull(); }
  });
});
