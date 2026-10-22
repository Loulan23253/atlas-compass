import { Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, num, str, todayISO } from "../util/File";
import { stripSuffix } from "../model/Coverage";
import { readTrackDayProps } from "./CoverageReport";
import type { City } from "../model/City";
import { readElevation } from "../model/Elevation";
import { tripNote, TRIP_PERSONAL, type TripDayInfo } from "../model/TripNote";
import { saveTravelNote } from "../util/TravelNote";

/**
 * 旅程实体：把连续的活动日（有轨迹/有到访）聚合成一次"旅程"，生成笔记。
 * 间隔 ≤ gapDays 天视为同一次旅程（默认 2 天）。
 */

/** 纯函数：活动日聚类（可单测） */
export function clusterTripDays(dates: string[], gapDays = 2): string[][] {
  const sorted = [...new Set(dates)].sort();
  const dayNum = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
  const trips: string[][] = [];
  let cur: string[] = [];
  for (const d of sorted) {
    if (cur.length && dayNum(d) - dayNum(cur[cur.length - 1]) > gapDays) {
      trips.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) trips.push(cur);
  return trips;
}

export class TripsCommand {
  constructor(private plugin: AtlasPlugin) {}

  async run(): Promise<void> {
    // 活动日信息：轨迹日的里程/方式 + 城市到访日（读轨迹文件属性走共享 helper）
    const dayInfo = new Map<string, TripDayInfo>();
    for (const [date, p] of await readTrackDayProps(this.plugin)) {
      dayInfo.set(date, {
        km: num(p.km),
        transport: str(p.transport),
        trips: num(p.trips),
        stays: num(p.stays),
        avgKmh: num(p.avgKmh),
        maxKmh: num(p.maxKmh),
        elev: readElevation(p.elev),
      });
    }
    const dayCities = new Map<string, City[]>();
    for (const c of [...this.plugin.db.cities, ...this.plugin.db.places]) {
      for (const d of c.visitDates) {
        const list = dayCities.get(d) ?? [];
        list.push(c);
        dayCities.set(d, list);
      }
    }
    // 只收完整日期（常用地点的按月简化串如 2025-09 会生成月份桩）；
    // 家门口的日子（只到访常用地点、或无轨迹里程）不算旅程活动——旅程 = 离开常驻城市
    const homeKey = stripSuffix(this.plugin.settings.frequentCity.trim());
    const allDays = [...new Set([...dayInfo.keys(), ...dayCities.keys()])]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    const activityDays = allDays.filter((d) => {
      const cs = [...(dayCities.get(d) ?? [])];
      if (cs.some((c) => stripSuffix(c.name) !== homeKey)) return true;
      // 家门口的日子（只到访常用地点）不算旅程——哪怕绕家跑了 5km
      if (cs.length) return false;
      // 当天完全没有城市数据（荒野/海上轨迹）时按里程兜底
      return (dayInfo.get(d)?.km ?? 0) >= 5;
    });
    if (!activityDays.length) {
      new Notice("还没有轨迹或到访记录，无从聚合旅程");
      return;
    }

    const trips = clusterTripDays(activityDays, 2);
    let created = 0;
    let revised = 0;
    await ensureFolder(this.plugin.app, `${this.plugin.settings.travelFolder}/旅程`);
    const diaryLinks = new Map(this.plugin.app.vault.getMarkdownFiles()
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.basename))
      .map((f) => [f.basename, f.path]));
    for (const days of trips) {
      const start = days[0];
      const cities: string[] = [];
      for (const d of days) for (const c of dayCities.get(d) ?? []) if (!cities.includes(stripSuffix(c.name))) cities.push(stripSuffix(c.name));
      const name = cities.length === 1 ? cities[0] : cities.length ? `${cities[0]} → ${cities[cities.length - 1]}` : "途中有轨迹";
      const path = `${this.plugin.settings.travelFolder}/旅程/${start} ${name}.md`;
      const existed = !!this.plugin.app.vault.getAbstractFileByPath(path);
      await saveTravelNote(this.plugin.app, path,
        tripNote(name, days, dayInfo, dayCities, todayISO(), diaryLinks), TRIP_PERSONAL);
      if (existed) revised++;
      else created++;
    }
    new Notice(`旅程笔记：新建 ${created} 个、更新或另存新版 ${revised} 个（个人记录保留）`);
  }
}
