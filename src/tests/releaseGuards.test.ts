// src/tests/releaseGuards.test.ts
// WHAT: pins which shell commands the PreToolUse release hook blocks, checks or lets through.
// GUARDS: someone "simplifying" the hook regex so `git tag -m msg 1.2.3` or `git push --follow-tags` slips past.
import { describe, expect, it } from "vitest";
import { classifyReleaseCommand } from "../../scripts/lib/releaseChecks.mjs";

describe("classifyReleaseCommand", () => {
  it.each([
    ["git tag 1.2.3", "needs-check"],
    ["git tag 1.2.3-beta.4", "needs-check"],
    ["git tag -a -m 'x' 1.2.3", "needs-check"],
    ["git push origin 1.2.3", "needs-check"],
    ["git push origin HEAD:refs/tags/1.2.3", "needs-check"],
    ["git tag -d 1.2.3", "allow"],
    ["git status", "allow"],
    ["git push origin my-branch", "allow"],
    ["git push --tags", "block-push-tags"],
    ["git push --follow-tags origin main", "block-push-tags"],
    ["gh release create 1.2.3", "block-release-cmd"],
    ["gh release view 1.2.3", "allow"],
  ])("%s -> %s", (command, verdict) => expect(classifyReleaseCommand(command)).toBe(verdict));
});
