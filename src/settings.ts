import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type Organized from "./main";
import { DISPLAY_PROPERTIES, DisplayProperty, path, RETENTION_DETAILS, RetentionDetail, settingsFrom, visibleFolder } from "./model";
import { report } from "./service";
import { loadRole, Role, ROLE_LABELS, saveRole } from "./device";

export const PROPERTY_LABELS: Record<DisplayProperty, string> = {
  status: "Status", priority: "Priority", scheduled: "Scheduled date", created: "Created date",
  time_tracked_seconds: "Tracked time", recurring: "Recurrence", starred: "Favorite",
  projects: "Project links", movement_history: "Movement history", subtasks: "Subtask progress", sources: "Source references", description: "Description",
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
        row("Completed/canceled task retention (days)", "After this many days from completion or cancellation, linked todos become regular checkboxes and task notes move to Obsidian's trash. 0 disables cleanup; it runs when opening today's daily note.", setting => {
          setting.addText(t => {
            t.setValue(String(this.owner.settings.taskRetentionDays)); t.inputEl.type = "number"; t.inputEl.min = "0"; t.inputEl.max = "36500"; t.inputEl.step = "1";
            t.onChange(value => {
              if (!value.trim()) return;
              const days = Number(value);
              if (!Number.isInteger(days) || days < 0 || days > 36500) return;
              this.owner.settings.taskRetentionDays = days; this.owner.saveSettings();
            });
          });
        }),
        row("What retired tasks keep", "Applies when the retention above turns a task into a regular checkbox. Title only keeps just the checkbox. Add description writes it as a quote under the checkbox. Add everything also keeps sources and the time you worked, so older daily notes stay informative and the Day and Week views can still draw that time.", setting => {
          setting.addDropdown(d => d.addOption("title", "Keep the title only").addOption("description", "Add description if available").addOption("all", "Add everything (description, sources and time worked)")
            .setValue(this.owner.settings.retentionDetail).onChange(value => { if (RETENTION_DETAILS.includes(value as RetentionDetail)) { this.owner.settings.retentionDetail = value as RetentionDetail; this.owner.saveSettings(); } }));
        }),
      ] },
      { type: "group", heading: "Daily notes", items: [
        row("Daily-note source", this.owner.service.daily.followed() ? `Following the Daily Notes plugin: folder "${this.owner.service.daily.setup().dailyFolder || "(vault root)"}", format ${this.owner.service.daily.setup().dailyFormat}. The fields below are used only when you choose custom settings.` : "Follow the folder, format and template of the Daily Notes (or Periodic Notes) plugin, or set them here. Nothing is followed when neither plugin has a setup.", setting => {
          setting.addDropdown(d => d.addOption("plugin", "Follow the daily notes plugin").addOption("custom", "Custom settings").setValue(this.owner.settings.dailySource).onChange(value => {
            if (value === "plugin" || value === "custom") { this.owner.settings.dailySource = value; this.owner.saveSettings(); this.renderInto(this.containerEl); }
          }));
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
        row("Daily-note template", "Optional note whose content starts every daily note Organized creates, for example Templates/Daily.md. Supports {{date}}, {{date:FORMAT}}, {{time}}, {{time:FORMAT}} and {{title}}. Leave empty for blank notes.", setting => {
          setting.addText(t => t.setValue(this.owner.settings.dailyTemplate).onChange(value => {
            const validated = settingsFrom({ ...this.owner.settings, dailyTemplate: value });
            if (validated.dailyTemplate === value.trim()) { this.owner.settings = validated; this.owner.saveSettings(); }
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
        row("Long-press marker menu", "On a phone or tablet, press and hold a todo's checkbox in a daily note to pick its marker from a menu instead of typing it.", setting => {
          setting.addToggle(t => t.setValue(this.owner.settings.longPressMenu).onChange(value => { this.owner.settings.longPressMenu = value; this.owner.saveSettings(); }));
        }),
        row("Start tasks at their planned time", "While Obsidian is open, a task's timer starts when a block planned for it begins and stops when the block ends, so the planned time you spend on it counts as worked. Stop it during the block and that block leaves it stopped; a timer still running when the block ends stops at its end. Off by default.", setting => {
          setting.addToggle(t => t.setValue(this.owner.settings.startAtPlannedTime).onChange(value => { this.owner.settings.startAtPlannedTime = value; this.owner.saveSettings(); if (value) this.owner.planningTick(); }));
        }),
        row("Missing sections", "Choose what happens when a destination heading is missing.", setting => {
          setting.addDropdown(d => d.addOption("recreate", "Recreate heading path").addOption("ask", "Ask before inserting").setValue(this.owner.settings.missingSection).onChange(value => { this.owner.settings.missingSection = value === "ask" ? "ask" : "recreate"; this.owner.saveSettings(); }));
        }),
        row("Priority sort scope", "Sorting never moves tasks across heading paths.", setting => {
          setting.addDropdown(d => d.addOption("list", "Current task list").addOption("section", "Whole heading section").addOption("first", "First task position").addOption("none", "No automatic sorting").setValue(this.owner.settings.sortScope).onChange(value => { this.owner.settings = settingsFrom({ ...this.owner.settings, sortScope: value }); this.owner.saveSettings(); }));
        }),
      ] },
      { type: "group", heading: "Rendered task properties", items: [row("Alignment", "Where the symbols sit on a todo line: right after its text, or at the right edge of the line.", setting => {
        setting.addDropdown(d => d.addOption("text", "After the text").addOption("right", "Right edge").setValue(this.owner.settings.propertiesAlign).onChange(value => { this.owner.settings.propertiesAlign = value === "right" ? "right" : "text"; this.owner.saveSettings(); }));
      }), ...DISPLAY_PROPERTIES.filter(property => property !== "scheduled").map(property => row(PROPERTY_LABELS[property], undefined, setting => {
        setting.addToggle(t => t.setValue(this.owner.settings.displayProperties.includes(property)).onChange(value => {
          this.owner.settings.displayProperties = value ? [...this.owner.settings.displayProperties, property] : this.owner.settings.displayProperties.filter(p => p !== property); this.owner.saveSettings();
        }));
      }))] },
      { type: "group", heading: "This device", items: [
        row("Role of this device", "Only for this device; it is not synced. Use Secondary or Mirror on a phone or tablet that may open a daily note before your main device has synced it: two devices writing the same note is what makes sync conflicts. Secondary shows and changes tasks as usual but never creates or fills daily notes (recurring tasks, carrying unfinished tasks forward). Mirror only shows your tasks and changes nothing.", setting => {
          setting.addDropdown(d => {
            for (const [role, label] of Object.entries(ROLE_LABELS)) d.addOption(role, label);
            d.setValue(this.owner.role).onChange(value => { const role = value as Role; saveRole(this.app, role); this.owner.role = loadRole(this.app); this.owner.refresh(); });
          });
        }),
      ] },
      { type: "group", heading: "Help", items: [
        row("Retire tasks", "Turn tasks back into ordinary Markdown, or clean up finished ones: links, readable file names, keep or remove properties. Nothing changes until you confirm.", setting => { setting.addButton(b => b.setButtonText("Open").onClick(() => this.owner.retireTasks())); }),
        row("Onboarding card", "A short tour of the idea behind Organized. It appears once on a fresh install.", setting => { setting.addButton(b => b.setButtonText("Show").onClick(() => this.owner.showOnboarding(false))); }),
        row("Show what's new after updates", "After Organized updates, a short note says what changed, once. Turn it back on to see the notes again at the next start.", setting => {
          setting.addToggle(t => t.setValue(this.owner.settings.showWhatsNew).onChange(value => { this.owner.settings.showWhatsNew = value; if (value) this.owner.settings.lastSeenVersion = ""; this.owner.saveSettings(false); }));
        }),
        row("What's new", "Read the notes for this version again.", setting => { setting.addButton(b => b.setButtonText("Show").onClick(() => this.owner.showWhatsNew())); }),
      ] },
    ];
  }
}
