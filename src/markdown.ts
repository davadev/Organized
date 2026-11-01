import { App, Component, MarkdownRenderer } from "obsidian";
import { report } from "./service";

/** Render Markdown and explicitly route links from plugin-owned inspector/modal DOM. */
export async function renderMarkdownLinks(app: App, markdown: string, host: HTMLElement, sourcePath: string, component: Component): Promise<void> {
  await MarkdownRenderer.render(app, markdown, host, sourcePath, component);
  for (const anchor of host.querySelectorAll<HTMLAnchorElement>("a")) {
    anchor.addEventListener("click", event => {
      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;
      event.preventDefault(); event.stopPropagation();
      if (/^https?:\/\//i.test(href)) { window.open(href, "_blank", "noopener"); return; }
      const target = anchor.dataset.href ?? href;
      let linktext = target;
      try { linktext = decodeURIComponent(target); } catch { /* Keep literal link text when malformed. */ }
      linktext = linktext.replace(/\.md(?=($|#))/i, "");
      try { void app.workspace.openLinkText(linktext, sourcePath).catch(report); } catch (error) { report(error); }
    }, true);
  }
}
