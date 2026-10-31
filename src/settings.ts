import { App, PluginSettingTab, Setting, SettingDefinition } from "obsidian";
import type Organized from "./main";
import { DISPLAY_PROPERTIES, path, settingsFrom, visibleFolder } from "./model";
import { report } from "./service";

export class OrganizedSettingsTab extends PluginSettingTab {
  constructor(app: App, readonly owner: Organized) { super(app, owner); }
  display(): void {
    this.renderInto(this.containerEl);
  }
  getSettingDefinitions(): SettingDefinition[] {
    return [{ name: "Task configuration", render: setting => { this.renderInto(setting.settingEl); } }];
  }
  renderInto(host: HTMLElement): void {
    host.empty(); host.addClass("organized-settings");
    new Setting(host).setName("Task storage").setHeading();
    new Setting(host).setName("Task folder").setDesc("One Markdown file per task. Changing this does not move existing files.")
      .addText(t => t.setValue(this.owner.settings.taskFolder).onChange(value => {
        try { this.owner.settings.taskFolder = visibleFolder(value); this.owner.saveSettings(); } catch (error) { report(error); }
      }));
    new Setting(host).setName("Daily notes").setHeading();
    new Setting(host).setName("Daily-note source").setDesc("Custom settings are required: Obsidian does not expose a supported API for reading core daily notes configuration. Match these to your daily-note folder and date format.")
      .addDropdown(d => d.addOption("custom", "Use custom settings").addOption("core", "Use core settings (unavailable)").setValue("custom").setDisabled(true));
    new Setting(host).setName("Daily-note folder").addText(t => t.setValue(this.owner.settings.dailyFolder).onChange(value => {
      try { this.owner.settings.dailyFolder = path(value, true); this.owner.saveSettings(); } catch (error) { report(error); }
    }));
    new Setting(host).setName("Filename format").setDesc("Moment date format containing YYYY, MM and DD; folders in the format are supported.")
      .addText(t => t.setValue(this.owner.settings.dailyFormat).onChange(value => {
        const validated = settingsFrom({ ...this.owner.settings, dailyFormat: value });
        if (validated.dailyFormat === value) { this.owner.settings = validated; this.owner.saveSettings(); }
      }));
    new Setting(host).setName("Task behavior").setHeading();
    new Setting(host).setName("Auto-forward unfinished tasks").setDesc("On by default. Opening today's existing daily note carries unfinished tasks from their latest prior occurrence, updates scheduled dates, and marks prior lines forwarded. No timer or automatic note creation. A summary offers Undo.")
      .addToggle(t => t.setValue(this.owner.settings.autoForward).onChange(value => { this.owner.settings.autoForward = value; this.owner.saveSettings(); }));
    new Setting(host).setName("Missing sections").addDropdown(d => d.addOption("recreate", "Recreate heading path").addOption("ask", "Ask before inserting").setValue(this.owner.settings.missingSection).onChange(value => { this.owner.settings.missingSection = value === "ask" ? "ask" : "recreate"; this.owner.saveSettings(); }));
    new Setting(host).setName("Priority sort scope").addDropdown(d => d.addOption("list", "Current task list").addOption("section", "Whole heading section").addOption("first", "First task position in section").addOption("none", "No automatic sorting").setValue(this.owner.settings.sortScope).onChange(value => { this.owner.settings = settingsFrom({ ...this.owner.settings, sortScope: value }); this.owner.saveSettings(); }));
    new Setting(host).setName("Rendered task properties").setHeading();
    host.createEl("p", { text: "None selected by default. Scheduled dates still appear for scheduled tasks. These are read-only projections, never inserted into note source." });
    for (const property of DISPLAY_PROPERTIES) new Setting(host).setName(property.replace(/_/g, " ")).addToggle(t => t.setValue(this.owner.settings.displayProperties.includes(property)).onChange(value => {
      this.owner.settings.displayProperties = value ? [...this.owner.settings.displayProperties, property] : this.owner.settings.displayProperties.filter(p => p !== property); this.owner.saveSettings();
    }));
  }
}
