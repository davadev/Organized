import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type Organized from "./main";
import { DISPLAY_PROPERTIES, DisplayProperty, path, settingsFrom, visibleFolder } from "./model";
import { report } from "./service";

export const PROPERTY_LABELS: Record<DisplayProperty, string> = {
  status: "Status", priority: "Priority", scheduled: "Scheduled date", created: "Created date",
  time_tracked_seconds: "Tracked time", recurring: "Recurrence", starred: "Favorite",
  projects: "Project links", movement_history: "Movement history", sources: "Source references", notes: "Task notes",
};
interface Row { name: string; desc?: string; render: (setting: Setting) => void }
interface Group { type: "group"; heading: string; items: Row[] }
export class OrganizedSettingsTab extends PluginSettingTab {
  constructor(app: App, readonly owner: Organized) { super(app, owner); }
  getSettingDefinitions(): SettingDefinitionItem[] { return this.groups(); }
  display(): void { this.renderInto(this.containerEl); }
  renderInto(host: HTMLElement): void {
    host.empty(); host.addClass("organized-settings");
    for (const group of this.groups()) {
      new Setting(host).setName(group.heading).setHeading();
      for (const row of group.items) {
        const setting = new Setting(host).setName(row.name);
        // An empty description still reserves a line; omit it instead.
        if (row.desc) setting.setDesc(row.desc);
        row.render(setting);
      }
    }
  }
  private groups(): Group[] {
    const row = (name: string, desc: string | undefined, render: (setting: Setting) => void): Row => ({ name, desc, render: setting => { setting.setClass("organized-setting-row"); render(setting); } });
    return [
      { type: "group", heading: "Task storage", items: [
        row("Task folder", "Visible Markdown folder; changing it does not move existing tasks.", setting => {
          setting.addText(t => t.setValue(this.owner.settings.taskFolder).onChange(value => {
            try { this.owner.settings.taskFolder = visibleFolder(value); this.owner.saveSettings(); } catch (error) { report(error); }
          }));
        }),
      ] },
      { type: "group", heading: "Daily notes", items: [
        row("Daily-note source", "Custom settings are required because core daily-note configuration has no public API.", setting => {
          setting.addDropdown(d => d.addOption("custom", "Custom settings").setValue("custom").setDisabled(true));
        }),
        row("Daily-note folder", "Match your daily-note setup; leave empty for the vault root.", setting => {
          setting.addText(t => t.setValue(this.owner.settings.dailyFolder).onChange(value => {
            try { this.owner.settings.dailyFolder = path(value, true); this.owner.saveSettings(); } catch (error) { report(error); }
          }));
        }),
        row("Filename format", "Use a Moment date format with YYYY, MM and DD.", setting => {
          setting.addText(t => t.setValue(this.owner.settings.dailyFormat).onChange(value => {
            const validated = settingsFrom({ ...this.owner.settings, dailyFormat: value });
            if (validated.dailyFormat === value) { this.owner.settings = validated; this.owner.saveSettings(); }
          }));
        }),
      ] },
      { type: "group", heading: "Task behavior", items: [
        row("Auto-forward unfinished tasks", "On by default: opening today's daily note carries unfinished tasks forward, with an Undo summary.", setting => {
          setting.addToggle(t => t.setValue(this.owner.settings.autoForward).onChange(value => { this.owner.settings.autoForward = value; this.owner.saveSettings(); }));
        }),
        row("Show scheduled date link", "Show the date link above task properties and beside scheduled tasks, including forwarded ones.", setting => {
          setting.addToggle(t => t.setValue(this.owner.settings.showScheduledDate).onChange(value => { this.owner.settings.showScheduledDate = value; this.owner.saveSettings(); }));
        }),
        row("Missing sections", "Choose what happens when a destination heading is missing.", setting => {
          setting.addDropdown(d => d.addOption("recreate", "Recreate heading path").addOption("ask", "Ask before inserting").setValue(this.owner.settings.missingSection).onChange(value => { this.owner.settings.missingSection = value === "ask" ? "ask" : "recreate"; this.owner.saveSettings(); }));
        }),
        row("Priority sort scope", "Sorting never moves tasks across heading paths.", setting => {
          setting.addDropdown(d => d.addOption("list", "Current task list").addOption("section", "Whole heading section").addOption("first", "First task position").addOption("none", "No automatic sorting").setValue(this.owner.settings.sortScope).onChange(value => { this.owner.settings = settingsFrom({ ...this.owner.settings, sortScope: value }); this.owner.saveSettings(); }));
        }),
      ] },
      { type: "group", heading: "Rendered task properties", items: DISPLAY_PROPERTIES.filter(property => property !== "scheduled").map(property => row(PROPERTY_LABELS[property], undefined, setting => {
        setting.addToggle(t => t.setValue(this.owner.settings.displayProperties.includes(property)).onChange(value => {
          this.owner.settings.displayProperties = value ? [...this.owner.settings.displayProperties, property] : this.owner.settings.displayProperties.filter(p => p !== property); this.owner.saveSettings();
        }));
      })) },
    ];
  }
}
