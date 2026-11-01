// TEMPLATE: src/tests/__mocks__/obsidian.ts
// WHAT: test-only stub of the Obsidian runtime API (the real `obsidian` package ships only type definitions). Wired in by the
//       `obsidian` alias in vitest.config.mts. Plugin records everything a plugin registers; Setting/Modal/Notice are
//       DOM-aware fakes that become real elements under happy-dom.
// CHANGE: nothing to substitute. Grow it as your code uses more of the API: add the class/function here, never mock
//         `obsidian` ad hoc inside a test.
// GUARDS: module evaluation fails (or silently diverges from the app) when a test imports code that imports `obsidian`.
//         One shared stub keeps every test's idea of the app identical.
/**
 * Test-only stub of the Obsidian runtime API. Real Obsidian is only present
 * inside the host app — for unit tests we only need symbols to satisfy
 * `import` so module evaluation doesn't fail.
 */
import momentFactory from "moment";
import { load, dump } from "js-yaml";
import { StateField } from "@codemirror/state";
export const moment = momentFactory;
export const parseYaml = load;
export const stringifyYaml = (value: unknown) => dump(value, { noRefs: true });
export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: value => value });
export class Component {
  cleanups: (() => void)[] = [];
  children: Component[] = [];
  register(fn: () => void) { this.cleanups.push(fn); }
  addChild<T extends Component>(child: T): T { this.children.push(child); child.load(); return child; }
  removeChild(child: Component) { this.children.splice(this.children.indexOf(child), 1); child.unload(); return child; }
  load() {}
  unload() { for (const child of this.children) child.unload(); for (const fn of this.cleanups) fn(); }
}
export class App {}
/**
 * The base class of a plugin, with what a real one gets from the app: `app` and `manifest`, an in-memory data file, and
 * recorders for everything a plugin registers, so a test can load the whole plugin and see what it asked Obsidian for.
 */
export class Plugin extends Component {
  app: any;
  manifest: any;
  data: unknown = null;
  commands: any[] = [];
  views = new Map<string, (leaf: any) => unknown>();
  events: any[] = [];
  domEvents: Array<{ target: unknown; type: string; cb: (...a: unknown[]) => unknown }> = [];
  intervals: number[] = [];
  ribbon: Array<{ icon: string; title: string; cb: () => unknown }> = [];
  settingTabs: unknown[] = [];
  constructor(app?: unknown, manifest?: unknown) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData(): Promise<unknown> {
    return this.data;
  }
  async saveData(d: unknown): Promise<void> {
    this.data = JSON.parse(JSON.stringify(d));
  }
  addCommand(c: any) { this.commands.push(c); return c; }
  registerView(type: string, creator: (leaf: any) => unknown) { this.views.set(type, creator); }
  registerEvent(ref: unknown) { this.events.push(ref); }
  registerDomEvent(target: unknown, type: string, cb: (...a: unknown[]) => unknown) { this.domEvents.push({ target, type, cb }); }
  registerInterval(id: number) { this.intervals.push(id); return id; }
  addRibbonIcon(icon: string, title: string, cb: () => unknown) { this.ribbon.push({ icon, title, cb }); return {}; }
  addSettingTab(tab: unknown) { this.settingTabs.push(tab); }
  extensions: unknown[] = [];
  processors: any[] = [];
  registerEditorExtension(extension: unknown) { this.extensions.push(extension); }
  registerMarkdownPostProcessor(processor: any) { this.processors.push(processor); }
}
export class PluginSettingTab {
  containerEl = hasDom() ? document.createElement("div") : undefined;
  // Real Obsidian assigns both and exposes update() for declarative tabs;
  // settingsCoverage.test.ts drives a real subclass through this.
  constructor(public app: any, public plugin: any) {}
  update() {}
  refreshDomState() {}
}
const hasDom = (): boolean => typeof document !== "undefined";
const isNode = (x: unknown): x is Node => !!x && typeof (x as Node).appendChild === "function";

