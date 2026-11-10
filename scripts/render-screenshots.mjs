// Renders the README screenshots from the real inspector view and the real styles.css (fixture data, no vault).
//   node scripts/render-screenshots.mjs            write resources/screenshots/<scene>-<light|dark>.png
//   node scripts/render-screenshots.mjs --check    render into a temp dir, write nothing, exit 1 on any problem
//   node scripts/render-screenshots.mjs day week   only these scenes (`--all` adds the onboarding steps, `--out <dir>` writes elsewhere, `--phone` shows the onboarding steps on a phone)
// The clock is fixed to Wed 4 March 2026, 15:20, so the "today" ring, the running timer and the now-line never drift.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkCallouts } from './lib/calloutChecks.mjs';

/** scene -> [description (the README alt text says the same), in the default set?, element to capture]. The onboarding steps are for review (`--all`), the README does not use them. */
const PANEL = '#frame';
/** An annotated scene redraws a base scene (light theme only) with numbered, dashed boxes found by CSS selector: `{ sel, nth?, side?: 'left' | 'right', line?: false }` (no leader line where it would cross text). The README legends use the same numbers, in order. */
const attr = (label, nth = 0) => ({ sel: `[aria-label^="${label}"]`, nth });
const annotated = (scene, desc, callouts) => [desc, true, PANEL, { scene, callouts }];
const SCENES = { month: ['Month calendar', true, PANEL], week: ['Week view', true, PANEL], day: ['Day view with time blocks', true, PANEL], task: ['Task details', true, PANEL], 'task-minimal': ['A task with nothing added', true, PANEL], slipping: ['Task with many moves', false, PANEL], projects: ['Projects', true, PANEL],
  retire: ['Retire window', false, '.organized-modal-window'],
  'task-minimal-annotated': annotated('task-minimal', 'A task with nothing added, numbered', [{ sel: '.organized-status-field' }, { sel: '.organized-add-details', side: 'right' }, { sel: '.organized-task-hero .organized-icon-button', nth: 2, side: 'right' }]),
  'task-annotated': annotated('task', 'Task details, numbered', [{ sel: '.organized-status-field' }, { sel: '.organized-add-details', side: 'right' }, { sel: '.organized-prop-strip' }, { sel: '.organized-card', nth: 0 }, { sel: '.organized-card', nth: 1 }, { sel: '.organized-subtask-actions', side: 'right' }, { sel: '.organized-card', nth: 2 }, { sel: '.organized-card', nth: 3 }, { sel: '.organized-moves' }, { sel: '.organized-task-actions' }]),
  'month-annotated': annotated('month', 'Month calendar, numbered', [{ sel: '.organized-tabs' }, { sel: '.organized-seg', side: 'right' }, { sel: '.organized-calendar-nav' }, { ...attr('Wednesday, March 4'), line: false }, { sel: '.organized-stats' }]),
  'week-annotated': annotated('week', 'Week view, numbered', [{ sel: '.organized-week-row:nth-of-type(3) .organized-week-count', side: 'right' }, { sel: '.organized-week-row', nth: 3 }, { sel: '.organized-week-row:nth-of-type(4) .organized-week-track', side: 'right', line: false }]),
  'day-annotated': annotated('day', 'Day view, numbered', [{ sel: '.organized-day-task', nth: 0 }, { sel: '.organized-day-task', nth: 1, side: 'right' }, { sel: '.organized-day-task', nth: 4 }, { sel: '.organized-head-action', side: 'right', line: false }, { sel: '.organized-day-grid', line: false }, { sel: '.organized-now-line', side: 'right' }]),
  'projects-annotated': annotated('projects', 'Projects, numbered', [{ sel: '.organized-field' }, { sel: '.organized-colors', side: 'right' }, { sel: '.organized-list-card', nth: 0 }, { sel: '.organized-chip', nth: 0, side: 'right' }]),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(n => [`onboarding-${n}`, [`Onboarding card, step ${n}`, false, '.organized-modal-window']])) };
/** Crops of the real panel that the What's new note embeds (src/whatsNew/shots): name -> [base scene, the parts to keep, optionally the share of their height to keep as [from, to]]. */
const SHOTS = {
  repeat: ['task', [{ sel: '.organized-prop-strip' }]],
  timer: ['task', [{ sel: '.organized-card', nth: 2 }]],
  plan: ['day', [{ sel: '.organized-day-grid' }], [0.62, 1]],
};
const WIDTH = 400; // CSS px, a typical side-panel width; images are 2x
const args = process.argv.slice(2);
const check = args.includes('--check');
const phone = args.includes('--phone'); // onboarding steps on a 390 x 640 phone with a mobile theme that inflates buttons
const outArg = args.indexOf('--out');
const outDir = outArg >= 0 ? args[outArg + 1] : null;
const wanted = args.filter((a, i) => !a.startsWith('--') && !(outArg >= 0 && i === outArg + 1));
for (const w of wanted) if (!SCENES[w] && !SHOTS[w]) { console.error(`unknown scene "${w}"; known: ${[...Object.keys(SCENES), ...Object.keys(SHOTS)].join(', ')}`); process.exit(2); }
const shots = wanted.length ? wanted.filter(w => SHOTS[w]) : Object.keys(SHOTS);
const scenes = wanted.length ? wanted.filter(w => SCENES[w]) : Object.keys(SCENES).filter(name => check || args.includes('--all') || SCENES[name][1]);
const ANNOTATED_PAD = 44; // side margins that hold the number circles, in CSS px
const out = check ? await mkdtemp(join(tmpdir(), 'organized-shots-')) : resolve(outDir ?? 'resources/screenshots');
await mkdir(out, { recursive: true });
const shotOut = check || outDir ? out : resolve('src/whatsNew/shots');
await mkdir(shotOut, { recursive: true });

