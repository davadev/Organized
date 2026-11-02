import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const engine = process.argv[2] === 'webkit' ? 'webkit' : 'chromium';
const bundle = await build({ entryPoints: ['scripts/layout-entry.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', alias: { obsidian: resolve('src/tests/__mocks__/obsidian.ts') } });
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const css = await readFile('styles.css', 'utf8');
const hostCss = `*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font: 14px system-ui; --text-normal: #222; --text-muted: #666; --text-faint: #777; --background-primary: #fff; --background-secondary: #eee; --background-modifier-border: #ccc; --interactive-accent: #6755c5; --color-green: #2f9e44; --text-on-accent: #fff; --font-ui-small: 13px; --font-ui-smaller: 11px; --size-4-1: 4px; --size-4-2: 8px; --size-4-3: 12px; } body.theme-dark { --text-normal: #ddd; --text-muted: #aaa; --text-faint: #999; --background-primary: #202020; --background-secondary: #303030; --background-modifier-border: #555; background: #202020; color: #ddd; } button, input, select, textarea { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-normal); font: inherit; } button { cursor: pointer; } .setting-item { display: flex; justify-content: space-between; padding-block: 8px; }`;
await mkdir('test-results', { recursive: true });
try {
  let page; const errors = [];
  // A phone with a large system font scales every text size but not the fixed boxes around it (Android), so each width is also checked with text 1.3 times larger.
  for (const scale of [1, 1.3]) {
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  await page.addStyleTag({ content: hostCss + css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (_match, size) => `font-size: ${Number(size) * scale}px`) });
  // The Obsidian mock only records icon names; draw a stand-in the size of a real icon (svg sized by our CSS) so positions and colours are checked.
  await page.addStyleTag({ content: '.organized-list-status[data-icon]::before, .organized-block-status[data-icon]::before, .organized-status-icon[data-icon]::before, .organized-icon-button[data-icon]::before { content: ""; display: block; background: currentColor; border-radius: 3px; } .organized-status-icon[data-icon]::before, .organized-icon-button[data-icon]::before { inline-size: 16px; block-size: 16px; } .organized-list-status[data-icon]::before { inline-size: 14px; block-size: 14px; } .organized-block-status[data-icon]::before { inline-size: 12px; block-size: 12px; }' });
  // Reproduce hostile mobile host defaults from the reported screenshots,
  // rather than testing only an unstyled desktop DOM.
  await page.addStyleTag({ content: '.is-mobile button { block-size: 48px; margin-block: 6px; border-radius: 999px; padding: 18px 24px; font-size: 20px; box-shadow: 0 2px 4px #0005; } .setting-item-name { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; } .setting-item-control input[type=checkbox] { inline-size: 50px; block-size: 28px; } .setting-item-control { flex-shrink: 0; } .is-mobile .setting-item { display: flex; flex-direction: column; }' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text, type: 'module' });
  await page.waitForFunction(() => typeof window.scene === 'function');
  for (const width of [240, 320, 360, 390, 412, 768].filter(width => scale === 1 || width <= 412)) for (const dark of [false, true]) for (const rtl of [false, true]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ dark, rtl }) => { document.body.className = `${dark ? 'theme-dark' : 'theme-light'} is-mobile`; document.documentElement.dir = rtl ? 'rtl' : 'ltr'; }, { dark, rtl });
    for (const tab of ['Calendar', 'Week', 'Day', 'Task', 'NoteTasks', 'InlineEditor', 'Projects', 'Favorites', 'Settings', 'LegacySettings', 'LivePreview', 'Source', 'ScheduleModal', 'SessionModal', 'NoteModal', 'Eof']) {
      await page.evaluate(tab => window.scene(tab), tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error(`${engine}: horizontal overflow at ${width}${scale === 1 ? '' : ` with ${scale}x text`}, ${dark ? 'dark' : 'light'}, ${rtl ? 'RTL' : 'LTR'}, ${tab}`);
      const tabs = await page.evaluate(() => { const list = document.querySelector('.organized-tabs'); const host = document.querySelector('.organized-view'); if (!list || !host) return null; const box = list.getBoundingClientRect(); const hostBox = host.getBoundingClientRect(); const rtl = getComputedStyle(host).direction === 'rtl'; const buttons = [...list.querySelectorAll('button')].map(button => { const b = button.getBoundingClientRect(); return [b.width, b.height, button.getAttribute('aria-label'), button.hasAttribute('data-icon')]; }); return { buttons, gap: rtl ? box.left - hostBox.left : hostBox.right - box.right }; });
      if (tabs) {
        if (tabs.buttons.length !== 4 || tabs.buttons.some(([w, h, label, icon]) => w !== h || w > 44 || !label || !icon)) throw Error(`Tabs are not square labelled icon buttons: ${JSON.stringify(tabs.buttons)}`);
        if (tabs.gap > 24) throw Error(`Tabs are not aligned to the inline end of the panel: ${tabs.gap}px away at ${width}`);
      }
      const clippedButtons = await page.evaluate(() => [...document.querySelectorAll('.organized-view button')].filter(button => button.clientWidth > 0 && button.scrollWidth > button.clientWidth + 1).map(button => button.textContent.trim() || button.className));
      if (clippedButtons.length) throw Error(`${engine}: button text is clipped at ${width}${scale === 1 ? '' : ` with ${scale}x text`}: ${clippedButtons.join(', ')}`);
      const calendar = page.locator('.organized-calendar button');
      if (tab === 'Calendar' && await calendar.count() !== 42) throw Error('Calendar is not the real 42-cell inspector');
      if (tab === 'Calendar') {
        const height = await calendar.first().evaluate(el => el.getBoundingClientRect().height);
        if (height > 44) throw Error('Mobile theme inflated calendar cells');
      }
      if (tab === 'Task' || tab === 'InlineEditor') {
        const cards = await page.locator('.organized-card-title').allTextContents();
        if (cards[0] !== 'Description' || !cards.includes('Sources') || await page.locator('.organized-view .setting-item').count()) throw Error(`Task inspector lost its description-first cards: ${cards.join(',')}`);
        if (!(await page.locator('.organized-task-hero .organized-task-title').count())) throw Error('Task inspector is missing its titled hero');
        if (!(await page.locator('.organized-task-actions .organized-danger').count())) throw Error('Task inspector is missing its delete action');
        if (await page.locator('.organized-task-details').count() !== 1) throw Error('Task properties are fragmented instead of grouped into one details surface');
      }
      if (tab === 'Week' || tab === 'Day') {
        const segment = await page.evaluate(() => [...document.querySelectorAll('.organized-seg-button')].map(button => [button.getBoundingClientRect().height, button.getAttribute('aria-pressed')]));
        if (segment.length !== 3 || segment.some(([height]) => height > 40) || segment.filter(([, pressed]) => pressed === 'true').length !== 1) throw Error(`Calendar view switch is missing, inflated or has no active mode: ${JSON.stringify(segment)}`);
      }
      if (tab === 'Week') {
        const rows = await page.evaluate(() => [...document.querySelectorAll('.organized-week-row')].map(row => { const box = row.getBoundingClientRect(); const track = row.querySelector('.organized-week-track').getBoundingClientRect(); const blocks = [...row.querySelectorAll('.organized-week-block')].map(block => { const b = block.getBoundingClientRect(); return b.left >= track.left - 1 && b.right <= track.right + 1; }); return { height: box.height, track: track.width, inside: blocks.every(Boolean), blocks: blocks.length }; }));
        if (rows.length !== 7 || rows.some(row => row.height > 64 || row.track < 40 || !row.inside)) throw Error(`Week rows are inflated, cramped or their blocks leave the track: ${JSON.stringify(rows)}`);
        if (rows.reduce((sum, row) => sum + row.blocks, 0) < 3) throw Error('Week view lost its time blocks');
      }
      if (tab === 'Day') {
        const day = await page.evaluate(() => { const grid = document.querySelector('.organized-day-grid'); if (!grid) return null; const box = grid.getBoundingClientRect(); const blocks = [...grid.querySelectorAll('.organized-block')].map(block => { const b = block.getBoundingClientRect(); return b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1; }); const labels = [...grid.querySelectorAll('.organized-hour-label')].map(label => { const b = label.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }); return { blocks, labels, width: box.width, tasks: document.querySelectorAll('.organized-day-task').length, firstTask: document.querySelector('.organized-day-task').getBoundingClientRect().top, gridTop: box.top }; });
        if (!day) throw Error('Day view has no time grid'); if (day.blocks.length < 4 || day.blocks.some(inside => !inside)) throw Error(`Day blocks are missing or leave the grid: ${JSON.stringify(day.blocks)}`);
        if (day.labels.some(inside => !inside)) throw Error('Day hour labels leave the panel'); if (day.width < 120) throw Error(`Day grid is too narrow to read: ${day.width}px at ${width}`);
        const glyphs = await page.evaluate(() => [...document.querySelectorAll('.organized-block')].map(block => { const icon = block.querySelector('.organized-block-status'); if (!icon) return null; const b = block.getBoundingClientRect(); const i = icon.getBoundingClientRect(); return { inside: i.width > 0 && i.height > 0 && i.left >= b.left && i.right <= b.right + 0.5 && i.top >= b.top && i.bottom <= b.bottom + 0.5, name: icon.getAttribute('data-icon') }; }));
        if (glyphs.length < 4 || glyphs.some(glyph => !glyph || !glyph.inside || !glyph.name)) throw Error(`Day blocks lost their status icon or it leaves the block: ${JSON.stringify(glyphs)}`);
        const add = await page.evaluate(() => { const button = document.querySelector('.organized-head-action[aria-label="Add time worked"]'); if (!button) return null; const b = button.getBoundingClientRect(); const head = button.closest('.organized-section-head').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), inside: b.left >= head.left && b.right <= head.right + 1 }; });
        if (!add || !add.inside || add.w > 44 || add.h > 44) throw Error(`Day view lacks a compact Add time button: ${JSON.stringify(add)}`);
        if (day.tasks < 2 || day.firstTask >= day.gridTop) throw Error('Day view does not list its tasks above the time grid');
        const fold = await page.evaluate(() => { const head = document.querySelector('.organized-section-fold'); if (!head) return null; const box = head.getBoundingClientRect(); return { expanded: head.getAttribute('aria-expanded'), height: box.height, width: box.width, host: document.querySelector('.organized-panel').getBoundingClientRect().width }; });
        if (!fold || fold.expanded !== 'true' || fold.height > 44 || fold.width < fold.host - 2) throw Error(`Day task list has no compact, full-width fold button: ${JSON.stringify(fold)}`);
      }
      if (tab === 'NoteTasks') {
        if (await page.locator('.organized-list-card').count() !== 2) throw Error('Task tab is missing current-note tasks when no task is selected');
        if (await page.locator('.organized-list-card').first().innerText().then(text => !text.includes('A task title'))) throw Error('Current-note linked task title is missing');
        const headings = page.locator('.organized-heading-row'); if (await headings.count() !== 2) throw Error('Task tab is missing current-note headings');
        const boxes = await headings.evaluateAll(rows => rows.map(row => { const box = row.getBoundingClientRect(); const text = row.querySelector('.organized-heading-text').getBoundingClientRect(); return { height: box.height, text: text.left, right: text.right }; }));
        if (boxes.some(box => box.height > 40)) throw Error(`Mobile theme inflated heading rows: ${boxes.map(box => box.height)}`);
        const cardWidths = await page.locator('.organized-list-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
        if (!(cardWidths[1] < cardWidths[0])) throw Error('Tasks under a nested heading are not indented inside their parent heading');
      }
      if (tab === 'InlineEditor') {
        const field = page.locator('.organized-inline-editor'); if (await field.count() !== 1) throw Error('Inline editor field is missing');
        if (await page.locator('.organized-inline-actions').count()) throw Error('Inline editor still shows Save/Cancel actions; it autosaves');
        const fieldBox = await field.boundingBox(); if (!fieldBox) throw Error('Inline editor is not visible');
        if (await field.evaluate(el => getComputedStyle(el).borderTopWidth) !== '0px') throw Error('Inline editor draws its own border instead of matching the rendered text');
        if (fieldBox.width > width) throw Error(`Inline editor overflows its ${width}px host: ${fieldBox.width}`);
      }
      if (tab === 'Favorites') {
        const sections = await page.locator('.organized-section-title').allTextContents();
        if (sections.join(',') !== 'Favorites') throw Error(`Favorites tab lost its section: ${sections.join(',')}`);
        // Cards are filled by status (done and in progress green, in progress stronger; open neutral) and the icons follow.
        const cards = await page.evaluate(() => { const read = status => { const card = document.querySelector(`.organized-list-card[data-status="${status}"]`); if (!card) return null; const icon = card.querySelector('.organized-list-status'); return { icon: icon ? getComputedStyle(icon).color : null, fill: getComputedStyle(card).backgroundColor }; }; return { open: read('open'), completed: read('completed'), active: read('in_progress') }; });
        if (!cards.open || !cards.completed || !cards.active) throw Error(`Favorites tab is missing status cards: ${JSON.stringify(cards)}`);
        if (cards.completed.icon !== cards.active.icon || cards.open.icon === cards.completed.icon) throw Error(`Done and in-progress icons must share the green and open must differ: ${JSON.stringify(cards)}`);
        if (cards.open.fill === cards.completed.fill || cards.open.fill === cards.active.fill || cards.completed.fill === cards.active.fill) throw Error(`Cards are not filled by status: ${JSON.stringify(cards)}`);
      }
      if (tab === 'Projects') {
        const sections = await page.locator('.organized-section-title').allTextContents();
        if (sections.join(',') !== 'Projects,Canceled') throw Error(`Projects tab lost its sections: ${sections.join(',')}`);
        const hideButton = await page.evaluate(() => { const button = document.querySelector('.organized-hide-done'); if (!button) return null; const b = button.getBoundingClientRect(); const head = button.closest('.organized-section-head').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), inside: b.left >= head.left && b.right <= head.right + 1 }; });
        if (!hideButton || !hideButton.inside || hideButton.w > 44 || hideButton.h > 44) throw Error(`Projects tab lacks a compact hide-done button: ${JSON.stringify(hideButton)}`);
        if (await page.locator('.organized-list-card').count() < 2) throw Error('Projects tab did not render task cards');
        const chips = await page.evaluate(() => Array.from(document.querySelectorAll('.organized-chip[data-project]')).map(chip => { const dot = getComputedStyle(chip, '::before'); return { dot: dot.backgroundColor, size: [dot.width, dot.height] }; }));
        if (!chips.length || chips.some(chip => chip.dot === 'rgba(0, 0, 0, 0)' || chip.size[0] !== '8px' || chip.size[1] !== '8px')) throw Error(`Project labels lost their colour dot: ${JSON.stringify(chips)}`);
        // Open the colour list: each swatch is a small square holding an invisible full-size input, whatever the host does to colour inputs.
        await page.evaluate(() => { const details = document.querySelector('.organized-colors'); if (details) details.open = true; });
        const swatches = await page.evaluate(() => Array.from(document.querySelectorAll('.organized-color-swatch')).map(swatch => { const box = swatch.getBoundingClientRect(); const input = swatch.querySelector('input').getBoundingClientRect(); return { w: Math.round(box.width), h: Math.round(box.height), inside: input.left >= box.left - 1 && input.right <= box.right + 1 && input.top >= box.top - 1 && input.bottom <= box.bottom + 1, fill: getComputedStyle(swatch).backgroundColor }; }));
        if (!swatches.length || swatches.some(swatch => swatch.w !== swatch.h || swatch.w > 26 || !swatch.inside || swatch.fill === 'rgba(0, 0, 0, 0)')) throw Error(`Colour swatches are not small squares holding their input: ${JSON.stringify(swatches)}`);
        const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (overflowing) throw Error('Colour list overflows the panel');
        if (await page.locator('.organized-list-meta .organized-status-dot').count()) throw Error('Task rows still show a status dot next to their tinted card');
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
      if (tab === 'SessionModal') {
        const window = page.locator('.organized-modal-window'); const box = await window.boundingBox(); if (!box) throw Error('Session modal is not visible');
        if (box.y > 96 || box.width > width - 8) throw Error(`Session modal is misplaced: ${JSON.stringify(box)} at ${width}`);
        const fields = await page.evaluate(() => Array.from(document.querySelectorAll('.organized-modal-window input[type=datetime-local]')).map(input => { const b = input.getBoundingClientRect(); const w = document.querySelector('.organized-modal-window').getBoundingClientRect(); return b.left >= w.left - 1 && b.right <= w.right + 1; }));
        if (fields.length !== 2 || fields.some(inside => !inside)) throw Error(`Session fields leave the modal: ${fields}`);
        const buttons = await page.locator('.organized-modal-window .modal-content button').allTextContents(); if (buttons.join(',') !== 'Save,Open task,Delete') throw Error(`Session modal actions regressed: ${buttons}`);
        const clipped = await page.evaluate(() => { const w = document.querySelector('.organized-modal-window').getBoundingClientRect(); return Array.from(document.querySelectorAll('.organized-modal-window .modal-content button')).filter(b => { const r = b.getBoundingClientRect(); return r.right > w.right + 1 || r.left < w.left - 1 || r.bottom > w.bottom + 1; }).map(b => b.textContent); });
        if (clipped.length) throw Error(`Session modal actions are clipped at ${width}px: ${clipped}`);
      }
      if (tab === 'NoteModal') {
        const window = page.locator('.organized-modal-window'); const box = await window.boundingBox(); if (!box) throw Error('Note conversion modal is not visible');
        if (box.y > 96 || box.width > width - 8) throw Error(`Note conversion modal is misplaced: ${JSON.stringify(box)} at ${width}`);
        const inside = await page.evaluate(() => { const w = document.querySelector('.organized-modal-window').getBoundingClientRect(); return Array.from(document.querySelectorAll('.organized-modal-window input, .organized-modal-window select, .organized-modal-window .modal-content button')).filter(el => el.getBoundingClientRect().width > 0).map(el => { const r = el.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1; }); });
        if (inside.length < 6 || inside.some(ok => !ok)) throw Error(`Note conversion fields leave the modal at ${width}px: ${inside}`);
      }
      if (tab.endsWith('Settings')) {
        if (await page.locator('.setting-item .setting-item').count()) throw Error('Settings are nested inside a native setting row');
        const clipped = await page.locator('.organized-setting-row .setting-item-name').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth + 1));
        if (clipped) throw Error(`Unreadable clipped setting labels at ${width}`);
        if (width <= 390) {
          const gap = await page.locator('.organized-setting-row').evaluateAll(rows => Math.max(...rows.map(row => {
            const info = row.querySelector('.setting-item-info')?.getBoundingClientRect();
            const control = row.querySelector('.setting-item-control')?.getBoundingClientRect();
            return info && control ? control.top - info.bottom : 0;
          })));
          const padded = await page.locator('.organized-setting-row .setting-item-info').evaluateAll(infos => infos.some(info => info.getBoundingClientRect().height > [...info.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) + 16));
          if (padded) throw Error(`Mobile settings label area is taller than its text (wasted space) at width ${width}`);
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
      if (scale === 1 && width === 320 && !rtl) await page.screenshot({ path: `test-results/${engine}-${tab.toLowerCase()}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    }
  }
  }
  // Canary: a deliberately oversized child MUST be detected by the same probe.
  await page.addStyleTag({ content: '#app { inline-size: 2000px; min-block-size: 100px; }' });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))) throw Error('Overflow canary was invisible: layout gate cannot detect its defect');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`${engine}: sidebar, modern/legacy settings and real CM Live Preview/source; 4 widths × light/dark × LTR/RTL; overflow canary detected.`);
} finally { await browser.close(); }
