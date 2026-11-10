import { Editor, MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { ACTION_MARKERS, parentIds, parseTasks, sameNesting, NOTE_MARKER, NoteSection, PROJECT_MARKER, RECURRING_MARKER, SECTION_MARKERS, SUBTASK_MARKER, TaskLine, TIME_MARKER, writeNoteSection } from "./codec";
import { DEFAULT_SETTINGS, elapsed, localDate, object, Settings, Status, Task } from "./model";
import { settingsFrom } from "./model";
import { Repository } from "./repository";
import { anchorOf, explicitRule, taskRule } from "./recurrence";
import { Context, report, TaskService } from "./service";
import { formatMinutes } from "./sessions";
import { loadRole, MirrorError, Role } from "./device";
import { ConfirmModal, DatePicker, isKeepAsTodo, NoteConversionModal, OnboardingModal, PriorityPicker, ProjectPicker, RecurrencePicker, RetireModal, SessionModal, TaskPicker, WhatsNewModal } from "./modals";
import { notesOfLine, notesToShow, ReleaseNote } from "./whatsNew/releaseNotes";
import { OrganizedInspectorView, VIEW_TYPE } from "./view";
import { OrganizedSettingsTab } from "./settings";
import { editorExtension, reading, refreshEditor } from "./render";
import { crashStatePath, decideOnLoad, DEFAULT_CRASH_STATE, readCrashState, writeCrashState } from "./crashGuard";
import { DataSafety } from "./safety";
import { isDestructive, normalizeRetire } from "./retire";

/** How long after the layout is ready the first-run card waits, so it does not open under the settings window that switched the plugin on. */
const FIRST_RUN_DELAY_MS = 1500;
/** A synced daily note arrives in pieces; how long to wait between looks, and how many looks at most. */
const MIRROR_NOTICE_MS = 5000;
const SETTLE_MS = 1000; const SETTLE_TRIES = 5;
const PLANNING_TICK_MS = 60000;
export default class Organized extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  repo!: Repository;
  service!: TaskService;
  safety!: DataSafety;
  context: Context | null = null;
  selectedTaskId: string | null = null;
  private shownNote: string | null = null;
  private readonly titleTimers = new Map<string, number>();
  private readonly structure = new Map<string, { before: Map<string, string | null>; timer: number }>();
  private lastNoteEditor: { editor: Editor; file: TFile } | null = null;
  revision = 0;
  readonly projectionListeners = new Set<() => void>();
  private busy = 0;
  private pickerOpen = false;
  private settingsRaw: Record<string, unknown> = {};
  private saveTail: Promise<unknown> = Promise.resolve();
  private loaded = false;
  /** This device's role; see `device.ts`. Read once at load, changed from the settings. */
  role: Role = "main";
  private mirrorNoticeAt = 0;
  private unloaded = false;
  async onload(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter; const crashPath = crashStatePath(this.manifest, this.app.vault.configDir);
      const decision = decideOnLoad(await readCrashState(adapter, crashPath), 5);
      await writeCrashState(adapter, crashPath, decision.next);
      if (decision.action === "trip-threshold") { new Notice("Organized detected repeated unsuccessful starts. Features are paused this launch. Disable/re-enable Organized after updating, or report the problem.", 0); return; }
      this.safety = new DataSafety(adapter, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`, this.manifest.version, message => { new Notice(message, 12000); });
      await this.safety.prepare();
      this.role = loadRole(this.app);
      this.settingsRaw = object(await this.loadData()); const saved = object(this.settingsRaw.settings ?? this.settingsRaw); this.settings = settingsFrom(saved);
      this.reconcileInstall(Object.keys(this.settingsRaw).length === 0, saved);
      // Disabled while the awaits above were pending: onunload already ran, so registering now would leak handlers and timers into a dead plugin.
      if (this.unloaded) return;
      this.repo = new Repository(this.app, () => this.settings, () => this.activeEditor());
      this.service = new TaskService(this.repo, () => this.refresh(), (message, heading, confirmLabel) => this.confirm(message, heading, confirmLabel));
      this.registerView(VIEW_TYPE, leaf => new OrganizedInspectorView(leaf, this));
      this.addSettingTab(new OrganizedSettingsTab(this.app, this));
      this.addRibbonIcon("calendar-check", "Open Organized", () => { void this.openInspector().catch(report); });
      this.addCommand({ id: "open-inspector", name: "Open inspector", callback: () => { void this.openInspector().catch(report); } });
      this.addCommand({ id: "attach-task", name: "Attach/create task (or repair missing link)", editorCallback: (editor, view) => { if (view.file) void this.pickTask(editor, view.file).catch(report); } });
      this.addCommand({ id: "duplicate-task", name: "Duplicate as new task", editorCallback: (editor, view) => { if (view.file) void this.pickTask(editor, view.file, true).catch(report); } });
      this.addCommand({ id: "convert-todos", name: "Convert unchecked todos to tasks", editorCallback: (_editor, view) => { if (view.file) void this.convertTodos(view.file).catch(report); } });
      this.addCommand({ id: "unlink-note-tasks", name: "Convert tasks in this note back to todos", editorCallback: (_editor, view) => { if (view.file) void this.run(() => this.service.unlinkTasks([view.file!], "this note")).catch(report); } });
      this.addCommand({ id: "add-subtask", name: "Add subtask", editorCallback: (editor, view) => { if (view.file) void this.addSubtask(editor, view.file).catch(report); } });
      this.addCommand({ id: "repair-subtasks", name: "Repair subtask links in this note", editorCallback: (_editor, view) => { const file = view.file; if (file) void this.run(() => this.service.repairSubtasks(file)).catch(report); } });
      this.addCommand({ id: "nest-subtasks", name: "Indent subtasks under their parents", callback: () => { void this.run(() => this.nestSubtasks(true)).catch(report); } });
      this.addCommand({ id: "retire-tasks", name: "Retire tasks…", callback: () => { this.retireTasks(); } });
      this.addCommand({ id: "rename-task-notes", name: "Rename task notes to their titles", callback: () => { void this.run(() => this.migrateTaskNoteNames(true)).catch(report); } });
      this.addCommand({ id: "show-onboarding", name: "Show onboarding card", callback: () => { this.showOnboarding(false); } });
      this.addCommand({ id: "show-whats-new", name: "Show what's new", callback: () => { this.showWhatsNew(); } });
      this.addCommand({ id: "undo", name: "Undo last recurrence/auto-forward batch", callback: () => { void this.service.undo().catch(report); } });
      this.addCommand({ id: "restore-settings", name: "Restore compatible settings backup (restart required)", callback: () => { void this.confirm("Queue the newest compatible settings backup for restoration on next restart? Task Markdown will not change.").then(yes => yes ? this.safety.queueCompatibleRestore() : undefined).catch(report); } });
      this.addCommand({ id: "edit-marker", name: "Edit checkbox marker", editorCallback: editor => { this.editMarker(editor); } });
      this.registerEditorExtension(editorExtension(this));
      this.registerMarkdownPostProcessor((el, ctx) => reading(this, el, ctx));
      this.registerEvent(this.app.workspace.on("editor-change", () => this.followCursor()));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.followCursor()));
      this.loaded = true;
      this.app.workspace.onLayoutReady(() => {
        if (!this.loaded) return;
        // Registration happens AFTER Obsidian's initial existing-file create events.
        this.registerEvent(this.app.vault.on("create", file => { if (file instanceof TFile) { void this.repo.track(file); if (this.role === "main") void this.run(async () => { if (this.service.daily.date(file.path)) await this.settle(file); await this.service.onDailyCreated(file); }); void this.service.index(file).catch(report); } }));
        this.registerEvent(this.app.vault.on("modify", file => { if (file instanceof TFile) {
          void this.repo.track(file); const id = this.selectedTaskId; const wasReference = this.service.hasReference(id, file.path);
          void this.service.index(file).then(() => {
            if (file.path.startsWith(`${this.settings.taskFolder}/`) || this.service.daily.date(file.path) === localDate() || wasReference || this.service.hasReference(id, file.path)) this.refreshSoon();
          }).catch(report);
        } }));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { this.service.forget(oldPath); if (file instanceof TFile) { this.repo.moved(oldPath, file); void this.service.index(file).then(() => this.refresh()).catch(report); if (this.safety.writable && this.repo.convertedTo(oldPath).length) void this.runQuiet(() => this.service.followRename(oldPath, file.path)); if (this.safety.writable && this.repo.isProjectNote(file)) { this.remapKnownProjects([{ from: oldPath, to: file.path }]); void this.runQuiet(() => this.service.followProjectRename(oldPath, file.path)); } } }));
        // The colour is read from the metadata cache, which updates a moment after the note is written.
        this.registerEvent(this.app.metadataCache.on("changed", file => { if (this.repo.isProjectNote(file)) this.refresh(); }));
        this.registerEvent(this.app.vault.on("delete", file => { this.repo.forgetPath(file.path); this.service.forget(file.path); this.refresh(); }));
        // A moment after the layout is ready (immediately so when the plugin is switched on in a running session): the settings window that switched it on may still be closing.
        this.registerInterval(window.setTimeout(() => { void this.maybeShowStartupCard().catch(report); }, FIRST_RUN_DELAY_MS));
        void this.runQuiet(async () => { await this.repo.reindex(); await this.migrateProjects(); await this.markProjectNotes(); await this.migrateTaskNotes(); await this.migrateTaskNoteNames(); await this.nestSubtasks(); });
        this.registerEvent(this.app.workspace.on("file-open", file => { this.followCursor(); if (file && this.role === "main") void this.run(() => this.service.reconcile(file)); }));
      });
      this.loaded = true;
      // Planned blocks start and end tasks only while the setting is on; the check catches up on start and when the app comes back to the foreground.
      this.app.workspace.onLayoutReady(() => {
        this.planningTick(); this.registerInterval(window.setInterval(() => this.planningTick(), PLANNING_TICK_MS));
        this.registerDomEvent(document, "visibilitychange", () => { if (!document.hidden) this.planningTick(); });
      });
      this.registerInterval(window.setTimeout(() => { void writeCrashState(adapter, crashPath, DEFAULT_CRASH_STATE); }, 30000));
    } catch (error) { report(error); throw error; }
  }
  onunload(): void {
    this.loaded = false; this.unloaded = true; for (const timer of this.titleTimers.values()) window.clearTimeout(timer); this.titleTimers.clear(); for (const { timer } of this.structure.values()) window.clearTimeout(timer); this.structure.clear(); if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer); this.refreshTimer = null;
    void writeCrashState(this.app.vault.adapter, crashStatePath(this.manifest, this.app.vault.configDir), DEFAULT_CRASH_STATE);
  }
  /** Sets tasks in progress for planned blocks that have begun and reopens the ones whose block is over. Does nothing unless the person switched it on. */
  planningTick(): void {
    if (this.unloaded || !this.loaded || !this.safety.writable || this.role === "mirror" || !this.settings.startAtPlannedTime) return;
    void this.run(async () => {
      const ended = await this.service.applyPlanning();
      if (ended.length) new Notice(ended.length === 1 ? `Planned time for “${ended[0]}” is over. Adjust the time if you need longer.` : `Planned time is over for ${ended.length} tasks: ${ended.map(title => `“${title}”`).join(", ")}. Adjust the time if you need longer.`, 10000);
    });
  }
  assertWritable(): void { if (!this.safety.writable) throw new Error("Writes paused to protect newer/unreadable settings. Restore a compatible backup or update Organized."); }
  /** Like `assertWritable`, and a mirror device may not change anything either. */
  assertEditable(): void { this.assertWritable(); if (this.role === "mirror") throw new MirrorError(); }
  async run(action: () => Promise<unknown>): Promise<void> {
    this.busy++;
    try {
      this.assertEditable();
      await this.repo.serial(action);
    } catch (error) {
      // Typing in a note on a mirror would repeat the notice for every change.
      if (error instanceof MirrorError) { if (Date.now() - this.mirrorNoticeAt > MIRROR_NOTICE_MS) { this.mirrorNoticeAt = Date.now(); report(error); } } else report(error);
    } finally { this.busy--; }
  }
  /** For background work (migrations, following a rename): nothing at all on a mirror, instead of a notice nobody asked for. */
  runQuiet(action: () => Promise<unknown>): Promise<void> { return this.role === "mirror" ? Promise.resolve() : this.run(action); }
  saveSettings(refresh = true): void {
    this.saveTail = this.saveTail.then(async () => {
      this.assertWritable(); await this.saveData({ ...this.settingsRaw, schemaVersion: 1, writerVersion: this.manifest.version, settings: { ...object(this.settingsRaw.settings), ...this.settings } }); if (refresh) this.refresh();
    }).catch(report);
  }
  /** Whether the Day view's task list is folded away; kept so a long list stays out of the way. */
  /**
   * Decides, once per load, who is new: no saved data at all is a fresh install (told nothing old; the onboarding card is owed), data written before What's new existed means someone
   * who updated (never pushed the tour; they get the catch-up note). Only the saved settings are looked at, nothing in the vault.
   */
  private reconcileInstall(fresh: boolean, saved: Record<string, unknown>): void {
    if (fresh) this.settings.lastSeenVersion = this.manifest.version;
    else if (!("lastSeenVersion" in saved)) this.settings.onboardingSeen = true;
  }
  /** The one card to show now: the onboarding tour while it is owed (fresh installs), otherwise What's new for a release this device has not been told about. Never both, and nothing while writes are paused. Nothing waits for a restart: if this code is running, the new version is the one that is loaded. */
  async maybeShowStartupCard(): Promise<void> {
    if (this.unloaded || !this.loaded || !this.safety.writable) return;
    if (!this.settings.onboardingSeen) { this.showOnboarding(true); return; }
    if (!this.settings.showWhatsNew) return;
    const current = this.manifest.version; const notes = notesToShow(this.settings.lastSeenVersion, current); if (!notes.length) return;
    // Recorded before it opens, so it cannot come back even if the app closes while it is open.
    this.settings.lastSeenVersion = current; this.saveSettings(false); await this.saveTail;
    this.openWhatsNew(notes);
  }
  showOnboarding(remember: boolean): void {
    new OnboardingModal(this.app, () => { if (remember && !this.settings.onboardingSeen) { this.settings.onboardingSeen = true; this.settings.lastSeenVersion = this.manifest.version; this.saveSettings(false); } }).open();
  }
  /** Opens this version's notes again (the whole minor line, oldest first), whatever has been shown before. */
  showWhatsNew(): void {
    const notes = notesOfLine(this.manifest.version);
    if (!notes.length) { new Notice(`There are no release notes for ${this.manifest.version}.`); return; }
    this.openWhatsNew(notes);
  }
  private openWhatsNew(notes: ReleaseNote[]): void {
    new WhatsNewModal(this.app, notes, () => {
      this.settings.showWhatsNew = false; this.saveSettings(false);
      new Notice("Release notes are off. You can turn them on again in the settings of Organized.", 8000);
    }).open();
  }
  /** Remembers a task panel card as folded or open; it holds for every task. */
  setTaskSectionCollapsed(name: string, collapsed: boolean): void { const rest = this.settings.collapsedTaskSections.filter(n => n !== name); this.settings.collapsedTaskSections = collapsed ? [...rest, name] : rest; this.saveSettings(false); }
  setDayTasksCollapsed(collapsed: boolean): void { this.settings.dayTasksCollapsed = collapsed; this.saveSettings(false); }
  /** Whether the Task tab's note list leaves out done tasks. */
  setHideDoneTasks(hide: boolean): void { this.settings.hideDoneTasks = hide; this.saveSettings(false); }
  /** Whether the Projects tab leaves out done and canceled tasks (on by default; the lists span all time). */
  setHideClosedProjects(hide: boolean): void { this.settings.hideClosedProjects = hide; this.saveSettings(false); }
  /** Collapsed task-tab headings persist until the user expands them again. */
  setHeadingCollapsed(notePath: string, key: string, collapsed: boolean): void {
    const keys = (this.settings.collapsedHeadings[notePath] ?? []).filter(k => k !== key); if (collapsed) keys.push(key);
    const next = { ...this.settings.collapsedHeadings }; if (keys.length) next[notePath] = keys; else delete next[notePath];
    this.settings.collapsedHeadings = next; this.saveSettings(false);
  }
  /** One-time move of already linked project notes into the project folder, announced with an Undo. */
  async migrateProjects(): Promise<void> {
    if (this.settings.projectsMigrated || !this.safety.writable) return;
    const result = await this.service.migrateProjects();
    this.settings.projectsMigrated = true; this.remapKnownProjects(result.moved);
    if (!result.moved.length && !result.skipped.length) return;
    const fragment = createFragment(); const notice = fragment.createDiv({ cls: "organized-notice" });
    notice.createDiv({ cls: "organized-notice-title", text: "Projects moved into the task folder" });
    notice.createDiv({ cls: "organized-notice-detail", text: `${result.moved.length} project note${result.moved.length === 1 ? "" : "s"} moved to ${this.repo.projectFolder()}${result.skipped.length ? ` · ${result.skipped.length} skipped because the destination exists or the move failed: ${result.skipped.join(", ")}` : ""}.` });
    if (result.moved.length) {
      const undo = notice.createEl("button", { text: "Undo", cls: "organized-notice-undo" });
      undo.addEventListener("click", () => { void this.run(async () => {
        const back = result.moved.map(m => ({ from: m.to, to: m.from })); const reverted = await this.service.moveProjects(back);
        this.remapKnownProjects(reverted.moved); new Notice(reverted.skipped.length ? `Some projects could not move back: ${reverted.skipped.join(", ")}` : "Project notes moved back.");
      }); });
    }
    new Notice(fragment, 15000);
  }
  /** One-time: project notes made before the marker or the start date existed get `organized_type: project` and `organized_start` (today), so the picker lists them and a project knows when it began. */
  async markProjectNotes(): Promise<void> {
    if (this.settings.projectStartsSet || !this.safety.writable) return;
    const updated = await this.service.markProjects(); this.settings.projectNotesMarked = true; this.settings.projectStartsSet = true; this.saveSettings(false);
    if (updated) new Notice(`${updated} project note${updated === 1 ? "" : "s"} updated: marked as projects and given a start date (today).`, 12000);
  }
  /** Opens the Retire window. Choices that remove something (properties, the task note itself) ask once more before anything is written. */
  retireTasks(): void {
    const s = this.settings;
    const defaults = normalizeRetire({ which: s.taskRetentionDays > 0 ? "closed" : "all", olderThanDays: s.taskRetentionDays || 7, lines: "plain", keep: s.retentionDetail, notes: "keep", yaml: "keep" });
    new RetireModal(this.app, defaults, () => this.service.scanRetire(), async options => {
      if (isDestructive(options) && !(await this.confirm(options.notes === "trash"
        ? "The selected task notes move to Obsidian's trash. You can restore them from there, but Undo will not be offered. Continue?"
        : "Organized's properties (status, dates, tracked time…) are removed from the selected task notes; Organized will no longer recognise them. Anything you want to keep must be chosen under \"Kept under the todo\". Continue?", "Retire tasks", "Retire"))) return;
      await this.run(() => this.service.retireTasks(options, (files, extra) => this.safety.writeBackup("retire", files, extra)));
    }).open();
  }
  /** One-time: rewrite task notes from the old layout in the new one, after saving their old text. Retries on the next start when anything failed. */
  async migrateTaskNotes(): Promise<void> {
    if (this.settings.taskNotesMigrated || !this.safety.writable) return;
    let result: Awaited<ReturnType<TaskService["migrateTaskBodies"]>>;
    try { result = await this.service.migrateTaskBodies(files => this.safety.writeBackup("task-notes", files)); }
    catch (error) { new Notice(`Task notes were not updated (nothing was changed): ${error instanceof Error ? error.message : String(error)}`, 12000); return; }
    if (!result.failed.length) { this.settings.taskNotesMigrated = true; this.saveSettings(false); }
    if (!result.changes.length && !result.failed.length) return;
    const count = result.changes.length;
    this.service.summarize(result.changes, "Task notes updated", `${count} task note${count === 1 ? "" : "s"} now keep the description as the note text. The old text is saved in the plugin folder (note-backups).${result.failed.length ? ` ${result.failed.length} could not be updated and will be retried next start.` : ""}`);
  }
  /** One-time (and on demand): name task notes that still carry their id after the title of their todo, after saving the plan. Tried once; the command runs it again. */
  async migrateTaskNoteNames(again = false): Promise<void> {
    if ((this.settings.taskNoteNamesMigrated && !again) || !this.safety.writable) return;
    let result: Awaited<ReturnType<TaskService["migrateTaskNames"]>>;
    try { result = await this.service.migrateTaskNames(extra => this.safety.writeBackup("task-names", [], extra)); }
    catch (error) { new Notice(`Task notes were not renamed (nothing was changed): ${error instanceof Error ? error.message : String(error)}`, 12000); return; }
    this.settings.taskNoteNamesMigrated = true; this.saveSettings(false);
    if (!result.renames.length && !result.failed.length) { if (again) new Notice("Every task note already carries its title."); return; }
    const count = result.renames.length;
    this.service.summarize([], "Task notes renamed", `${count} task note${count === 1 ? "" : "s"} now carry the title of their todo. The planned names are saved in the plugin folder (note-backups). Update Organized on your other devices too: an older version looks for task notes by their id.${result.failed.length ? ` ${result.failed.length} could not be renamed and keep their id (${result.failed.join(", ")}); the command Rename task notes to their titles tries again.` : ""}`, result.renames);
  }
  /** One-time (and on demand): indent todos under their parents where a parent's subtask list says so but the lines are not nested yet, after saving the old text of every note it changes. */
  async nestSubtasks(again = false): Promise<void> {
    if ((this.settings.subtaskNestingMigrated && this.settings.subtaskIndentMigrated && !again) || !this.safety.writable) return;
    let result: Awaited<ReturnType<TaskService["nestSubtaskLines"]>>;
    try { result = await this.service.nestSubtaskLines(files => this.safety.writeBackup("subtask-indent", files)); }
    catch (error) { new Notice(`Subtasks were not indented (nothing was changed): ${error instanceof Error ? error.message : String(error)}`, 12000); return; }
    if (!result.failed.length) { this.settings.subtaskNestingMigrated = true; this.settings.subtaskIndentMigrated = true; this.saveSettings(false); }
    if (!result.changes.length && !result.failed.length) { if (again) new Notice("Every subtask is already indented under its parent."); return; }
    const notes = new Set(result.changes.map(c => c.file.path)).size;
    this.service.summarize(result.changes, "Subtasks indented", `${notes} note${notes === 1 ? "" : "s"} updated: subtasks now sit under their parents. The old text is saved in the plugin folder (note-backups).${result.failed.length ? ` ${result.failed.length} could not be updated and will be retried next start.` : ""}`);
  }
  private remapKnownProjects(moved: { from: string; to: string }[]): void {
    const target = new Map(moved.map(m => [m.from, m.to]));
    this.settings.knownProjects = [...new Set(this.settings.knownProjects.map(p => target.get(p) ?? p))]; this.saveSettings(false);
  }
  /** Remembers project notes so they stay listed after their last task is deleted. */
  rememberProjects(projects: string[]): void {
    const added = projects.filter(p => !this.settings.knownProjects.includes(p)); if (!added.length) return;
    this.settings.knownProjects = [...this.settings.knownProjects, ...new Set(added)]; this.saveSettings(false);
  }
  activeEditor(): { editor: Editor; file: TFile } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView); return view?.file && view.getMode() === "source" ? { editor: view.editor, file: view.file } : null;
  }
  /** The note last used in the main area, even when the side panel has focus or the note was opened before any editor event. */
  private recentEditor(): { editor: Editor; file: TFile } | null {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    return view instanceof MarkdownView && view.file ? { editor: view.editor, file: view.file } : null;
  }
  taskSourceEditor(): { editor: Editor; file: TFile } | null {
    const current = this.activeEditor() ?? this.recentEditor(); if (current) this.lastNoteEditor = current;
    if (this.lastNoteEditor && !this.repo.file(this.lastNoteEditor.file.path)) this.lastNoteEditor = null;
    return this.lastNoteEditor;
  }
  /** Waits until a new daily note stops changing, so the repeat lines are not written into the empty file a sync is about to fill, or over its text. */
  private async settle(file: TFile): Promise<void> {
    try {
      let last = await this.repo.readText(file);
      for (let i = 0; i < SETTLE_TRIES; i++) {
        await new Promise<void>(done => { window.setTimeout(done, SETTLE_MS); });
        const now = await this.repo.readText(file); if (now === last) return; last = now;
      }
    } catch { /* The note went away; filling it then fails and is reported as before. */ }
  }
  async taskLines(file: TFile): Promise<TaskLine[]> { return parseTasks(await this.repo.readText(file)); }
  current(editor: Editor, file: TFile): Context | null {
    const line = parseTasks(editor.getValue()).find(t => t.line === editor.getCursor().line);
    return line ? { file, line } : null;
  }
  followCursor(): void {
    // The task list shows the note in the main area, so switching notes must repaint it even when no task is selected on either side.
    const note = this.taskSourceEditor()?.file.path ?? null; const noteChanged = note !== this.shownNote; this.shownNote = note;
    const active = this.activeEditor();
    // Focusing the inspector is not leaving the selected task. Only an actual
    // Markdown editor cursor change can replace its context.
    if (!active) { if (noteChanged) this.eachView(view => { void view.render().catch(report); }); return; }
    const next = this.current(active.editor, active.file);
    const changed = (next?.line.id ?? null) !== (this.context?.line.id ?? null);
    this.context = next;
    if (changed) this.selectedTaskId = next?.line.id ?? null;
    if (changed || noteChanged) this.eachView(view => {
      if (changed) { view.origin = "Editor cursor"; view.module = ""; view.editingModule = ""; view.editingTitle = false; }
      void view.render().catch(report);
    });
  }
  eachView(callback: (view: OrganizedInspectorView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof OrganizedInspectorView) callback(leaf.view);
  }
  private refreshTimer: number | null = null;
  /** Autosaves of the note being typed in arrive every second or two; the panel is redrawn for them at most about twice a second, not once per save. */
  refreshSoon(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = null; if (this.loaded) this.refresh(); }, 400);
  }
  refresh(): void {
    this.revision++;
    for (const listener of this.projectionListeners) listener();
    this.eachView(view => { void view.render().catch(report); });
    // Every open note, not just the focused one: the settings dialog has focus when a display option is switched.
    for (const cm of this.editorViews()) refreshEditor(cm);
  }
  private editorViews(): Set<EditorView> {
    // One isolated bridge: Obsidian intentionally omits CM6 from Editor's
    // public type. Unknown first also keeps type-blind review lint honest.
    const views = new Set<EditorView>(); const editors: unknown[] = [this.activeEditor()?.editor];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) if (leaf.view instanceof MarkdownView) editors.push(leaf.view.editor);
    for (const editor of editors) { const cm = (editor as { cm?: EditorView } | undefined)?.cm; if (cm) views.add(cm); }
    return views;
  }
  async openInspector(tab?: "Task", module = ""): Promise<void> {
    const active = this.activeEditor(); if (active) this.lastNoteEditor = active;
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error("Cannot open the sidebar; try opening a workspace pane first."); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof OrganizedInspectorView) { if (tab) leaf.view.tab = tab; leaf.view.module = module; if (module) leaf.view.editingModule = module; await leaf.view.render(); }
  }
  confirm(message: string, heading = "Confirm task action", confirmLabel = "Confirm"): Promise<boolean> { return new Promise(resolve => new ConfirmModal(this.app, message, resolve, heading, confirmLabel).open()); }
  async deleteTask(id: string): Promise<void> {
    let removed = false;
    await this.run(async () => {
      removed = await this.service.deleteTask(id, () => {
        if (this.selectedTaskId === id) this.selectedTaskId = null;
        if (this.context?.line.id === id) this.context = null;
      });
    });
    if (!removed) return;
    this.eachView(view => { view.tab = "Projects"; view.module = ""; view.editingModule = ""; view.editingTitle = false; });
    this.refresh();
  }
  async pickTask(editor: Editor, file: TFile, duplicate = false, allowTodo = false): Promise<void> {
    this.assertEditable(); const context = this.current(editor, file); if (!context) throw new Error("Place the cursor on a Markdown task-list item.");
    if (context.line.id && !duplicate && await this.repo.exists(context.line.id)) throw new Error("Task already linked. Use duplicate as new task for a fresh identity.");
    const captured = editor.getValue(); const selection = editor.listSelections(); this.lastNoteEditor = { editor, file };
    this.pickerOpen = true;
    // A failed read must not leave editor handling disabled for good.
    // Finished tasks are history: offering them would bury a chore you repeat under every time you did it. Creating a new task stays one choice away.
    const tasks = duplicate ? [] : (await this.repo.list().catch((error: unknown) => { this.pickerOpen = false; throw error; })).filter(task => task.status === "open" || task.status === "in_progress");
    const picker = new TaskPicker(this.app, tasks, async choice => {
      if (isKeepAsTodo(choice)) return;
      await this.run(async () => {
        if (this.taskSourceEditor()?.editor !== editor || editor.getValue() !== captured || JSON.stringify(editor.listSelections()) !== JSON.stringify(selection)) throw new Error("Editor changed while the picker was open. Line preserved; invoke attach/create to retry.");
        let task = typeof choice === "string" ? await this.repo.create(choice) : choice;
        // A task created for a todo nested under a linked todo belongs to the same projects as its parent.
        const parent = typeof choice === "string" ? parseTasks(captured).find(t => t.line === context.line.parent)?.id : undefined;
        if (parent) { const { projects } = await this.repo.read(parent); if (projects.length) task = await this.repo.update(task.id, t => ({ ...t, projects })); }
        await this.service.attach(context, task, duplicate || !!context.line.id);
      });
    }, context.line.title, allowTodo);
    const close = picker.onClose.bind(picker);
    picker.onClose = () => { close(); this.pickerOpen = false; };
    picker.open();
  }
  /** Editing a linked todo's text in a note renames the task once typing pauses, so the panel and every other occurrence follow. */
  private watchEditedTitle(update: ViewUpdate): void {
    const events = update.transactions.map(t => t.annotation(Transaction.userEvent));
    if (events.every(event => event?.startsWith("input.organized"))) return;
    const active = this.activeEditor(); if (!active || active.editor.getValue() !== update.state.doc.toString()) return;
    const cursor = active.editor.getCursor().line;
    const now = parseTasks(update.state.doc.toString()).find(t => t.line === cursor); const before = parseTasks(update.startState.doc.toString()).find(t => t.line === cursor);
    if (!now?.id || before?.id !== now.id || before.title === now.title) return;
    const id = now.id; window.clearTimeout(this.titleTimers.get(id));
    this.titleTimers.set(id, window.setTimeout(() => { this.titleTimers.delete(id); void this.syncEditedTitle(active.file, id).catch(report); }, 800));
  }
  /** Indenting, outdenting or moving a linked todo changes whose subtask it is. The first change of a burst remembers how the note was nested; once typing pauses, the parents' lists are brought in step (nothing is written when the nesting did not change). */
  private watchStructure(update: ViewUpdate): void {
    if (update.transactions.every(t => t.annotation(Transaction.userEvent)?.startsWith("input.organized"))) return;
    const active = this.activeEditor(); if (!active || this.repo.isTaskRecord(active.file.path) || active.editor.getValue() !== update.state.doc.toString()) return;
    const key = active.file.path; const pending = this.structure.get(key); window.clearTimeout(pending?.timer);
    const before = pending?.before ?? parentIds(update.startState.doc.toString());
    const timer = window.setTimeout(() => {
      this.structure.delete(key);
      void (async () => {
        const after = parentIds(await this.repo.readText(active.file)); if (sameNesting(before, after)) return;
        await this.run(() => this.service.syncSubtasks(before, after));
      })().catch(report);
    }, 800);
    this.structure.set(key, { before, timer });
  }
  /** Adds an empty todo one level in under the todo at the cursor (after everything already nested under it) and asks which task it is. */
  /** Puts the caret on the marker of the todo line it is on (`[ ]` -> the space selected), so the next letter typed replaces it exactly as if the person had clicked into the checkbox. Bind a key to it in Obsidian's Hotkeys settings. */
  editMarker(editor: Editor): void {
    // The whole note is parsed: on its own, an indented subtask line reads as a code block.
    const line = editor.getCursor().line; const task = parseTasks(editor.getValue()).find(t => t.line === line);
    if (!task) { new Notice("Put the cursor on a todo line (- [ ] ...) first."); return; }
    editor.setSelection({ line, ch: task.prefix.length }, { line, ch: task.prefix.length + 1 });
  }
  async addSubtask(editor: Editor, file: TFile): Promise<void> {
    const context = this.current(editor, file); if (!context?.line.id) throw new Error("Put the cursor on a linked todo to add a subtask under it.");
    const lines = editor.getValue().split("\n"); const indent = (line: string) => /^\s*/.exec(line)![0].replace(/\t/g, "    ").length; const own = indent(context.line.raw);
    let end = context.line.line + 1; while (end < lines.length && lines[end].trim() && indent(lines[end]) > own) end++;
    const at = { line: end - 1, ch: lines[end - 1].replace(/\r$/, "").length };
    const child = `${/^\s*/.exec(context.line.raw)![0]}${await this.repo.indentUnit()}- [ ] `;
    editor.replaceRange(`\n${child}`, at); editor.setCursor({ line: end, ch: child.length });
    await this.pickTask(editor, file, false, true);
  }
  private async syncEditedTitle(file: TFile, id: string): Promise<void> {
    const lines = parseTasks(await this.repo.readText(file)).filter(t => t.id === id); if (lines.length !== 1 || !lines[0].title) return;
    const title = lines[0].title; const task = await this.repo.read(id); if (task.title === title) return;
    await this.run(() => this.service.title(id, title));
  }
  /** A running timer stops when its `[/]` line is removed or its marker is changed, wherever the cursor is and even while another action runs (the stop queues behind it). Only the person's own edits count: a note reloaded after a sync or rewritten by another plugin must not stop a timer. */
  private stopEditedTimers(update: ViewUpdate): void {
    const active = this.activeEditor(); if (!active || active.editor.getValue() !== update.state.doc.toString()) return;
    const after = new Map(parseTasks(update.state.doc.toString()).flatMap(t => t.id ? [[t.id, t.marker] as const] : []));
    const status = (marker: string | undefined): Status | null => marker === undefined || marker === " " ? "open" : marker === "x" || marker === "X" ? "completed" : marker === "-" ? "canceled" : null;
    for (const line of parseTasks(update.startState.doc.toString())) {
      const id = line.id; if (!id || line.marker !== "/") continue; const next = status(after.get(id)); if (next === null) continue;
      void this.run(async () => {
        // The task may have been stopped, finished or deleted since; then there is nothing to stop.
        const running = await this.repo.read(id).catch(() => null); if (!running?.time_tracking_started_at) return;
        await this.service.status(id, next); const task = await this.repo.read(id);
        new Notice(`Timer stopped for "${task.title}" because ${after.has(id) ? "its marker changed" : "its todo was removed"}. ${formatMinutes(Math.floor(task.time_tracked_seconds / 60))} tracked so far.`);
      }).catch(report);
    }
  }
  onEditorUpdate(update: ViewUpdate): void {
    if (update.selectionSet) this.followCursor();
    if (update.docChanged) { this.watchEditedTitle(update); this.watchStructure(update); }
    if (!update.docChanged || this.pickerOpen) return;
    const events = update.transactions.map(t => t.annotation(Transaction.userEvent));
    if (events.some(event => event && ["paste", "drop", "undo", "redo"].some(ignored => event.includes(ignored)))) return;
    const user = events.some(event => event && !event.startsWith("input.organized"));
    if (user) this.stopEditedTimers(update);
    if (this.busy) return;
    const active = this.activeEditor(); if (!active || active.editor.getValue() !== update.state.doc.toString()) return;
    this.lastNoteEditor = active;
    // Ticking a checkbox in Live Preview replaces one marker character, often with no user event and without moving the cursor onto the line.
    if (this.tickedLinkedTask(update, active, user)) return;
    let touchedLines = 0; update.changes.iterChanges((_a, _b, from, to) => { touchedLines += update.state.doc.lineAt(to).number - update.state.doc.lineAt(from).number + 1; });
    if (touchedLines > 2) return;
    const context = this.current(active.editor, active.file); if (!context) return;
    const old = parseTasks(update.startState.doc.toString()).find(t => t.line === context.line.line);
    let changes = 0; let exactBlankCheckboxInsertion = false;
    update.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      changes++;
      exactBlankCheckboxInsertion = update.startState.doc.sliceString(from, to).trim() === ""
        && /^\s*(?:[-+*]|\d+[.)]) \[ \] ?$/.test(inserted.toString());
    });
    // Some mobile toolbar actions dispatch a single blank checkbox without a CM userEvent annotation.
    // Accept only that exact one-line insertion; pasted blocks, undo/redo and bulk edits stay ignored.
    if (!user && !(changes === 1 && exactBlankCheckboxInsertion && !context.line.id && context.line.marker === " " && !context.line.title)) return;
    // Enter on a todo leaves a blank `- [ ] ` below it; the first character typed there asks as well, as if the checkbox had just been typed.
    const firstCharacter = !!old && !old.id && old.marker === " " && !old.title && !!context.line.title;
    if (!context.line.id && context.line.marker === " " && (!old || !/^\s*(?:[-+*]|\d+[.)]) \[ \]/.test(old.raw) || firstCharacter)) {
      queueMicrotask(() => { if (!this.pickerOpen) void this.pickTask(active.editor, active.file, false, true).catch(report); }); return;
    }
    if (!context.line.id && context.line.title && ACTION_MARKERS.includes(context.line.marker) && context.line.marker !== old?.marker) {
      queueMicrotask(() => { void this.run(async () => {
        const fresh = await this.service.resolve(context);
        const task = await this.repo.create(fresh.line.title);
        const attached = await this.service.attach(context, task);
        // Modal triggers must not run inside the serial queue they use later.
        queueMicrotask(() => { void this.trigger(attached).catch(report); });
      }); });
      return;
    }
    if (context.line.id && old?.marker !== context.line.marker) queueMicrotask(() => { void this.trigger(context).catch(report); });
  }
  /** Handles a one-character [ ] <-> [x] change on a linked task that the cursor-based path would miss; returns whether it did. */
  private tickedLinkedTask(update: ViewUpdate, active: { editor: Editor; file: TFile }, user: boolean): boolean {
    let count = 0; let at = -1; update.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => { count++; at = to - from === 1 && inserted.length === 1 ? from : -1; });
    if (count !== 1 || at < 0) return false;
    const line = update.state.doc.lineAt(at).number - 1;
    const before = parseTasks(update.startState.doc.toString()).find(t => t.line === line); const after = parseTasks(update.state.doc.toString()).find(t => t.line === line);
    const done = (marker: string) => marker === "x" || marker === "X";
    if (!after?.id || before?.id !== after.id || !(done(before.marker) || before.marker === " ") || !(done(after.marker) || after.marker === " ") || done(before.marker) === done(after.marker)) return false;
    // A typed marker with the cursor on the line is handled by the trigger path.
    if (user && active.editor.getCursor().line === line) return false;
    const context = { file: active.file, line: after }; const id = after.id;
    queueMicrotask(() => { void this.run(() => this.service.status(id, done(after.marker) ? "completed" : "open", context)); });
    return true;
  }
  async trigger(context: Context): Promise<void> {
    const marker = context.line.marker; const id = context.line.id; if (!id) return;
    this.assertEditable(); this.context = context; this.selectedTaskId = id;
    if (marker === "<") { const task = await this.repo.read(id); new DatePicker(this.app, task.scheduled ?? localDate(), date => this.run(() => this.service.schedule(context, date)), task.scheduled ? () => this.run(() => this.service.unschedule(id)) : undefined).open(); }
    else if (marker === "!") new PriorityPicker(this.app, priority => this.run(() => this.service.priority(context, priority))).open();
    else if (marker in SECTION_MARKERS) { await this.openInspector("Task", SECTION_MARKERS[marker]); await this.run(() => this.service.clean(context)); }
    else if (marker === PROJECT_MARKER) this.pickProjects(await this.repo.read(id), context);
    else if (marker === NOTE_MARKER) this.convertToNote(await this.repo.read(id), context);
    else if (marker === RECURRING_MARKER) this.pickRecurrence(await this.repo.read(id), context, true);
    else if (marker === TIME_MARKER) this.addTime(await this.repo.read(id), context);
    else if (marker === SUBTASK_MARKER) await this.addSubtaskFromMarker(await this.repo.read(id), context);
    else await this.run(() => this.service.marker(context, marker));
  }
  /** Asks how the task repeats. From a typed `[r]` (`typed`), cancelling puts the todo's own marker back; from the panel there is no marker to put back. */
  pickRecurrence(task: Task, context?: Context, typed = false): void {
    new RecurrencePicker(this.app, localDate(), task.recurring ? explicitRule(taskRule(task), anchorOf(task)) : null, rule => this.run(() => this.service.recurrence(task.id, rule, context)),
      typed && context ? () => { void this.run(() => this.service.clean(context, this.ownMarker(task))); } : undefined).open();
  }
  /** The marker a task's own status shows (a running timer is `[/]`). */
  private ownMarker(task: Task): string { return task.status === "completed" ? "x" : task.status === "canceled" ? "-" : task.status === "in_progress" ? "/" : " "; }
  /** `[+]`: puts the todo's own marker back, then adds an empty subtask under it as the command does. */
  private async addSubtaskFromMarker(task: Task, context: Context): Promise<void> {
    await this.run(() => this.service.clean(context, this.ownMarker(task)));
    const active = this.activeEditor();
    if (!active || active.file.path !== context.file.path) { new Notice("Open the note to add a subtask."); return; }
    await this.addSubtask(active.editor, active.file);
  }
  /** Asks for a block of time on the todo, worked or planned (on the day of its daily note, or today), then puts the todo's own marker back. Cancelling leaves the `[t]` in place. */
  private addTime(task: Task, context: Context): void {
    const at = (time: string) => new Date(`${this.service.daily.date(context.file.path) ?? localDate()}T${time}:00`).toISOString();
    const marker = this.ownMarker(task);
    // One dialog for both: a block that has ended is time worked, one still to come is planned.
    new SessionModal(this.app, { heading: "Add time", taskTitle: task.title, start: at("09:00"), end: at("10:00"), kind: null, save: async (next, kind) => { await this.run(() => kind === "planned" ? this.service.addPlanned(task.id, next) : this.service.addSession(task.id, next)); await this.run(() => this.service.clean(context, marker)); } }).open();
  }
  /** Folders offered for a standalone note. */
  noteFolders(): string[] { return this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder && f.path !== "/").map(f => f.path).sort(); }
  /** Template notes: the core Templates plugin's folder when it is set, otherwise notes in a folder called Template(s). */
  templateFiles(): string[] {
    const plugins = (this.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { instance?: { options?: { folder?: string } } } | null } }).internalPlugins;
    const configured = plugins?.getPluginById?.("templates")?.instance?.options?.folder;
    return this.app.vault.getMarkdownFiles().filter(f => configured ? f.path.startsWith(`${configured}/`) : /(^|\/)templates?\//i.test(f.path)).map(f => f.path).sort();
  }
  /** Asks where to put the task's standalone note, then replaces the task by a link to it. */
  convertToNote(task: Task, context?: Context): void {
    new NoteConversionModal(this.app, {
      title: task.title, folders: this.noteFolders(), folder: this.settings.noteFolder, templates: this.templateFiles(), exists: notePath => this.repo.file(notePath) !== null,
      tracked: task.work_sessions.length || task.time_tracking_started_at ? formatMinutes(Math.max(1, Math.floor(elapsed(task) / 60))) : undefined,
      convert: options => this.run(async () => {
        await this.service.convertToNote(task.id, options, context);
        this.settings.noteFolder = options.folder; this.saveSettings(false);
        if (this.selectedTaskId === task.id) this.selectedTaskId = null; if (this.context?.line.id === task.id) this.context = null;
        this.eachView(view => { view.module = ""; view.editingModule = ""; view.editingTitle = false; }); this.refresh();
      }),
    }).open();
  }
  pickProjects(task: Task, context?: Context): void {
    new ProjectPicker(this.app, this.repo.projectNotes(), task.projects, notes => this.run(async () => { await this.service.projects(task.id, notes); this.rememberProjects(notes); if (context) await this.service.clean(context); }), this.repo.projectFolder(), note => this.repo.projectColor(note)).open();
  }
  async saveModule(id: string, section: NoteSection, text: string): Promise<void> {
    const file = this.repo.taskFile(id); if (!file) throw new Error("Task note is missing.");
    const before = await this.repo.readText(file);
    await this.repo.write(file, before, writeNoteSection(before, section, text)); this.refresh();
  }
  async convertTodos(file: TFile): Promise<void> {
    await this.run(() => this.service.convertTodos(file));
  }
}
