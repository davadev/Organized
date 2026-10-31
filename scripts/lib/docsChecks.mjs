// TEMPLATE: scripts/lib/docsChecks.mjs
// WHAT: pure predicates behind check-release's optional "docs and What's new" gates (a RELEASE_NOTES source file, a
//       docs/index.md that links every page, README/docs images that exist).
// CHANGE: the notes-file shape is the one in tests/whatsNew/releaseNotes.ts (`version: "X.Y.Z"` fields). If you do not
//         ship an in-app What's new popup, delete the *WhatsNew* functions and the matching block in check-release.mjs.
//         `brokenScreenshotRefs` looks for `resources/screenshots/<file>`; change SCREENSHOT_DIR to your folder.
// GUARDS: a user who skipped 1.2.0 must still be told about it when 1.2.2 arrives (notes stack within a minor line), and
//         docs pages must not be orphaned or point at images that were never committed.

export const SCREENSHOT_DIR = "resources/screenshots";

/** `0.9.1-beta.3` -> `0.9.1`; `0.9.1` -> `0.9.1`; anything else -> null. */
export function baseVersion(version) {
  const m = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(version ?? ""));
  return m ? m[1] : null;
}

/** A minor (`X.Y.0`) release is expected to change something a user sees; patch releases often do not. */
export const isMinorRelease = (base) => /^\d+\.\d+\.0$/.test(base);

/** Does `releaseNotes.ts` carry an entry for `base`? Matches the `version: "X.Y.Z"` field of a RELEASE_NOTES entry. */
export function hasWhatsNewEntry(releaseNotesSource, base) {
  const escaped = base.replace(/\./g, "\\.");
  return new RegExp(`^\\s*version:\\s*"${escaped}"`, "m").test(releaseNotesSource);
}

/** docs/*.md pages (file names) that `docs/index.md` never links to. Draft release notes are exempt. */
export function unindexedDocs(docFiles, indexText) {
  return docFiles
    .filter((f) => f.endsWith(".md") && f !== "index.md" && !/^release-notes-/.test(f))
    .filter((f) => !new RegExp(`\\]\\(\\./${f.replace(/\./g, "\\.")}(?:#[^)]*)?\\)`).test(indexText));
}

/**
 * Image paths (relative to the repo root) that README.md/docs reference under resources/screenshots/ but that are not in
 * `existing`. `sources` maps a markdown file name to its text.
 */
export function brokenScreenshotRefs(sources, existing) {
  const have = new Set(existing);
  const shotRe = new RegExp(`${SCREENSHOT_DIR.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/([A-Za-z0-9._-]+\\.(?:png|svg|jpg|gif))`, "g");
  const broken = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(shotRe)) {
      if (!have.has(m[1])) broken.push(`${file}: ${m[1]}`);
    }
  }
  return broken;
}

/** Every `version: "X.Y.Z"` of a RELEASE_NOTES source. */
export const releaseNoteVersions = (releaseNotesSource) =>
  [...releaseNotesSource.matchAll(/^\s*version:\s*"(\d+\.\d+\.\d+)"/gm)].map((m) => m[1]);

/**
 * The What's new stack is append-only within a minor line (0.9.x): a user who skipped 0.9.0 must still be told about it
 * when 0.9.2 arrives. Returns the entries of the previous release that belong to `currentBase`'s line (same X.Y) and are
 * gone from the current source. A new minor line (0.10.0) may start fresh.
 */
export function droppedWhatsNewEntries(previousSource, currentSource, currentBase) {
  const line = currentBase.split(".").slice(0, 2).join(".");
  const now = new Set(releaseNoteVersions(currentSource));
  return releaseNoteVersions(previousSource).filter((v) => v.split(".").slice(0, 2).join(".") === line && !now.has(v));
}
