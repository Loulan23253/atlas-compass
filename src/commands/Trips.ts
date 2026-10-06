import { Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, num, str, todayISO } from "../util/File";
import { stripSuffix } from "../model/Coverage";
import { readTrackDayProps } from "./CoverageReport";

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

/** 交通方式 → emoji（逐日摘要用） */
const MODE_EMOJI: Record<string, string> = {
  步行: "🚶", 骑行: "🚴", 驾车: "🚗", 高铁: "🚄", 飞机: "✈️", 公交: "🚌", 地铁: "🚇", 火车: "🚆", 未知: "🧭",
};

/** "驾车×1 + 步行×2" → "🚗 🚶🚶" */
function transportEmoji(summary: string): string {
  if (!summary || summary === "无路径") return "";
  return summary
    .split(" + ")
    .map((part) => {
      const m = part.match(/^(\D+)(?:×(\d+))?$/);
      if (!m) return part;
      const emoji = MODE_EMOJI[m[1].trim()] ?? "";
      return emoji.repeat(Math.max(1, Number(m[2] ?? 1)));
    })
    .join(" ");
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const weekdayOf = (date: string): string => {
  const d = new Date(date + "T12:00:00");
  return Number.isNaN(d.getTime()) ? "" : WEEKDAY[d.getDay()];
};

interface TripDayInfo {
  km: number;
  transport: string;
  trips: number;
  stays: number;
  avgKmh: number;
  maxKmh: number;
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
      });
    }
    const dayCities = new Map<string, string[]>();
    for (const c of [...this.plugin.db.cities, ...this.plugin.db.places]) {
      for (const d of c.visitDates) {
        const list = dayCities.get(d) ?? [];
        list.push(stripSuffix(c.name));
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
      if (cs.some((c) => stripSuffix(c) !== homeKey)) return true;
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
    let skipped = 0;
    await ensureFolder(this.plugin.app, `${this.plugin.settings.travelFolder}/旅程`);
    const elevFolder = `${this.plugin.settings.travelFolder}/轨迹/海拔`;
    for (const days of trips) {
      const start = days[0];
      const end = days[days.length - 1];
      const cities: string[] = [];
      for (const d of days) for (const c of dayCities.get(d) ?? []) if (!cities.includes(c)) cities.push(c);
      const km = Math.round(days.reduce((n, d) => n + (dayInfo.get(d)?.km ?? 0), 0) * 10) / 10;
      // 命名：单城用城市名，多城用 起→终
      const name = cities.length === 1 ? cities[0] : cities.length ? `${cities[0]} → ${cities[cities.length - 1]}` : "途中有轨迹";
      const path = `${this.plugin.settings.travelFolder}/旅程/${start} ${name}.md`;
      if (this.plugin.app.vault.getAbstractFileByPath(path)) {
        skipped++;
        continue;
      }
      // 返程判定：多日旅程首末两天到访同一座非常驻城市 → 末日是回程（D 标题不变，概览加返程行）
      const endCities = dayCities.get(end) ?? [];
      const isReturnTrip =
        days.length > 1 &&
        (dayCities.get(start) ?? []).some((c) => c !== homeKey && endCities.includes(c));
      const cityLinks = cities.map((c) => `[[${c}]]`).join(" · ");
      const frontmatter = [
        "---",
        `type: trip`,
        `start: ${start}`,
        `end: ${end}`,
        `days: ${days.length}`,
        `cities: ${cities.length}`,
        `km: ${km}`,
        `updated: ${todayISO()}`,
        "cssclasses: atlas-trip",
        "---",
        "",
      ];
      const body: string[] = [`# 🧭 ${name}`, ""];
      body.push("> [!summary] 行程概览", `> **${days.length} 天** · **${cities.length}** 座城市 · **≈ ${km} km**`, `> ${start} — ${end}`);
      if (isReturnTrip) body.push(`> ↩️ 返程：${end}`);
      body.push("");
      if (cities.length) body.push(`## 🏙️ 足迹城市`, "", cityLinks, "");
      body.push("## 📅 逐日记录", "");
      days.forEach((d, di) => {
        const info = dayInfo.get(d);
        const emoji = transportEmoji(info?.transport ?? "");
        const speed = info?.avgKmh ? ` · 均 ${info.avgKmh} km/h（峰 ${info.maxKmh}）` : "";
        const stayTxt = info?.stays ? ` · 停留 ${info.stays} 次` : "";
        body.push(`### D${di + 1} · ${d}（${weekdayOf(d)}）`, "");
        body.push(`- ${emoji || "🧭 无路径记录"}${info ? ` · ${info.km} km${speed}${stayTxt}` : ""}`);
        const dayCs = [...new Set(dayCities.get(d) ?? [])];
        if (dayCs.length) body.push(`- 📍 ${dayCs.map((c) => `[[${c}]]`).join(" · ")}`);
        // 海拔剖面：导入时生成过该日 SVG 才嵌入（用户可能未开海拔功能，须先确认存在）
        if (this.plugin.app.vault.getAbstractFileByPath(`${elevFolder}/${d}.svg`)) body.push("", `![[${d}.svg]]`);
        body.push("");
      });
      await this.plugin.app.vault.create(path, [...frontmatter, ...body].join("\n"));
      created++;
    }
    new Notice(`旅程笔记：新建 ${created} 个、已存在跳过 ${skipped} 个（Travel/旅程/）`);
  }
}