/** Fluent component stand-ins: real elements when there is a `document`, plain state either way. */
class FakeComponent {
  disabled = false;
  setDisabled(v: boolean) { this.disabled = v; return this; }
}
class FakeText extends FakeComponent {
  inputEl: HTMLInputElement | HTMLTextAreaElement;
  private cb: ((v: string) => unknown) | null = null;
  constructor(parent: unknown, tag: "input" | "textarea") {
    super();
    this.inputEl = (hasDom() ? document.createElement(tag) : { value: "", placeholder: "", addEventListener() {} }) as HTMLInputElement;
    if (isNode(parent)) parent.appendChild(this.inputEl);
    this.inputEl.addEventListener?.("input", () => this.cb?.(this.inputEl.value));
  }
  setValue(v: string) { this.inputEl.value = v; return this; }
  getValue() { return this.inputEl.value; }
  setPlaceholder(v: string) { this.inputEl.placeholder = v; return this; }
  onChange(fn: (v: string) => unknown) { this.cb = fn; return this; }
}
class FakeToggle extends FakeComponent {
  inputEl: HTMLInputElement;
  value = false;
  private cb: ((v: boolean) => unknown) | null = null;
  constructor(parent: unknown) {
    super(); this.inputEl = (hasDom() ? document.createElement('input') : { checked: false, addEventListener() {} }) as HTMLInputElement; this.inputEl.type = 'checkbox';
    if (isNode(parent)) parent.appendChild(this.inputEl);
    this.inputEl.addEventListener('change', () => { this.value = this.inputEl.checked; this.cb?.(this.value); });
  }
  setValue(v: boolean) { this.value = v; this.inputEl.checked = v; return this; }
  getValue() { return this.value; }
  onChange(fn: (v: boolean) => unknown) { this.cb = fn; return this; }
  /** Test helper: what a click on the switch does. */
  toggle() { this.value = !this.value; return this.cb?.(this.value); }
}
class FakeDropdown extends FakeComponent {
  selectEl: HTMLSelectElement;
  private cb: ((v: string) => unknown) | null = null;
  constructor(parent: unknown) {
    super();
    this.selectEl = (hasDom() ? document.createElement("select") : { value: "", appendChild() {}, addEventListener() {} }) as HTMLSelectElement;
    if (isNode(parent)) parent.appendChild(this.selectEl);
    this.selectEl.addEventListener?.("change", () => this.cb?.(this.selectEl.value));
  }
  addOption(value: string, label: string) {
    if (hasDom()) { const o = document.createElement("option"); o.value = value; o.textContent = label; this.selectEl.appendChild(o); }
    return this;
  }
  setValue(v: string) { this.selectEl.value = v; return this; }
  getValue() { return this.selectEl.value; }
  onChange(fn: (v: string) => unknown) { this.cb = fn; return this; }
}
class FakeButton extends FakeComponent {
  buttonEl: HTMLButtonElement;
  cta = false;
  warning = false;
  constructor(parent: unknown) {
    super();
    this.buttonEl = (hasDom() ? document.createElement("button") : { textContent: "", addClass() {}, addEventListener() {} }) as HTMLButtonElement;
    if (isNode(parent)) parent.appendChild(this.buttonEl);
  }
  setButtonText(t: string) { this.buttonEl.textContent = t; return this; }
  setCta() { this.cta = true; return this; }
  setWarning() { this.warning = true; return this; }
  onClick(fn: (evt: MouseEvent) => unknown) { this.buttonEl.addEventListener?.("click", fn as EventListener); return this; }
}

