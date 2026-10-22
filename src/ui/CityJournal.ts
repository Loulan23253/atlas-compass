import { MarkdownRenderChild } from "obsidian";
import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { renderJournalReferences } from "./JournalReferences";
import { validDay, validVisit } from "../model/TravelInsights";

/** 让模板里的足迹随到访记录更新，避免正文里的次数与日期变旧。 */
export function renderCityJournal(el: HTMLElement, city: City | null, onDate?: (date: string) => void, hasDiary?: (date: string) => boolean): void {
  el.empty();
  el.addClass("atlas-city-journal");
  if (!city) {
    el.createDiv({ cls: "atlas-city-journal-hint", text: "城市足迹会在笔记完成建档后显示。" });
    return;
  }
  const dates = [...new Set(city.visitDates.filter(validVisit))].sort().reverse();
  const latest = [...dates, city.lastVisit].filter(validVisit).sort().pop();
  el.createDiv({ cls: "atlas-city-journal-title", text: "在这里留下的足迹" });
  if (city.visits > 0 || dates.length > 0) {
    el.createDiv({ cls: "atlas-city-journal-stat", text: `${Math.max(city.visits, dates.length)} 条到访记录${latest ? ` · 最近 ${latest}` : ""}` });
    if (dates.length > 1) el.createDiv({ cls: "atlas-city-journal-hint", text: `最早记录于 ${dates[dates.length - 1]}` });
    const renderDates = (parent: HTMLElement, entries: string[]): void => {
      const chips = parent.createDiv("atlas-city-journal-dates");
      for (const date of entries) {
        const isDay = validDay(date);
        if (isDay && onDate && (!hasDiary || hasDiary(date))) {
          const button = chips.createEl("button", { text: date, cls: "atlas-city-journal-date" });
          button.title = "查看这天的日记";
          button.onclick = () => onDate(date);
        } else {
          const label = chips.createSpan({ text: date, cls: "atlas-city-journal-date" });
          label.title = isDay ? "这天暂未找到日记" : "这条记录只精确到月份";
        }
      }
    };
    renderDates(el, dates.slice(0, 6));
    if (dates.length > 6) {
      const history = el.createEl("details", { cls: "atlas-journal-more" });
      history.createEl("summary", { text: `更早的 ${dates.length - 6} 条足迹` });
      renderDates(history, dates.slice(6));
    }
  } else el.createDiv({ cls: "atlas-city-journal-hint", text: "还没有到访记录，先记下想去的地方。" });
}

export class CityJournalBlock extends MarkdownRenderChild {
  constructor(el: HTMLElement, private plugin: AtlasPlugin, private sourcePath: string) {
    super(el);
  }

  onload(): void {
    const render = (): void => {
      const city = [...this.plugin.db.cities, ...this.plugin.db.places].find((c) => c.note === this.sourcePath) ?? null;
      renderCityJournal(this.containerEl, city, (date) => {
        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(date, this.sourcePath);
        if (file) void this.plugin.app.workspace.openLinkText(file.path, this.sourcePath, false);
      }, (date) => !!this.plugin.app.metadataCache.getFirstLinkpathDest(date, this.sourcePath));
      if (city) renderJournalReferences(this.containerEl, this.plugin, [city], this.sourcePath);
    };
    this.register(this.plugin.registerJournalRefresh(render));
    render();
  }
}
