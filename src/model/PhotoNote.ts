import { noteLink, tableText } from "./NoteFormat";
import { validDay } from "./TravelInsights";
import { travelTags } from "./TravelTags";
import { sectionMarkdown, writingPrompt, PHOTO_BEYOND } from "./JournalSections";

export interface PhotoStoryPoint {
  file: string;
  date: string | null;
  location: string | null;
  locationKey?: string;
  note?: string;
  country?: string;
}

/** 只用 EXIF 与现有地点笔记串联相册，不替用户编写拍摄见闻。 */
export function photoNote(points: PhotoStoryPoint[], noGps: number, today: string): string {
  const dated = points.filter((p) => p.date && validDay(p.date)).sort((a, b) => a.date!.localeCompare(b.date!) || a.file.localeCompare(b.file));
  const byDay = new Map<string, PhotoStoryPoint[]>();
  const locations = new Map<string, PhotoStoryPoint[]>();
  const years = new Map<string, number>();
  for (const p of points) {
    const key = p.locationKey || p.location || "未识别地点";
    const group = locations.get(key) ?? []; group.push(p); locations.set(key, group);
    if (!p.date || !validDay(p.date)) continue;
    const day = byDay.get(p.date) ?? []; day.push(p); byDay.set(p.date, day);
    const year = p.date.slice(0, 4); years.set(year, (years.get(year) ?? 0) + 1);
  }
  const identified = new Set(points.filter((p) => p.location).map((p) => p.locationKey || p.location));
  const dense = [...byDay].sort(([a, av], [b, bv]) => bv.length - av.length || a.localeCompare(b))[0];
  const countries = points.map((p) => p.country).filter((country): country is string => typeof country === "string" && !!country);
  const lines = ["---", "type: photo-report", `tags: ${JSON.stringify(travelTags([], countries))}`, `updated: ${today}`, "cssclasses: [atlas-note, atlas-trip]", "---", "", "# 镜头里的旅途", "",
    "> [!abstract] 用照片，把路上的片刻接起来", `> **${points.length}** 张定位照片 · **${identified.size}** 个已识别地点 · **${byDay.size}** 个有拍摄日期的日子`, "",
    "## 相册里的时间线索", "",
  ];
  if (dated.length) lines.push(`- **记录的起止**：${dated[0].date} — ${dated[dated.length - 1].date}。`);
  if (dense) lines.push(`- **镜头最多的一天**：${dense[0]}，留下 ${dense[1].length} 张定位照片。`);
  if (points.length > dated.length) lines.push(`- **还没有拍摄日期**：${points.length - dated.length} 张照片，放在地点收藏中，不推断拍摄顺序。`);
  lines.push("");
  if (dated.length) {
    lines.push("## 最早与最近的两幕", "");
    const ends = dated.length > 1 && dated[0].file !== dated[dated.length - 1].file ? [dated[0], dated[dated.length - 1]] : [dated[0]];
    for (const [index, p] of ends.entries()) {
      lines.push(`### ${index === 0 ? "最早" : "最近"} · ${p.date}`, "",
        p.note ? noteLink(p.note, p.location || "地点笔记") : p.location || "地点尚未识别", "", `!${noteLink(p.file, "360")}`, "");
    }
  }
  const moments = [...byDay].sort(([a, av], [b, bv]) => bv.length - av.length || a.localeCompare(b)).slice(0, 6).sort(([a], [b]) => a.localeCompare(b));
  if (moments.length) {
    lines.push("## 几个镜头密集的日子", "", "| 拍摄日 | 定位照片 | 镜头里的地点 |", "| --- | --- | --- |");
    for (const [date, photos] of moments) {
      const names = [...new Set(photos.map((p) => p.note ? noteLink(p.note, p.location || "地点笔记") : p.location || "未识别地点"))];
      lines.push(`| ${date} | ${photos.length} | ${names.map(tableText).join(" · ")} |`);
    }
    lines.push("");
  }
  lines.push("## 按地点，收好这些照片", "");
  const ranked = [...locations.values()].sort((a, b) => b.length - a.length || a[0].file.localeCompare(b[0].file));
  for (const photos of ranked.slice(0, 5)) {
    const sorted = [...photos].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.file.localeCompare(b.file));
    const place = sorted[0];
    const dates = [...new Set(sorted.map((p) => p.date).filter((date): date is string => date !== null && validDay(date)))];
    lines.push(`### ${place.location || "还没认出的风景"}`, "",
      `${photos.length} 张照片${dates.length ? ` · ${dates[0]}${dates.length > 1 ? ` — ${dates[dates.length - 1]}` : ""}` : " · 拍摄日期缺失"}`, "");
    if (place.note) lines.push(`地点手记 → ${noteLink(place.note, place.location || "打开笔记")}`, "");
    lines.push(`!${noteLink(place.file, "320")}`, "", "> [!note]- 打开这个地点的照片");
    for (const p of sorted.slice(0, 12)) lines.push(`> - ${noteLink(p.file, p.file.split("/").pop())}${p.date ? ` · ${p.date}` : ""}`);
    if (sorted.length > 12) lines.push(`> 另有 ${sorted.length - 12} 张同地点照片未逐项展开。`);
    lines.push("");
  }
  if (ranked.length > 5) {
    lines.push("> [!note]- 其余地点索引");
    for (const group of ranked.slice(5)) lines.push(`> - ${group[0].note ? noteLink(group[0].note, group[0].location || "地点笔记") : group[0].location || "未识别地点"} · ${group.length} 张`);
    lines.push("");
  }
  if (years.size) {
    lines.push("## 翻过的年份", "", "| 年份 | 定位照片 |", "| --- | --- |");
    for (const year of [...years.keys()].sort()) lines.push(`| ${year} | ${years.get(year)} |`);
    lines.push("");
  }
  lines.push("> [!note]- 关于这些照片", `> ${noGps} 张照片无可用 GPS，未计入相册。照片位置与拍摄日期来自 JPEG EXIF，目前只有中国、日本可识别城市。`,
    "> 照片顺序依据有记录的拍摄日期；同一天没有可靠时刻顺序。照片格点尚未纳入 GPS 覆盖率。", "");
  return lines.join("\n");
}

export const PHOTO_PERSONAL = `## 选一张，写下它的故事

${writingPrompt("从一张照片开始", "把最喜欢的照片拖到这里：是什么让你按下快门？", "它可以拍得不完美，只要能让你回到当时。")}

${sectionMarkdown(PHOTO_BEYOND)}

## 还想再拍一次的地方

${writingPrompt("给下一次相遇留个位置", "想在另一个时段、另一个季节再拍哪里？还想把谁带进画面？", "可链接到 [[地点笔记]]，把位置和想法一起收好。")}`;