export class Setting {
  static instances: Setting[] = [];
  controls: any[] = [];
  settingEl: HTMLElement;
  controlEl: HTMLElement;
  nameText = "";
  descText = "";
  infoEl!: HTMLElement;
  nameEl!: HTMLElement;
  descEl!: HTMLElement;
  constructor(containerEl: any) {
    Setting.instances.push(this);
    this.settingEl = (hasDom() ? document.createElement("div") : {}) as HTMLElement;
    this.controlEl = (hasDom() ? document.createElement("div") : {}) as HTMLElement;
    if (hasDom()) {
      this.settingEl.className = "setting-item";
      this.controlEl.className = "setting-item-control";
      this.infoEl = document.createElement('div'); this.infoEl.className = 'setting-item-info'; this.nameEl = document.createElement('div'); this.nameEl.className = 'setting-item-name'; this.descEl = document.createElement('div'); this.descEl.className = 'setting-item-description'; this.infoEl.append(this.nameEl, this.descEl); this.settingEl.appendChild(this.infoEl);
      this.settingEl.appendChild(this.controlEl);
      if (isNode(containerEl)) containerEl.appendChild(this.settingEl);
    }
  }
  setName(v: string) { this.nameText = v; if (this.nameEl) this.nameEl.textContent = v; return this; }
  setDesc(v: string) { this.descText = v; if (this.descEl) this.descEl.textContent = v; return this; }
  setHeading() { return this; }
  setClass(c: string) { (this.settingEl as HTMLElement).classList?.add(c); return this; }
  addText(cb: (c: FakeText) => unknown) { const c = new FakeText(this.controlEl, "input"); this.controls.push(c); cb(c); return this; }
  addTextArea(cb: (c: FakeText) => unknown) { const c = new FakeText(this.controlEl, "textarea"); this.controls.push(c); cb(c); return this; }
  addToggle(cb: (c: FakeToggle) => unknown) { const c = new FakeToggle(this.controlEl); this.controls.push(c); cb(c); return this; }
  addDropdown(cb: (c: FakeDropdown) => unknown) { const c = new FakeDropdown(this.controlEl); this.controls.push(c); cb(c); return this; }
  addButton(cb: (c: FakeButton) => unknown) { const c = new FakeButton(this.controlEl); this.controls.push(c); cb(c); return this; }
}
export class Modal {
  static instances: unknown[] = [];
  // The real class owns a lot more; this keeps the parts the plugin's modals use. Outside a DOM test (plain Node) the
  // elements simply do not exist and a test that needs one assigns it.
  app: unknown;
  containerEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  modalEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  titleEl: HTMLElement = (hasDom() ? document.createElement("div") : undefined) as HTMLElement;
  contentEl: any = hasDom() ? document.createElement("div") : undefined;
  private isOpen = false;
  constructor(app?: unknown) {
    Modal.instances.push(this);
    this.app = app;
    if (hasDom()) {
      this.containerEl.className = "modal-container";
      this.modalEl.className = "modal";
      this.titleEl.className = "modal-title";
      this.contentEl.className = "modal-content";
      this.containerEl.appendChild(this.modalEl);
      this.modalEl.appendChild(this.titleEl);
      this.modalEl.appendChild(this.contentEl);
    }
  }
  onOpen(): void {}
  onClose(): void {}
  open() {
    this.isOpen = true;
    if (hasDom()) document.body.appendChild(this.containerEl);
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
    this.containerEl?.remove?.();
  }
}
export class SuggestModal<T> extends Modal {
  inputEl = hasDom() ? document.createElement("input") : { value: "" } as HTMLInputElement;
  placeholder = "";
  setPlaceholder(value: string) { this.placeholder = value; return this; }
  getSuggestions(_query: string): T[] { return []; }
  renderSuggestion(_value: T, _el: HTMLElement) {}
  onChooseSuggestion(_value: T) {}
}
export class Notice {
  /** Every notice shown since the last `Notice.instances.length = 0`, so a test can assert what the user was told. */
  static instances: Notice[] = [];
  message: string | DocumentFragment;
  /** The element a notice's own buttons are built into (only exists when there is a `document`). */
  messageEl: HTMLElement = (typeof document !== "undefined" ? document.createElement("div") : undefined) as HTMLElement;
  /** Milliseconds the notice stays (0 = until dismissed), as passed by the caller. */
  duration?: number;
  constructor(message: string | DocumentFragment, duration?: number) { this.message = message; this.duration = duration; Notice.instances.push(this); }
  setMessage(message: string) { this.message = message; }
  hide() {}
}
export class ItemView extends Component {
  contentEl = hasDom() ? document.createElement("div") : undefined;
  app: any;
  constructor(public leaf: any) { super(); this.app = leaf?.app; }
}
/** Minimal TextFileView: records the header actions a view registered. Extend as your views need more of the real class. */
export class TextFileView {
  /** Obsidian's header action: recorded so a test can assert which actions a view registered. */
  actions: Array<{ icon: string; title: string; cb: (evt: unknown) => unknown }> = [];
  requestSave(): void {}
  addAction(icon: string, title: string, cb: (evt: unknown) => unknown): unknown {
    this.actions.push({ icon, title, cb });
    return {};
  }
}
export class WorkspaceLeaf {}
export class TFile {
  extension = "md";
  basename: string;
  name: string;
  stat = { mtime: 0, ctime: 0, size: 0 };
  constructor(public path = "") { this.name = path.split("/").pop()!; this.basename = this.name.replace(/\.md$/, ""); }
}
export class TAbstractFile {}
export class TFolder { constructor(public path = "") {} }
export class MarkdownView {}
/** Registers an icon with the app: nothing to draw in a test. */
export function addIcon(_id: string, _svg: string): void {}
export const Platform = { isMobile: false, isIosApp: false, isAndroidApp: false };
/** Like the app's: forward slashes, no doubled, leading or trailing slash. */
export function normalizePath(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  return n === "" ? "/" : n;
}
export async function requestUrl(_p: any): Promise<{ status: number; text: string; arrayBuffer: ArrayBuffer }> {
  return { status: 200, text: "", arrayBuffer: new ArrayBuffer(0) };
}

/** Records the icon name on the element instead of rendering an SVG; enough for tests that assert which icon a button got. */
export function setIcon(el: { setAttribute?: (k: string, v: string) => void }, name: string): void {
  el.setAttribute?.("data-icon", name);
}
export class MarkdownRenderer {
  static async render(_app: unknown, markdown: string, el: HTMLElement, _path: string, _component: unknown) {
    const linked = markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, note: string) => `<a href="${note.endsWith('.md') ? note : `${note}.md`}">${note.replace(/\|/g, ' ')}</a>`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    el.innerHTML = linked;
  }
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) { super(); }
  onload() {}
  onunload() {}
  load() { this.onload(); }
  unload() { this.onunload(); super.unload(); }
}
