#!/usr/bin/env node
// TEMPLATE: scripts/check-release.mjs
// WHAT: the pre-release guard for an Obsidian community plugin. Runs locally (`npm run check-release`, REQUIRED before
//       tagging; the PreToolUse hook runs it with --with-lint before any `git tag`/`git push <tag>`) and in CI
//       (ci.yml without a tag, release.yml with --tag --with-build --strict). Exit 0 = ready, 1 = any FAIL (or any
//       WARN under --strict). No dependencies: pure Node >= 20 ESM.
// CHANGE: set CSS_PREFIX below to your class prefix (replace organized). Optionally tune SRC_DIR, WHATS_NEW_FILE,
//         MAX_CONSOLE_LOG. The predicates live in scripts/lib/*.mjs; the rules are not plugin-specific.
// GUARDS (one incident each):
//   - styles.css missing from a release: 0.1.56-0.1.59 shipped without it and broke every iPad install.
//   - tag != manifest.version, or a beta committed to the default branch: Obsidian reads the default-branch manifest,
//     then downloads the release tagged identically; a version with no release breaks every install and update.
//   - `npm ci` succeeds on an inconsistent tree; only `npm ls --all` exits non-zero (a vitest bump once left esbuild
//     outside vite's declared range for a whole stable release).
//   - a dependency-age policy that silently vanished (dependabot cooldown / .npmrc) is a supply-chain hole.
//
// Usage:
//   node scripts/check-release.mjs                         # committed-state checks (no tag)
//   node scripts/check-release.mjs --tag 1.2.3             # + tag must equal manifest.version exactly
//   node scripts/check-release.mjs --with-lint             # + `npm run lint` (must pass with --max-warnings=0) + lint:css
//   node scripts/check-release.mjs --with-build            # + lint + `npm run build` + `npm test`
//   node scripts/check-release.mjs --strict                # WARN blocks too (release.yml uses this)
// The tag is also read from the environment, but only when the ref IS a tag (GITHUB_REF_TYPE=tag / refs/tags/...).
//
// Reporting: ✓ pass, ✗ fail (blocks), ! warn (blocks only under --strict), · skip, ℹ note (never counted, never blocks).

import { readFile, stat, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_AGE_DAYS, MIN_NPM_WITH_RELEASE_AGE, checkAllowScripts, checkDependabotCooldown, checkNpmrc, npmSupportsMinReleaseAge } from "./lib/supplyChainChecks.mjs";
import { attestStepProblem, lintScriptIsStrict, manifestFindings, nodeOnlyImports, usesCssPrefix, versionFindings } from "./lib/releaseChecks.mjs";
import { baseVersion, brokenScreenshotRefs, droppedWhatsNewEntries, hasWhatsNewEntry, isMinorRelease, unindexedDocs } from "./lib/docsChecks.mjs";

// ---------- Configuration (the only part to edit) ----------
const CSS_PREFIX = "organized"; // every class your code adds starts with `organized-`; styles.css is required iff it is used
const SRC_DIR = "src";
const WHATS_NEW_FILE = "src/whatsNew/releaseNotes.ts"; // optional; the What's new checks are skipped when it does not exist
const MAX_CONSOLE_LOG = 30;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- CLI ----------
const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  const v = i === -1 ? undefined : argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
};
const hasFlag = (x) => argv.includes(x);
const envRef = process.env.GITHUB_REF || "";
const tagFromEnv = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : envRef.startsWith("refs/tags/") ? envRef.slice("refs/tags/".length) : null;
const rawTag = argValue("--tag") || tagFromEnv || null;
const tag = rawTag ? rawTag.replace(/^v/, "") : null;
const runBuildAndTest = hasFlag("--with-build");
const runLint = hasFlag("--with-lint") || runBuildAndTest; // --with-build implies --with-lint
const strict = hasFlag("--strict");

