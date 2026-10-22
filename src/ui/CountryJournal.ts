import { MarkdownRenderChild, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { countryJournal } from "../model/CountryJournal";
import { str } from "../util/File";
import { renderJournalReferences } from "./JournalReferences";

export class CountryJournalBlock extends MarkdownRenderChild {
  constructor(el: HTMLElement, private plugin: AtlasPlugin, private sourcePath: string) { super(el); }

  onload(): void {
    const render = (): void => {
      const el = this.containerEl;
      el.empty();
      el.addClass("atlas-country-journal");
      const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
      if (!(file instanceof TFile)) return;
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      const country = str(fm?.name, file.basename);
      const data = countryJournal([...this.plugin.db.cities, ...this.plugin.db.places], country);
      el.createDiv({ cls: "atlas-city-journal-title", text: "把这些目的地，串成自己的地图" });
      const metrics = el.createDiv("atlas-journal-metrics");
      const counts: Array<[number, string]> = [[data.cities.length, "到访城市"]];
      if (data.places.length) counts.push([data.places.length, "到访地点笔记"]);
      if (data.wishlist.length) counts.push([data.wishlist.length, "想去的收藏"]);
      for (const [count, label] of counts) {
        const item = metrics.createDiv("atlas-journal-metric");
        item.createSpan({ cls: "atlas-journal-metric-value", text: String(count) });
        item.createSpan({ cls: "atlas-journal-metric-label", text: label });
      }
      if (data.latest) el.createDiv({ cls: "atlas-city-journal-hint", text: `最近有记录的到访：${data.latest}` });
      for (const [title, entries] of [["走过的城市", data.cities], ["到访的地点笔记", data.places], ["还想去", data.wishlist]] as const) {
        if (!entries.length) continue;
        const section = el.createDiv("atlas-country-section");
        section.createEl("h4", { text: title });
        const links = section.createDiv("atlas-country-links");
        for (const entry of entries) {
          const link = links.createEl("a", { text: entry.name, cls: "internal-link", href: entry.note });
          link.setAttribute("data-href", entry.note);
          link.onclick = (event) => {
            event.preventDefault();
            void this.plugin.app.workspace.openLinkText(entry.note, this.sourcePath, event.ctrlKey || event.metaKey);
          };
        }
      }
      if (!data.cities.length && !data.places.length && !data.wishlist.length) {
        el.createDiv({ cls: "atlas-city-journal-hint", text: "在 Atlas 添加或导入这个国家的城市后，会自动汇集到这里。" });
      }
      if (this.plugin.db.trackStays > 0) {
        const gps = el.createDiv("atlas-country-gps");
        gps.createDiv({ cls: "atlas-city-journal-title", text: "轨迹里的停留 · 全库统计" });
        gps.createDiv({ cls: "atlas-city-journal-stat", text: `${this.plugin.db.trackStays} 段停留 · ${this.plugin.db.trackStayDays} 天有记录` });
        gps.createDiv({ cls: "atlas-city-journal-hint", text: "同一地点可能多次停留。这些记录尚未按国家归类，不计入上方的地点笔记数量。" });
      }
      renderJournalReferences(el, this.plugin, [...data.cities, ...data.places], this.sourcePath);
    };
    this.register(this.plugin.registerJournalRefresh(render));
    render();
  }
}
