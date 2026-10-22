import { Notice, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, todayISO } from "../util/File";
import { stripSuffix } from "../model/Coverage";
import { mergeVisitDates } from "./Import";
import { saveTravelNote } from "../util/TravelNote";
import { loadAdminGeoJson, findCityFeature, type AdminFeature } from "../map/GeoJsonLoader";
import { parseExifGps } from "../util/Exif";
import { photoNote, PHOTO_PERSONAL, type PhotoStoryPoint } from "../model/PhotoNote";
import { validDay } from "../model/TravelInsights";

/**
 * 照片点亮：
 * 扫描库内 JPEG 的 EXIF GPS 与拍摄时间 → 照片手记 + 已建档地点到访日期合并。
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
          (f.extension.toLowerCase() === "jpg" || f.extension.toLowerCase() === "jpeg") &&
          !skipPrefixes.some((p) => f.path.startsWith(p)),
      );
    if (!photos.length) {
      new Notice("库里没有可扫描的 JPG（iPhone 若用 HEIC 格式，需先在相机设置里改为「兼容性最佳」才会写 JPEG）");
      return;
    }

    // 照片城市解析目前仅使用中国、日本的市级多边形。
    const datasets: { iso3: string; features: AdminFeature[] }[] = [];
    for (const iso3 of ["CHN", "JPN"]) {
      try {
        const geo = await loadAdminGeoJson("admin2", iso3);
        if (geo.features.length) datasets.push({ iso3, features: geo.features });
      } catch {
        continue;
      }
    }
    const resolveCity = (lat: number, lng: number): { name: string; country: string } | null => {
      for (const ds of datasets) {
        const hit = findCityFeature(ds, lng, lat);
        if (!hit) continue;
        const name = hit.properties?.name;
        return name ? { name, country: ds.iso3 === "CHN" ? "中国" : "日本" } : null;
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

    const story: PhotoStoryPoint[] = [];
    const datesByNote = new Map<string, Set<string>>();
    const normalizeCountry = (value: string): string => {
      if (/^(中国|中國|中华人民共和国|china|chn)$/i.test(value.trim())) return "中国";
      if (/^(日本|japan|jpn)$/i.test(value.trim())) return "日本";
      return value.trim();
    };
    for (const point of points) {
      const city = resolveCity(point.lat, point.lng);
      const target = city ? [...this.plugin.db.cities, ...this.plugin.db.places].find((c) =>
        stripSuffix(c.name) === stripSuffix(city.name) && normalizeCountry(c.country) === city.country) : undefined;
      const date = point.date && validDay(point.date) ? point.date : null;
      story.push({ file: point.file, date, location: city ? `${city.name} · ${city.country}` : null,
        locationKey: city ? `${city.country}::${city.name}` : undefined, note: target?.note, country: city?.country });
      if (target && date) {
        const dates = datesByNote.get(target.note) ?? new Set<string>();
        dates.add(date); datesByNote.set(target.note, dates);
      }
    }
    await ensureFolder(this.plugin.app, this.plugin.settings.travelFolder);
    const path = await saveTravelNote(this.plugin.app, `${this.plugin.settings.travelFolder}/照片足迹.md`,
      photoNote(story, noExif, todayISO()), PHOTO_PERSONAL);

    let merged = 0;
    this.plugin.setSuppressScan(true);
    try {
      for (const [note, dates] of datesByNote) {
        const target = [...this.plugin.db.cities, ...this.plugin.db.places].find((c) => c.note === note);
        const newDates = [...dates].filter((d) => !target?.visitDates.includes(d));
        if (newDates.length && await mergeVisitDates(this.plugin, note, newDates)) merged += newDates.length;
      }
    } finally { this.plugin.setSuppressScan(false); }
    await this.plugin.db.scan();
    this.plugin.refreshViews();
    new Notice(`照片足迹：${points.length} 张定位照片、${new Set(story.filter((p) => p.location).map((p) => p.locationKey)).size} 个已识别地点，报告已写入 ${path}` + (merged ? `；到访日期合并 ${merged} 条` : ""));
  }
}
