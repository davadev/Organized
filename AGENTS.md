# Organized

Mobile-compatible Obsidian plugin; TypeScript, native Obsidian UI, Markdown-backed tasks.
Project attribution and Git author/committer identity: **davadev only**. Never publish a real name or local user path.

## Commands
- `npm run build`: typecheck and production bundle.
- `npm run lint`: review-parity lint, zero warnings.
- `npm run lint:css`: stylesheet lint.
- `npm run test:cov`: all source measured; 100% coverage requirement.
- `npm run check:dead-code`: production reachability and dependencies.
- `npm run check:layout` / `npm run check:webkit`: real-browser layout.
- `npm run check-release -- --with-build --strict`: pre-tag gate.

## Procedures
Read the applicable `.claude/skills/<name>/SKILL.md` before its task.
| Trigger | Skill |
|---|---|
| Coding and design | `plugin-design-rules` |
| Dependencies and action pins | `dependency-update` |
| Before a PR | `feature-done` |
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

## Reference
- `PLAN.md`: intended feature specification and original constraints.
- `docs/architecture.md`: code and safety boundaries.
- `docs/releasing.md`: standalone release procedure.
- `docs/testing.md`: verified checks and remaining device limitations.
