// Maintainer-only, explicit local import. No network and never run during builds.
// Extract only checkbox SVG assets; no Things theme selectors enter the plugin.
import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync(process.argv[2], "utf8");
const markers = ['>', '<', '?', '!', '"', '-', '*', 'l', 'i', 'S', 'I', 'f', 'k', 'u', 'd', 'w', 'p', 'c', 'b', 'P', 'M', 'D'];
const icons = {};
for (const marker of markers) {
  const blocks = [...source.slice(source.indexOf('Checkbox styling & icons')).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const block = blocks.find(b => b[1].includes(`input[data-task='${marker}']:checked`) && /(?:-webkit-mask-image|background-image): url\(/.test(b[2]));
  const urls = [...(block?.[2] ?? '').matchAll(/(?:-webkit-mask-image|background-image): (url\(.*\));/g)];
  if (!urls.length) throw new Error(`Missing glyph ${marker}`);
  icons[marker] = urls.at(-1)[1];
}
const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
const header = `\n/* Bundled Things/Minimal checkbox artwork.\n${notices.replaceAll('*/', '* /')}\n*/\n`;
const rules = Object.entries(icons).map(([marker, url]) => {
  const escaped = marker === '"' ? '\\"' : marker;
  return `.organized-glyph[data-marker="${escaped}"], .organized-task-line .organized-checkbox[data-organized-marker="${escaped}"] { mask-image: ${url}; }`;
}).join('\n');
const base = readFileSync('styles.css', 'utf8').split('/* Bundled Things/Minimal checkbox artwork.')[0];
writeFileSync('styles.css', `${base}${header}${rules}\n.organized-glyph[data-marker="/"], .organized-task-line .organized-checkbox[data-organized-marker="/"] { border: 1px solid currentColor; background: linear-gradient(90deg, currentColor 50%, transparent 50%); }\n`);
