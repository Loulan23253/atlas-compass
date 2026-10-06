import { Notice, TFile, type App } from "obsidian";
import type { Geometry } from "geojson";
import type AtlasPlugin from "../main";
import { loadChinaCells } from "../model/LandCoverage";
import { geohashBounds } from "../model/TrackClean";
import { loadAdminGeoJson, findCityFeature, type AdminFeature } from "../map/GeoJsonLoader";
import { ensureFolder, todayISO } from "../util/File";

/**
 * 读取 Travel/轨迹/*.geojson 每天的首个要素属性（覆盖率/旅程报告共用）。
 * 返回 文件名（即日期）→ properties（缺失时为空对象），损坏文件跳过。
 */
export async function readTrackDayProps(
  plugin: AtlasPlugin,
): Promise<Map<string, Record<string, unknown>>> {
  const folder = `${plugin.settings.travelFolder}/轨迹/`;
  const files = plugin.app.vault
    .getFiles()
    .filter((f) => f instanceof TFile && f.path.startsWith(folder) && f.extension === "geojson");
  const out = new Map<string, Record<string, unknown>>();
  for (const f of files) {
    try {
      const geo = JSON.parse(await plugin.app.vault.adapter.read(f.path)) as
        | { features?: Array<{ properties?: Record<string, unknown> }> }
        | null;
      const p = geo?.features?.[0]?.properties;
      out.set(f.basename, p && typeof p === "object" ? p : {});
    } catch {
      // 跳过损坏文件
    }
  }
  return out;
}

/** 报告笔记落盘：已存在则覆写，否则创建（覆盖率/年度回顾/照片足迹共用） */
export async function writeReportFile(app: App, path: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) await app.vault.adapter.write(path, content);
  else await app.vault.create(path, content);
}

// ---- 覆盖率地图 SVG（点亮格 + 中国轮廓，失败静默降级为不嵌入）----

/** 地图经纬窗口与画布：视野覆盖中国范围（lng 73→136，lat 18→54） */
const MAP_LNG0 = 73;
const MAP_LNG1 = 136;
const MAP_LAT0 = 18;
const MAP_LAT1 = 54;
const MAP_W = 720;
/** 等经纬投影按中纬度（≈36°N）校正纵横比：H = W·(36/63)/cos36° ≈ 508 */
const MAP_H = 508;
/** 点亮格最小绘制尺寸（px）：真实格在全国视野下仅 ≈0.5px，抬到小方点保证可见 */
const CELL_DOT_PX = 2.4;

/** 提取面要素的所有外环（忽略内环孔洞），非面要素返回空数组 */
function polygonOuterRings(geom: Geometry | null): number[][][] {
  if (geom?.type === "Polygon") return [geom.coordinates[0]];
  if (geom?.type === "MultiPolygon") return geom.coordinates.map((poly) => poly[0]);
  return [];
}

/**
 * 生成覆盖率地图 SVG 文本：橙点亮格叠在灰色中国轮廓上（countries.geojson 的 CHN 要素外环）。
 * 线性映射 lng∈[73,136]→x∈[0,W]、lat∈[18,54]→y 翻转∈[H,0]；只画点亮格（几百个），体积可控。
 * 无数据/无轮廓/任何异常都返回 null，调用方静默跳过。
 */
