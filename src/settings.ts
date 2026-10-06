import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type AtlasPlugin from "./main";
import { VIEW_TYPE_ATLAS, AtlasView } from "./view";

export interface AtlasSettings {
  travelFolder: string;
  defaultMapCenter: [number, number];
  defaultZoom: number;
  /** Photon/Nominatim-compatible geocoding endpoint used by auto-locate. */
  geocodeUrl: string;
  /** 常用地点（常住地）城市名：GPS 到访按月简化记录 */
  frequentCity: string;
  /** GPS 到访判定档位：宽松=只要打点就算（路过也算）；标准=累计≥2h或连续≥30min；严格=累计≥6h */
  visitMode: "loose" | "standard" | "strict";
  /** GPS 导入历史（文件、哈希、天数、时间），上限 50 条 */
  importHistory: ImportHistoryEntry[];
}

export interface ImportHistoryEntry {
  file: string;
  hash: string;
  days: number;
  points: number;
  ignored: number;
  time: string;
}

export const DEFAULT_SETTINGS: AtlasSettings = {
  travelFolder: "Travel",
  defaultMapCenter: [30, 0],
  defaultZoom: 2,
  geocodeUrl: "https://photon.komoot.io/api",
  frequentCity: "",
  visitMode: "standard",
  importHistory: [],
};

const VISIT_MODE_OPTIONS: Record<string, string> = {
  loose: "宽松",
  standard: "标准",
  strict: "严格",
};

export class AtlasSettingTab extends PluginSettingTab {
  plugin: AtlasPlugin;

