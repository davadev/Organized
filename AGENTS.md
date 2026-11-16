# Organized

Mobile-compatible Obsidian plugin; TypeScript, native Obsidian UI, Markdown-backed tasks.
Project attribution: **davadev only**. Git authors may be **davadev** or **Dany**, using the verified davadev GitHub no-reply address. Committers may match or be GitHub’s merge service (`GitHub <noreply@github.com>`). Never publish a local user path.

## Commands
- `npm run build`: typecheck and production bundle.
- `npm run lint`: review-parity lint, zero warnings.
- `npm run lint:css`: stylesheet lint (no `:has`).
- `npm run lint:deps`: package.json lint for dependencies the review wants replaced.
- `npm run test:cov`: all source measured; 100% coverage requirement.
- `npm run check:dead-code`: production reachability and dependencies.
- `npm run check:layout` / `npm run check:webkit`: real-browser layout.
- `npm run sync`: fetch, fast-forward a clean main, `npm ci` when package-lock.json moved, report what the auto-merge lane did.
- `npm run check-release -- --with-build --strict`: pre-tag gate.

## Procedures
Read the applicable `.claude/skills/<name>/SKILL.md` before its task.
| Trigger | Skill |
|---|---|
| Coding and design | `plugin-design-rules` |
| Dependencies and action pins | `dependency-update` |
| Before a PR | `feature-done` |
| Bug audit, before stable | `bug-hunt` |
| Beta / tag / ship | `release-beta` |
| Explicit stable promotion only | `release-stable` |
| Issue triage | `triage-issue` |

## Always-on rules
- Work on a branch and open a PR; never commit implementation directly to main.
- No note writes on startup/render. Only explicit actions, recognized user syntax or enabled date-flip reconciliation.
- Vault.process for background edits; Editor transactions for the active note; processFrontMatter for metadata.
- Validate persisted data; never overwrite unknown/newer schemas or ambiguous ID matches.
- No Node/Electron/network/telemetry in the shipped plugin.
- Do not disable lint rules, hide source from coverage, or lower gates to ship.
- Tag-driven releases only. Read `docs/releasing.md`; never hand-create a release.
- Main keeps stable-shaped version metadata; beta assets are stamped in CI. Initial 0.0.0 is an unpublished bootstrap, not a stable release.
- No stable promotion or community submission without explicit approval; real-device testing is required before stable.
- **GitHub changes main without you.** The Dependabot auto-merge lane merges dependency bumps that leave `main.js` byte-identical (see `dependency-update`, "Auto-merge lane"), so a checkout is stale by default. A SessionStart hook runs `npm run sync`; run it yourself before creating a branch, before a PR and before a tag, and act on every `NEEDS A HUMAN` line. Never work from a `node_modules` that does not match `package-lock.json`.
- **Dependabot gate.** Before every beta and every stable run the Dependabot gate in `dependency-update`. An open Dependabot PR now means the lane left it for a human: fold it into the next beta. A `needs-beta` issue is a security fix that changes shipped bytes: cut a beta. Stable needs 0 open alerts (turn alerts on if the API says they are disabled).

## Reference
- `PLAN.md`: design notes: what the plugin is for, the principles behind it, and where the code keeps them.
- `docs/architecture.md`: code and safety boundaries.
- `docs/releasing.md`: standalone release procedure.
- `docs/testing.md`: verified checks and remaining device limitations.