// Obsidian's default light/dark variables (the app without a theme), so the panel reads as it does in the app.
const light = '--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;--background-modifier-border-hover:#d0d0d0;--background-modifier-hover:rgba(0,0,0,.075);--background-modifier-error:#e93147;--text-normal:#222;--text-muted:#5c5c5c;--text-faint:#ababab;--text-error:#e93147;--text-on-accent:#fff;--interactive-accent:#7b6cd9;--interactive-accent-hover:#8a7fe0;--color-red:#e93147;--color-orange:#ec7500;--color-yellow:#e0ac00;--color-green:#08b94e;--link-color:#705dcf;--shadow-l:0 1.4px 1.6px rgba(0,0,0,.03),0 3.4px 4px rgba(0,0,0,.05),0 6.4px 7.5px rgba(0,0,0,.06),0 11.4px 13.4px rgba(0,0,0,.08),0 21px 25px rgba(0,0,0,.1)';
const dark = '--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#363636;--background-modifier-border-hover:#3f3f3f;--background-modifier-hover:rgba(255,255,255,.075);--background-modifier-error:#fb464c;--text-normal:#dadada;--text-muted:#b3b3b3;--text-faint:#666;--text-error:#fb464c;--text-on-accent:#fff;--interactive-accent:#7b6cd9;--interactive-accent-hover:#8a7fe0;--color-red:#fb464c;--color-orange:#e9973f;--color-yellow:#e0de71;--color-green:#44cf6e;--link-color:#a99ff0;--shadow-l:0 1.4px 1.6px rgba(0,0,0,.2),0 6.4px 7.5px rgba(0,0,0,.35),0 21px 25px rgba(0,0,0,.45)';
const host = `*,*::before,*::after{box-sizing:border-box}body{margin:0;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--font-ui-small:13px;--font-ui-smaller:11px;--font-bold:600;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--radius-s:4px;--radius-m:8px;--link-decoration:none;color:var(--text-normal)}body.theme-light{${light}}body.theme-dark{${dark}}#frame{inline-size:${WIDTH + 32}px;padding:16px;background:var(--background-secondary)}#app{inline-size:${WIDTH}px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;overflow:hidden;padding:4px 0}button,input,select,textarea{font:inherit;color:var(--text-normal);background:var(--background-modifier-hover);border:0;border-radius:var(--radius-s)}body{background:var(--background-secondary)}html.annotated #frame{inline-size:${WIDTH + 2 * ANNOTATED_PAD}px;padding-inline:${ANNOTATED_PAD}px;position:relative}.co-box{position:absolute;border:2px dashed #0d6a00;border-radius:4px;pointer-events:none}.co-line{position:absolute;block-size:2px;background:#349e00;pointer-events:none}.co-circle{position:absolute;inline-size:26px;block-size:26px;border-radius:50%;background:#349e00;border:2px solid #307000;color:#fff;font:700 15px/22px Arial,sans-serif;text-align:center;pointer-events:none}.modal-container{display:flex;justify-content:center;padding:16px}.modal{background:var(--background-primary);border-radius:12px;box-shadow:var(--shadow-l)}button{cursor:pointer}a{color:var(--link-color);text-decoration:var(--link-decoration)}svg.svg-icon{inline-size:1em;block-size:1em;display:block}`;

