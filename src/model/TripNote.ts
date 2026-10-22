import type { City } from "./City";
import { travelTags } from "./TravelTags";
import { noteLink, tableText } from "./NoteFormat";
import { elevationSummary, type Elevation } from "./Elevation";
import { transportCounts, validVisit } from "./TravelInsights";
import { sectionMarkdown, writingPrompt, COMPANIONS } from "./JournalSections";

export interface TripDayInfo {
  km: number;
  transport: string;
  trips: number;
  stays: number;
  avgKmh: number;
  maxKmh: number;
  elev: Elevation | null;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const dayNumber = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const modes = (transport: string): string => transport.split(" + ").map((s) => s.replace(/×\d+$/, "").trim()).filter((s) => s && s !== "未知" && s !== "无路径").join("、");
const kmText = (n: number): string => Math.round(n * 10) / 10 + " km";

/** 不虚构见闻：旅程线索来自真实日期、地点和轨迹，个人故事留在可编辑区。 */
export function tripNote(
  name: string,
  days: string[],
  dayInfo: Map<string, TripDayInfo>,
  dayCities: Map<string, City[]>,
  updated: string,
  diaryLinks: Map<string, string> = new Map(),
): string {
  const start = days[0];
  const end = days[days.length - 1];
  const calendarDays = dayNumber(end) - dayNumber(start) + 1;
  const cities = new Map<string, { city: City; dates: string[] }>();
  for (const d of days) for (const c of dayCities.get(d) ?? []) {
    const entry = cities.get(c.note) ?? { city: c, dates: [] };
    if (!entry.dates.includes(d)) entry.dates.push(d);
    cities.set(c.note, entry);
  }
  const trackDays = days.filter((d) => dayInfo.has(d));
  const km = Math.round(trackDays.reduce((n, d) => n + dayInfo.get(d)!.km, 0) * 10) / 10;
  const mostTravelled = [...trackDays].sort((a, b) => dayInfo.get(b)!.km - dayInfo.get(a)!.km)[0];
  const lines = [
    "---", "type: trip", `tags: ${JSON.stringify(travelTags([], [...cities.values()].map(({city}) => city.country)))}`, `start: ${start}`, `end: ${end}`, `days: ${calendarDays}`,
    `recordedDays: ${days.length}`, `cities: ${cities.size}`, `km: ${km}`, `updated: ${updated}`,
    "cssclasses: [atlas-note, atlas-trip]", "---", "", `# ${name} · 旅途手记`, "",
    `> [!abstract] 这一程`,
    `> ${start} — ${end} · ${calendarDays} 天${days.length < calendarDays ? `，其中 ${days.length} 天有记录` : ""}`,
    ">",
    `> ${cities.size ? `${cities.size} 个地点` : "沿途地点待补充"}${trackDays.length ? ` · 已记录路程约 ${kmText(km)}` : " · 尚无 GPS 轨迹"}`,
    "", "## 旅程里的几个片段", "",
  ];
  if (cities.size) lines.push(`足迹留在 ${[...cities.values()].map(({ city }) => noteLink(city.note, city.name)).join(" · ")}。`, "");
  if (mostTravelled && dayInfo.get(mostTravelled)!.km > 0) {
    const info = dayInfo.get(mostTravelled)!;
    lines.push(`路程最多的一天是 **${mostTravelled}**，记录了约 **${kmText(info.km)}**${modes(info.transport) ? `，交通记录包含${modes(info.transport)}` : ""}。`, "");
  }
  const mostStays = [...trackDays].sort((a, b) => dayInfo.get(b)!.stays - dayInfo.get(a)!.stays)[0];
  if (mostStays && dayInfo.get(mostStays)!.stays >= 2) lines.push(`**${mostStays}** 留下的 GPS 停留片段最多，共 **${dayInfo.get(mostStays)!.stays} 处**；有些故事，也许就藏在这些停下来的时候。`, "");
  const fresh = [...cities.values()].filter(({ city }) => {
    const first = [...city.visitDates].filter(validVisit).sort()[0];
    return first && first >= start && first <= end;
  });
  if (fresh.length) lines.push(`这一次，${fresh.map(({ city }) => noteLink(city.note, city.name)).join("、")}首次出现在你的到访记录里。`, "");
  const returning = [...cities.values()].filter(({ city }) => [...city.visitDates].filter(validVisit).sort()[0] < start);
  if (returning.length) lines.push(`更早已有到访记录的地方：${returning.map(({ city }) => noteLink(city.note, city.name)).join(" · ")}。`, "");
  const changes: string[] = [];
  let previousPlaces = "";
  for (const date of days) {
    const locations = dayCities.get(date) ?? [];
    if (!locations.length) continue;
    const key = locations.map((c) => c.note).sort().join("|");
    if (key === previousPlaces) continue;
    previousPlaces = key;
    changes.push(`> - ${date} · ${locations.map((c) => noteLink(c.note, c.name)).join(" · ")}`);
  }
  if (changes.length > 1) lines.push("> [!note]- 沿途地点，怎样出现在记录里", ...changes,
    "> 同一天的多个地点并列展示，不推断具体先后顺序。", "");
  const transport = transportCounts(trackDays.map((d) => ({ transport: dayInfo.get(d)!.transport })));
  if (transport.length) {
    lines.push("> [!info]- 这一程的交通记录", "> | 方式 | 出行段数 |", "> | --- | --- |");
    for (const mode of transport) lines.push(`> | ${tableText(mode.mode)} | ${mode.segments} |`);
    lines.push("> 统计的是出行段数，不是各方式的路程；可在 Atlas 中修正分类。", "");
  }
  lines.push("## 一天一页", "");
  for (const d of days) {
    const info = dayInfo.get(d);
    const locations = dayCities.get(d) ?? [];
    const weekday = WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
    lines.push(`### ${start.slice(0, 4) === end.slice(0, 4) ? d.slice(5).replace("-", ".") : d} · ${weekday}`, "");
    if (locations.length) lines.push(locations.map((c) => noteLink(c.note, c.name)).join(" · "), "");
    if (info) {
      const travelModes = modes(info.transport);
      lines.push(`${travelModes ? `${travelModes} · ` : ""}记录路程约 **${kmText(info.km)}**。`, "");
      const elevation = elevationSummary(info.elev);
      if (elevation) lines.push(elevation, "");
      const details = [
        info.trips ? `${info.trips} 段出行` : "",
        info.stays ? `${info.stays} 处停留记录` : "",
        info.avgKmh > 0 ? `移动均速约 ${info.avgKmh} km/h` : "",
      ].filter(Boolean);
      if (details.length) lines.push("> [!info]- 当天的轨迹数据", `> ${details.join(" · ")}`, "> 由 GPS 估算；交通方式可在 Atlas 中修正。", "");
    } else lines.push("这天有到访记录，尚无 GPS 路程数据。", "");
    const diary = diaryLinks.get(d);
    if (diary) lines.push(`回到这天的日记 → ${noteLink(diary, d)}`, "");
  }
  if (cities.size) {
    lines.push("> [!note]- 沿途地点索引", "> | 地点 | 首次记录于本程 | 有记录的天数 |", "> | --- | --- | --- |");
    for (const { city, dates } of cities.values()) lines.push(`> | ${tableText(noteLink(city.note, city.name))} | ${dates[0]} | ${dates.length} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export const TRIP_PERSONAL = `## 这一程，最想留下的画面

${writingPrompt("用三幕把旅程留住", "抵达时的第一眼 · 途中一个小细节 · 离开前的最后一幕", "挑一张照片放在每一幕旁边，写下当时的声音、心情或一句原话。")}

${sectionMarkdown(COMPANIONS)}

## 想再走一遍的地方

${writingPrompt("给喜欢的地方留一个入口", "一家小店、一段散步的路、一道没吃够的菜，附上 [[地点笔记]]。", "如果再有一天时间，你想怎样安排？")}

## 留给下一次

${writingPrompt("记一件值得保留和一件可以改变的事", "这次的节奏、交通或住处，有什么经验值得带到下一次？", "没走到的地方、想带来的人，以及一件不用赶着完成的小事。")}`;