// ---------- Reporting ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { green: paint(32), red: paint(31), yellow: paint(33), gray: paint(90), bold: paint(1) };
const results = { pass: 0, fail: 0, warn: 0, skip: 0 };
const pass = (name, detail = "") => (results.pass++, console.log(`${c.green("✓")} ${name}${detail ? `: ${c.gray(detail)}` : ""}`));
const fail = (name, detail = "") => (results.fail++, console.log(`${c.red("✗")} ${name}${detail ? `: ${detail}` : ""}`));
const warn = (name, detail = "") => (results.warn++, console.log(`${c.yellow("!")} ${name}${detail ? `: ${detail}` : ""}`));
const skip = (name, detail = "") => (results.skip++, console.log(`${c.gray("·")} ${name}${detail ? ` (${detail})` : ""}`));
// Informational only. --strict promotes WARN to a blocker, so dev-dependency advisories must never go through warn():
// an upstream CVE in the lint toolchain must not hold back an urgent user-facing fix.
const note = (name, detail = "") => console.log(`${c.gray("ℹ")} ${name}${detail ? `: ${c.gray(detail)}` : ""}`);
const report = (findings) => findings.forEach((x) => ({ pass, fail, warn, skip }[x.level](x.name, x.detail)));

// ---------- Helpers ----------
const fileSize = async (p) => stat(join(ROOT, p)).then((s) => (s.isFile() ? s.size : -1), () => -1);
const readText = async (p) => readFile(join(ROOT, p), "utf8").catch(() => null);
async function readJson(p) {
  try {
    const v = JSON.parse(await readFile(join(ROOT, p), "utf8"));
    pass(`${p} parses as JSON`);
    return v;
  } catch (e) {
    fail(`${p} parses as JSON`, e.message);
    return null;
  }
}
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) await walk(full, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}
let srcCache = null;
async function srcFiles() {
  if (srcCache) return srcCache;
  srcCache = [];
  for (const file of await walk(join(ROOT, SRC_DIR))) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (rel.startsWith(`${SRC_DIR}/tests/`)) continue; // fixtures may be noisy
    srcCache.push({ path: rel, text: await readFile(file, "utf8") });
  }
  return srcCache;
}
const npm = (args, extra = {}) => spawnSync("npm", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...extra });
const tail = (r, n = 3) => (r.stderr || r.stdout || "").trim().split("\n").slice(-n).join(" | ");

// ---------- Template guard ----------
if (CSS_PREFIX.includes("<")) {
  fail("CSS_PREFIX is set", 'scripts/check-release.mjs still says "organized": replace it with your class prefix');
}

