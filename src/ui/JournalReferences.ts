import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { relatedJournals, type JournalReference } from "../model/JournalReferences";
import { str } from "../util/File";

export function renderJournalReferences(el: HTMLElement, plugin: AtlasPlugin, cities: City[], sourcePath: string): void {
  const reports: JournalReference[] = [];
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(`${plugin.settings.travelFolder}/`) || file.path === sourcePath) continue;
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "trip" && fm?.type !== "year-review") continue;
    reports.push({ path: file.path, name: file.basename, type: fm.type, start: str(fm.start).slice(0, 10), end: str(fm.end).slice(0, 10), year: str(fm.year), mtime: file.stat.mtime });
  }
  const related = relatedJournals(cities, reports);
  if (!related.length) return;
  const section = el.createDiv("atlas-journal-references");
  section.createDiv({ cls: "atlas-city-journal-title", text: "再翻几页" });
  const renderLinks = (parent: HTMLElement, entries: JournalReference[]): void => {
    const links = parent.createDiv("atlas-journal-reference-links");
    for (const report of entries) {
      const text = report.type === "year-review" ? `${report.year} 年度回顾` : report.name;
      const link = links.createEl("a", { text, cls: "internal-link", href: report.path });
      link.setAttribute("data-href", report.path);
      link.title = report.type === "trip" ? `${report.start} — ${report.end}` : "打开这一年的足迹与故事";
      link.onclick = (event) => {
        event.preventDefault();
        void plugin.app.workspace.openLinkText(report.path, sourcePath, event.ctrlKey || event.metaKey);
      };
    }
  };
  renderLinks(section, related.slice(0, 5));
  if (related.length > 5) {
    const more = section.createEl("details", { cls: "atlas-journal-more" });
    more.createEl("summary", { text: `继续翻阅 · 还有 ${related.length - 5} 份手记` });
    renderLinks(more, related.slice(5));
  }
}
