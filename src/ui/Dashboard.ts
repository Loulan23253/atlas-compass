import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { hasCoords } from "../model/City";
import { buildCountries } from "../model/Country";
import { computeCoverage } from "../model/Coverage";
import { loadAdminGeoJson } from "../map/GeoJsonLoader";
import { StatisticsPanel } from "./Statistics";
import { AddCityCommand } from "../commands/AddCity";

/**
 * Full-width overview tab: headline stats, recent visits, top cities,
 * country list and a warning list for entries without coordinates.
 */
export class AtlasDashboard {
  plugin: AtlasPlugin;
  el: HTMLElement;
  onSelect: (city: City) => void;
  onFilterCountry: (country: string) => void;
  onLocate: (city: City) => void;

  constructor(
    plugin: AtlasPlugin,
    el: HTMLElement,
    onSelect: (city: City) => void,
    onFilterCountry: (country: string) => void,
    onLocate: (city: City) => void,
  ) {
    this.plugin = plugin;
    this.el = el;
    this.onSelect = onSelect;
    this.onFilterCountry = onFilterCountry;
    this.onLocate = onLocate;
  }

  /** 整页内容签名：展示全部由城市/地点/建议/里程数据 + 年份派生，未变时跳过重建 */
  private renderSig: string | null = null;

  render(): void {
    const sig = this.dataSignature();
    // refresh 在每次 db 重扫后都会调用（含总览隐藏时）；数据未变时整页 DOM 复用，
    // 避免日记打字触发的 300ms 防抖重扫反复重建全部区块
    if (sig === this.renderSig && this.el.childElementCount > 0) return;
    this.renderSig = null; // 中途异常时下次仍会重建
    this.el.empty();
    this.el.createEl("h2", { text: "总览" });

    const stats = this.el.createDiv("atlas-dash-section");
    new StatisticsPanel(stats, this.plugin.db).render();

    this.renderCoverage(this.el.createDiv("atlas-dash-section"));
    this.renderSuggestions(this.el.createDiv("atlas-dash-section"));
    this.renderYearReport(this.el.createDiv("atlas-dash-section"));

    const recent = this.recentVisits();
    if (recent.length) {
      const sec = this.el.createDiv("atlas-dash-section");
      sec.createEl("h3", { text: "最近访问" });
      for (const c of recent) {
        this.cityRow(sec, c, c.lastVisit ? `访问 ${c.visits} 次 · ${c.lastVisit}` : `访问 ${c.visits} 次`);
      }
    }

    const top = this.topCities();
    if (top.length) {
      const sec = this.el.createDiv("atlas-dash-section");
      sec.createEl("h3", { text: "访问最多的城市" });
      for (const c of top) {
        this.cityRow(sec, c, `访问 ${c.visits} 次`);
      }
    }

    const countries = buildCountries(this.plugin.db.cities);
    if (countries.length) {
      const sec = this.el.createDiv("atlas-dash-section");
      sec.createEl("h3", { text: "国家" });
      for (const cn of countries) {
        const row = sec.createDiv("atlas-dash-row");
        row.createDiv("atlas-dash-label").textContent = `${cn.name}（${cn.cityCount} 城）`;
        row.createDiv("atlas-muted").textContent = cn.visits
          ? `访问 ${cn.visits} 次 · ${cn.lastVisit}`
          : "未访问";
        row.onclick = () => this.onFilterCountry(cn.name);
      }
    }

    const unlocated = [...this.plugin.db.cities, ...this.plugin.db.places].filter(
      (c) => !hasCoords(c),
    );
    if (unlocated.length) {
      const sec = this.el.createDiv("atlas-dash-section");
      sec.createEl("h3", { text: "未定位（缺少坐标）" });
      for (const c of unlocated) {
        const row = this.cityRow(sec, c, c.kind === "place" ? "地点" : "缺少坐标");
        const btn = row.createEl("button", { text: "定位", cls: "atlas-locate-btn" });
        btn.title = "自动识别该地点经纬度";
        btn.onclick = (e) => {
          e.stopPropagation();
          this.onLocate(c);
        };
      }
    }

    this.renderSig = sig; // 渲染完成，记录签名供下次复用
  }

  /**
   * 总览展示内容的完整依赖签名：
   * 统计卡/覆盖率/年度报告/最近与最多访问/国家列表/未定位 全部由
   * 城市+地点条目（路径/类型/坐标/到访/日期/名称/国家）、建议列表、
   * 路线与轨迹里程派生；加上当前年份（跨年时报告标题与筛选要变）。
   */
  private dataSignature(): string {
    const parts: string[] = [`y:${new Date().getFullYear()}`];
    for (const c of [...this.plugin.db.cities, ...this.plugin.db.places]) {
      parts.push(
        `${c.note}#${c.kind}#${c.lat},${c.lng}#${c.visits}` +
          `#${c.visitDates.join(",")}#${c.lastVisit}#${c.name}#${c.country}`,
      );
    }
    parts.push(`r:${this.plugin.db.route.totalKm}`, `t:${this.plugin.db.trackKm}`);
    for (const s of this.plugin.db.suggestions) parts.push(`s:${s.name}:${s.diaries}`);
    return parts.join("|");
  }

