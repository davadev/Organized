// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Setting, Notice } from "./__mocks__/obsidian";
import { OrganizedSettingsTab } from "../settings";
import { DEFAULT_SETTINGS, DISPLAY_PROPERTIES } from "../model";
import { harness } from "./harness";

installObsidianDom();
describe('settings completeness and validation', () => {
  it('renders every setting in classic and modern hosts, validates changes before save', () => {
    const h = harness(); const owner = { settings: { ...DEFAULT_SETTINGS, displayProperties: [] }, saveSettings: vi.fn() } as any;
    const tab = new OrganizedSettingsTab(h.app, owner); Setting.instances.length = 0; tab.display();
    expect(Setting.instances.filter(s => s.controls.length)).toHaveLength(7 + DISPLAY_PROPERTIES.length);
    const controls = (name: string) => Setting.instances.find(s => s.nameText === name)!.controls[0];
    const type = (control: any, value: string) => { control.inputEl.value = value; control.inputEl.dispatchEvent(new Event('input')); };
    type(controls('Task folder'), 'Work'); expect(owner.settings.taskFolder).toBe('Work'); type(controls('Task folder'), '.tasks'); expect(owner.settings.taskFolder).toBe('Work'); expect(Notice.instances.at(-1)?.message).toContain('visible');
    type(controls('Daily-note folder'), 'Notes'); expect(owner.settings.dailyFolder).toBe('Notes'); type(controls('Daily-note folder'), '../outside'); expect(owner.settings.dailyFolder).toBe('Notes');
    type(controls('Filename format'), 'YYYY/MM/DD'); expect(owner.settings.dailyFormat).toBe('YYYY/MM/DD'); type(controls('Filename format'), 'invalid'); expect(owner.settings.dailyFormat).toBe('YYYY/MM/DD');
    controls('Auto-forward unfinished tasks').toggle(); expect(owner.settings.autoForward).toBe(false);
    const select = (name: string, value: string) => { const c = controls(name); c.selectEl.value = value; c.selectEl.dispatchEvent(new Event('change')); };
    select('Missing sections', 'ask'); expect(owner.settings.missingSection).toBe('ask'); select('Missing sections', 'recreate'); expect(owner.settings.missingSection).toBe('recreate');
    select('Priority sort scope', 'none'); expect(owner.settings.sortScope).toBe('none');
    for (const p of DISPLAY_PROPERTIES) { controls(p.replace(/_/g, ' ')).toggle(); expect(owner.settings.displayProperties).toContain(p); controls(p.replace(/_/g, ' ')).toggle(); expect(owner.settings.displayProperties).not.toContain(p); }
    expect(owner.saveSettings).toHaveBeenCalled();
    const definitions = tab.getSettingDefinitions(); expect(definitions).toHaveLength(1); const setting = new Setting(createDiv()); (definitions[0] as any).render(setting); expect(setting.settingEl.querySelectorAll('.setting-item').length).toBeGreaterThan(10);
  });
});
