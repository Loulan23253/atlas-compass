import { ItemView, WorkspaceLeaf, Notice, Modal, TFile } from "obsidian";
import type AtlasPlugin from "./main";
import { AtlasMap } from "./map/MapView";
import { AddCityCommand } from "./commands/AddCity";
import { AtlasSidebar } from "./ui/Sidebar";
import { AtlasDashboard } from "./ui/Dashboard";
import type { City } from "./model/City";
import { cityKey, hasCoords } from "./model/City";
import { formatCoords, geocode, geocodeQueries, distanceKm } from "./util/Geo";
import { AIRPORTS } from "./data/airports";
import { sleep } from "./util/File";

export const VIEW_TYPE_ATLAS = "atlas-view";

type AtlasMode = "map" | "dashboard";

export class AtlasView extends ItemView {
  plugin: AtlasPlugin;
  mode: AtlasMode = "map";

  atlasMap!: AtlasMap;
  sidebar!: AtlasSidebar;
  dashboard!: AtlasDashboard;

  private body!: HTMLElement;
  private mapPane!: HTMLElement;
  private mapEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private dashboardEl!: HTMLElement;
  private mapTabEl!: HTMLElement;
  private dashTabEl!: HTMLElement;
  /** 统计条内容签名（展示的四个统计值），未变时跳过 DOM 重建 */
  private statsSig: string | null = null;
  /** 详情面板内容签名（当前城市的展示字段），未变时跳过重建 */
  private detailSig: string | null = null;
  /** 视图已关闭标记：一次性 invalidate 定时器在关闭后不再触碰已销毁的地图 */
  private closed = false;

  constructor(leaf: WorkspaceLeaf, plugin: AtlasPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ATLAS;
  }

  getDisplayText(): string {
    return "Atlas";
  }

  getIcon(): string {
    return "globe";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("atlas-container");

    const tabs = this.contentEl.createDiv("atlas-tabs");
    this.mapTabEl = tabs.createEl("button", { text: "🗺 地图", cls: "atlas-tab" });
    this.dashTabEl = tabs.createEl("button", { text: "📊 总览", cls: "atlas-tab" });
    this.mapTabEl.onclick = () => this.setMode("map");
    this.dashTabEl.onclick = () => this.setMode("dashboard");

    this.body = this.contentEl.createDiv("atlas-body");

    // Map pane: sidebar | map | detail.
    this.mapPane = this.body.createDiv("atlas-map-pane");
    this.sidebarEl = this.mapPane.createDiv("atlas-sidebar");
    this.mapEl = this.mapPane.createDiv("atlas-map");
    this.detailEl = this.mapPane.createDiv("atlas-detail");

    // Dashboard pane (hidden until the 总览 tab is active).
    this.dashboardEl = this.body.createDiv("atlas-dashboard");
    this.dashboard = new AtlasDashboard(
      this.plugin,
      this.dashboardEl,
      (c) => this.select(c),
      (country) => this.filterCountry(country),
      (c) => {
        void this.locate(c);
      },
    );

    this.sidebar = new AtlasSidebar(this.plugin, this.sidebarEl, (c) => this.select(c));
    this.sidebar.render();
    this.renderDetail(null);

    try {
      this.atlasMap = new AtlasMap(this.plugin, this.mapEl, (c) => this.select(c));
      this.renderStats();
      window.setTimeout(() => { if (!this.closed) this.atlasMap?.invalidate(); }, 100);
      window.setTimeout(() => { if (!this.closed) this.atlasMap?.invalidate(); }, 500);
    } catch (e) {
      console.error("Atlas map initialization failed", e);
      const status = this.mapEl.createDiv("atlas-map-status");
      status.textContent = "地图初始化失败，请打开开发者工具查看错误";
    }

    this.setMode(this.mode);
  }

  setMode(mode: AtlasMode): void {
    this.mode = mode;
    this.mapTabEl?.toggleClass("is-active", mode === "map");
    this.dashTabEl?.toggleClass("is-active", mode === "dashboard");
    this.mapPane?.toggleClass("is-hidden", mode !== "map");
    this.dashboardEl?.toggleClass("is-hidden", mode !== "dashboard");
    if (mode === "dashboard") this.dashboard?.render();
    window.setTimeout(() => { if (!this.closed) this.atlasMap?.invalidate(); }, 60);
  }

  filterCountry(country: string): void {
    this.sidebar.setSearch(country);
    this.setMode("map");
  }

