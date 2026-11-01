import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const engine = process.argv[2] === 'webkit' ? 'webkit' : 'chromium';
const bundle = await build({ entryPoints: ['scripts/layout-entry.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', alias: { obsidian: resolve('src/tests/__mocks__/obsidian.ts') } });
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const css = await readFile('styles.css', 'utf8');
const hostCss = `body { margin: 0; font: 14px system-ui; --text-normal: #222; --text-muted: #666; --text-faint: #777; --background-primary: #fff; --background-secondary: #eee; --background-modifier-border: #ccc; --interactive-accent: #6755c5; --text-on-accent: #fff; --font-ui-small: 13px; --font-ui-smaller: 11px; --size-4-1: 4px; --size-4-2: 8px; --size-4-3: 12px; } body.theme-dark { --text-normal: #ddd; --text-muted: #aaa; --text-faint: #999; --background-primary: #202020; --background-secondary: #303030; --background-modifier-border: #555; background: #202020; color: #ddd; } button, input, select, textarea { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-normal); font: inherit; } button { cursor: pointer; } .setting-item { display: flex; justify-content: space-between; padding-block: 8px; }`;
await mkdir('test-results', { recursive: true });
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  await page.addStyleTag({ content: hostCss + css });
  // Reproduce hostile mobile host defaults from the reported screenshots,
  // rather than testing only an unstyled desktop DOM.
  await page.addStyleTag({ content: '.is-mobile button { border-radius: 999px; padding: 18px 24px; font-size: 20px; box-shadow: 0 2px 4px #0005; } .setting-item-name { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; } .setting-item-control input[type=checkbox] { inline-size: 50px; block-size: 28px; } .setting-item-control { flex-shrink: 0; }' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text, type: 'module' });
  await page.waitForFunction(() => typeof window.scene === 'function');
  for (const width of [240, 320, 390, 768]) for (const dark of [false, true]) for (const rtl of [false, true]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ dark, rtl }) => { document.body.className = `${dark ? 'theme-dark' : 'theme-light'} is-mobile`; document.documentElement.dir = rtl ? 'rtl' : 'ltr'; }, { dark, rtl });
    for (const tab of ['Calendar', 'Task', 'NoteTasks', 'InlineEditor', 'Projects', 'Settings', 'LegacySettings', 'LivePreview', 'Source', 'ScheduleModal', 'Eof']) {
      await page.evaluate(tab => window.scene(tab), tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error(`${engine}: horizontal overflow at ${width}, ${dark ? 'dark' : 'light'}, ${rtl ? 'RTL' : 'LTR'}, ${tab}`);
      const calendar = page.locator('.organized-calendar button');
      if (tab === 'Calendar' && await calendar.count() !== 42) throw Error('Calendar is not the real 42-cell inspector');
      if (tab === 'Calendar') {
        const height = await calendar.first().evaluate(el => el.getBoundingClientRect().height);
        if (height > 44) throw Error('Mobile theme inflated calendar cells');
      }
      if (tab === 'Task' || tab === 'InlineEditor') {
        const cards = await page.locator('.organized-card-title').allTextContents();
        if (cards[0] !== 'Description' || !cards.includes('Idea') || await page.locator('.organized-view .setting-item').count()) throw Error(`Task inspector lost its description-first cards: ${cards.join(',')}`);
        if (!(await page.locator('.organized-task-hero .organized-task-title').count())) throw Error('Task inspector is missing its titled hero');
        if (!(await page.locator('.organized-task-actions .organized-danger').count())) throw Error('Task inspector is missing its delete action');
        if (await page.locator('.organized-task-details').count() !== 1) throw Error('Task properties are fragmented instead of grouped into one details surface');
      }
      if (tab === 'NoteTasks') {
        if (await page.locator('.organized-list-card').count() !== 2) throw Error('Task tab is missing current-note tasks when no task is selected');
        if (await page.locator('.organized-list-card').first().innerText().then(text => !text.includes('A task title'))) throw Error('Current-note linked task title is missing');
      }
      if (tab === 'InlineEditor') {
        const field = page.locator('.organized-inline-editor'); if (await field.count() !== 1) throw Error('Inline editor field is missing');
        const save = page.locator('.organized-inline-actions .organized-save'); if (await save.count() !== 1) throw Error('Inline editor is missing Save');
        const fieldBox = await field.boundingBox(), saveBox = await save.boundingBox(); if (!fieldBox || !saveBox) throw Error('Inline editor is not visible');
        if (saveBox.y + saveBox.height > fieldBox.y) throw Error('Inline editor Save is below the keyboard-prone field');
        if (fieldBox.width > width) throw Error(`Inline editor overflows its ${width}px host: ${fieldBox.width}`);
      }
      if (tab === 'Projects') {
        const sections = await page.locator('.organized-section-title').allTextContents();
        if (sections.join(',') !== 'Favorites,Projects,Canceled') throw Error(`Projects tab lost its sections: ${sections.join(',')}`);
        if (await page.locator('.organized-list-card').count() < 2) throw Error('Projects tab did not render task cards');
        if (await page.locator('.organized-view .setting-item').count()) throw Error('Projects tab exposed a native settings row');
      }
      if (tab === 'ScheduleModal') {
        if (!(await page.locator('.modal-container.organized-modal-host').count())) throw Error('Organized modal host is missing its keyboard-safe class');
        const window = page.locator('.organized-modal-window'); if (await window.count() !== 1) throw Error('Schedule modal is missing the shared chrome');
        const box = await window.boundingBox(); if (!box) throw Error('Schedule modal is not visible');
        if (box.y > 96) throw Error(`Schedule modal is not top-aligned: ${box.y}`);
        if (box.width > width - 8) throw Error(`Schedule modal overflows its ${width}px host: ${box.width}`);
        const title = await page.locator('.organized-modal-window .modal-title').innerText(); if (title !== 'Schedule task') throw Error(`Schedule modal title regressed: ${title}`);
        const button = page.locator('.organized-modal-window .modal-content button'); if (!(await button.isVisible())) throw Error('Schedule modal action is hidden');
      }
      if (tab.endsWith('Settings')) {
        if (await page.locator('.setting-item .setting-item').count()) throw Error('Settings are nested inside a native setting row');
        const clipped = await page.locator('.organized-setting-row .setting-item-name').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth + 1));
        if (clipped) throw Error(`Unreadable clipped setting labels at ${width}`);
        if (width <= 390) {
          const gap = await page.locator('.organized-setting-row').first().evaluate(row => {
            const info = row.querySelector('.setting-item-info')?.getBoundingClientRect();
            const control = row.querySelector('.setting-item-control')?.getBoundingClientRect();
            return info && control ? control.top - info.bottom : 0;
          });
          if (gap > 48) throw Error(`Mobile settings control is separated from its label by ${gap}px at width ${width}`);
        }
      }
      if (tab === 'Eof') {
        const projection = page.locator('.organized-projection');
        if (await projection.count() !== 1 || !(await projection.innerText()).includes('priority: none')) throw Error('Final-line task properties are missing at EOF');
      }
      if (tab === 'LivePreview' || tab === 'Source') {
        const visible = await page.locator('.cm-content').innerText();
        if (visible.includes('organized:') !== (tab === 'Source')) throw Error('Task identity source/Live Preview separation regressed');
      }
      if (width === 320 && !rtl) await page.screenshot({ path: `test-results/${engine}-${tab.toLowerCase()}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    }
  }
  // Canary: a deliberately oversized child MUST be detected by the same probe.
  await page.addStyleTag({ content: '#app { inline-size: 2000px; min-block-size: 100px; }' });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))) throw Error('Overflow canary was invisible: layout gate cannot detect its defect');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`${engine}: sidebar, modern/legacy settings and real CM Live Preview/source; 4 widths × light/dark × LTR/RTL; overflow canary detected.`);
} finally { await browser.close(); }
