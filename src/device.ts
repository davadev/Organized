import type { App } from "obsidian";

/** What this device does with the vault. "main" does everything; "secondary" never creates or fills daily notes (no recurring tasks, no carrying unfinished tasks forward) so it cannot clash with the main device's copy of a note it has not synced yet; "mirror" only shows tasks and changes nothing. */
export type Role = "main" | "secondary" | "mirror";
export const ROLE_LABELS: Record<Role, string> = { main: "Main device", secondary: "Secondary: does not create or fill daily notes", mirror: "Mirror: view only" };
/** Kept in this device's own storage, never in the plugin data, which syncs: choosing it on a phone must not change the main device. */
const key = (app: App): string => `organized-device-role:${app.vault.getName()}`;
export const loadRole = (app: App): Role => { let saved: string | null = null; try { saved = window.localStorage.getItem(key(app)); } catch { /* Storage can be blocked; the device is then a main device. */ } return saved === "secondary" || saved === "mirror" ? saved : "main"; };
export const saveRole = (app: App, role: Role): void => { try { if (role === "main") window.localStorage.removeItem(key(app)); else window.localStorage.setItem(key(app), role); } catch { /* Not remembered; the next start is a main device. */ } };

export const MIRROR_MESSAGE = "This device is a mirror: it shows your tasks but does not change them. Make changes on your main device, then sync this vault to see them here.";
/** What a blocked change throws, so callers can tell it from a failure and not repeat the notice for every keystroke. */
export class MirrorError extends Error { constructor() { super(MIRROR_MESSAGE); } }