  /** 探索覆盖率：进度条 + 点击展开明细与邻近推荐（数据异步取，缓存后即时） */
  private renderCoverage(sec: HTMLElement): void {
    sec.createEl("h3", { text: "探索覆盖率" });
    const holder = sec.createDiv("atlas-coverage");
    holder.createDiv({ cls: "atlas-muted", text: "计算中…" });
    void (async () => {
      const [china, japan] = await Promise.all([
        loadAdminGeoJson("admin2", "CHN"),
        loadAdminGeoJson("admin2", "JPN"),
      ]);
      const items = computeCoverage(
        [...this.plugin.db.cities, ...this.plugin.db.places],
        china,
        japan,
      );
      holder.empty();
      if (!items.length) {
        holder.createDiv({ cls: "atlas-muted", text: "暂无可统计的数据" });
        return;
      }
      for (const it of items) {
        const pct = it.total ? Math.round((it.done / it.total) * 100) : 0;
        const row = holder.createDiv("atlas-coverage-row");
        const label = row.createDiv("atlas-coverage-label");
        label.createSpan({ text: it.label });
        label.createSpan({ cls: "atlas-muted", text: `  ${it.done}/${it.total}（${pct}%）` });
        const fill = row.createDiv("atlas-coverage-bar").createDiv("atlas-coverage-fill");
        fill.style.width = `${pct}%`;

        // 点击展开：全部城市（已去高亮）+ 邻近未去推荐
        if (it.allNames.length) {
          const detail = row.createDiv("atlas-coverage-detail");
          detail.style.display = "none";
          row.addClass("atlas-coverage-clickable");
          row.onclick = () => {
            const open = detail.style.display !== "none";
            detail.style.display = open ? "none" : "";
          };
          const chips = detail.createDiv("atlas-coverage-chips");
          for (const { name, visited } of it.allNames) {
            chips.createSpan({
              cls: `atlas-coverage-chip${visited ? " is-visited" : ""}`,
              text: name,
            });
          }
          if (it.nearbySuggestions.length) {
            detail.createDiv({
              cls: "atlas-coverage-sub",
              text: `邻近推荐：${it.nearbySuggestions
                .map((s) => `${s.name}（离${s.near} ${Math.round(s.km)}km）`)
                .join("、")}`,
            });
          }
          label.createSpan({ cls: "atlas-coverage-hint", text: "  ▸ 点击展开全部" });
        }
      }
    })().catch((e) => console.error("Atlas: coverage section failed:", e));
  }

  /** 日记里提到但未建档的城市，一键创建并自动定位 */
  private renderSuggestions(sec: HTMLElement): void {
    const suggestions = this.plugin.db.suggestions;
    if (!suggestions.length) {
      sec.remove();
      return;
    }
    sec.createEl("h3", { text: "日记中提到、还未建档的城市" });
    for (const s of suggestions.slice(0, 20)) {
      const row = sec.createDiv("atlas-dash-row");
      row.createDiv("atlas-dash-label").textContent = s.name;
      row.createDiv("atlas-muted").textContent = `${s.diaries} 篇日记提到`;
      const btn = row.createEl("button", { text: "创建并定位", cls: "atlas-locate-btn" });
      btn.onclick = (e) => {
        e.stopPropagation();
        new AddCityCommand(this.plugin).run(null, s.name, (city) => this.onLocate(city));
      };
    }
  }

  /** 年度旅行报告：当年新到访城市、到访次数、轨迹里程 */
  private renderYearReport(sec: HTMLElement): void {
    const year = new Date().getFullYear();
    const prefix = `${year}`;
    // 到访记录以该年开头的城市（月份 2025-09 与日期 2025-10-02 都算命中当年）
    const touched = [...this.plugin.db.cities, ...this.plugin.db.places].filter((c) =>
      c.visitDates.some((d) => d.startsWith(prefix)),
    );
    // 新到访：该年首次出现到访记录的城市
    const fresh = touched.filter((c) => {
      const before = c.visitDates.filter((d) => !d.startsWith(prefix));
      return before.length === 0;
    });
    const visitCount = touched.reduce(
      (n, c) => n + c.visitDates.filter((d) => d.startsWith(prefix)).length,
      0,
    );
    const trackKm = this.plugin.db.trackKm;

    sec.createEl("h3", { text: `${year} 旅行报告` });
    const grid = sec.createDiv("atlas-stat-grid");
    const cards: [string, string | number, string?][] = [
      ["新到访城市", fresh.length ? [...fresh].map((c) => c.name).join("、") : "—"],
      ["涉及城市", touched.length],
      ["到访记录", visitCount],
      ["轨迹里程", `${Math.round(trackKm).toLocaleString()} km`],
    ];
    for (const [label, value, hint] of cards) {
      const d = grid.createDiv("atlas-stat-card");
      d.createDiv("atlas-stat-value").textContent = String(value);
      d.createDiv("atlas-stat-label").textContent = hint ? `${label} · ${hint}` : label;
    }
  }

  private recentVisits(): City[] {
    return this.plugin.db.cities
      .filter((c) => c.lastVisit)
      .sort((a, b) => (a.lastVisit < b.lastVisit ? 1 : a.lastVisit > b.lastVisit ? -1 : 0))
      .slice(0, 10);
  }

  private topCities(): City[] {
    return [...this.plugin.db.cities]
      .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))
      .slice(0, 5);
  }

  private cityRow(parent: HTMLElement, city: City, meta: string): HTMLElement {
    const row = parent.createDiv("atlas-dash-row");
    row.createDiv("atlas-dash-label").textContent = `${city.name} · ${city.country}`;
    row.createDiv("atlas-muted").textContent = meta;
    row.onclick = () => this.onSelect(city);
    return row;
  }
}