const bundle = await build({ entryPoints: ['scripts/screenshots/entry.ts'], bundle: true, write: false, loader: { '.png': 'dataurl' }, format: 'iife', target: 'es2022', alias: { obsidian: resolve('scripts/screenshots/obsidianShim.ts') } });
const css = await readFile('styles.css', 'utf8');
const browser = await chromium.launch({ headless: true });
const problems = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: WIDTH + 32, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    const page = await context.newPage();
    page.on('pageerror', e => problems.push(`${theme}: page error: ${e.message}`));
    await page.clock.setFixedTime(new Date(2026, 2, 4, 15, 20));
    await page.setContent(`<!doctype html><html><head></head><body class="theme-${theme}"><div id="frame"><main id="app"></main></div></body></html>`);
    await page.addStyleTag({ content: host + css });
    if (phone) { await page.evaluate(() => document.body.classList.add('is-mobile')); await page.addStyleTag({ content: '.is-mobile button { block-size: 48px; margin-block: 6px; border-radius: 999px; padding: 18px 24px; font-size: 20px; } .modal-container { padding: 0 }' }); }
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => typeof window.scene === 'function');
    for (const scene of scenes) {
      const note = SCENES[scene][3]; if (note && theme === 'dark') continue;
      await page.evaluate(async ([name, on]) => { document.querySelector('.co-layer')?.remove(); document.documentElement.classList.toggle('annotated', on); await window.scene(name); }, [note?.scene ?? scene, Boolean(note)]);
      await page.evaluate(() => document.fonts.ready);
      const modal = scene.startsWith('onboarding-') || scene === 'retire';
      await page.setViewportSize({ width: modal ? (phone ? 390 : 520) : WIDTH + (note ? 2 * ANNOTATED_PAD : 32), height: phone ? 640 : 900 });
      const state = await page.evaluate(modal => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, empty: modal ? !document.querySelector('.organized-modal-window .modal-title') : !document.querySelector('#app .organized-view *'), missing: window.missingIcons(), height: document.querySelector(modal ? '.organized-modal-window' : '#frame').getBoundingClientRect().height }), modal);
      if (state.overflow && !phone) problems.push(`${theme}/${scene}: horizontal overflow`);
      if (state.empty) problems.push(`${theme}/${scene}: nothing rendered`);
      if (state.missing.length) problems.push(`${theme}/${scene}: no glyph for icon(s) ${state.missing.join(', ')}; add them to scripts/screenshots/icons.json`);
      await page.setViewportSize({ width: modal ? (phone ? 390 : 520) : WIDTH + (note ? 2 * ANNOTATED_PAD : 32), height: phone ? 640 : Math.max(900, Math.ceil(state.height) + 64) });
      if (note) {
        const report = await page.evaluate(callouts => {
          document.querySelector('.co-layer')?.remove();
          const frame = document.querySelector('#frame'), origin = frame.getBoundingClientRect(), layer = document.createElement('div'); layer.className = 'co-layer'; frame.append(layer);
          const items = callouts.map(({ sel, nth = 0, side = 'left', line = true }, i) => {
            const el = document.querySelectorAll(sel)[nth]; if (!el) throw new Error(`callout ${i + 1}: nothing matches ${sel} (#${nth})`);
            const r = el.getBoundingClientRect(), pad = 3, box = { left: r.left - origin.left - pad, top: r.top - origin.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
            const cx = side === 'left' ? 22 : origin.width - 22, cy = box.top + box.height / 2;
            const edge = side === 'left' ? box.left : box.left + box.width, from = side === 'left' ? cx + 13 : edge, to = side === 'left' ? edge : cx - 13;
            const add = (cls, css, text = '') => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); d.textContent = text; layer.append(d); };
            add('co-box', { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
            if (line && to > from) add('co-line', { left: `${from}px`, top: `${cy - 1}px`, width: `${to - from}px` });
            add('co-circle', { left: `${cx - 13}px`, top: `${cy - 13}px` }, String(i + 1));
            return { n: i + 1, box, circle: { cx, cy } };
          });
          return { width: origin.width, height: origin.height, items };
        }, note.callouts);
        for (const problem of checkCallouts(report)) problems.push(`${scene}: ${problem}`);
      }
      if (phone) await page.screenshot({ path: join(out, `${scene}-${theme}.png`) }); else await page.locator(SCENES[scene][2]).screenshot({ path: join(out, note ? `${scene}.png` : `${scene}-${theme}.png`) });
    }
    for (const shot of phone ? [] : shots) {
      const [base, parts, rows = [0, 1]] = SHOTS[shot];
      await page.evaluate(async name => { document.querySelector('.co-layer')?.remove(); document.documentElement.classList.remove('annotated'); await window.scene(name); }, base);
      await page.evaluate(() => document.fonts.ready);
      await page.setViewportSize({ width: WIDTH + 32, height: 2400 });
      const clip = await page.evaluate(([parts, rows]) => {
        const rects = parts.map(({ sel, nth = 0 }) => { const el = document.querySelectorAll(sel)[nth]; if (!el) throw new Error(`crop: nothing matches ${sel} (#${nth})`); return el.getBoundingClientRect(); });
        const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right)), top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
        const pad = 6; return { x: left - pad, y: top + (bottom - top) * rows[0] - pad, width: right - left + 2 * pad, height: (bottom - top) * (rows[1] - rows[0]) + 2 * pad };
      }, [parts, rows]);
      await page.screenshot({ path: join(shotOut, `${shot}-${theme}.png`), clip });
    }
    await context.close();
  }
} finally {
  await browser.close();
  if (check) await rm(out, { recursive: true, force: true });
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(check ? `ok: ${scenes.length} scene(s) and ${shots.length} crop(s) x 2 themes render cleanly` : `wrote ${scenes.reduce((n, name) => n + (SCENES[name][3] ? 1 : 2), 0) + (phone ? 0 : shots.length * 2)} image(s) (${shots.length * 2} of them crops in ${shotOut})`);
