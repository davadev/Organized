/** Project colours are stored as `#rrggbb`, which is also what the browser's colour picker produces. */
export const COLOR = /^#[0-9a-fA-F]{6}$/;
export function validColor(value: unknown): value is string { return typeof value === "string" && COLOR.test(value); }
/** `"#ff8800"` as the space-separated channels CSS `rgb(r g b / alpha)` takes, so one colour can be washed to any strength. */
export function rgbOf(color: string): string {
  return [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)).join(" ");
}