// ---------- Release artifacts (BRAT and Obsidian need main.js, manifest.json, styles.css) ----------
for (const p of ["manifest.json", "main.js", "versions.json", "README.md", "LICENSE"]) {
  const size = await fileSize(p);
  if (size > 0) pass(`${p} present and non-empty`, `${size} B`);
  else fail(`${p} present and non-empty`, size === 0 ? "file is empty" : `missing${p === "main.js" ? " (run npm run build)" : ""}`);
}
{
  const size = await fileSize("styles.css");
  const used = [];
  if (!CSS_PREFIX.includes("<")) for (const f of await srcFiles()) if (usesCssPrefix(f.text, CSS_PREFIX)) used.push(f.path);
  if (used.length) {
    if (size > 0) pass(`styles.css present (source uses ${CSS_PREFIX}- classes)`, `${size} B`);
    else fail("styles.css present", `${size === 0 ? "empty" : "missing"} but source uses ${CSS_PREFIX}- classes (e.g. ${used[0]})`);
  } else if (size > 0) pass("styles.css present", `${size} B (no ${CSS_PREFIX}- classes detected)`);
  else skip("styles.css present", "plugin appears not to use CSS");

  // styles.css is linted like Obsidian's review does (no !important, no partially supported features).
  if (size > 0) {
    const cfg = await readText("stylelint.config.mjs");
    if (cfg == null) fail("stylelint config present", "stylelint.config.mjs is missing");
    else if (!/declaration-no-important/.test(cfg) || !/no-unsupported-browser-features/.test(cfg)) fail("stylelint config present", "must enable declaration-no-important and no-unsupported-browser-features");
    else pass("stylelint config present");
    if (!runLint) skip("styles.css passes stylelint", "pass --with-lint or --with-build to execute");
    else {
      const r = npm(["run", "lint:css", "--silent"], { env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
      if (r.status === 0) pass("styles.css passes stylelint");
      else fail("styles.css passes stylelint", tail(r) || `exit ${r.status}`);
    }
  }
}

// ---------- Manifest, package, lock, versions ----------
const manifest = await readJson("manifest.json");
const pkg = await readJson("package.json");
const lock = await readJson("package-lock.json");
const versions = await readJson("versions.json");
if (manifest) report(manifestFindings(manifest));
report(versionFindings({ manifest, pkg, lock, versions, tag }));
if (!tag) skip("manifest.version matches release tag", "no --tag and the environment ref is not a tag");

// ---------- Release workflow signs its assets ----------
{
  const wf = await readText(".github/workflows/release.yml");
  const label = "release workflow attests build provenance";
  if (wf == null) skip(label, "release.yml not found");
  else {
    const p = attestStepProblem(wf);
    if (p.ok) pass(label, "actions/attest signs main.js, manifest.json, styles.css");
    else warn(label, p.problem);
  }
}

// ---------- Source hygiene ----------
{
  const files = await srcFiles();
  const paths = files.map((f) => ({ f, m: f.text.match(/\/(?:Users|home)\/[a-zA-Z][\w.-]*|[A-Za-z]:\\Users\\[a-zA-Z]/) })).filter((x) => x.m);
  if (!paths.length) pass("no hardcoded local paths in source");
  else fail("no hardcoded local paths in source", paths.slice(0, 3).map((x) => `${x.f.path}: ${x.m[0]}`).join("; "));

  const logs = files.reduce((n, x) => n + (x.text.match(/\bconsole\.log\s*\(/g)?.length ?? 0), 0);
  if (logs <= MAX_CONSOLE_LOG) pass(`console.log usage under ${MAX_CONSOLE_LOG}`, `${logs} occurrences`);
  else warn(`console.log usage under ${MAX_CONSOLE_LOG}`, `${logs} occurrences: gate debug output`);

  if (manifest) {
    const sites = files.flatMap((x) => nodeOnlyImports(x.text).map((s) => `${x.path}: import "${s}"`));
    if (!sites.length) pass("mobile-safe imports", "no node-only imports");
    else if (manifest.isDesktopOnly === true) pass("mobile-safe imports", `node-only imports allowed: isDesktopOnly=true (${sites.length} sites)`);
    else fail("mobile-safe imports", `node-only imports but isDesktopOnly is not true: ${sites.slice(0, 3).join("; ")}`);
  }

  const raw = files.filter((x) => /\badapter\.\s*(?:read|write|exists|mkdir|list|append|remove|rename)\b/.test(x.text) && !/\bnormalizePath\s*\(/.test(x.text)).map((x) => x.path);
  if (!raw.length) pass("vault paths use normalizePath()");
  else warn("vault paths use normalizePath()", `${raw.length} file(s) call adapter.* without normalizePath: ${raw.slice(0, 3).join(", ")}`);
}

// ---------- Docs and What's new (all optional: each part is skipped when its files do not exist) ----------
{
  const base = manifest ? baseVersion(manifest.version) : null;
  const notes = await readText(WHATS_NEW_FILE);
  if (base && notes !== null) {
    if (hasWhatsNewEntry(notes, base)) pass(`What's new has an entry for ${base}`);
    else if (isMinorRelease(base)) warn(`What's new has an entry for ${base}`, `add one to ${WHATS_NEW_FILE}`);
    else note(`What's new has no entry for patch release ${base}`, "fine if nothing user-visible changed");

    const line = base.split(".").slice(0, 2).join(".");
    const t = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "[0-9]*.[0-9]*.[0-9]*", "--exclude", "*-*"], { cwd: ROOT, encoding: "utf8" });
    const prevTag = t.status === 0 ? t.stdout.trim() : "";
    const prev = prevTag ? spawnSync("git", ["show", `${prevTag}:${WHATS_NEW_FILE}`], { cwd: ROOT, encoding: "utf8" }) : null;
    if (prev && prev.status === 0) {
      const dropped = droppedWhatsNewEntries(prev.stdout, notes, base);
      if (!dropped.length) pass(`What's new keeps every ${line}.x entry from ${prevTag}`);
      else fail(`What's new keeps every ${line}.x entry from ${prevTag}`, `removed: ${dropped.join(", ")} (notes stack within a minor line)`);
    } else skip("What's new keeps earlier entries of this minor line", "no stable release tag with that file in this checkout");
  }
  const docNames = (await readdir(join(ROOT, "docs")).catch(() => [])).filter((n) => n.endsWith(".md"));
  const index = await readText("docs/index.md");
  if (index !== null) {
    const missing = unindexedDocs(docNames, index);
    if (!missing.length) pass("every docs page is linked from docs/index.md");
    else fail("every docs page is linked from docs/index.md", missing.join(", "));
  }
  const sources = { "README.md": (await readText("README.md")) ?? "" };
  for (const n of docNames) sources[`docs/${n}`] = (await readText(`docs/${n}`)) ?? "";
  const shots = await readdir(join(ROOT, "resources/screenshots")).catch(() => []);
  const broken = brokenScreenshotRefs(sources, shots);
  if (!broken.length) pass("README/docs only reference screenshots that exist");
  else fail("README/docs only reference screenshots that exist", broken.join(", "));
}

// ---------- Supply chain ----------
{
  const dep = checkDependabotCooldown(await readText(".github/dependabot.yml"));
  if (dep.ok) pass("Dependabot cooldown (npm + github-actions)", `>= ${MIN_AGE_DAYS} days`);
  else fail("Dependabot cooldown (npm + github-actions)", dep.problems.join("; "));

  const rc = checkNpmrc(await readText(".npmrc"));
  if (rc.ok) pass("npm min-release-age", `${rc.days} days`);
  else fail("npm min-release-age", rc.problem);

  const v = npm(["-v"]);
  const npmVersion = v.status === 0 ? v.stdout.trim() : "";
  if (npmSupportsMinReleaseAge(npmVersion)) pass("npm honours min-release-age", `npm ${npmVersion}`);
  else fail("npm honours min-release-age", `npm ${npmVersion || "?"} is older than ${MIN_NPM_WITH_RELEASE_AGE}: .npmrc would be a silent no-op`);

  const scripts = checkAllowScripts(pkg?.allowScripts);
  if (scripts.ok) pass("npm install-script policy: nothing approved", `denied: ${scripts.denied.join(", ") || "none"}`);
  else if (scripts.approved.length) fail("npm install-script policy: nothing approved", scripts.problem);
  else warn("npm install-script policy recorded", `${scripts.problem}; run \`npm install-scripts deny <pkg>\``);

  // `npm audit --omit=dev` covers what ships (a plugin bundles its code and declares no runtime dependencies), so it
  // blocks. Dev-toolchain advisories are informational (see note()).
  const audit = (omitDev) => {
    const r = npm(["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])], { stdio: "pipe" });
    let json;
    try {
      json = JSON.parse(r.stdout || "");
    } catch {
      return { ok: false, reason: (r.stderr || "no JSON on stdout").trim().split("\n")[0] };
    }
    if (json.error) return { ok: false, reason: json.error.summary || json.error.code || "audit error" };
    const total = json.metadata?.vulnerabilities?.total ?? 0;
    return { ok: true, total, names: Object.keys(json.vulnerabilities || {}) };
  };
  const prod = audit(true);
  if (!prod.ok) skip("no vulnerable runtime dependencies", `npm audit unavailable: ${prod.reason}`);
  else if (prod.total === 0) pass("no vulnerable runtime dependencies", "npm audit --omit=dev is clean");
  else fail("no vulnerable runtime dependencies", `${prod.total} advisory(ies): ${prod.names.slice(0, 5).join(", ")}`);
  const all = audit(false);
  if (!all.ok) note("dev-dependency advisories", `npm audit unavailable: ${all.reason}`);
  else note("dev-dependency advisories", all.total - (prod.ok ? prod.total : 0) > 0 ? `${all.total - (prod.ok ? prod.total : 0)} in the build/test/lint toolchain: not shipped, non-blocking` : "none");

  const hasModules = await stat(join(ROOT, "node_modules")).then((s) => s.isDirectory(), () => false);
  if (!hasModules) skip("dependency tree is internally consistent", "node_modules not installed");
  else {
    const r = npm(["ls", "--all"], { stdio: ["ignore", "pipe", "pipe"] });
    if (r.status === 0) pass("dependency tree is internally consistent", "npm ls reports no conflicts");
    else {
      const problems = (r.stderr || "").split("\n").filter((l) => /invalid|extraneous|missing|peer dep/i.test(l)).map((l) => l.replace(/^npm (error|warn)\s*/, "").trim()).filter(Boolean);
      fail("dependency tree is internally consistent", problems.length ? `${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}` : "npm ls exited non-zero");
    }
  }
}

// ---------- Scripts: build / test / lint ----------
if (pkg) {
  const scripts = pkg.scripts || {};
  const missing = ["build", "test", "lint"].filter((s) => typeof scripts[s] !== "string");
  if (!missing.length) pass("package.json defines build, test and lint scripts");
  else fail("package.json defines build, test and lint scripts", `missing: ${missing.join(", ")}`);

  if (typeof scripts.lint === "string") {
    if (lintScriptIsStrict(scripts.lint)) pass("lint script fails on warnings", "--max-warnings=0");
    else fail("lint script fails on warnings", `add --max-warnings=0 to "lint": ${scripts.lint}`);
  }
  if (runLint && typeof scripts.lint === "string") {
    const r = npm(["run", "lint", "--silent"], { env: { ...process.env, FORCE_COLOR: "0" } });
    if (r.status === 0) pass("npm run lint passes", "0 errors, 0 warnings");
    else fail("npm run lint passes", `exit ${r.status}: ${tail(r, 4)}`);
  } else skip("npm run lint passes", "pass --with-lint or --with-build to execute");

  for (const s of ["build", "test"]) {
    if (!runBuildAndTest) skip(`npm run ${s} passes`, "pass --with-build to execute");
    else if (typeof scripts[s] !== "string") skip(`npm run ${s} passes`, "script not defined");
    else {
      console.log(c.gray(`  → running npm run ${s}…`));
      const r = npm(["run", s, "--silent"]);
      if (r.status === 0) pass(`npm run ${s} passes`);
      else fail(`npm run ${s} passes`, `exit ${r.status}: ${tail(r)}`);
    }
  }
}

// ---------- Summary ----------
const total = results.pass + results.fail + results.warn + results.skip;
const blocked = results.fail > 0 || (strict && results.warn > 0);
const warnNote = results.warn ? (strict ? c.red(` (${results.warn} warning(s), blocking under --strict)`) : c.yellow(` (${results.warn} warning(s): review, non-blocking)`)) : "";
console.log("");
console.log(c.bold(`${total} checks · ${results.pass} passed, ${results.fail} failed, ${results.warn} warned, ${results.skip} skipped — ${blocked ? c.red("DO NOT release.") : c.green("ready to release.") + warnNote}`));
process.exit(blocked ? 1 : 0);
