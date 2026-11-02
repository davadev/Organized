// Screenshot-only stand-in for the `obsidian` module: the unit-test mock, plus a setIcon that draws real Lucide glyphs
// (the icon set Obsidian ships). The glyph table is scripts/screenshots/icons.json; see docs/testing.md.
export * from '../../src/tests/__mocks__/obsidian';
import icons from './icons.json';

type Part = [number, ...(string | number)[]];
const NS = 'http://www.w3.org/2000/svg';
const known = icons as Record<string, Part[]>;
export const missingIcons = new Set<string>();

export function setIcon(el: HTMLElement, name: string): void {
  el.setAttribute('data-icon', name);
  const parts = known[name];
  if (!parts) { missingIcons.add(name); return; }
  el.querySelector('svg')?.remove();
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `svg-icon lucide-${name}` })) svg.setAttribute(k, v);
  for (const [type, ...a] of parts) {
    const make = (tag: string, attrs: Record<string, string | number>) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); svg.appendChild(n); };
    if (type === 6) make('path', { d: a[0] });
    else if (type === 1) make('circle', { cx: a[0], cy: a[1], r: a[2] });
    else if (type === 0) make('line', { x1: a[0], y1: a[1], x2: a[2], y2: a[3] });
    else if (type === 5) make('rect', { x: a[0], y: a[1], width: a[2], height: a[3], rx: a[4] });
    else throw new Error(`icon ${name}: unknown element type ${type}`);
  }
  el.appendChild(svg);
}