  /** Auto-locate a single city/place via geocoding and refresh every pane. */
  async locate(city: City): Promise<void> {
    const url = this.plugin.settings.geocodeUrl || "https://photon.komoot.io/api";
    new Notice(`正在定位 ${city.name}…`);
    for (const query of geocodeQueries(city.name, city.country)) {
      const found = await geocode(query, url);
      if (found) {
        const file = this.app.vault.getAbstractFileByPath(city.note);
        if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm.lat = found.lat;
            fm.lng = found.lng;
          });
        }
        await this.plugin.db.scan();
        this.plugin.refreshViews();
        const updated =
          this.plugin.db.cities.find((c) => c.note === city.note) ??
          this.plugin.db.places.find((c) => c.note === city.note) ??
          { ...city, lat: found.lat, lng: found.lng };
        this.select(updated);
        new Notice(`已定位 ${city.name}：${formatCoords(found.lat, found.lng)}`);
        return;
      }
      await sleep(1100);
    }
    new Notice(`未能定位 ${city.name}`);
  }

  select(city: City): void {
    this.renderDetail(city);
    this.sidebar.setActive(city);
    this.atlasMap?.focus(city);
  }

  /** 打开城市笔记时的地图联动：仅聚焦地图与详情，不改动任何数据 */
  focusOnMap(city: City): void {
    if (!hasCoords(city)) return;
    this.atlasMap?.focus(city);
  }

  renderDetail(city: City | null): void {
    // 签名覆盖详情面板展示的全部字段（名称/国家/类型/坐标/访问/笔记）：
    // 同一城市重复选中、refresh 重扫后数据未变时直接复用现有 DOM。
    // 附近机场列表来自静态 AIRPORTS 表，只随坐标变化 → 已包含在签名内。
    const sig = city
      ? `${cityKey(city)}#${city.kind}#${city.name}#${city.country}` +
        `#${city.lat},${city.lng}#${city.visits}#${city.lastVisit}#${city.note}`
      : "";
    if (sig === this.detailSig && this.detailEl.childElementCount > 0) return;
    this.detailSig = sig;
    this.detailEl.empty();
    if (!city) {
      this.detailEl.createEl("h3", { text: "城市详情" });
      this.detailEl.createEl("p", { cls: "atlas-muted", text: "点击城市或地图标记查看" });
      return;
    }
    this.detailEl.createEl("h3", { text: city.name });
    this.row("类型", city.kind === "place" ? "地点" : "城市");
    this.row("国家", city.country);
    if (city.kind === "city") {
      this.row("访问次数", String(city.visits));
      this.row("最近访问", city.lastVisit || "—");
    }
    this.row("坐标", formatCoords(city.lat, city.lng));
    this.row("笔记", city.note);

    // 附近机场：150km 内最近的 3 个，点击飞达
    if (hasCoords(city)) {
      const nearby = AIRPORTS.map((a) => ({
        a,
        km: distanceKm({ lat: city.lat, lng: city.lng }, { lat: a.lat, lng: a.lng }),
      }))
        .filter((x) => x.km <= 150)
        .sort((x, y) => x.km - y.km)
        .slice(0, 3);
      if (nearby.length) {
        const sec = this.detailEl.createDiv("atlas-detail-airports");
        sec.createDiv({ cls: "atlas-detail-sub", text: "附近机场" });
        for (const { a, km } of nearby) {
          const row = sec.createDiv("atlas-airport-row");
          row.setText(`✈ ${a.name} · ${Math.round(km)} km`);
          row.title = "在地图上查看该机场";
          row.onclick = () => this.atlasMap?.flyToAirport(a);
        }
      }
    }

    const act = this.detailEl.createDiv("atlas-detail-actions");
    const open = act.createEl("button", { text: "打开笔记", cls: "mod-cta" });
    open.onclick = () => this.app.workspace.openLinkText(city.note, "", false);
    const edit = act.createEl("button", { text: "编辑" });
    edit.onclick = () => new AddCityCommand(this.plugin).run(city);
    const del = act.createEl("button", { text: "删除" });
    del.onclick = () => this.confirmDelete(city);
  }

  row(a: string, b: string): void {
    const r = this.detailEl.createDiv("atlas-detail-row");
    r.createSpan({ cls: "atlas-muted", text: a });
    r.createSpan({ text: b });
  }

  renderStats(): void {
    if (!this.mapEl) return;
    const s = this.plugin.db.getStats();
    // 签名只含实际展示的四个值（国家/城市/访问/里程）：
    // 日记防抖重扫等触发的 refresh 大多数据未变，直接复用现有 DOM
    const sig = `${s.countries}|${s.cities}|${s.visits}|${s.routeKm}`;
    const old = this.mapEl.querySelector(".atlas-statbar");
    if (sig === this.statsSig && old) return;
    this.statsSig = sig;
    old?.remove();
    const bar = this.mapEl.createDiv("atlas-statbar");
    for (const [k, v] of [
      ["国家", s.countries],
      ["城市", s.cities],
      ["访问", s.visits],
      ["里程", `${s.routeKm.toLocaleString()}km`],
    ] as [string, string | number][]) {
      const d = bar.createDiv("atlas-stat");
      d.textContent = `${k} ${v}`;
    }
  }

  refresh(): void {
    if (!this.sidebar || !this.mapEl || !this.atlasMap) {
      this.render();
      return;
    }
    this.sidebar.render();
    this.renderStats();
    this.atlasMap.render();
    this.dashboard?.render();
    if (this.atlasMap.selected) this.renderDetail(this.atlasMap.selected);
  }

  async confirmDelete(city: City): Promise<void> {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      const c = modal.contentEl;
      c.empty();
      c.createEl("h3", { text: "删除城市" });
      c.createEl("p", { text: `确定删除「${city.name}」及对应笔记？` });
      const b = c.createDiv();
      const no = b.createEl("button", { text: "取消" });
      no.onclick = () => modal.close();
      const yes = b.createEl("button", { text: "删除", cls: "mod-warning" });
      yes.onclick = async () => {
        const f = this.app.vault.getAbstractFileByPath(city.note);
        if (f) await this.app.fileManager.trashFile(f);
        modal.close();
        await this.plugin.db.scan();
        this.refresh();
        new Notice(`已删除 ${city.name}`);
      };
    };
    modal.open();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.atlasMap?.destroy();
  }
}
