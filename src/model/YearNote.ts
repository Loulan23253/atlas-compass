import type { City } from "./City";
import { travelTags } from "./TravelTags";
import { annualSnapshot, annualGraphicData, validDay, validVisit, type TrackDays } from "./TravelInsights";
import { noteLink, tableText } from "./NoteFormat";
import { sectionMarkdown, writingPrompt, YEAR_CHOICES } from "./JournalSections";

export interface JourneyReference { path: string; name: string; start: string; end: string; }
export interface YearNoteOptions {
  today: string;
  diaries?: Map<string, string>;
  journeys?: JourneyReference[];
}
const kmText = (n: number | null): string => n === null ? "未记录" : `${n.toLocaleString()} km`;
const signed = (n: number): string => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
const cityLinks = (cities: City[]): string => cities.map((c) => noteLink(c.note, c.name)).join(" · ");

export function yearNote(cities: City[], tracks: TrackDays, year: string, options: YearNoteOptions): string {
  const currentYear = options.today.slice(0, 4) === year;
  const through = currentYear ? options.today : `${year}-12-31`;
  const data = annualSnapshot(cities, tracks, year, through);
  const previousYear = String(Number(year) - 1);
  let previousThrough = `${previousYear}-${through.slice(5)}`;
  if (!validDay(previousThrough)) previousThrough = `${previousYear}-02-28`;
  const previous = annualSnapshot(cities, tracks, previousYear, previousThrough);
  const previousHasData = previous.records > 0 || previous.trackDays > 0;
  const dateLink = (date: string): string => options.diaries?.has(date) ? noteLink(options.diaries.get(date)!, date) : date;
  const countriesNew = data.countries.filter((country) => {
    const dates = cities.filter((c) => c.country === country).flatMap((c) => c.visitDates.filter(validVisit)).sort();
    return dates[0]?.startsWith(year);
  });
  const lines = [
    "---", "type: year-review", `tags: ${JSON.stringify(travelTags([], data.countries))}`, `year: ${year}`, `through: ${through}`, `updated: ${options.today}`,
    "cssclasses: [atlas-note, atlas-trip]", "---", "", `# ${year} · 把这一年留在路上`, "",
    `> [!abstract] ${currentYear && through.slice(5) !== "12-31" ? `写到 ${through} 的年度手记` : "这一年的足迹"}`,
    `> **${data.rows.length}** 个地点 · **${data.fresh.length}** 个首次记录的地点 · **${data.countries.length}** 个国家/地区`,
    ">",
    `> **${data.days.length}** 个有完整日期的足迹日${data.km !== null ? ` · GPS 记录约 **${kmText(data.km)}**` : " · 暂无 GPS 路程数据"}`,
    "", "## 属于这一年的几个瞬间", "",
  ];
  const strongest = [...data.months].sort((a, b) => b.days - a.days || b.records - a.records)[0];
  if (strongest.days || strongest.records) lines.push(`- **最密集的月份**：${strongest.month} 月，${strongest.days} 个足迹日、${strongest.records} 条到访记录。`);
  const farthest = [...data.days].filter((d) => d.km !== null && d.km > 0).sort((a, b) => b.km! - a.km!)[0];
  if (farthest) lines.push(`- **路程最多的一天**：${dateLink(farthest.date)}，已记录约 ${kmText(farthest.km)}${farthest.places.length ? `，到访记录包括${farthest.places.map((c) => noteLink(c.note, c.name)).join("、")}` : ""}。`);
  if (data.returning.length) lines.push(`- **再次出现的老地方**：${cityLinks(data.returning.slice(0, 5))}${data.returning.length > 5 ? `等 ${data.returning.length} 个地点` : ""}。`);
  if (countriesNew.length) lines.push(`- **首次有记录的国家/地区**：${countriesNew.join("、")}。`);
  if (data.longestStreak && data.longestStreak.days >= 2) lines.push(`- **最长连续记录**：${data.longestStreak.start} — ${data.longestStreak.end}，连续 ${data.longestStreak.days} 天留有足迹。这表示记录连续，不等同于一次旅行。`);
  if (data.days.length) lines.push(`- **这段记录的起止**：${dateLink(data.days[0].date)} — ${dateLink(data.days[data.days.length - 1].date)}。`);
  if (!data.days.length) lines.push("目前只有按月记录的到访信息，日历会在补充完整日期或 GPS 轨迹后点亮。");
  lines.push("", "## 这一年的出发节奏", "", "点击月份切换路程与足迹，点击有记录的日期查看当天地点。", "", "```atlas-year", JSON.stringify(annualGraphicData(data)), "```", "");
  const quarters = [0, 1, 2, 3].map((index) => {
    const months = data.months.slice(index * 3, index * 3 + 3);
    const places = [...new Map(months.flatMap((m) => m.places).map((c) => [c.note, c])).values()];
    const days = months.reduce((n, m) => n + m.days, 0);
    const records = months.reduce((n, m) => n + m.records, 0);
    const recordedKm = months.filter((m) => m.km !== null);
    return { index, places, days, records, km: recordedKm.length ? recordedKm.reduce((n, m) => n + m.km!, 0) : null };
  }).filter((q) => q.records || q.days);
  if (quarters.length) {
    lines.push("## 把这一年，折成几张书签", "", "| 时间 | 有记录的片刻 | 目的地书签 |", "| --- | --- | --- |");
    for (const q of quarters) lines.push(`| ${q.index * 3 + 1}—${q.index * 3 + 3} 月 | ${q.days} 个足迹日${q.km !== null ? ` · ${kmText(Math.round(q.km * 10) / 10)}` : ""}${!q.days && q.records ? "（仅有按月到访）" : ""} | ${q.places.length ? q.places.slice(0, 3).map((c) => tableText(noteLink(c.note, c.name))).join(" · ") + (q.places.length > 3 ? ` 等 ${q.places.length} 个地点` : "") : "尚无对应地点笔记"} |`);
    lines.push("");
  }
  lines.push("## 和上一年对照", "");
  if (previousHasData) {
    lines.push(currentYear && through.slice(5) !== "12-31" ? `比较范围：两年各自的 1 月 1 日至 ${through.slice(5).replace("-", " 月 ")} 日。` : `比较范围：${previousYear} 与 ${year} 的完整年度。`, "",
      `| 已记录的足迹 | ${previousYear} | ${year} | 变化 |`, "| --- | --- | --- | --- |",
      `| 到访地点 | ${previous.rows.length} | ${data.rows.length} | ${signed(data.rows.length - previous.rows.length)} |`,
      `| 首次记录的地点 | ${previous.fresh.length} | ${data.fresh.length} | ${signed(data.fresh.length - previous.fresh.length)} |`,
      `| 完整日期的足迹日 | ${previous.days.length} | ${data.days.length} | ${signed(data.days.length - previous.days.length)} |`,
      `| GPS 路程 | ${kmText(previous.km)} | ${kmText(data.km)} | ${data.km === null || previous.km === null ? "数据不足" : `${signed(data.km - previous.km)} km`} |`, "",
      "> 对比的是库内已记录的足迹。两年的导入范围和到访判定不同，会影响结果。", "");
    const ranges = [previous, data].map((s) => {
      const dates = s.days.filter((d) => d.km !== null).map((d) => d.date);
      return dates.length ? `${s.year}：${dates[0]} — ${dates[dates.length - 1]}（${s.trackDays} 天）` : `${s.year}：暂无 GPS 轨迹`;
    });
    lines.push("> [!info]- 本次比较所用的 GPS 记录范围", ...ranges.map((range) => `> ${range}`), "");
  } else lines.push(`库内还没有 ${previousYear} 同期的足迹记录，暂不作增减比较。`, "");
  if (data.fresh.length) lines.push("## 第一次，把这些名字写进记录", "", cityLinks(data.fresh), "");
  if (data.rows.length) {
    lines.push("> [!note]- 一年里的目的地", "> | 地点 | 到访记录 | 本年首次 | 本年最近 |", "> | --- | --- | --- | --- |");
    for (const { city, dates } of data.rows) lines.push(`> | ${tableText(noteLink(city.note, city.name))} · ${tableText(city.country)} | ${dates.length} | ${dates[0]} | ${dates[dates.length - 1]} |`);
    lines.push("");
  }
  lines.push("## 按月份，翻回当时", "");
  for (const month of data.months.filter((m) => m.records || m.days)) {
    lines.push(`### ${month.month} 月${month.places.length ? ` · ${month.places.length} 个地点` : ""}`, "",
      `${month.days} 个足迹日${month.km !== null ? ` · 已记录约 ${kmText(month.km)}` : ""}。`, "");
    if (month.places.length) lines.push(cityLinks(month.places), "");
    if (month.fresh.length) lines.push(`本月首次记录：${cityLinks(month.fresh)}。`, "");
  }
  if (data.transport.length) {
    const total = data.transport.reduce((n, m) => n + m.segments, 0);
    lines.push("> [!info]- 这一年，怎么在路上", "> | 交通方式 | 记录的出行段 | 占比 |", "> | --- | --- | --- |");
    for (const mode of data.transport) lines.push(`> | ${tableText(mode.mode)} | ${mode.segments} | ${Math.round(mode.segments / total * 100)}% |`);
    lines.push("> 占比按记录的出行段数计算，不代表路程或时间占比；交通方式可手动修正。", "");
  }
  const journeys = (options.journeys ?? []).filter((j) => j.start <= through && j.end >= `${year}-01-01`);
  if (journeys.length) {
    lines.push("## 把这些旅程再翻一遍", "");
    for (const j of journeys) lines.push(`- ${noteLink(j.path, j.name)} · ${j.start} — ${j.end}`);
    lines.push("");
  }
  lines.push("> [!note]- 怎样理解这些数字", `> 共 ${data.records} 条地点到访记录${data.monthOnlyRecords ? `，其中 ${data.monthOnlyRecords} 条只精确到月份，不会填充日历中的具体日期` : ""}。同一天到访多个地点，在日历中只计一天。`,
    "> GPS 路程涵盖已导入轨迹中的各种交通方式，不是步行距离；首次记录不等同于人生第一次到访。", "");
  return lines.join("\n");
}

export const YEAR_PERSONAL = `## 想留下的年度画面

${writingPrompt("为这一年挑几张照片", "选一个新地方、一处老地方，再留一张很普通却想记住的画面。", "在照片旁写下为什么选择它，或者链接到那天的日记。")}

${sectionMarkdown(YEAR_CHOICES)}

## 有些事，数字没有记下来

${writingPrompt("让回顾留一点自己的声音", "哪次出发改变了心情？有没有一段关系、一种习惯，悄悄变得不同？", "也可以写一次没能出发的计划，以及留在原地的收获。")}

## 留给下一年的三个念头

${writingPrompt("一处地方，一个人，一种节奏", "想去或重返哪里？想和谁一起？希望怎样度过在路上的时间？", "把愿望链接到城市或地点笔记，不必急着排满行程。")}`;
