import { Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { validDay, type AnnualDay, type AnnualGraphicData } from "../model/TravelInsights";

export function parseAnnualGraphic(source: string): AnnualGraphicData | null {
  try {
    if (source.length > 500000) return null;
    const value = JSON.parse(source) as AnnualGraphicData;
    if (!/^\d{4}$/.test(value.year) || Number(value.year) < 1900 || Number(value.year) > 9998 ||
      !validDay(value.through) || !value.through.startsWith(value.year) || !Array.isArray(value.days) || !Array.isArray(value.months)) return null;
    const seen = new Set<string>();
    const days = value.days.slice(0, 366).filter((d) => {
      if (!d || !validDay(d.date) || !d.date.startsWith(value.year) || d.date > value.through || seen.has(d.date)) return false;
      seen.add(d.date); return true;
    }).map((d) => ({ date: d.date, km: typeof d.km === "number" && Number.isFinite(d.km) && d.km >= 0 ? d.km : null,
      places: Array.isArray(d.places) ? d.places.slice(0, 100).filter((p) => p && typeof p.name === "string" && typeof p.note === "string") : [] }));
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = value.months.find((m) => m?.month === i + 1);
      const count = (n: unknown): number => typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      return { month: i + 1, records: count(m?.records), days: Math.min(31, count(m?.days)),
        km: typeof m?.km === "number" && Number.isFinite(m.km) && m.km >= 0 ? m.km : null };
    });
    return { year: value.year, through: value.through, days, months };
  } catch { return null; }
}

/** 按月翻阅的年度日历，不写新文件；每个日期可继续打开真实日记或地点。 */
export function renderYearCalendar(
  el: HTMLElement, data: AnnualGraphicData,
  openNote?: (path: string) => void,
  diaryFor?: (date: string) => string | null,
): void {
  el.empty();
  el.addClass("atlas-year-calendar");
  let selected = [...data.months].sort((a, b) => b.days - a.days || b.records - a.records)[0]?.month ?? 1;
  let metric: "days" | "km" = "days";
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const tools = el.createDiv("atlas-year-tools");
  tools.createSpan({ text: `${data.year} 的足迹日历`, cls: "atlas-year-title" });
  const toggles = tools.createDiv("atlas-year-metrics");
  const months = el.createDiv("atlas-year-months");
  const current = el.createDiv("atlas-year-current");
  const grid = el.createDiv("atlas-year-grid");
  const detail = el.createDiv("atlas-year-detail");
  detail.setAttribute("aria-live", "polite");
  const showDetail = (day: AnnualDay): void => {
    detail.empty();
    detail.createDiv({ text: day.date, cls: "atlas-year-detail-date" });
    detail.createDiv({ text: day.km === null ? "当天有到访记录，尚无 GPS 路程。" : `GPS 记录路程约 ${day.km.toLocaleString()} km`, cls: "atlas-year-caption" });
    const links = detail.createDiv("atlas-year-detail-links");
    for (const place of day.places) {
      const button = links.createEl("button", { text: place.name });
      button.onclick = () => openNote?.(place.note);
    }
    const diary = diaryFor?.(day.date);
    if (diary) {
      const button = links.createEl("button", { text: "回到这天的日记" });
      button.onclick = () => openNote?.(diary);
    }
  };
  const renderGrid = (): void => {
    current.empty(); grid.empty(); detail.empty();
    const month = data.months[selected - 1];
    current.createSpan({ text: `${selected} 月`, cls: "atlas-year-title" });
    current.createSpan({ text: `${month.days} 个足迹日 · ${month.records} 条到访记录${month.km === null ? "" : ` · ${month.km.toLocaleString()} km`}`, cls: "atlas-year-caption" });
    for (const weekday of ["一", "二", "三", "四", "五", "六", "日"]) grid.createDiv({ text: weekday, cls: "atlas-year-weekday" });
    const first = new Date(Date.UTC(Number(data.year), selected - 1, 1));
    const padding = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(Number(data.year), selected, 0)).getUTCDate();
    for (let i = 0; i < padding; i++) grid.createDiv("atlas-year-empty");
    for (let i = 1; i <= count; i++) {
      const date = `${data.year}-${String(selected).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const day = byDate.get(date);
      const button = grid.createEl("button", { text: String(i), cls: `atlas-year-day${day ? " has-record" : ""}` });
      button.disabled = !day;
      button.title = day ? `${date} · ${day.places.map((p) => p.name).join("、") || "GPS 轨迹"}${day.km === null ? "" : ` · ${day.km} km`}` : `${date} · 无完整日期记录`;
      button.setAttribute("aria-label", button.title);
      if (day) button.onclick = () => {
        grid.querySelectorAll(".is-selected").forEach((b) => b.removeClass("is-selected"));
        button.addClass("is-selected"); showDetail(day);
      };
    }
    const firstRecord = data.days.find((d) => d.date.startsWith(`${data.year}-${String(selected).padStart(2, "0")}`));
    if (firstRecord) showDetail(firstRecord);
    else detail.createDiv({ text: month.records ? "本月只有按月记录的到访，未指定具体日期。" : "本月暂无足迹记录。", cls: "atlas-year-caption" });
  };
  const renderMonths = (): void => {
    months.empty();
    for (const month of data.months) {
      const button = months.createEl("button", { cls: `atlas-year-month${selected === month.month ? " is-selected" : ""}` });
      button.setAttribute("aria-pressed", String(selected === month.month));
      button.createSpan({ text: `${month.month} 月`, cls: "atlas-year-month-label" });
      button.createSpan({ text: metric === "days" ? `${month.days} 天` : month.km === null ? "—" : `${month.km.toLocaleString()} km`, cls: "atlas-year-month-value" });
      button.title = `${month.records} 条到访记录${month.km === null ? " · 尚无 GPS 路程" : ""}`;
      button.onclick = () => {
        selected = month.month;
        [...months.children].forEach((item, i) => {
          item.toggleClass("is-selected", i + 1 === selected);
          item.setAttribute("aria-pressed", String(i + 1 === selected));
        });
        renderGrid();
      };
    }
  };
  const buttons = ([ ["days", "足迹日"], ["km", "GPS 路程"] ] as const).map(([value, label]) => {
    const button = toggles.createEl("button", { text: label });
    button.setAttribute("aria-pressed", String(metric === value));
    button.onclick = () => { metric = value; buttons.forEach(([v, b]) => b.setAttribute("aria-pressed", String(v === value))); renderMonths(); };
    return [value, button] as const;
  });
  renderMonths(); renderGrid();
  el.createDiv({ text: "有记录的日期可点击。日历会合并同一天的多个地点，按月记录不会填满整个月。", cls: "atlas-year-caption atlas-year-legend" });
}

export function registerYearCalendar(plugin: AtlasPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("atlas-year", (source, el, ctx) => {
    const data = parseAnnualGraphic(source);
    if (!data) { el.createDiv({ text: "年度日历数据不完整，请重新生成年度回顾。" }); return; }
    renderYearCalendar(el, data, (path) => {
      if (plugin.app.vault.getAbstractFileByPath(path)) void plugin.app.workspace.openLinkText(path, ctx.sourcePath, false);
      else new Notice("这篇笔记暂时找不到，重新生成回顾可刷新链接。");
    }, (date) => plugin.app.metadataCache.getFirstLinkpathDest(date, ctx.sourcePath)?.path ?? null);
  });
}
