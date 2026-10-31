import { Editor, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { parseTasks, TaskLine } from "./codec";
import { DEFAULT_SETTINGS, localDate, object, Settings, Task } from "./model";
import { settingsFrom } from "./model";
import { Repository } from "./repository";
import { Context, report, TaskService } from "./service";
import { ConfirmModal, DatePicker, PriorityPicker, ProjectPicker, TaskPicker, TextModal } from "./modals";
import { OrganizedInspectorView, VIEW_TYPE } from "./view";
import { OrganizedSettingsTab } from "./settings";
import { editorExtension, reading, refreshEditor } from "./render";
import { crashStatePath, decideOnLoad, DEFAULT_CRASH_STATE, readCrashState, writeCrashState } from "./crashGuard";
import { DataSafety } from "./safety";

export default class Organized extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  repo!: Repository;
  service!: TaskService;
  safety!: DataSafety;
  context: Context | null = null;
  selectedTaskId: string | null = null;
  revision = 0;
  readonly projectionListeners = new Set<() => void>();
  private busy = 0;
  private pickerOpen = false;
  private settingsRaw: Record<string, unknown> = {};
  private saveTail: Promise<unknown> = Promise.resolve();
  private loaded = false;
  async onload(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter; const crashPath = crashStatePath(this.manifest, this.app.vault.configDir);
      const decision = decideOnLoad(await readCrashState(adapter, crashPath), 5);
      await writeCrashState(adapter, crashPath, decision.next);
      if (decision.action === "trip-threshold") { new Notice("Organized detected repeated unsuccessful starts. Features are paused this launch. Disable/re-enable Organized after updating, or report the problem.", 0); return; }
      this.safety = new DataSafety(adapter, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`, this.manifest.version, message => { new Notice(message, 12000); });
      await this.safety.prepare();
      this.settingsRaw = object(await this.loadData()); this.settings = settingsFrom(this.settingsRaw.settings ?? this.settingsRaw);
      this.repo = new Repository(this.app, () => this.settings, () => this.activeEditor());
      this.service = new TaskService(this.repo, () => this.refresh(), message => this.confirm(message));
      this.registerView(VIEW_TYPE, leaf => new OrganizedInspectorView(leaf, this));
      this.addSettingTab(new OrganizedSettingsTab(this.app, this));
      this.addRibbonIcon("calendar-check", "Open Organized", () => { void this.openInspector().catch(report); });
      this.addCommand({ id: "open-inspector", name: "Open inspector", callback: () => { void this.openInspector().catch(report); } });
      this.addCommand({ id: "attach-task", name: "Attach/create task (or repair missing link)", editorCallback: (editor, view) => { if (view.file) void this.pickTask(editor, view.file).catch(report); } });
      this.addCommand({ id: "duplicate-task", name: "Duplicate as new task", editorCallback: (editor, view) => { if (view.file) void this.pickTask(editor, view.file, true).catch(report); } });
      this.addCommand({ id: "undo", name: "Undo last recurrence/auto-forward batch", callback: () => { void this.service.undo().catch(report); } });
      this.addCommand({ id: "restore-settings", name: "Restore compatible settings backup (restart required)", callback: () => { void this.confirm("Queue the newest compatible settings backup for restoration on next restart? Task Markdown will not change.").then(yes => yes ? this.safety.queueCompatibleRestore() : undefined).catch(report); } });
      this.registerEditorExtension(editorExtension(this));
      this.registerMarkdownPostProcessor((el, ctx) => reading(this, el, ctx));
      this.registerEvent(this.app.workspace.on("editor-change", () => this.followCursor()));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.followCursor()));
      this.loaded = true;
      this.app.workspace.onLayoutReady(() => {
        if (!this.loaded) return;
        // Registration happens AFTER Obsidian's initial existing-file create events.
        this.registerEvent(this.app.vault.on("create", file => { if (file instanceof TFile) { void this.run(() => this.service.onDailyCreated(file)); void this.service.index(file).catch(report); } }));
        this.registerEvent(this.app.vault.on("modify", file => { if (file instanceof TFile) {
          const id = this.selectedTaskId; const wasReference = this.service.hasReference(id, file.path);
          void this.service.index(file).then(() => {
            if (file.path.startsWith(`${this.settings.taskFolder}/`) || this.service.daily.date(file.path) === localDate() || wasReference || this.service.hasReference(id, file.path)) this.refresh();
          }).catch(report);
        } }));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { this.service.forget(oldPath); if (file instanceof TFile) void this.service.index(file).then(() => this.refresh()).catch(report); }));
        this.registerEvent(this.app.vault.on("delete", file => { this.service.forget(file.path); this.refresh(); }));
        this.registerEvent(this.app.workspace.on("file-open", file => { if (file) void this.run(() => this.service.reconcile(file)); }));
      });
      this.loaded = true;
      this.registerInterval(window.setTimeout(() => { void writeCrashState(adapter, crashPath, DEFAULT_CRASH_STATE); }, 30000));
    } catch (error) { report(error); throw error; }
  }
  onunload(): void {
    this.loaded = false;
    void writeCrashState(this.app.vault.adapter, crashStatePath(this.manifest, this.app.vault.configDir), DEFAULT_CRASH_STATE);
  }
  assertWritable(): void { if (!this.safety.writable) throw new Error("Writes paused to protect newer/unreadable settings. Restore a compatible backup or update Organized."); }
  async run(action: () => Promise<unknown>): Promise<void> {
    this.busy++;
    try {
      this.assertWritable();
      await this.repo.serial(action);
    } catch (error) { report(error); } finally { this.busy--; }
  }
  saveSettings(): void {
    this.saveTail = this.saveTail.then(async () => {
      this.assertWritable(); await this.saveData({ ...this.settingsRaw, schemaVersion: 1, writerVersion: this.manifest.version, settings: { ...object(this.settingsRaw.settings), ...this.settings } }); this.refresh();
    }).catch(report);
  }
  activeEditor(): { editor: Editor; file: TFile } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView); return view?.file && view.getMode() === "source" ? { editor: view.editor, file: view.file } : null;
  }
  async taskLines(file: TFile): Promise<TaskLine[]> { return parseTasks(await this.repo.readText(file)); }
  current(editor: Editor, file: TFile): Context | null {
    const line = parseTasks(editor.getValue()).find(t => t.line === editor.getCursor().line);
    return line ? { file, line } : null;
  }
  followCursor(): void {
    const active = this.activeEditor();
    // Focusing the inspector is not leaving the selected task. Only an actual
    // Markdown editor cursor change can replace its context.
    if (!active) return;
    const next = this.current(active.editor, active.file);
    const changed = (next?.line.id ?? null) !== (this.context?.line.id ?? null);
    this.context = next;
    if (changed) {
      this.selectedTaskId = next?.line.id ?? null;
      this.eachView(view => { view.origin = "Editor cursor"; view.module = ""; void view.render().catch(report); });
    }
  }
  eachView(callback: (view: OrganizedInspectorView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof OrganizedInspectorView) callback(leaf.view);
  }
  refresh(): void {
    this.revision++;
    for (const listener of this.projectionListeners) listener();
    this.eachView(view => { void view.render().catch(report); });
    const active = this.activeEditor(); if (active) {
      // One isolated bridge: Obsidian intentionally omits CM6 from Editor's
      // public type. Unknown first also keeps type-blind review lint honest.
      const bridge: unknown = active.editor;
      const cm = (bridge as { cm?: EditorView }).cm;
      if (cm) refreshEditor(cm);
    }
  }
  async openInspector(tab?: "Task", module = ""): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error("Cannot open the sidebar; try opening a workspace pane first."); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof OrganizedInspectorView) { if (tab) leaf.view.tab = tab; leaf.view.module = module; await leaf.view.render(); }
  }
  confirm(message: string): Promise<boolean> { return new Promise(resolve => new ConfirmModal(this.app, message, resolve).open()); }
  async pickTask(editor: Editor, file: TFile, duplicate = false): Promise<void> {
    this.assertWritable(); const context = this.current(editor, file); if (!context) throw new Error("Place the cursor on a Markdown task-list item.");
    if (context.line.id && !duplicate && this.repo.file(this.repo.taskPath(context.line.id))) throw new Error("Task already linked. Use duplicate as new task for a fresh identity.");
    const captured = editor.getValue(); const selection = editor.listSelections();
    this.pickerOpen = true;
    const picker = new TaskPicker(this.app, duplicate ? [] : await this.repo.list(), async choice => {
      await this.run(async () => {
        if (this.activeEditor()?.editor !== editor || editor.getValue() !== captured || JSON.stringify(editor.listSelections()) !== JSON.stringify(selection)) throw new Error("Editor changed while the picker was open. Line preserved; invoke attach/create to retry.");
        const task = typeof choice === "string" ? await this.repo.create(choice) : choice;
        await this.service.attach(context, task, duplicate || !!context.line.id);
      });
    }, context.line.title);
    const close = picker.onClose.bind(picker);
    picker.onClose = () => { close(); this.pickerOpen = false; };
    picker.open();
  }
  onEditorUpdate(update: ViewUpdate): void {
    if (update.selectionSet) this.followCursor();
    if (!update.docChanged || this.busy || this.pickerOpen) return;
    const user = update.transactions.some(t => { const event = t.annotation(Transaction.userEvent); return event && !event.startsWith("input.organized") && !event.includes("paste") && !event.includes("drop") && !event.includes("undo") && !event.includes("redo"); });
    if (!user) return;
    const active = this.activeEditor(); if (!active || active.editor.getValue() !== update.state.doc.toString()) return;
    // Deletion is meaningful even when the cursor no longer sits on a task.
    const remaining = new Set(parseTasks(update.state.doc.toString()).map(t => t.id));
    for (const removed of parseTasks(update.startState.doc.toString()).filter(t => t.id && t.marker === "/" && !remaining.has(t.id))) {
      const id = removed.id!;
      void this.confirm("An in-progress occurrence was removed. Stop and accumulate its timer? Cancel keeps it running.").then(yes => yes ? this.run(() => this.service.status(id, "open")) : undefined).catch(report);
    }
    let touchedLines = 0; update.changes.iterChanges((_a, _b, from, to) => { touchedLines += update.state.doc.lineAt(to).number - update.state.doc.lineAt(from).number + 1; });
    if (touchedLines > 2) return;
    const context = this.current(active.editor, active.file); if (!context) return;
    const old = parseTasks(update.startState.doc.toString()).find(t => t.line === context.line.line);
    if (!context.line.id && context.line.marker === " " && (!old || !/^\s*(?:[-+*]|\d+[.)]) \[ \]/.test(old.raw))) {
      queueMicrotask(() => { if (!this.pickerOpen) void this.pickTask(active.editor, active.file).catch(report); }); return;
    }
    if (!context.line.id && context.line.title && '<>/!iI?xX-*"bf'.includes(context.line.marker) && context.line.marker !== old?.marker) {
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
  async trigger(context: Context): Promise<void> {
    const marker = context.line.marker; const id = context.line.id; if (!id) return;
    this.assertWritable(); this.context = context; this.selectedTaskId = id;
    if (marker === "<") { const task = await this.repo.read(id); new DatePicker(this.app, task.scheduled ?? localDate(), date => this.run(() => this.service.schedule(context, date))).open(); }
    else if (marker === "!") new PriorityPicker(this.app, priority => this.run(() => this.service.priority(context, priority))).open();
    else if (["i", "I", "?"].includes(marker)) {
      await this.openInspector("Task", marker === "i" ? "Information" : marker === "I" ? "Idea" : "Question"); await this.run(() => this.service.clean(context));
    } else if (marker === '"') await this.editModule(id, "Sources", context);
    else if (marker === "b") this.pickProjects(await this.repo.read(id), context);
    else await this.run(() => this.service.marker(context, marker));
  }
  pickProjects(task: Task, context?: Context): void {
    new ProjectPicker(this.app, this.app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(`${this.settings.taskFolder}/`)).map(f => f.path), task.projects, notes => this.run(async () => { await this.service.projects(task.id, notes); if (context) await this.service.clean(context); })).open();
  }
  async editModule(id: string, heading: string, context?: Context): Promise<void> {
    const file = this.repo.file(this.repo.taskPath(id)); if (!file) throw new Error("Task note is missing.");
    const before = await this.repo.readText(file); const regex = new RegExp(`(^|\\n)## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`); const match = regex.exec(before);
    new TextModal(this.app, `Edit ${heading.toLowerCase()}`, match?.[2].trim() ?? "", text => this.run(async () => {
      const after = match ? before.replace(regex, `$1## ${heading}\n${text.replace(/\$/g, "$$$$")}\n`) : `${before}\n## ${heading}\n${text}\n`;
      await this.repo.write(file, before, after); if (context) await this.service.clean(context); this.refresh();
    })).open();
  }
}
