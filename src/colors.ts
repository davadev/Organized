/** Project colours are stored as `#rrggbb`, which is also what the browser's colour picker produces. */
export const COLOR = /^#[0-9a-fA-F]{6}$/;
export function validColor(value: unknown): value is string { return typeof value === "string" && COLOR.test(value); }

const toLinear = (c: number): number => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
/** Only called with channels already held inside 0..1 at a mid lightness, so the linear toe of the curve never applies. */
const toGamma = (c: number): number => 1.055 * c ** (1 / 2.4) - 0.055;
/** A colour as lightness, chroma and hue in OKLCH, where equal lightness and chroma look equally strong whatever the hue. */
export function oklchOf(color: string): { l: number; c: number; h: number } {
  const [r, g, b] = [1, 3, 5].map(at => toLinear(parseInt(color.slice(at, at + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
}
function srgbOf(l: number, c: number, h: number): number[] {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3];
}
/** Lightness and chroma range every project colour is drawn with, so projects look like one family. The hue is kept; lightness follows the pick halfway inside a narrow band, because a yellow forced to the lightness of a blue turns olive. */
export const SOFT = { lightness: 0.74, follow: 0.5, lowest: 0.66, highest: 0.88, minChroma: 0.07, maxChroma: 0.13, grayBelow: 0.025 };
/** The picked colour as space-separated `r g b` channels for CSS `rgb(r g b / alpha)`, drawn in the shared lightness band and a moderate chroma. A gray pick stays gray. */
export function softTint(color: string): string {
  const { l: picked, c, h } = oklchOf(color); const gray = c < SOFT.grayBelow;
  const lightness = Math.min(SOFT.highest, Math.max(SOFT.lowest, SOFT.lightness + SOFT.follow * (picked - SOFT.lightness)));
  const chroma = gray ? c : Math.min(SOFT.maxChroma, Math.max(SOFT.minChroma, c));
  const rgb = srgbOf(lightness, chroma, h);
  // Inside the lightness band and chroma range every hue fits the screen's gamut to within rounding; clamping only guards the last bit.
  return rgb.map(v => Math.round(Math.max(0, toGamma(Math.min(1, Math.max(0, v)))) * 255)).join(" ");
}
/** The picked colour itself as `r g b` channels, for the small dot beside a project's name. */
export function rgbOf(color: string): string { return [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)).join(" "); }
