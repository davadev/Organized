// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { ONBOARDING_STEPS } from "../onboarding";
import { FIGURE_IDS, renderFigure } from "../onboardingFigures";

installObsidianDom();
const css = readFileSync("styles.css", "utf8");
describe("onboarding content and figures", () => {
  it("has short, complete steps and only known figures", () => {
    expect(ONBOARDING_STEPS).toHaveLength(9);
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.trim()).not.toBe(""); expect(step.text.trim()).not.toBe("");
      expect(step.text.length).toBeLessThan(400);
      expect(step.text.split("`").length % 2).toBe(1); // backticks come in pairs
      if (step.figure) expect(FIGURE_IDS).toContain(step.figure);
    }
    // Every figure is used by some step, so none ships undrawn or unused.
    expect(new Set(ONBOARDING_STEPS.flatMap(s => s.figure ?? []))).toEqual(new Set(FIGURE_IDS));
  });
  it("draws every figure as aria-hidden decoration that uses only styled classes", () => {
    for (const id of FIGURE_IDS) {
      const host = createDiv(); const fig = renderFigure(host, id);
      expect(fig.getAttribute("aria-hidden")).toBe("true"); expect(fig.getAttribute("data-figure")).toBe(id);
      expect(fig.querySelectorAll("button, a, input").length).toBe(0);
      const classes = new Set([...fig.querySelectorAll("*"), fig].flatMap(el => [...el.classList]));
      // A renamed or removed class would leave the figure unstyled: fail here instead.
      for (const name of classes) if (name.startsWith("organized-")) expect(css, `${id}: .${name}`).toContain(`.${name}`);
    }
  });
  it("refuses an unknown figure instead of drawing nothing", () => { expect(() => renderFigure(createDiv(), "nope" as never)).toThrow(/Unknown onboarding figure/); });
  it("shows the calendar's three modes and the commands it names", () => {
    expect([...renderFigure(createDiv(), "calendar").querySelectorAll(".organized-welcome-fig-pill")].map(n => n.textContent)).toEqual(["Month", "Week", "Day"]);
    const main = readFileSync("src/main.ts", "utf8");
    for (const row of renderFigure(createDiv(), "commands").querySelectorAll(".organized-welcome-fig-row-role")) expect(main, row.textContent!).toContain(`name: "${row.textContent}`);
    const view = readFileSync("src/view.ts", "utf8"); for (const mode of ["Month", "Week", "Day"]) expect(view).toContain(`"${mode}"`);
    const settings = readFileSync("src/settings.ts", "utf8");
    for (const name of renderFigure(createDiv(), "settings").querySelectorAll(".organized-welcome-fig-row-name")) expect(settings, name.textContent!).toContain(`row("${name.textContent}"`);
  });
  it("names the panel's four tabs in order, as the panel shows them", () => {
    const names = [...renderFigure(createDiv(), "tabs").querySelectorAll(".organized-welcome-fig-tab-name")].map(n => n.textContent);
    expect(names).toEqual(["Calendar", "Task", "Projects", "Favorites"]);
    const view = readFileSync("src/view.ts", "utf8"); for (const name of names) expect(view).toContain(`["${name}", "`);
  });
});