  constructor(app: App, plugin: AtlasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ============================================================
  // 声明式定义（Obsidian 1.13+ 走此路径，可被设置搜索索引）
  // ============================================================

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Atlas 旅行地图",
        items: [
          {
            name: "旅行笔记根目录",
            desc: "扫描此目录下 type: city / type: place 的笔记",
            control: {
              type: "text",
              key: "travelFolder",
              defaultValue: "Travel",
            },
          },
          {
            name: "日记链接扫描",
            desc: "已改为全库扫描：任何目录下形如 2026-08-07.md 的笔记都会参与 [[城市]] 链接统计与到访派生（无需配置）",
          },
          {
            name: "默认地图中心",
            desc: "格式：纬度,经度",
            control: {
              type: "text",
              key: "defaultMapCenter",
              validate: (v) =>
                parseCenter(v) ? undefined : "格式：纬度,经度（如 30,120）",
            },
          },
          {
            name: "采用当前视野",
            desc: "把 Atlas 地图当前所在的中心和缩放级别设为默认值",
            action: () => {
              void this.useCurrentView();
            },
          },
          {
            name: "默认缩放",
            control: {
              type: "number",
              key: "defaultZoom",
              min: 2,
              max: 12,
              step: 1,
              validate: (v) =>
                Number.isFinite(v) && v >= 2 && v <= 12
                  ? undefined
                  : "范围 2–12",
            },
          },
          {
            name: "常用地点",
            desc: "常住地城市名（如：苏州市）：GPS 轨迹导入时该城市的到访按月简化记录，其他城市记完整日期。留空则全部记完整日期。",
            render: (setting) => {
              this.buildFrequentCityRow(setting);
            },
          },
          {
            name: "到访判定",
            desc: "GPS 轨迹里怎样算「去过」一个城市：宽松=当天打点即可（坐车穿过也算）；标准=当天累计停留≥2小时或单段≥30分钟（推荐）；严格=当天累计≥6小时（约等于过夜）",
            control: {
              type: "dropdown",
              key: "visitMode",
              defaultValue: "standard",
              options: VISIT_MODE_OPTIONS,
            },
          },
          {
            name: "地理编码服务（自动定位）",
            desc: "新建城市笔记自动查坐标用的 Geocoding 端点（默认 Photon，无需 key；可换 Nominatim：https://nominatim.openstreetmap.org/search）",
            control: {
              type: "text",
              key: "geocodeUrl",
              defaultValue: "https://photon.komoot.io/api",
            },
          },
          {
            name: "重新扫描",
            desc: "重新扫描旅行笔记根目录",
            action: () => {
              void this.rescan();
            },
          },
        ],
      },
    ];
  }

  /** 控件值 ↔ 设置对象的双向映射（中心是 [number,number]，缩放是 number，控件里都是文本/数值） */
  override getControlValue(key: string): unknown {
    if (key === "defaultMapCenter") return this.plugin.settings.defaultMapCenter.join(",");
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    return s[key];
  }

  override setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "defaultMapCenter") {
      const parsed = parseCenter(String(value));
      if (parsed) s.defaultMapCenter = parsed;
      return this.plugin.saveSettings();
    }
    s[key] = value;
    return this.plugin.saveSettings();
  }

  // ============================================================
  // 共享行为（声明式 action 与旧版 display 复用）
  // ============================================================

  /** 取当前打开的 Atlas 地图视野（无则返回 null） */
  private atlasCurrentView(): { center: [number, number]; zoom: number } | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ATLAS)[0];
    const view = leaf?.view;
    if (view instanceof AtlasView && view.atlasMap) {
      return view.atlasMap.currentView;
    }
    return null;
  }

  private async useCurrentView(): Promise<void> {
    const view = this.atlasCurrentView();
    if (!view) {
      new Notice("未找到打开的 Atlas 地图，请先打开地图标签页");
      return;
    }
    this.plugin.settings.defaultMapCenter = view.center;
    this.plugin.settings.defaultZoom = view.zoom;
    await this.plugin.saveSettings();
    new Notice(
      `已设为默认视野：${view.center[0]}, ${view.center[1]}（缩放 ${view.zoom}）`,
    );
  }

  private async rescan(): Promise<void> {
    await this.plugin.db.scan();
    this.plugin.refreshViews();
    new Notice("扫描完成");
  }

  /** 常用地点即时校验：在描述区提示该名能否匹配到已有城市笔记 */
  private buildFrequentCityRow(setting: Setting): void {
    setting
      .setName("常用地点")
      .setDesc(
        "常住地城市名（如：苏州市）：GPS 轨迹导入时该城市的到访按月简化记录，其他城市记完整日期。留空则全部记完整日期。",
      )
      .addText((t) => {
        t.setPlaceholder("例：苏州市")
          .setValue(this.plugin.settings.frequentCity)
          .onChange(async (v) => {
            this.plugin.settings.frequentCity = v.trim();
            await this.plugin.saveSettings();
            this.updateFrequentStatus(setting, v.trim());
          });
      });
    this.updateFrequentStatus(setting, this.plugin.settings.frequentCity.trim());
  }

  private updateFrequentStatus(setting: Setting, value: string): void {
    const descEl = setting.descEl;
    descEl.querySelector(".atlas-setting-status")?.remove();
    if (!value) return;
    const target = [...this.plugin.db.cities, ...this.plugin.db.places].find(
      (c) => c.name === value || c.name === `${value}市` || `${c.name}市` === value,
    );
    const el = descEl.createDiv({ cls: "atlas-setting-status" });
    el.textContent = target
      ? `✓ 匹配到「${target.name}」`
      : "⚠ 没有匹配的城市笔记（导入时仍会按名称去后缀匹配）";
  }

  // ============================================================
  // 旧版命令式渲染（Obsidian < 1.13 的回退路径；1.13+ 走上面的声明式定义）
  // ============================================================

  display(): void {
    const c = this.containerEl;
    c.empty();
    new Setting(c).setName("Atlas 旅行地图").setHeading();

    new Setting(c)
      .setName("旅行笔记根目录")
      .setDesc("扫描此目录下 type: city / type: place 的笔记")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.travelFolder)
          .onChange(async (v) => {
            this.plugin.settings.travelFolder = v.trim() || "Travel";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(c)
      .setName("日记链接扫描")
      .setDesc("已改为全库扫描：任何目录下形如 2026-08-07.md 的笔记都会参与 [[城市]] 链接统计与到访派生（无需配置）");

    const centerSetting = new Setting(c)
      .setName("默认地图中心")
      .setDesc("格式：纬度,经度")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.defaultMapCenter.join(","))
          .onChange(async (v) => {
            const p = v.split(",").map(Number);
            if (p.length === 2 && p.every(Number.isFinite)) {
              this.plugin.settings.defaultMapCenter = [p[0], p[1]];
              await this.plugin.saveSettings();
            }
          }),
      );
    centerSetting.addButton((b) =>
      b
        .setButtonText("采用当前视野")
        .setTooltip("把 Atlas 地图当前所在的中心和缩放级别设为默认值")
        .onClick(() => {
          void this.useCurrentView();
        }),
    );

    new Setting(c)
      .setName("默认缩放")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultZoom))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 2 && n <= 12) {
              this.plugin.settings.defaultZoom = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    this.buildFrequentCityRow(new Setting(c));

    new Setting(c)
      .setName("到访判定")
      .setDesc(
        "GPS 轨迹里怎样算「去过」一个城市：宽松=当天打点即可（坐车穿过也算）；标准=当天累计停留≥2小时或单段≥30分钟（推荐）；严格=当天累计≥6小时（约等于过夜）",
      )
      .addDropdown((d) =>
        d
          .addOption("loose", "宽松")
          .addOption("standard", "标准")
          .addOption("strict", "严格")
          .setValue(this.plugin.settings.visitMode)
          .onChange(async (v) => {
            this.plugin.settings.visitMode = v as AtlasSettings["visitMode"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(c)
      .setName("地理编码服务（自动定位）")
      .setDesc(
        "新建城市笔记自动查坐标用的 Geocoding 端点（默认 Photon，无需 key；可换 Nominatim：https://nominatim.openstreetmap.org/search）",
      )
      .addText((t) =>
        t
          .setValue(this.plugin.settings.geocodeUrl)
          .onChange(async (v) => {
            this.plugin.settings.geocodeUrl = v.trim() || "https://photon.komoot.io/api";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(c)
      .setName("重新扫描")
      .addButton((b) =>
        b.setButtonText("立即扫描").onClick(() => {
          void this.rescan();
        }),
      );
  }
}

/** "纬度,经度" → [number, number]（两个分量都须是有限数值） */
function parseCenter(v: string): [number, number] | null {
  const p = v.split(",").map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null;
}