async function buildCoverageMapSvg(plugin: AtlasPlugin, litCells: Set<string>): Promise<string | null> {
  try {
    if (!litCells.size) return null;
    const geo = await loadAdminGeoJson("country", undefined);
    const chn = geo.features.find((f) => f.properties?.iso3 === "CHN") ?? null;
    const rings = polygonOuterRings(chn?.geometry ?? null);
    const px = (lng: number): number => ((lng - MAP_LNG0) / (MAP_LNG1 - MAP_LNG0)) * MAP_W;
    const py = (lat: number): number => ((MAP_LAT1 - lat) / (MAP_LAT1 - MAP_LAT0)) * MAP_H;
    // 轮廓：一条 path 承载全部外环子路径（多面 MultiPolygon 都要画）
    const d = rings
      .map((ring) =>
        ring.map(([lng, lat], i) => `${i ? "L" : "M"}${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join("") + "Z",
      )
      .join("");
    if (!d) return null;
    // 点亮格：geohash 四至映射成矩形；尺寸不足 CELL_DOT_PX 时抬到可见、中心仍对准格子
    const rects: string[] = [];
    for (const c of litCells) {
      const b = geohashBounds(c);
      if (b.maxLng < MAP_LNG0 || b.minLng > MAP_LNG1 || b.maxLat < MAP_LAT0 || b.minLat > MAP_LAT1) continue;
      const cx = (px(b.minLng) + px(b.maxLng)) / 2;
      const cy = (py(b.minLat) + py(b.maxLat)) / 2;
      const w = Math.max(px(b.maxLng) - px(b.minLng), CELL_DOT_PX);
      const h = Math.max(py(b.minLat) - py(b.maxLat), CELL_DOT_PX);
      rects.push(
        `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`,
      );
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}">`,
      `  <rect width="${MAP_W}" height="${MAP_H}" fill="none"/>`,
      `  <path d="${d}" fill="#e9ecef" stroke="#adb5bd" stroke-width="1" stroke-linejoin="round"/>`,
      `  <g fill="#f76707">${rects.join("")}</g>`,
      `  <rect x="10" y="${MAP_H - 18}" width="11" height="11" rx="2" fill="#f76707"/>`,
      `  <text x="27" y="${MAP_H - 8}" font-size="12" fill="#868e96">已点亮 ${litCells.size.toLocaleString()} 格</text>`,
      "</svg>",
    ].join("\n");
  } catch {
    return null;
  }
}

/** 生成国土覆盖率报告：汇总 Travel/轨迹/*.geojson 里点亮的中国 5 位 geohash 格，
 *  并把点亮格画到中国轮廓上生成 Travel/覆盖率地图.svg（失败静默降级为不嵌入）。 */
export class CoverageReportCommand {
  constructor(private plugin: AtlasPlugin) {}

  async run(): Promise<void> {
    const props = await readTrackDayProps(this.plugin);
    if (!props.size) {
      new Notice("还没有已导入的轨迹文件（Travel/轨迹/），先导入 GPS 轨迹再生成覆盖率");
      return;
    }

    new Notice("统计国土格点中…");
    const china = await loadChinaCells(async (p) => {
      try {
        return (await this.plugin.app.vault.adapter.exists(p)) ? await this.plugin.app.vault.adapter.read(p) : null;
      } catch {
        return null;
      }
    });

    const litAll = new Set<string>();
    const litByYear = new Map<string, Set<string>>();
    let dayCount = 0;
    for (const [date, p] of props) {
      const cells = Array.isArray(p.cells) ? p.cells.map(String) : [];
      if (!cells.length) continue;
      dayCount++;
      const year = date.slice(0, 4);
      for (const c of cells) {
        if (!china.has(c)) continue;
        litAll.add(c);
        let ys = litByYear.get(year);
        if (!ys) {
          ys = new Set();
          litByYear.set(year, ys);
        }
        ys.add(c);
      }
    }

    if (!china.size) {
      new Notice("国土格点数据缺失（data/chinacells.txt），请检查插件 data 目录");
      return;
    }
    const total = china.size;
    const lit = litAll.size;
    const pct = ((lit / total) * 100).toFixed(4);
    const bar = this.bar(lit / total, 40);

    // 省份分布：每个点亮格取中心做省级归属（admin1 简化版，网格索引加速）
    const provinceCells = new Map<string, number>();
    try {
      const admin1 = await loadAdminGeoJson("admin1", undefined, "lo");
      for (const c of litAll) {
        const b = geohashBounds(c);
        const hit = findCityFeature(admin1, (b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2);
        if (!hit) continue;
        const name = (hit.properties as { name?: string })?.name ?? "未知";
        provinceCells.set(name, (provinceCells.get(name) ?? 0) + 1);
      }
    } catch {
      // admin1 未就绪时跳过省份分布
    }

    const nextMilestone = [0.1, 0.5, 1, 2, 5].find((m) => (m / 100) * total > lit) ?? null;
    const milestoneText = nextMilestone
      ? `距 **${nextMilestone}%** 还差 **${(Math.ceil((nextMilestone / 100) * total) - lit).toLocaleString()}** 格`
      : "已超越全部预设里程碑 🎉";

    // 覆盖率地图：有点亮格才生成并覆写 Travel/覆盖率地图.svg；任何失败静默降级为不嵌入
    let mapEmbed = "";
    if (lit) {
      try {
        const svg = await buildCoverageMapSvg(this.plugin, litAll);
        if (svg) {
          await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
          const svgPath = `${this.plugin.settings.travelFolder}/覆盖率地图.svg`;
          if (this.plugin.app.vault.getAbstractFileByPath(svgPath)) await this.plugin.app.vault.adapter.write(svgPath, svg);
          else await this.plugin.app.vault.create(svgPath, svg);
          mapEmbed = "![[覆盖率地图.svg]]";
        }
      } catch {
        // 地图生成/写盘失败 → 不嵌入，不影响报告本身
      }
    }

    const lines: string[] = [
      "---",
      "type: coverage-report",
      `updated: ${todayISO()}`,
      "cssclasses: atlas-coverage",
      "---",
      "",
      "# 🗺️ 中国国土覆盖率",
      "",
      ...(mapEmbed ? [mapEmbed, ""] : []),
      `> [!summary] 点亮 ${lit.toLocaleString()} / ${total.toLocaleString()} 格 · 覆盖率 ${pct}%`,
      `> 格边长 ≈ 4.9km（5 位 geohash） · 统计 ${dayCount} 天轨迹`,
      "",
      "```",
      `[${bar}] ${pct}%`,
      "```",
      "",
      `🎯 ${milestoneText}`,
      "",
    ];
    const years = [...litByYear.keys()].sort();
    if (years.length) {
      lines.push("## 📅 按年累计", "", "| 年份 | 当年点亮 | 累计 | 累计率 |", "| --- | --- | --- | --- |");
      const acc = new Set<string>();
      for (const y of years) {
        for (const c of litByYear.get(y)!) acc.add(c);
        lines.push(`| ${y} | ${(litByYear.get(y)!.size).toLocaleString()} | ${acc.size.toLocaleString()} | ${((acc.size / total) * 100).toFixed(4)}% |`);
      }
      lines.push("");
    }
    if (provinceCells.size) {
      lines.push("## 🗺️ 省份分布", "", "| 省份 | 点亮格 |", "| --- | --- |");
      const provMax = Math.max(...provinceCells.values());
      for (const [name, n] of [...provinceCells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        const barN = "█".repeat(Math.max(1, Math.round((n / provMax) * 16)));
        lines.push(`| ${name} | ${barN} ${n.toLocaleString()} |`);
      }
      lines.push("");
    }
    lines.push("> [!note]- 说明", "> 格点在导入 GPS 轨迹时点亮（按抽稀前的原始点计算），重新导入自动更新。");

    const path = `${this.plugin.settings.travelFolder}/国土覆盖率.md`;
    await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
    await writeReportFile(this.plugin.app, path, lines.join("\n"));
    new Notice(`国土覆盖率 ${pct}%（已点亮 ${lit.toLocaleString()} 格），报告已写入 ${path}`);
  }

  private bar(ratio: number, width: number): string {
    const n = Math.round(ratio * width);
    return "█".repeat(n) + "░".repeat(width - n);
  }
}
