import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const text = (path: string) => readFileSync(path, 'utf8');
describe('release and privacy wiring', () => {
  it('keeps project attribution and Git metadata pseudonymous', () => {
    expect(JSON.parse(text('manifest.json')).author).toBe('davadev'); expect(text('LICENSE')).toContain('Copyright (c) 2026 davadev');
    const result = spawnSync(process.execPath, ['scripts/check-identity.mjs'], { encoding: 'utf8' }); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('privacy verified');
  });
  it('pins workflow actions and separates real-browser checks from tag publication', () => {
    const ci = text('.github/workflows/ci.yml'); const release = text('.github/workflows/release.yml');
    for (const workflow of [ci, release]) {
      for (const uses of workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) expect(uses[1]).toMatch(/@[a-f0-9]{40}$/);
      expect(workflow).toContain('persist-credentials: false'); expect(workflow).toContain('node-version: 24');
      expect(workflow).toContain('run: node scripts/check-toolchain.mjs');
      for (const script of ['test:cov', 'lint:css', 'check:dead-code', 'check:identity']) expect(workflow).toContain(`run: npm run ${script}`);
    }
    expect(ci).toContain('engine: [chromium, webkit]'); expect(ci).toContain('node scripts/check-layout.mjs'); expect(release).not.toMatch(/run: .*playwright|run: .*check:(?:layout|webkit)/);
    expect(release).toContain('--strict'); expect(release).toContain('cancel-in-progress: false'); expect(release).toContain('scripts/stamp-prerelease.mjs');
  });
  it('keeps bundled artwork local, licensed and scoped to plugin-owned selectors', () => {
    const css = text('styles.css'); const notices = text('THIRD_PARTY_NOTICES.md');
    for (const project of ['Things 2', 'Heroicons', 'Bootstrap Icons', 'Ionicons', 'Fluent UI System Icons', 'Octicons']) expect(notices).toContain(project);
    expect(css).toContain('Permission is hereby granted'); expect(css).not.toContain('!important'); expect(css).toContain('.organized-glyph'); expect(css).not.toMatch(/url\(["']?https?:/);
    const bundle = text('esbuild.config.mjs'); expect(bundle).toContain('"@codemirror/state"'); expect(bundle).toContain('"@codemirror/view"');
  });
  it('fails the release hook before a tag when the guard cannot run', () => {
    const hook = '.claude/hooks/pre-tag-check.mjs';
    const safe = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_input: { command: 'git status' } }), encoding: 'utf8' }); expect(safe.status).toBe(0);
    const blocked = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_input: { command: 'git tag 0.1.0-beta.1' } }), env: { ...process.env, CLAUDE_PROJECT_DIR: '/dev/null' }, encoding: 'utf8' }); expect(blocked.status).toBe(2); expect(blocked.stderr).toContain('blocked');
  });
});
