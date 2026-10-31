<!-- TEMPLATE: .github/pull_request_template.md. CHANGE: adjust the docs/What's new lines to files your repo has. -->

## What and why

<!-- One or two sentences. Link the issue: Closes #N -->

## Checklist (see `.claude/skills/feature-done`)

- [ ] Tests added/updated; `npm run test:cov` still 100 %
- [ ] `npm run build`, `npm run lint` (0 errors, 0 warnings) and `npm run lint:css` clean
- [ ] Docs updated (`docs/*.md`, `docs/index.md`, README) or not applicable
- [ ] What's new entry in `src/whatsNew/releaseNotes.ts` for any user-visible change, or not applicable
- [ ] Release plan: beta tag after merge (manifest/package/versions untouched)
