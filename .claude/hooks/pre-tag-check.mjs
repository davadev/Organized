#!/usr/bin/env node
// TEMPLATE: .claude/hooks/pre-tag-check.mjs (registered by .claude/settings.json)
// WHAT: Claude Code PreToolUse hook for Bash. Before the agent creates or pushes a SemVer release tag, it runs the
//       release guard plus lint (`npm run check-release -- --with-lint`). A failure blocks the command (exit 2) and shows
//       the agent the output. It also blocks `gh release create|upload|edit|delete` and `git push --tags|--follow-tags`
//       outright (release.yml publishes from a tag). Any other command passes straight through (exit 0).
// CHANGE: nothing. It imports the command matcher from ../../scripts/lib/releaseChecks.mjs, so copy that file too.
// GUARDS: a tag pushed past a red check-release publishes a broken release (missing styles.css, wrong version, a lint
//         Error that fails Obsidian's auto-review). The workflow re-checks on the runner, but a bad tag is slow to undo and
//         a pushed tag can briefly be seen by BRAT users; failing before the push is cheaper.
import { spawnSync } from "node:child_process";
import { classifyReleaseCommand } from "../../scripts/lib/releaseChecks.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command = "";
try {
  command = JSON.parse(input)?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

const verdict = classifyReleaseCommand(command);
if (verdict === "allow") process.exit(0);
const BLOCKED = {
  "block-release-cmd": "Blocked: releases are published by release.yml from a tag. Use the release-beta / release-stable skill, not `gh release`.",
  "block-push-tags": "Blocked: push the one tag by name (`git push origin <tag>`), never --tags or --follow-tags.",
};
if (verdict !== "needs-check") {
  process.stderr.write(`${BLOCKED[verdict]}\n`);
  process.exit(2);
}

const run = spawnSync("npm", ["run", "check-release", "--", "--with-lint"], { encoding: "utf8", cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
if (run.status === 0) process.exit(0);

process.stderr.write(
  `Release tag blocked: \`npm run check-release -- --with-lint\` failed (exit ${run.status}).\n` +
    `Fix it (see the release-beta skill) before tagging.\n\n${(run.stdout || "").split("\n").slice(-40).join("\n")}\n${run.stderr || ""}`
);
process.exit(2);
