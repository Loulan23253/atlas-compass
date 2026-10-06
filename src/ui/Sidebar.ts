import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { cityKey, hasCoords } from "../model/City";
import { Notice } from "obsidian";
import { AddCityCommand } from "../commands/AddCity";

/** Left-hand city list: search box + cities grouped by country. */
export class AtlasSidebar {
  plugin: AtlasPlugin;
  el: HTMLElement;
  onSelect: (city: City) => void;
  search = "";
  private listEl: HTMLElement | null = null;
  /** 列表内容签名（搜索词 + 每个条目的展示字段），未变时保留 DOM 只更新高亮 */
  private listSig: string | null = null;
  /** 当前高亮条目的 cityKey（setActive 记录，列表重建后重放） */
  private activeKey = "";

  constructor(plugin: AtlasPlugin, el: HTMLElement, onSelect: (city: City) => void) {
    this.plugin = plugin;
    this.el = el;
    this.onSelect = onSelect;
  }

  render(): void {
    // refresh() 在每次 db 重扫（日记打字 300ms 防抖）后都会调用；
    // 面板已构建且仍在文档中时不再整块清空重建，保留搜索框与列表 DOM
    if (this.listEl && this.el.contains(this.listEl)) {
      this.renderList();
      return;
    }
    this.el.empty();
    const head = this.el.createDiv("atlas-sidebar-header");
    head.createEl("h3", { text: "城市列表" });
    const add = head.createEl("button", { text: "+ 添加", cls: "atlas-add-btn" });
    add.onclick = () => new AddCityCommand(this.plugin).run();

    const input = this.el.createEl("input", {
      cls: "atlas-search-input",
      type: "text",
      placeholder: "搜索城市 / 国家…",
    });
    input.value = this.search;
    input.oninput = () => {
      this.search = input.value.trim().toLowerCase();
      this.renderList();
    };

    this.listEl = this.el.createDiv("atlas-city-list");
    this.listSig = null;
    this.renderList();
  }

  renderList(): void {
    if (!this.listEl) return;

    const cities = this.filtered();
    // 签名必须覆盖列表展示字段 + 点击闭包会消费的字段（visits/lastVisit 流向详情面板），
    // 数据未变时保留列表 DOM，只把高亮同步到当前选中项
    const sig =
      this.search +
      "\u0000" +
      cities
        .map(
          (c) =>
            `${cityKey(c)}#${c.name}#${c.country}#${c.visits}` +
            `#${c.lastVisit}#${hasCoords(c) ? 1 : 0}#${c.note}`,
        )
        .join("|");
    if (sig === this.listSig) {
      this.applyActive();
      return;
    }
    this.listSig = sig;
    this.listEl.empty();

    if (!cities.length) {
      this.listEl.createDiv({ cls: "atlas-muted", text: "还没有匹配的城市" });
      return;
    }

    const grouped = new Map<string, City[]>();
    for (const c of cities) {
      if (!grouped.has(c.country)) grouped.set(c.country, []);
      grouped.get(c.country)!.push(c);
    }

    for (const [country, list] of grouped) {
      const g = this.listEl.createDiv("atlas-country-group");
      g.createDiv({ cls: "atlas-country-title", text: country });
      for (const city of list) {
        const item = g.createDiv("atlas-city-item");
        item.textContent = city.name;
        item.dataset.key = cityKey(city);
        if (!hasCoords(city)) item.addClass("no-coord");
        item.onclick = () => this.onSelect(city);
        item.ondblclick = () => {
          if (!city.note) {
            new Notice(`「${city.name}」还没有笔记`);
            return;
          }
          void this.plugin.app.workspace.openLinkText(city.note, "", false);
        };
      }
    }

    this.applyActive();
  }

  /** Highlight the item for the given city (used when selecting from the map). */
  setActive(city: City | null): void {
    this.activeKey = city ? cityKey(city) : "";
    this.applyActive();
  }

  /** 把 is-active 高亮同步到 activeKey 对应的列表项（DOM 保留时也需同步） */
  private applyActive(): void {
    if (!this.listEl) return;
    const key = this.activeKey;
    this.listEl.querySelectorAll(".atlas-city-item").forEach((el) => {
      el.toggleClass("is-active", !!key && el instanceof HTMLElement && el.dataset.key === key);
    });
  }

  /** Set the search term from outside (e.g. clicking a country on the dashboard). */
  setSearch(term: string): void {
    this.search = term.trim().toLowerCase();
    const input = this.el.querySelector("input.atlas-search-input") as HTMLInputElement | null;
    if (input) input.value = this.search;
    this.renderList();
  }

  private filtered(): City[] {
    const q = this.search;
    if (!q) return this.plugin.db.cities;
    return this.plugin.db.cities.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
    );
  }
}
