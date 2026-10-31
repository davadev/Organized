---
name: triage-issue
description: Create or triage a GitHub issue with a target release. Use when opening an issue, choosing the next change, or documenting a beta's verification.
---

# Issues

Repository: `davadev/Organized`. No project board is configured; do not invent one or request broader GitHub scopes.

## Every issue, always
1. Use an existing appropriate label (`bug` or `enhancement`) and include the intended beta in the issue body.
2. Track implementation in a feature-branch PR referencing the issue.
3. Record verified checks, known limitations and install instructions; project attribution is davadev only.
4. Large features start as a research-and-design issue: verified facts / hypotheses / open questions kept separate, a timeboxed spike, explicit continue/stop criteria.

## Picking next work
Fix security, data-safety and release-pipeline regressions before adding features.

## Status lifecycle
Backlog -> Ready -> In progress -> **In beta** (prerelease published) -> **Done** (stable published, issue closed).

## After a stable release
Close verified released issues and re-check the targets of the remaining issues.

## GitHub comments
Correct a posted comment by editing it in place with an italic dated edit note; never stack a correction comment.
