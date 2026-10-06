import { Notice, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, todayISO } from "../util/File";
import { stripSuffix } from "../model/Coverage";
import { geohashEncode } from "../model/WorldCityIndex";
import { mergeVisitDates } from "./Import";
import { writeReportFile } from "./CoverageReport";
import { loadAdminGeoJson, findCityFeature, type AdminFeature } from "../map/GeoJsonLoader";
import { parseExifGps } from "../util/Exif";

/**
 * 照片点亮：
 * 扫描库内 JPEG 的 EXIF GPS 与拍摄时间 → 城市/格点 → 照片足迹报告 + 到访日期合并。
 */

interface PhotoPoint {
  lat: number;
  lng: number;
  date: string | null; // 拍摄日（YYYY-MM-DD）
  file: string;
}

export class PhotoFootprintCommand {
  constructor(private plugin: AtlasPlugin) {}

  async run(): Promise<void> {
    const skipPrefixes = [
      this.plugin.app.vault.configDir,
      `${this.plugin.settings.travelFolder}/轨迹/`,
      ".zcode",
      ".trash",
    ];
    const photos = this.plugin.app.vault
      .getFiles()
      .filter(
        (f) =>
          f instanceof TFile &&
          (f.extension === "jpg" || f.extension === "jpeg") &&
          !skipPrefixes.some((p) => f.path.startsWith(p)),
      );
    if (!photos.length) {
      new Notice("库里没有可扫描的 JPG（iPhone 若用 HEIC 格式，需先在相机设置里改为「兼容性最佳」才会写 JPEG）");
      return;
    }

    // 城市解析：admin2（多国）→ 世界城市库兜底
    const datasets: { iso3: string; features: AdminFeature[] }[] = [];
    for (const iso3 of ["CHN", "JPN"]) {
      try {
        const geo = await loadAdminGeoJson("admin2", iso3);
        if (geo.features.length) datasets.push({ iso3, features: geo.features });
      } catch {
        continue;
      }
    }
    const resolveCity = (lat: number, lng: number): string | null => {
      for (const ds of datasets) {
        const hit = findCityFeature(ds, lng, lat);
        if (!hit) continue;
        return hit.properties?.name ?? null;
      }
      return null; // 照片不落世界库（避免误报），报告里归"域外"
    };

    new Notice(`扫描 ${photos.length} 张照片的 EXIF…`);
    const points: PhotoPoint[] = [];
    let noExif = 0;
    const progress = new Notice(`扫描 0/${photos.length} 张…`, 0);
    let done = 0;
    for (const f of photos) {
      try {
        const ab = await this.plugin.app.vault.adapter.readBinary(f.path);
        const buf = new Uint8Array(ab, 0, Math.min(262144, ab.byteLength));
        const exif = parseExifGps(buf);
        if (exif) points.push({ lat: exif.lat, lng: exif.lng, date: exif.date, file: f.path });
        else noExif++;
      } catch {
        noExif++;
      }
      done++;
      if (done % 200 === 0 || done === photos.length) {
        progress.setMessage(`扫描 ${done}/${photos.length} 张…`);
        await new Promise((r) => window.setTimeout(r, 0));
      }
    }
    progress.hide();
    if (!points.length) {
      new Notice(`照片里没有 EXIF 定位（${noExif} 张无 GPS；HEIC 格式不支持，需相机改「兼容性最佳」）`);
      return;
    }

    // 聚合：城市 × 日期
    const cityMap = new Map<string, { name: string; dates: Set<string>; files: string[] }>();
    const cells = new Set<string>();
    const years = new Map<string, number>();
    for (const p of points) {
      cells.add(geohashEncode(p.lat, p.lng, 5));
      const city = resolveCity(p.lat, p.lng);
      const key = city ?? "（域外/未识别）";
      let e = cityMap.get(key);
      if (!e) {
        e = { name: key, dates: new Set(), files: [] };
        cityMap.set(key, e);
      }
      e.files.push(p.file);
      if (p.date) {
        e.dates.add(p.date);
        const y = p.date.slice(0, 4);
        years.set(y, (years.get(y) ?? 0) + 1);
      }
    }
    // 点亮格数（有照片的格即点亮——照片也是足迹）

    const ranked = [...cityMap.values()].sort((a, b) => b.files.length - a.files.length);
    const lines: string[] = [
      "---",
      "type: photo-report",
      `updated: ${todayISO()}`,
      "cssclasses: atlas-trip",
      "---",
      "",
      "# 📷 照片足迹",
      "",
      `> [!summary] 定位照片 ${points.length} 张 · 涉及 ${cityMap.size} 个地点`,
      `> 无定位 ${noExif} 张 · EXIF 格点可与 GPS 覆盖率叠加`,
      "",
      "## 城市排行",
      "",
      "| 地点 | 照片数 | 到访日期 |",
      "| --- | --- | --- |",
    ];
    for (const c of ranked.slice(0, 15)) {
      const dates = [...c.dates].sort();
      lines.push(`| ${stripSuffix(c.name)} | ${c.files.length} | ${dates.slice(0, 3).join("、")}${dates.length > 3 ? " 等" : ""} |`);
    }
    lines.push("", "## 按年分布", "", "```");
    for (const y of [...years.keys()].sort()) lines.push(`${y}: ${"█".repeat(Math.min(40, Math.ceil((years.get(y)! / Math.max(...years.values())) * 24)))} ${years.get(y)}`);
    lines.push("```", "", "> 照片位置来自 EXIF GPS（iPhone 相机默认开启）。报告由「照片点亮足迹」命令生成。");

    const path = `${this.plugin.settings.travelFolder}/照片足迹.md`;
    await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
    await writeReportFile(this.plugin.app, path, lines.join("\n"));

    // 到访日期合并：有拍摄日的照片按城市并入 visitDates（复用 GPS 导入的合并逻辑）
    let merged = 0;
    for (const [key, c] of cityMap) {
      if (key === "（域外/未识别）" || !c.dates.size) continue;
      const target = this.plugin.db.cities.find((x) => stripSuffix(x.name) === key) ?? this.plugin.db.places.find((x) => stripSuffix(x.name) === key);
      if (!target) continue;
      const newDates = [...c.dates].filter((d) => !target.visitDates.includes(d));
      if (!newDates.length) continue;
      if (await mergeVisitDates(this.plugin, target.note, newDates)) {
        merged += newDates.length;
      }
    }
    new Notice(`照片足迹：${points.length} 张定位照片、${cityMap.size} 地点，报告已写入 ${path}` + (merged ? `；到访日期合并 ${merged} 条` : ""));
  }
}
