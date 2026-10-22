import { Notice, TFile, type App } from "obsidian";
import type AtlasPlugin from "../main";
import { loadChinaCells } from "../model/LandCoverage";
import { geohashBounds } from "../model/TrackClean";
import { loadAdminGeoJson, findCityFeature } from "../map/GeoJsonLoader";
import { ensureFolder, todayISO } from "../util/File";
import { writingPrompt } from "../model/JournalSections";
import { saveTravelNote } from "../util/TravelNote";
import { noteLink, tableText } from "../model/NoteFormat";
import { coverageGrowth, validDay } from "../model/TravelInsights";
import { buildCoverageMapSvg } from "../model/CoverageMap";

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
      if (p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length) out.set(f.basename, p);
    } catch {
      // 跳过损坏文件
    }
  }
  return out;
}

/** 报告手记落盘：保护个人文字，旧版笔记另存新版。 */
export async function writeReportFile(app: App, path: string, content: string): Promise<string> {
  return saveTravelNote(app, path, content);
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
    const growth = coverageGrowth(props, china);
    const dayCount = growth.length;
    for (const [date, p] of props) {
      if (!validDay(date)) continue;
      const cells = Array.isArray(p.cells) ? p.cells.map(String) : [];
      if (!cells.length) continue;
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
      new Notice("内置国土格点加载失败，请重新安装完整的 Atlas 插件文件");
      return;
    }
    const total = china.size;
    const lit = litAll.size;
    const pct = ((lit / total) * 100).toFixed(4);

    // 省份分布：每个点亮格取中心做省级归属（admin1 简化版，网格索引加速）
    const provinceCells = new Map<string, number>();
    try {
      const admin1 = await loadAdminGeoJson("admin1", undefined, "lo");
      for (const c of litAll) {
        const b = geohashBounds(c);
        const hit = findCityFeature(admin1, (b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2);
        if (!hit) continue;
        const name = hit.properties?.nameLocal || hit.properties?.name || "未知";
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
        const svg = buildCoverageMapSvg(litAll);
        if (svg) {
          await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
          const svgPath = `${this.plugin.settings.travelFolder}/覆盖率地图.svg`;
          if (this.plugin.app.vault.getAbstractFileByPath(svgPath)) await this.plugin.app.vault.adapter.write(svgPath, svg);
          else await this.plugin.app.vault.create(svgPath, svg);
          mapEmbed = `!${noteLink(svgPath)}`;
        }
      } catch {
        // 地图生成/写盘失败 → 不嵌入，不影响报告本身
      }
    }

    const lines: string[] = [
      "---",
      "type: coverage-report",
      "tags: [travel, 中国]",
      `updated: ${todayISO()}`,
      "cssclasses: [atlas-note, atlas-trip]",
      "---",
      "",
      "# 走过的中国 · 足迹地图",
      "",
      `> [!abstract] 把走过的路留在地图上`,
      `> ${dayCount} 天轨迹 · 点亮 **${lit.toLocaleString()}** 格 · 中国陆地格点覆盖率 **${pct}%**`,
      "",
      ...(mapEmbed ? [mapEmbed, ""] : []),
      "> [!tip] 下一小步",
      `> ${milestoneText}`,
      "",
    ];
    if (growth.length) {
      const latestYear = growth[growth.length - 1].date.slice(0, 4);
      const recent = growth.filter((d) => d.date.startsWith(latestYear));
      const fresh = recent.reduce((n, d) => n + d.fresh, 0);
      const best = [...growth].sort((a, b) => b.fresh - a.fresh)[0];
      lines.push("## 这张地图，怎样慢慢长大", "",
        `- **最早的足迹**：${growth[0].date}，这是当前轨迹记录的起点。`,
        `- **最近有记录的一年**：${latestYear} 年，在已有足迹之外首次点亮 **${fresh.toLocaleString()}** 格。`,
        `- **开拓最多的一天**：${best.date}，首次点亮 **${best.fresh.toLocaleString()}** 格。`, "");
      lines.push(`## ${latestYear} · 每月多走一点`, "", "| 月份 | 中国陆地轨迹日 | 首次点亮 |", "| --- | --- | --- |");
      for (let month = 1; month <= 12; month++) {
        const entries = recent.filter((d) => Number(d.date.slice(5, 7)) === month);
        if (entries.length) lines.push(`| ${month} 月 | ${entries.length} | ${entries.reduce((n, d) => n + d.fresh, 0).toLocaleString()} 格 |`);
      }
      lines.push("");
      const achieved = [100, 500, 1000, 5000, 10000].map((target) => ({ target, day: growth.find((d) => d.cumulative >= target) })).filter((m) => m.day);
      if (achieved.length) {
        lines.push("> [!tip]- 已走到的里程碑");
        for (const milestone of achieved) lines.push(`> ${milestone.day!.date} · 累计点亮 ${milestone.target.toLocaleString()} 格`);
        lines.push("");
      }
    }
    const years = [...litByYear.keys()].sort();
    if (years.length) {
      lines.push("## 一年，又一年", "", "| 年份 | 当年走过 | 其中首次点亮 | 累计 | 累计覆盖率 |", "| --- | --- | --- | --- | --- |");
      const acc = new Set<string>();
      for (const y of years) {
        for (const c of litByYear.get(y)!) acc.add(c);
        const fresh = growth.filter((d) => d.date.startsWith(y)).reduce((n, d) => n + d.fresh, 0);
        lines.push(`| ${y} | ${(litByYear.get(y)!.size).toLocaleString()} | ${fresh.toLocaleString()} | ${acc.size.toLocaleString()} | ${((acc.size / total) * 100).toFixed(4)}% |`);
      }
      lines.push("");
    }
    if (provinceCells.size) {
      lines.push("## 足迹落在哪里", "", "| 省份 | 点亮格数 |", "| --- | --- |");
      for (const [name, n] of [...provinceCells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        lines.push(`| ${tableText(name)} | ${n.toLocaleString()} |`);
      }
      lines.push("");
    }
    lines.push("> [!note]- 这张地图怎样记录足迹", "> 按已导入 GPS 打点覆盖的中国陆地 geohash5 格点统计，并非精确的走过面积。格点大小随纬度变化；重新导入会更新记录。",
      `> 本次以 ${total.toLocaleString()} 个陆地格点作为分母，包含台湾；断续线符号不参与陆地覆盖计算。`);

    await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
    const path = await saveTravelNote(this.plugin.app, `${this.plugin.settings.travelFolder}/国土覆盖率.md`, lines.join("\n"),
      "## 下一站的念头\n\n" + writingPrompt("从一小段路开始", "地图上哪一处空白让你想出发？可以挑一个周末够得着的目的地。", "想在那里做什么、和谁同行？把想法链接到城市或地点笔记，留出临时改变路线的余地。"));
    new Notice(`国土覆盖率 ${pct}%（已点亮 ${lit.toLocaleString()} 格），报告已写入 ${path}`);
  }

}
