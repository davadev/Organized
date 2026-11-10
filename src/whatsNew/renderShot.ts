import { SHOTS, type ShotId } from "./shots";

/** A real crop of the panel: the light and the dark picture, of which the theme shows one. */
export function renderShot(parent: HTMLElement, id: ShotId): HTMLElement {
  const shot = parent.createDiv({ cls: "organized-welcome-shot", attr: { "data-shot": id } });
  const { light, dark, alt } = SHOTS[id];
  shot.createEl("img", { cls: "organized-shot-light", attr: { src: light, alt } });
  shot.createEl("img", { cls: "organized-shot-dark", attr: { src: dark, alt: "" } });
  return shot;
}
