import L from "leaflet";
import { Notice, Menu, Modal, Setting, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { cityKey, hasCoords } from "../model/City";
import { ensureFolder } from "../util/File";
import { cityTemplate } from "../util/Template";
import { stripSuffix } from "../model/Coverage";
import { AIRPORTS, type Airport } from "../data/airports";
import { distanceKm } from "../util/Geo";
import { geohashBounds } from "../model/TrackClean";
import {
  loadAdminGeoJson,
  getCentroid,
  getFeatureBbox,
  pointInFeature,
  isValidIso3,
  ISO3_ZH_FALLBACK,
  type AdminGeoJson,
  type AdminFeature,
  type AdminProperties,
} from "./GeoJsonLoader";

/** 行政区划样式 */
const STYLES: Record<string, L.PathOptions> = {
  country: {
    color: "#455a64",
    weight: 2,
    fillColor: "#e0e0e0",
    fillOpacity: 0.3,
    opacity: 0.8,
  },
  admin1: {
    color: "#667eea",
    weight: 1.5,
    fillColor: "#e8eaf6",
    fillOpacity: 0.4,
    opacity: 0.8,
  },
  admin2: {
    color: "#7e57c2",
    weight: 1,
    fillColor: "#f3e5f5",
    fillOpacity: 0.5,
    opacity: 0.8,
  },
};

const HOVER_STYLE: L.PathOptions = {
  weight: 3,
  fillOpacity: 0.7,
  color: "#1565c0",
};

const SELECTED_STYLE: L.PathOptions = {
  weight: 4,
  fillOpacity: 0.6,
  color: "#d32f2f",
};

/** 点亮样式（去过的区域：暖金色系，按层级递深） */
const LIT_STYLES: Record<string, L.PathOptions> = {
  country: { color: "#f08c00", weight: 2, fillColor: "#ffd43b", fillOpacity: 0.4, opacity: 0.9 },
  admin1: { color: "#e8590c", weight: 1.5, fillColor: "#ffa94d", fillOpacity: 0.5, opacity: 0.9 },
  admin2: { color: "#e8590c", weight: 1, fillColor: "#ffe8cc", fillOpacity: 0.65, opacity: 0.9 },
};

type RenderLevel = "country" | "admin1" | "admin2";
type RenderMode = "auto" | "country" | "admin1" | "admin2";

/** 交通方式配色 */
const MODE_COLORS: Record<number, string> = {
  0: "#868e96",
  1: "#51cf66",
  2: "#339af0",
  3: "#fd7e14",
  4: "#e03131",
  5: "#be4bdb",
  6: "#f06595",
  7: "#845ef7",
  8: "#c92a2a",
};

/** 轨迹 GeoJSON 文件结构 */
interface TrackGeoJson {
  features?: Array<{
    properties?: {
      inferred?: boolean;
      cells?: string[];
      ts?: number[];
      segments?: Array<{ s: number; e: number; m: number }>;
    };
    geometry?: { type: string; coordinates: number[][] };
  }>;
}

/** 覆盖率层只读 features[].properties.cells，其余字段忽略 */
type CoverageGeo = { features?: Array<{ properties?: { cells?: string[] } }> };

/** 自动模式下各层级的缩放阈值，与 README 一致：≤4 国家、5-7 省级、≥8 市级 */
const AUTO_LEVEL = (zoom: number): RenderLevel =>
  zoom <= 4 ? "country" : zoom <= 7 ? "admin1" : "admin2";

/** 视口内最多同时显示的名称标签数（防止低层级下标签铺满屏幕） */
const MAX_LABELS = 150;

/** 点击选中时缓存在行政区划要素层实例上的元数据（避免 as any 存取） */
interface AtlasLayerMeta {
  _atlasStyle?: L.PathOptions;
  _atlasLevel?: string;
  _atlasFeature?: AdminFeature;
}

/** 带元数据的行政区划要素层 */
type AtlasPath = L.Path & AtlasLayerMeta;

export class AtlasMap {
  plugin: AtlasPlugin;
  container: HTMLElement;
  map: L.Map;
  markers: L.Marker[] = [];
  selected: City | null = null;
  onSelect: (c: City) => void;

  private routeLayer: L.LayerGroup | null = null;
  private routeRenderer: L.SVG | null = null;
  private routesVisible = true;
  private trackLayer: L.LayerGroup | null = null;
  private coverageLayer: L.LayerGroup | null = null;
  private labelDebounce: number | null = null;
  private activePopupEl: HTMLElement | null = null;
  private minZoomObserver: ResizeObserver | null = null;
  private hiLoaded = new Set<string>();
  private pinnedLabel: L.Marker | null = null;
  private coverageSig = "";
  private trackRenderer: L.SVG | null = null;
  private tracksVisible = true;
  private coverageVisible = false;
  private trackCache = new Map<string, { mtime: number; geo: unknown }>();
  private trackToken = 0;
  private trackSig = "";
  private airportLayer: L.LayerGroup | null = null;
  private airportsVisible = true;
  /** 机场层签名（可见开关 + 常用城市 + 家坐标），不变时整层复用 */
  private airportSig = "";
  /** 城市标记签名（键/坐标/到访/类型/笔记路径/到访日期），路线层也依赖它 */
  private markerSig: string | null = null;
  /** 路线层签名（可见开关 + 城市数据签名） */
  private routesSig: string | null = null;
  /** 标签层签名（层级/视口/容器尺寸/选中项/到访数据），不变时跳过重建 */
  private labelSig: string | null = null;
  /** 图标缓存：icon 只由 (类型, 是否到访) 决定，最多 4 个实例 */
  private iconCache = new Map<string, L.DivIcon>();
  /** 覆盖率层异步渲染令牌（读取文件期间被关闭/重渲染时丢弃结果） */
  private coverageToken = 0;
  /** 覆盖率层专用 canvas 渲染器：复用避免每次重建往窗格里堆 canvas */
  private coverageRenderer: L.Canvas | null = null;
  /** fitMinZoom 最近一次计算结果（resize 事件与 ResizeObserver 会双触发） */
  private fittedMinZoom = -1;
  /** zoom 动画进行中（zoomstart→zoomend 之间），期间 renderGeoJson 推迟到动画结束 */
  private zoomAnimating = false;
  /** zoomstart 时刻：渲染抑制的时间上界（动画异常中断导致 zoomend 缺失时自愈） */
  private zoomStartedAt = 0;

  private geoJsonLayers: L.GeoJSON | null = null;
  /** 共享的 canvas 渲染器（大面要素比 SVG 快；复用避免每次渲染堆积窗格）。
   *  必须在 L.map 创建之后再初始化，故不用类字段初始化器 */
  private canvasRenderer: L.Renderer | null = null;
  private labelLayer: L.LayerGroup | null = null;
  private geoJsonData: Map<string, AdminGeoJson> = new Map();
  private selectedRegion: L.Layer | null = null;
  private renderMode: RenderMode = "auto";
  private initialized = false;
  private currentLevel: RenderLevel = "country";
  /** 当前正在渲染的要素数据（市级为多国合并数据，单独保存） */
  private currentData: AdminGeoJson | null = null;
  /** 已加载的市级数据集（按国家 ISO3），渲染时合并为单层 */
  private admin2Sets = new Map<string, AdminGeoJson>();
  private mergedAdmin2: AdminGeoJson | null = null;

  constructor(plugin: AtlasPlugin, container: HTMLElement, onSelect: (c: City) => void) {
    this.plugin = plugin;
    this.container = container;
    this.onSelect = onSelect;

    this.map = L.map(container, {
      center: plugin.settings.defaultMapCenter,
      zoom: plugin.settings.defaultZoom,
      zoomControl: true,
      worldCopyJump: false, // 环绕副本处没有数据（空白），不允许拖出地图外
      minZoom: 2,
      maxZoom: 12, // 矢量边界再放大也没有细节了
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1.0, // 硬钳制：拖不动，不是橡皮筋
    });
    // minZoom 随视口动态抬升：世界图（256×2^z px）必须盖满视口，否则两侧露空白
    // 用 ResizeObserver 盯容器——构造时视图可能尚未展开（尺寸为 0）
    const fitMinZoom = () => {
      const size = this.map.getSize();
      if (size.x < 50 || size.y < 50) return; // 容器还没展开，等下一次尺寸变化
      const z = Math.max(2, Math.ceil(Math.log2(Math.max(size.x, size.y) / 256)));
      if (z === this.fittedMinZoom) return; // resize 事件与 ResizeObserver 双触发时去重
      this.fittedMinZoom = z;
      this.map.setMinZoom(z);
    };
    fitMinZoom();
    this.map.on("resize", fitMinZoom);
    const minZoomObserver = new ResizeObserver(() => fitMinZoom());
    minZoomObserver.observe(container);
    this.minZoomObserver = minZoomObserver;
    this.canvasRenderer = L.canvas({ padding: 0.5 });

    this.addOceanBackground();
    this.addControls();
    this.addContextMenu();
    this.initializeMap().catch((e) => {
      console.error("Atlas: initializeMap failed:", e);
      this.showStatus(`地图数据加载失败：${(e as Error).message}`);
    });

    try {
      this.render();
    } catch (e) {
      console.error("Atlas: initial render failed:", e);
    }
    this.invalidate();
    window.setTimeout(() => this.invalidate(), 300);
    window.setTimeout(() => this.invalidate(), 1000);
  }

  private addOceanBackground(): void {
    L.rectangle([[-90, -180], [90, 180]], {
      color: "#b3e5fc",
      weight: 0,
      fillColor: "#b3e5fc",
      fillOpacity: 0.3,
      interactive: false,
    }).addTo(this.map);
  }

  private addControls(): void {
    const fit = new L.Control({ position: "topright" });
    fit.onAdd = () => {
      const btn = L.DomUtil.create("button", "atlas-fit-btn");
      btn.setAttribute("type", "button");
      btn.title = "显示全部";
      btn.textContent = "⌖";
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => this.fitAll();
      return btn;
    };
    fit.addTo(this.map);

    const routeToggle = new L.Control({ position: "topleft" });
    routeToggle.onAdd = () => {
      const btn = L.DomUtil.create("button", "atlas-route-btn");
      btn.setAttribute("type", "button");
      btn.title = "显示/隐藏旅行路线";
      btn.textContent = "➤";
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => {
        this.routesVisible = !this.routesVisible;
        btn.classList.toggle("is-off", !this.routesVisible);
        this.renderRoutes();
      };
      return btn;
    };
    routeToggle.addTo(this.map);

    const trackToggle = new L.Control({ position: "topleft" });
    trackToggle.onAdd = () => {
      const btn = L.DomUtil.create("button", "atlas-route-btn atlas-track-btn");
      btn.setAttribute("type", "button");
      btn.title = "显示/隐藏 GPS 轨迹（Travel/轨迹/）";
      btn.textContent = "GPS";
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => {
        this.tracksVisible = !this.tracksVisible;
        btn.classList.toggle("is-off", !this.tracksVisible);
        void this.renderTracks();
        void this.renderCoverage();
      };
      return btn;
    };
    trackToggle.addTo(this.map);

    const airportToggle = new L.Control({ position: "topleft" });
    airportToggle.onAdd = () => {
      const btn = L.DomUtil.create("button", "atlas-route-btn atlas-airport-btn");
      btn.setAttribute("type", "button");
      btn.title = "显示/隐藏常用机场";
      btn.textContent = "✈";
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => {
        this.airportsVisible = !this.airportsVisible;
        btn.classList.toggle("is-off", !this.airportsVisible);
        this.renderAirports();
      };
      return btn;
    };
    airportToggle.addTo(this.map);

    const coverageToggle = new L.Control({ position: "topleft" });
    coverageToggle.onAdd = () => {
      const btn = L.DomUtil.create("button", "atlas-route-btn atlas-coverage-btn");
      btn.setAttribute("type", "button");
      btn.title = "显示/隐藏国土覆盖率格点（导入轨迹后可用）";
      btn.textContent = "格";
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => {
        this.coverageVisible = !this.coverageVisible;
        btn.classList.toggle("is-off", !this.coverageVisible);
        void this.renderCoverage();
      };
      return btn;
    };
    coverageToggle.addTo(this.map);

    const levelCtrl = new L.Control({ position: "topleft" });
    levelCtrl.onAdd = () => {
      const div = L.DomUtil.create("div", "atlas-level-control");
      const select = div.createEl("select", { attr: { id: "atlas-level-select" } });
      const levelOptions: Array<[RenderMode, string]> = [
        ["auto", "自动层级"],
        ["country", "国家级"],
        ["admin1", "省级"],
        ["admin2", "市级"],
      ];
      for (const [value, label] of levelOptions) {
        const opt = select.createEl("option", { text: label });
        opt.value = value;
      }
      L.DomEvent.disableClickPropagation(div);

      select.onchange = () => {
        this.renderMode = select.value as RenderMode;
        void this.renderGeoJson();
      };

      return div;
    };
    levelCtrl.addTo(this.map);

    this.map.on("moveend", () => {
      if (this.initialized) {
        if (this.labelDebounce !== null) window.clearTimeout(this.labelDebounce);
        this.labelDebounce = window.setTimeout(() => this.updateLabels(), 120);
      }
    });
    
    // zoom 动画期间抑制行政区划整层重建：zoomstart→zoomend 之间到达的 renderGeoJson
    // 请求（LOD 高精度热切换、市级合并数据更新、层级切换）统一推迟到 zoomend 补跑，
    // 避免在过渡帧里重绘 2000+ 要素造成闪烁丢帧。zoomstart/zoomend 在 Leaflet 中对每次
    // 缩放变化成对触发（含非动画缩放，见 Map._moveStart/_moveEnd），renderGeoJson 内另有
    // 1s 时间上界兜底动画异常中断的情况。
    this.map.on("zoomstart", () => {
      this.zoomAnimating = true;
      this.zoomStartedAt = Date.now();
    });

    this.map.on("zoomend", () => {
      this.zoomAnimating = false;
      if (this.initialized) {
        void this.renderGeoJson();
      }
    });

    // 弹窗打开时淡出被压在身后的地名标签（popup 层级被主题干扰时的保底体验）
    this.map.on("popupopen", (e) => {
      this.activePopupEl = e.popup.getElement() ?? null;
      this.hideLabelsUnder(this.activePopupEl, true);
      // autoPan 平移动画（~0.25s）结束后按最终位置重算一次
      window.setTimeout(() => this.hideLabelsUnder(this.activePopupEl, true), 280);
    });
    this.map.on("popupclose", () => {
      this.activePopupEl = null;
      this.hideLabelsUnder(null, false);
    });
  }

  /** 把落在弹窗矩形内的标签设为透明/恢复（rect 为 null 时全部恢复） */
  private hideLabelsUnder(popupEl: HTMLElement | null | undefined, hide: boolean): void {
    if (!this.labelLayer) return;
    let rect: { left: number; top: number; right: number; bottom: number } | null = null;
    if (popupEl) {
      const pr = popupEl.getBoundingClientRect();
      const cr = this.map.getContainer().getBoundingClientRect();
      rect = { left: pr.left - cr.left, top: pr.top - cr.top, right: pr.right - cr.left, bottom: pr.bottom - cr.top };
    }
    this.labelLayer.eachLayer((layer) => {
      const marker = layer as L.Marker;
      const ll = marker.getLatLng?.();
      if (!ll) return;
      const pt = this.map.latLngToContainerPoint(ll);
      const inside =
        !!rect && pt.x >= rect.left - 70 && pt.x <= rect.right + 70 && pt.y >= rect.top - 14 && pt.y <= rect.bottom + 14;
      const el = marker.getElement();
      if (el) el.style.opacity = inside && hide ? "0" : "";
    });
  }

  /** 添加右键菜单（Obsidian Menu，自动适配主题；移动端 Leaflet 长按同样触发 contextmenu） */
  private addContextMenu(): void {
    this.map.on("contextmenu", (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("添加城市")
          .setIcon("map-pin")
          .onClick(() => this.showAddCityModal(lat, lng)),
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
          .setIcon("copy")
          .onClick(() => {
            void navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            new Notice("坐标已复制到剪贴板");
          }),
      );
      menu.showAtMouseEvent(e.originalEvent);
    });
  }

  /** 显示添加城市对话框 */
  /**
   * 反查坐标所在行政区（用内存中已加载的市级/国家级数据）。
   * 命中市级数据集时返回 city；否则回退国家级；公海等返回空国家名。
   */
  private reverseLocate(lat: number, lng: number): { city?: string; country: string } {
    const countries = this.geoJsonData.get("country");
    const byIso = new Map<string, string>();
    if (countries) {
      for (const f of countries.features) {
        const p = f.properties;
        if (p?.iso3 && !byIso.has(p.iso3)) byIso.set(p.iso3, p.nameLocal || p.name || p.iso3);
      }
    }
    const nameOf = (iso3: string): string => ISO3_ZH_FALLBACK[iso3] ?? byIso.get(iso3) ?? iso3;

    for (const [iso3, geo] of this.admin2Sets) {
      for (const f of geo.features) {
        if (!pointInFeature(lng, lat, f)) continue;
        const name = f.properties?.name;
        return { city: name || undefined, country: nameOf(iso3) };
      }
    }
    for (const f of countries?.features ?? []) {
      if (!pointInFeature(lng, lat, f)) continue;
      const p = f.properties;
      if (isValidIso3(p?.iso3)) return { country: nameOf(p.iso3) };
    }
    return { country: "" };
  }

  private showAddCityModal(lat: number, lng: number): void {
    const region = this.reverseLocate(lat, lng);
    const modal = new AddCityModal(this.plugin, lat, lng, (city) => {
      void (async () => {
        try {
        // 创建文件路径
        const travelFolder = this.plugin.settings.travelFolder || "Travel";
        const folder = `${travelFolder}/${city.country}`;
        const path = `${folder}/${city.name}.md`;
        
        // 检查文件是否已存在
        if (this.plugin.app.vault.getAbstractFileByPath(path)) {
          new Notice("该城市已存在");
          return;
        }

        // 创建文件夹
        await ensureFolder(this.plugin.app, folder);
        
        // 使用与加号添加相同的模板
        const content = cityTemplate(city.name, city.country, city.lat, city.lng);
        
        // 创建文件
        await this.plugin.app.vault.create(path, content);
        
        // 等待文件系统同步
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        
        // 刷新数据库
        await this.plugin.db.scan();
        
        // 刷新视图
        this.plugin.refreshViews();
        
        new Notice(`已添加城市: ${city.name}`);
      } catch (e) {
        console.error("Atlas: Failed to create city:", e);
        new Notice(`创建城市失败: ${(e as Error).message}`);
      }
      })();
    }, region);
    modal.open();
  }

  private async initializeMap(): Promise<void> {
    try {
      this.showStatus("正在加载世界地图数据...");
      const countries = await loadAdminGeoJson("country");
      this.geoJsonData.set("country", countries);
      // 启动只加载简化版（LOD）：解析快、内存省；高缩放时再懒加载全精度
      const admin1 = await loadAdminGeoJson("admin1", undefined, "lo");
      this.geoJsonData.set("admin1", admin1);
      if (!admin1.features.length) {
        this.showStatus("省/市级数据缺失：把 data/ 文件夹复制到插件目录并重启 Obsidian（世界轮廓仍可浏览）");
      }
      const chinaAdmin2 = await loadAdminGeoJson("admin2", "CHN", "lo");
      if (chinaAdmin2.features.length) this.admin2Sets.set("CHN", chinaAdmin2);
      const japanAdmin2 = await loadAdminGeoJson("admin2", "JPN", "lo");
      if (japanAdmin2.features.length) this.admin2Sets.set("JPN", japanAdmin2);
      this.initialized = true;
      this.renderGeoJson();
      this.showStatus("世界地图加载完成");
    } catch (e) {
      console.error("Atlas: Failed to initialize map:", e);
      this.showStatus("地图数据加载失败");
    }
  }

  /** ===== 点亮地图：去过的区域着色 ===== */
  private litNames = new Set<string>();
  private litPoints: { name: string; lat: number; lng: number; visits: number; lastVisit: string }[] = [];
  private litCountrySet = new Set<string>();
  private litSig = "";
  /** isLit 结果缓存：同一 litSig + 层级下每要素只算一次（style 回调/弹窗装配/悬停恢复共享），
   *  litSig 变化（到访数据更新）后按签名失效重算 */
  private litCache = new WeakMap<AdminFeature, { sig: string; level: RenderLevel; lit: boolean }>();

  /** 计算点亮集合（有坐标且有到访记录的笔记），按数据签名缓存 */
  private computeLit(): void {
    const all = [...this.plugin.db.cities, ...this.plugin.db.places].filter(
      (c) => hasCoords(c) && (c.visits > 0 || c.visitDates.length > 0),
    );
    const sig = all.map((c) => `${c.note}:${c.visits}:${c.lastVisit}`).join("|");
    if (sig === this.litSig) return;
    this.litSig = sig;
    this.litNames = new Set(all.map((c) => stripSuffix(c.name)));
    this.litPoints = all.map((c) => ({
      name: stripSuffix(c.name),
      lat: c.lat,
      lng: c.lng,
      visits: c.visits,
      lastVisit: c.lastVisit,
    }));
    this.litCountrySet = new Set(all.map((c) => c.country.trim()));
  }

  /** 要素在指定层级是否点亮（结果按 litSig + 层级缓存：同一数据下每要素只做一次
   *  litNames 匹配 / litPoints 逐点 pointInFeature 兜底） */
  private isLit(feature: AdminFeature, level: RenderLevel): boolean {
    const cached = this.litCache.get(feature);
    if (cached && cached.sig === this.litSig && cached.level === level) return cached.lit;
    const lit = this.computeIsLit(feature, level);
    this.litCache.set(feature, { sig: this.litSig, level, lit });
    return lit;
  }

  private computeIsLit(feature: AdminFeature, level: RenderLevel): boolean {
    const props = feature.properties;
    if (!props) return false;

    if (level === "admin2") {
      // 名字匹配 O(1) 先行，pointInFeature 只兜底无名字匹配的
      const n = props.name ? stripSuffix(props.name) : "";
      if (n && this.litNames.has(n)) return true;
      return this.litPoints.some((p) => pointInFeature(p.lng, p.lat, feature));
    }
    if (level === "admin1") {
      // 省份点亮：任一去过城市的坐标落在省界内
      return this.litPoints.some((p) => pointInFeature(p.lng, p.lat, feature));
    }
    // 国家级：国名或 ISO3 中文兜底名在去过国家集合中
    const names = [
      props.name,
      props.nameLocal,
      isValidIso3(props.iso3) ? ISO3_ZH_FALLBACK[props.iso3] : "",
    ].filter(Boolean) as string[];
    return names.some((n) => this.litCountrySet.has(n));
  }

  /** 要素的最终样式：点亮 → 暖金色，未点亮 → 常规灰 */
  private styleFor(feature: AdminFeature, level: string): L.PathOptions {
    return this.isLit(feature, level as RenderLevel)
      ? LIT_STYLES[level] ?? STYLES[level]
      : STYLES[level];
  }

  private renderGeoJson(): void {
    if (!this.initialized) return;

    // zoom 动画期间推迟整层重建（见 addControls 中 zoomstart 监听的说明）：
    // 动画期间 getZoom() 已返回目标级别，zoomend 后按最终级别重建结果一致；
    // 时间上界保证动画异常中断（zoomend 缺失）时后续请求仍能正常渲染
    if (this.zoomAnimating && Date.now() - this.zoomStartedAt < 1000) return;

    const zoom = this.map.getZoom();

    const requested: RenderLevel =
      this.renderMode === "auto" ? AUTO_LEVEL(zoom) : this.renderMode;

    let level: RenderLevel = requested;
    let data: AdminGeoJson | null = null;

    // LOD：高缩放时懒加载全精度边界并热切换（导入分析始终用全精度，互不影响）
    if (requested === "admin2" && zoom >= 10) {
      for (const iso3 of ["CHN", "JPN"]) {
        const key = `admin2|${iso3}|hi`;
        if (!this.hiLoaded.has(key) && this.admin2Sets.has(iso3)) {
          this.hiLoaded.add(key);
          this.showStatus("正在加载高精度边界…");
          void loadAdminGeoJson("admin2", iso3, "hi").then((hi) => {
            this.admin2Sets.set(iso3, hi);
            this.mergedAdmin2 = null;
            this.renderGeoJson();
          });
        }
      }
    }
    if (requested === "admin1" && zoom >= 7 && !this.hiLoaded.has("admin1|hi")) {
      this.hiLoaded.add("admin1|hi");
      this.showStatus("正在加载高精度边界…");
      void loadAdminGeoJson("admin1", undefined, "hi").then((hi) => {
        this.geoJsonData.set("admin1", hi);
        this.renderGeoJson();
      });
    }

    if (requested === "admin2") {
      // 渲染所有已加载国家的市级数据（中国+日本同时显示）
      data = this.getMergedAdmin2();
      if (!data || data.features.length === 0) {
        // 无任何市级数据时回退省级
        if (this.renderMode === "admin2") {
          this.showStatus("暂无市级数据，已显示省级边界");
        }
        level = "admin1";
        data = null;
      }
    }

    if (!data) data = this.geoJsonData.get(level) ?? null;
    if (!data || data.features.length === 0) {
      console.warn(`Atlas: No data for level ${level}`);
      return;
    }

    // 同一层级且数据未变时跳过重建（市级合并图层 2178 要素，逐级缩放时避免闪烁）
    if (level === this.currentLevel && data === this.currentData) return;

    if (this.geoJsonLayers) {
      this.geoJsonLayers.remove();
      this.geoJsonLayers = null;
      // 层已整体重建：旧选中区域的层引用随之失效（悬停/点击恢复不得再触碰已移除的层），
      // 清掉引用；新层本就以初始样式绘制，视觉无任何变化
      this.selectedRegion = null;
    }
    if (this.labelLayer) {
      this.labelLayer.remove();
      this.labelLayer = null;
    }

    this.currentLevel = level;
    this.currentData = data;
    // 点亮集合每层重建只需算一次（原来 style 回调里逐要素调用，2000+ 要素重复构建签名）
    this.computeLit();

    try {
      this.geoJsonLayers = L.geoJSON(data, {
        style: (feature) => this.styleFor(feature as AdminFeature, level),
        onEachFeature: (feature, layer) => {
          this.setupFeatureInteraction(feature as AdminFeature, layer, level);
        },
        // @types/leaflet 的 GeoJSONOptions 未声明 renderer，实际支持透传给内部 Path
        renderer: this.canvasRenderer,
      } as L.GeoJSONOptions & { renderer: L.Renderer }).addTo(this.map);
    } catch (e) {
      // 行政区划渲染失败时回退到默认 SVG 渲染器，避免整层消失
      console.error("Atlas: GeoJSON canvas render failed, falling back to SVG:", e);
      try {
        this.geoJsonLayers = L.geoJSON(data, {
          style: (feature) => this.styleFor(feature as AdminFeature, level),
          onEachFeature: (feature, layer) => {
            this.setupFeatureInteraction(feature as AdminFeature, layer, level);
          },
        }).addTo(this.map);
      } catch (e2) {
        console.error("Atlas: GeoJSON SVG render also failed:", e2);
        this.showStatus(`地图渲染失败：${(e2 as Error).message}`);
        return;
      }
    }

    this.updateLabels(true);
  }

  /** 尝试加载某国的市级数据；成功则并入图层并返回要素数 */
  private async addAdmin2Set(iso3: string): Promise<number> {
    const existing = this.admin2Sets.get(iso3);
    if (existing) return existing.features.length;
    const data = await loadAdminGeoJson("admin2", iso3);
    if (!data.features.length) return 0;
    this.admin2Sets.set(iso3, data);
    this.mergedAdmin2 = null;
    return data.features.length;
  }

  /** 合并所有已加载国家的市级数据（添加新国家后缓存失效） */
  private getMergedAdmin2(): AdminGeoJson | null {
    if (!this.admin2Sets.size) return null;
    if (!this.mergedAdmin2) {
      // 逐要素 push 而非 push(...set.features)：全精度数据集可能有数千要素，
      // 避免 spread 的实参数量上限风险
      const features: AdminFeature[] = [];
      for (const set of this.admin2Sets.values()) {
        for (const f of set.features) features.push(f);
      }
      this.mergedAdmin2 = { type: "FeatureCollection", features };
    }
    return this.mergedAdmin2;
  }

  private updateLabels(force = false): void {
    const data = this.currentData;
    if (!data) {
      if (this.labelLayer) {
        this.labelLayer.remove();
        this.labelLayer = null;
      }
      this.labelSig = null;
      return;
    }

    const bounds = this.map.getBounds();

    // 到访状态：笔记名（去后缀）→ 累计到访次数
    const visitCount = new Map<string, number>();
    const bump = (name: string, visits: number) => {
      const k = stripSuffix(name);
      visitCount.set(k, Math.max(visitCount.get(k) ?? 0, visits));
    };
    for (const c of this.plugin.db.cities) bump(c.name, c.visits);
    for (const c of this.plugin.db.places) bump(c.name, c.visits);

    // 签名未变（层级/视口/容器尺寸/选中项/到访数据）→ 标签层不变，跳过重建。
    // 消除 zoomend 渲染后 moveend 再重建一次、以及连续平移的重复重建
    let visitSig = "";
    for (const [k, v] of [...visitCount].sort()) visitSig += `${k}:${v}|`;
    const size = this.map.getSize();
    const sig =
      `${this.currentLevel}|${bounds.toBBoxString()}|${size.x}x${size.y}` +
      `|${this.selected ? cityKey(this.selected) : ""}|${visitSig}`;
    if (!force && sig === this.labelSig && this.labelLayer) return;
    this.labelSig = sig;

    if (this.labelLayer) {
      this.labelLayer.remove();
      this.labelLayer = null;
    }

    // 候选标签：视口内；到访过的优先（按次数降序），未到访保持数据顺序
    const west = bounds.getWest();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    const candidates: Array<{ display: string; latLng: L.LatLng; visits: number }> = [];
    for (const feature of data.features) {
      const props = feature.properties;
      if (!props?.name) continue;
      // bbox 快筛：质心必在要素 bbox 内，bbox 与视口不相交则不可能成为候选，
      // 省去逐要素的质心计算（质心有 WeakMap 缓存，bbox 同样只算一次）
      const bbox = getFeatureBbox(feature);
      if (bbox && (bbox[2] < west || bbox[0] > east || bbox[3] < south || bbox[1] > north)) continue;
      const centroid = getCentroid(feature);
      if (!centroid) continue;
      const latLng = L.latLng(centroid[1], centroid[0]);
      if (!bounds.contains(latLng)) continue;
      const display = stripSuffix(props.name) || props.name;
      if (this.selected && stripSuffix(this.selected.name) === display) continue; // 由 pinned 标签呈现
      candidates.push({ display, latLng, visits: visitCount.get(display) ?? 0 });
    }
    candidates.sort((a, b) => b.visits - a.visits); // 稳定排序，未到访不乱序

    // 碰撞检测：标签屏幕矩形互斥，密集区不再糊叠
    this.labelLayer = L.layerGroup();
    const occupied: Array<[number, number, number, number]> = [];
    let labelCount = 0;
    for (const cand of candidates) {
      if (labelCount >= MAX_LABELS) break;
      const pt = this.map.latLngToContainerPoint(cand.latLng);
      // 估算标签宽：CJK ≈ 11px/字，ASCII ≈ 6px/字，加内边距；到访角标 ≈ 18px
      let w = 12;
      for (const ch of cand.display) w += ch.charCodeAt(0) > 0x2e80 ? 11 : 6;
      if (cand.visits > 0) w += 18;
      w = Math.max(w, 26);
      const box: [number, number, number, number] = [pt.x - w / 2, pt.y - 9, w, 18];
      if (
        occupied.some(([ox, oy, ow, oh]) => box[0] < ox + ow && box[0] + box[2] > ox && box[1] < oy + oh && box[1] + box[3] > oy)
      ) {
        continue;
      }
      occupied.push(box);

      const visited = cand.visits > 0;
      const html = visited
        ? `<span>${cand.display}<i class="atlas-label-count">${cand.visits}</i></span>`
        : `<span>${cand.display}</span>`;
      const labelMarker = L.marker(cand.latLng, {
        interactive: false,
        icon: L.divIcon({
          className: `atlas-label atlas-label-${this.currentLevel}${visited ? " atlas-label-visited" : ""}`,
          html,
          iconSize: [0, 0],
        }),
      });
      this.labelLayer.addLayer(labelMarker);
      labelCount++;
    }

    this.labelLayer.addTo(this.map);
    if (this.activePopupEl) this.hideLabelsUnder(this.activePopupEl, true);
  }

  private setupFeatureInteraction(feature: AdminFeature, layer: L.Layer, level: string): void {
    const props = feature.properties;
    if (!props) return;

    // 初始样式建层时算好并缓存（styleFor → isLit 已按要素记忆，这里只多一次查表）：
    // 悬停恢复/选中恢复直接复用屏上已绘制的样式，不再重算点亮状态
    const baseStyle = this.styleFor(feature, level);
    (layer as AtlasPath)._atlasStyle = baseStyle;

    layer.on("mouseover", (e: L.LeafletMouseEvent) => {
      const target = e.target as L.Path;
      target.setStyle(HOVER_STYLE);
      target.bringToFront?.();
    });

    layer.on("mouseout", (e: L.LeafletMouseEvent) => {
      if (this.selectedRegion !== e.target) {
        (e.target as L.Path).setStyle(baseStyle);
      }
    });

    layer.on("click", () => {
      if (this.selectedRegion) {
        const prev = this.selectedRegion as AtlasPath;
        const prevLevel = prev._atlasLevel || level;
        const prevFeature = prev._atlasFeature;
        // 恢复优先用建层时缓存的原始样式（与屏上绘制一致、免重算点亮状态）；
        // _atlasStyle 缺失时回退到原重算路径
        (this.selectedRegion as L.Path).setStyle(
          prev._atlasStyle ??
            (prevFeature ? this.styleFor(prevFeature, prevLevel) : STYLES[prevLevel] || STYLES.country),
        );
      }

      this.selectedRegion = layer;
      (layer as AtlasPath)._atlasLevel = level;
      (layer as AtlasPath)._atlasFeature = feature;
      (layer as L.Path).setStyle(SELECTED_STYLE);

      this.onRegionSelect(props, level);
    });

    // 双击城市区域 → 打开对应笔记（未建档则提示；非城市区域保持默认双击缩放）
    layer.on("dblclick", (e: L.LeafletMouseEvent) => {
      const key = props.name ? stripSuffix(props.name) : "";
      const city = [...this.plugin.db.cities, ...this.plugin.db.places].find(
        (c) => stripSuffix(c.name) === key,
      );
      if (!city) return;
      L.DomEvent.stopPropagation(e);
      this.map.closePopup();
      this.openCityNote(city.name);
    });

    // 点亮区域的弹窗带足迹统计。
    // 点亮集合已在 renderGeoJson 建层前统一 computeLit()（原来这里逐要素调用，
    // 每次都对全部城市重复构建数组与签名），isLit 结果亦已缓存
    let visitLine = "";
    if (this.isLit(feature, level as RenderLevel)) {
      if (level === "admin2") {
        const n = props.name ? stripSuffix(props.name) : "";
        const p =
          this.litPoints.find((x) => x.name === n) ??
          this.litPoints.find((x) => pointInFeature(x.lng, x.lat, feature));
        if (p) visitLine = `到访 ${p.visits} 次${p.lastVisit ? ` · 最近 ${p.lastVisit}` : ""}`;
      } else if (level === "admin1") {
        const inside = this.litPoints.filter((p) => pointInFeature(p.lng, p.lat, feature));
        if (inside.length) {
          visitLine = `${inside.length} 个到访地 · 累计 ${inside.reduce((s, p) => s + p.visits, 0)} 次`;
        }
      } else if (level === "country") {
        visitLine = "✨ 已点亮";
      }
    }

    layer.bindPopup(this.createPopupContent(props, level, visitLine), { maxWidth: 280 });
  }

  private createPopupContent(props: AdminProperties, level: string, visitLine = ""): string {
    const levelName = level === "country" ? "国家级" : level === "admin2" ? "市级" : "省级";

    return `
      <div class="atlas-region-popup">
        <div class="atlas-popup-header">${props.name || "未知"}</div>
        ${props.nameLocal && props.nameLocal !== props.name ? `<div class="atlas-popup-local">${props.nameLocal}</div>` : ''}
        <div class="atlas-popup-level">${levelName}</div>
        ${visitLine ? `<div class="atlas-popup-visit">✨ ${visitLine}</div>` : ''}
        ${props.adcode ? `<div class="atlas-popup-code">区划码: ${props.adcode}</div>` : ''}
        ${props.parent?.name ? `<div class="atlas-popup-parent">上级: ${props.parent.name}</div>` : ''}
      </div>
    `;
  }

  /** 双击打开城市/地点笔记；未建档时提示 */
  private openCityNote(name: string): void {
    const key = stripSuffix(name);
    const city = [...this.plugin.db.cities, ...this.plugin.db.places].find(
      (c) => stripSuffix(c.name) === key,
    );
    if (!city?.note) {
      new Notice(`「${key}」还没有笔记，可通过「添加城市」或导入建档创建`);
      return;
    }
    void this.plugin.app.workspace.openLinkText(city.note, "", false);
    new Notice(`已打开：${city.name}`);
  }

  private onRegionSelect(props: AdminProperties, level: string): void {
    const levelName = level === "country" ? "国家级" : level === "admin2" ? "市级" : "省级";
    this.showStatus(`已选择：${props.name} (${levelName})`);

    // 点击国家时尝试加载该国的市级数据，有则并入市级图层
    if (level === "country" && isValidIso3(props.iso3)) {
      void this.addAdmin2Set(props.iso3).then((count) => {
        if (count && this.currentLevel === "admin2") {
          this.renderGeoJson();
        } else if (!count) {
          this.showStatus(`「${props.name}」暂无市级数据`);
        }
      });
    }
  }

  invalidate(): void {
    this.map.invalidateSize({ animate: false });
  }

  /** 当前地图视野（设置页「采用当前视野」用） */
  get currentView(): { center: [number, number]; zoom: number } {
    const c = this.map.getCenter();
    return { center: [Number(c.lat.toFixed(4)), Number(c.lng.toFixed(4))], zoom: this.map.getZoom() };
  }

  fitAll(): void {
    // 回到设置的默认视野（而非硬编码 [30,0], zoom 2）
    this.map.setView(this.plugin.settings.defaultMapCenter, this.plugin.settings.defaultZoom, {
      animate: true,
    });
  }

  focus(city: City): void {
    this.selected = city;
    if (hasCoords(city)) {
      this.map.setView([city.lat, city.lng], Math.max(this.map.getZoom(), 10), {
        animate: true,
      });
      this.pinLabel(city);
    }
    const key = cityKey(city);
    const marker = this.markers.find((m) => m.options.alt === key);
    if (marker) marker.openPopup();
  }

  /** 定位后把选中城市的白色名字标签钉在视线中央（缩放平移跟随，选中期间常驻） */
  private pinLabel(city: City): void {
    this.pinnedLabel?.remove();
    this.pinnedLabel = null;
    if (!hasCoords(city)) return;
    this.pinnedLabel = L.marker([city.lat, city.lng], {
      interactive: false,
      zIndexOffset: 2000,
      icon: L.divIcon({
        className: "atlas-label atlas-label-pinned",
        html: `<span>${stripSuffix(city.name) || city.name}</span>`,
        iconSize: [0, 0],
      }),
    }).addTo(this.map);
  }

  render(): void {
    this.renderMarkers();
    this.renderRoutes();
    void this.renderTracks();
    void this.renderCoverage();
    this.renderAirports();
  }

  /** 常用机场图层：内置静态数据，点击弹窗显示详情与离家距离 */
  private renderAirports(): void {
    // 层内容只由（可见开关, 常用城市, 家笔记路径+坐标）决定 → 签名不变时整层复用，
    // 避免 refresh()（每次 db.scan 后触发）都重建上百个机场 marker
    const frequent = this.plugin.settings.frequentCity.trim();
    const home = frequent
      ? [...this.plugin.db.cities, ...this.plugin.db.places].find(
          (c) => c.name.replace(/(市|县|区)$/, "") === frequent.replace(/(市|县|区)$/, ""),
        )
      : undefined;
    const sig = `${this.airportsVisible}|${frequent}|${home ? `${home.note}:${home.lat},${home.lng}` : "-"}`;
    if (sig === this.airportSig && (this.airportLayer || !this.airportsVisible)) return;
    this.airportSig = sig;

    if (this.airportLayer) {
      this.airportLayer.remove();
      this.airportLayer = null;
    }
    if (!this.airportsVisible) return;

    if (!this.map.getPane("atlas-airport")) {
      this.map.createPane("atlas-airport");
    }
    const layer = L.layerGroup();
    for (const ap of AIRPORTS) {
      const icon = L.divIcon({
        className: "atlas-airport-marker",
        html: `<span class="atlas-airport-icon tier${ap.tier}" title="${ap.name}">✈</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      // DOM 弹窗：信息行 + 「添加为地点」按钮（createEl/createDiv 构建，不拼接 HTML）
      const popup = L.DomUtil.create("div");
      popup.createDiv("atlas-popup-line").createEl("b", { text: ap.name });
      popup.createDiv("atlas-popup-line").setText(`${ap.iata} · ${ap.city} · ${ap.country}`);
      if (home && hasCoords(home)) {
        const km = Math.round(
          distanceKm({ lat: home.lat, lng: home.lng }, { lat: ap.lat, lng: ap.lng }),
        );
        popup.createDiv("atlas-popup-line").setText(`距${home.name} ${km.toLocaleString()} km`);
      }
      popup
        .createDiv("atlas-popup-line")
        .setText(`坐标 ${ap.lat.toFixed(4)}, ${ap.lng.toFixed(4)}`);
      const btn = popup.createEl("button", { text: "✈ 添加为地点", cls: "atlas-airport-add-btn" });
      btn.onclick = () => void this.addAirportAsPlace(ap);
      L.marker([ap.lat, ap.lng], { icon, pane: "atlas-airport" })
        .bindPopup(popup, { maxWidth: 260 })
        .addTo(layer);
    }
    this.airportLayer = layer;
    layer.addTo(this.map);
  }

  /** 把机场一键建档为地点笔记（type: place），已存在则直接打开 */
  private async addAirportAsPlace(ap: Airport): Promise<void> {
    try {
      const folder = `${this.plugin.settings.travelFolder || "Travel"}/${ap.country}`;
      const path = `${folder}/${ap.name}.md`;
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existing) {
        new Notice("该机场笔记已存在，正在打开…");
        await this.plugin.app.workspace.openLinkText(path, "", false);
        return;
      }
      await ensureFolder(this.plugin.app, folder);
      await this.plugin.app.vault.create(
        path,
        cityTemplate(ap.name, ap.country, ap.lat, ap.lng, "place"),
      );
      await this.plugin.db.scan();
      this.plugin.refreshViews();
      new Notice(`已添加地点: ${ap.name}`);
    } catch (e) {
      console.error("Atlas: Failed to create airport place:", e);
      new Notice(`创建失败: ${(e as Error).message}`);
    }
  }

  /** 让地图飞到某机场（城市详情「附近机场」点击时用） */
  flyToAirport(ap: Airport): void {
    this.map.setView([ap.lat, ap.lng], Math.max(this.map.getZoom(), 12), { animate: true });
  }

  /** GPS 轨迹图层：读取 Travel/轨迹/*.geojson（按 mtime 缓存），按日期配色 */
  private async renderTracks(): Promise<void> {
    try {
      await this.renderTracksInner();
    } catch (e) {
      console.error("Atlas: track rendering failed:", e);
    }
  }

  private async renderTracksInner(): Promise<void> {
    const token = ++this.trackToken;
    const folder = `${this.plugin.settings.travelFolder}/轨迹/`;
    const files = this.plugin.app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder) && f.extension === "geojson")
      .sort((a, b) => a.basename.localeCompare(b.basename));
    const sig = files.map((f) => `${f.path}:${f.stat.mtime}`).join("|");

    // 文件清单与内容都没变时保留现有图层，避免每次刷新重建 3 万+ 个点
    if (this.tracksVisible && this.trackLayer && sig === this.trackSig) return;

    if (this.trackLayer) {
      this.trackLayer.remove();
      this.trackLayer = null;
    }
    if (!this.tracksVisible) {
      this.trackSig = "";
      return;
    }

    if (!this.trackRenderer) {
      if (!this.map.getPane("atlas-track")) {
        this.map.createPane("atlas-track");
      }
      this.trackRenderer = L.svg({ pane: "atlas-track" });
    }

    // 与路线一致的年份配色语义
    const years = [...new Set(files.map((f) => f.basename.slice(0, 4)))].sort();
    const palette = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#e03131", "#f08c00", "#0c8599", "#5f3dc4", "#c2255c", "#2b8a3e"];
    const colorOf = new Map(years.map((y, i) => [y, palette[i % palette.length]]));
    const layer = L.layerGroup();

    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      let geo: TrackGeoJson | null = null;
      const cached = this.trackCache.get(f.path);
      if (cached && cached.mtime === f.stat.mtime) {
        geo = cached.geo as TrackGeoJson;
      } else {
        try {
          geo = JSON.parse(await this.plugin.app.vault.adapter.read(f.path)) as TrackGeoJson;
          this.trackCache.set(f.path, { mtime: f.stat.mtime, geo });
        } catch {
          continue;
        }
      }
      const color = colorOf.get(f.basename.slice(0, 4)) ?? "#7c3aed";
      for (const feat of geo?.features ?? []) {
        if (feat.geometry?.type !== "LineString") continue;
        const inferred = !!feat.properties?.inferred;
        const latlngs = feat.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        L.polyline(latlngs, {
          color,
          weight: inferred ? 2 : 3,
          opacity: inferred ? 0.3 : 0.55,
          dashArray: inferred ? "4 8" : undefined,
          renderer: this.trackRenderer,
        }).addTo(layer);
        // 方式分色：properties.segments（起止秒）+ ts（坐标时间戳）→ 逐段上色
        const segs = feat.properties?.segments;
        const ts = feat.properties?.ts;
        if (!inferred && segs?.length && ts?.length === feat.geometry.coordinates.length) {
          for (const seg of segs) {
            const segPts: [number, number][] = [];
            for (let i = 0; i < ts.length; i++) {
              if (ts[i] >= seg.s && ts[i] <= seg.e) latlngs[i] && segPts.push(latlngs[i]);
            }
            if (segPts.length >= 2) {
              L.polyline(segPts, {
                color: MODE_COLORS[seg.m] ?? color,
                weight: 3.5,
                opacity: 0.9,
                renderer: this.trackRenderer,
              }).addTo(layer);
            }
          }
        }
      }
    }

    if (token !== this.trackToken) return;
    this.trackSig = sig;
    this.trackLayer = layer;
    layer.addTo(this.map);
  }

  /** 国土覆盖率格点层：把各轨迹文件点亮的中国 5 位 geohash 格画成半透明矩形 */
  private renderCoverage(): void {
    try {
      this.renderCoverageInner();
    } catch (e) {
      console.error("Atlas: coverage rendering failed:", e);
    }
  }

  private renderCoverageInner(): void {
    if (!this.coverageVisible) {
      if (this.coverageLayer) {
        this.coverageLayer.remove();
        this.coverageLayer = null;
        this.coverageSig = "";
      }
      return;
    }

    const folder = `${this.plugin.settings.travelFolder}/轨迹/`;
    const files = this.plugin.app.vault
      .getFiles()
      .filter((f) => f instanceof TFile && f.path.startsWith(folder) && f.extension === "geojson");
    if (!files.length) {
      if (this.coverageLayer) {
        this.coverageLayer.remove();
        this.coverageLayer = null;
        this.coverageSig = "";
      }
      return;
    }
    const sig = files.map((f) => `${f.path}:${f.stat.mtime}`).join("|");
    // 轨迹文件清单未变且层已在图上 → 整层复用（refresh() 每次 db.scan 后都会走到这里）
    if (sig === this.coverageSig && this.coverageLayer) return;
    if (this.coverageLayer) {
      this.coverageLayer.remove();
      this.coverageLayer = null;
    }

    const token = ++this.coverageToken;
    void (async () => {
      const cellSet = new Set<string>();
      for (const f of files) {
        try {
          let geo: CoverageGeo | null = null;
          const cached = this.trackCache.get(f.path);
          if (cached && cached.mtime === f.stat.mtime) {
            geo = cached.geo as CoverageGeo;
          } else {
            geo = JSON.parse(await this.plugin.app.vault.adapter.read(f.path)) as CoverageGeo;
            this.trackCache.set(f.path, { mtime: f.stat.mtime, geo });
          }
          for (const c of geo?.features?.[0]?.properties?.cells ?? []) cellSet.add(c);
        } catch {
          continue;
        }
      }
      if (!this.map.getPane("atlas-track")) {
        this.map.createPane("atlas-track");
      }
      const layer = L.layerGroup();
      // 渲染器复用：每次重建都 new canvas 会在窗格里堆积空 canvas 容器
      const renderer = (this.coverageRenderer ??= L.canvas({ pane: "atlas-track" }));
      let n = 0;
      for (const c of cellSet) {
        if (n >= 8000) break;
        const b = geohashBounds(c);
        L.rectangle(
          [
            [b.minLat, b.minLng],
            [b.maxLat, b.maxLng],
          ],
          {
            color: "#f08c00",
            weight: 0.5,
            opacity: 0.25,
            fillColor: "#f08c00",
            fillOpacity: 0.12,
            renderer,
          },
        ).addTo(layer);
        n++;
      }
      // 读取文件期间被关闭或被新一轮渲染取代 → 丢弃结果，避免留下
      // 不在图上的悬挂层和过期签名（否则下次 toggle-on 会被签名跳过而不显示）
      if (token !== this.coverageToken || !this.coverageVisible) return;
      this.coverageSig = sig;
      this.coverageLayer = layer;
      layer.addTo(this.map);
    })();
  }

  /** 旅行路线：按日期串联到访城市，按年份配色 */
  private renderRoutes(): void {
    try {
      this.renderRoutesInner();
    } catch (e) {
      console.error("Atlas: route rendering failed:", e);
    }
  }

  private renderRoutesInner(): void {
    const route = this.plugin.db.route;
    // 路线完全由城市数据派生（db.scan 时重建 route）→ 城市签名 + 可见开关不变时整层复用，
    // 避免 refresh()（每次 db.scan 后触发）都重建全部路线 polyline 与弹窗
    const sig = `${this.routesVisible}|${this.markerSig}`;
    if (sig === this.routesSig && (this.routeLayer || !this.routesVisible || !route.segments.length)) {
      return;
    }
    this.routesSig = sig;

    if (this.routeLayer) {
      this.routeLayer.remove();
      this.routeLayer = null;
    }
    if (!this.routesVisible) return;

    if (!route.segments.length) return;

    const years = [...new Set(route.segments.map((s) => s.year))].sort();
    const palette = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#e03131", "#f08c00", "#0c8599", "#5f3dc4", "#c2255c", "#2b8a3e"];
    const colorOf = new Map(years.map((y, i) => [y, palette[i % palette.length]]));

    // 路线放在专用窗格（z=450）：高于行政区划 canvas（400），低于标记（600）
    if (!this.map.getPane("atlas-route")) {
      this.map.createPane("atlas-route");
    }
    // 渲染器只建一次：重复创建会在地图上堆积空的 SVG 容器
    if (!this.routeRenderer) this.routeRenderer = L.svg({ pane: "atlas-route" });
    const renderer = this.routeRenderer;

    this.routeLayer = L.layerGroup();
    for (const seg of route.segments) {
      const line = L.polyline(
        [
          [seg.from.city.lat, seg.from.city.lng],
          [seg.to.city.lat, seg.to.city.lng],
        ],
        { color: colorOf.get(seg.year), weight: 2.5, opacity: 0.75, renderer },
      );
      line.bindPopup(
        `<b>${escapeHtml(seg.from.city.name)} → ${escapeHtml(seg.to.city.name)}</b>` +
          `<div class="atlas-popup-line">${escapeHtml(seg.from.date)} ~ ${escapeHtml(seg.to.date)}</div>` +
          `<div class="atlas-popup-line">约 ${Math.round(seg.km).toLocaleString()} km</div>`,
      );
      this.routeLayer.addLayer(line);
    }
    this.routeLayer.addTo(this.map);
  }

  renderMarkers(): void {
    const all = [...this.plugin.db.cities, ...this.plugin.db.places];
    // 数据签名：键/类型/坐标/到访次数与日期/最近到访/笔记路径 任一变化才重建。
    // refresh() 每次 db.scan 后都会调用（日记防抖 300ms），签名不变时 131 个 marker 全部复用。
    // visitDates 值也纳入签名：路线层（renderRoutes）复用本签名，日期变化路线必须跟着重建。
    const sig = all
      .map(
        (c) =>
          `${cityKey(c)}#${c.kind}#${c.lat},${c.lng}#${c.visits}#${c.visitDates.join(",")}#${c.lastVisit}#${c.note}`,
      )
      .join("|");
    if (sig === this.markerSig) return;
    this.markerSig = sig;

    for (const m of this.markers) m.remove();
    this.markers = [];

    for (const city of all) {
      if (!hasCoords(city)) continue;
      const marker = L.marker([city.lat, city.lng], {
        title: city.name,
        alt: cityKey(city),
        icon: this.iconFor(city),
        riseOnHover: true,
      });
      marker.bindPopup(popupHtml(city));
      marker.on("click", () => {
        this.selected = city;
        this.onSelect(city);
      });
      marker.on("dblclick", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        this.map.closePopup();
        this.openCityNote(city.name);
      });
      marker.addTo(this.map);
      this.markers.push(marker);
    }
  }

  private iconFor(city: City): L.DivIcon {
    // 图标只由 (类型, 是否到访) 决定 → 按维度缓存 DivIcon 实例（DivIcon 本身无标记状态，
    // 可被多个 marker 共享），重建标记层时不再逐城市拼 SVG 字符串
    const key = `${city.kind}:${city.visits > 0 ? 1 : 0}`;
    const cached = this.iconCache.get(key);
    if (cached) return cached;
    const isPlace = city.kind === "place";
    const visited = city.visits > 0;
    const color = isPlace ? "#868e96" : visited ? "#e8590c" : "#1971c2";
    const size = isPlace ? 18 : 26;
    const svg = isPlace
      ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>`
      : `<svg width="${size}" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C6 0 1 5 1 12c0 8.5 12 22 12 22s12-13.5 12-22C25 5 20 0 13 0z" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/><circle cx="13" cy="12" r="4.5" fill="#fff"/></svg>`;
    const icon = L.divIcon({
      className: "atlas-marker",
      html: svg,
      iconSize: [size, isPlace ? size : 34],
      iconAnchor: isPlace ? [size / 2, size] : [13, 32],
      popupAnchor: [0, isPlace ? -size : -30],
    });
    this.iconCache.set(key, icon);
    return icon;
  }

  showStatus(text: string): void {
    let el = this.container.querySelector<HTMLElement>(".atlas-map-status");
    if (!el) el = this.container.createDiv("atlas-map-status");
    el.textContent = text;
    window.setTimeout(() => {
      if (el) el.remove();
    }, 5000);
  }

  destroy(): void {
    // 使在途的异步渲染（轨迹/覆盖率）失效，避免往已销毁的地图上加层
    this.trackToken++;
    this.coverageToken++;
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (this.routeLayer) this.routeLayer.remove();
    if (this.trackLayer) this.trackLayer.remove();
    if (this.airportLayer) this.airportLayer.remove();
    if (this.geoJsonLayers) this.geoJsonLayers.remove();
    if (this.labelLayer) this.labelLayer.remove();
    if (this.coverageLayer) this.coverageLayer.remove();
    if (this.labelDebounce !== null) {
      window.clearTimeout(this.labelDebounce);
      this.labelDebounce = null;
    }
    this.pinnedLabel?.remove();
    this.pinnedLabel = null;
    this.activePopupEl = null;
    this.initialized = false; // 使在途异步渲染回调失效
    this.minZoomObserver?.disconnect();
    this.minZoomObserver = null;
    this.map.remove();
  }
}

/** 添加城市对话框 */
class AddCityModal extends Modal {
  plugin: AtlasPlugin;
  lat: number;
  lng: number;
  onSubmit: (city: City) => void;
  prefill: { city?: string; country: string };
  name: string = "";
  country: string = "";

  constructor(
    plugin: AtlasPlugin,
    lat: number,
    lng: number,
    onSubmit: (city: City) => void,
    prefill: { city?: string; country: string } = { country: "" },
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.lat = lat;
    this.lng = lng;
    this.onSubmit = onSubmit;
    this.prefill = prefill;
    this.name = prefill.city ?? "";
    this.country = prefill.country;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "添加城市" });

    // 坐标显示 + 自动识别结果
    const coordDiv = contentEl.createDiv("atlas-modal-coord");
    coordDiv.createSpan({ text: `坐标: ${this.lat.toFixed(4)}, ${this.lng.toFixed(4)}` });
    if (this.prefill.country) {
      const where = this.prefill.city
        ? `${this.prefill.country} · ${this.prefill.city}`
        : this.prefill.country;
      coordDiv.createDiv({
        cls: "atlas-modal-region",
        text: `已识别：${where}`,
      });
    }

    // 城市名称（识别到市级时预填）
    new Setting(contentEl)
      .setName("城市名称")
      .setDesc(this.prefill.city ? "已按所在区划预填，可修改" : "输入城市名称")
      .addText((text) =>
        text
          .setPlaceholder("例如: 北京")
          .setValue(this.name)
          .onChange((value) => {
            this.name = value.trim();
          })
      );

    // 国家（识别到时预填）
    new Setting(contentEl)
      .setName("国家")
      .setDesc(this.prefill.country ? "已按坐标自动识别" : "输入国家名称")
      .addText((text) =>
        text
          .setPlaceholder("例如: 中国")
          .setValue(this.country)
          .onChange((value) => {
            this.country = value.trim();
          })
      );

    // 按钮
    const buttonDiv = contentEl.createDiv("atlas-modal-buttons");
    
    const submitBtn = buttonDiv.createEl("button", { text: "添加", cls: "mod-cta" });
    submitBtn.onclick = () => {
      if (!this.name) {
        new Notice("请输入城市名称");
        return;
      }
      if (!this.country) {
        new Notice("请输入国家名称");
        return;
      }

      const city: City = {
        name: this.name,
        country: this.country,
        lat: this.lat,
        lng: this.lng,
        visits: 0,
        visitDates: [],
        lastVisit: "",
        note: "",
        kind: "city",
        created: new Date().toISOString().split("T")[0],
      };

      this.onSubmit(city);
      this.close();
    };

    const cancelBtn = buttonDiv.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function popupHtml(city: City): string {
  const meta =
    city.kind === "place"
      ? "地点"
      : city.visits > 0
        ? `访问 ${city.visits} 次`
        : "尚未访问";
  const lines = [
    `<b>${escapeHtml(city.name)}</b>`,
    escapeHtml(city.country),
    meta,
    city.lastVisit ? `最近 ${escapeHtml(city.lastVisit)}` : "",
  ].filter(Boolean);
  return lines.map((l) => `<div class="atlas-popup-line">${l}</div>`).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
