import { FuzzySuggestModal, Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, str, todayISO } from "../util/File";
import { readTrackDayProps } from "./CoverageReport";
import { saveTravelNote } from "../util/TravelNote";
import { noteLink, tableText } from "../model/NoteFormat";
import { availableYears, annualSnapshot, validDay, type TrackDays } from "../model/TravelInsights";
import { yearNote, YEAR_PERSONAL, type JourneyReference } from "../model/YearNote";
import type { City } from "../model/City";
import { writingPrompt } from "../model/JournalSections";
import { travelTags } from "../model/TravelTags";

interface ReviewContext { cities: City[]; tracks: TrackDays; years: string[]; diaries: Map<string, string>; journeys: JourneyReference[]; today: string; }

export class YearReviewCommand {
  constructor(private plugin: AtlasPlugin) {}

  private async context(): Promise<ReviewContext> {
    const cities = [...this.plugin.db.cities, ...this.plugin.db.places];
    const tracks = await readTrackDayProps(this.plugin);
    const diaries = new Map<string, string>();
    const journeys = new Map<string, JourneyReference & { mtime: number }>();
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (validDay(file.basename)) diaries.set(file.basename, file.path);
      if (!file.path.startsWith(`${this.plugin.settings.travelFolder}/旅程/`)) continue;
      const fm = this.plugin.app.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (fm?.type !== "trip") continue;
      const start = str(fm.start); const end = str(fm.end);
      if (!validDay(start) || !validDay(end) || end < start) continue;
      const key = `${start}|${end}`;
      const previous = journeys.get(key);
      if (!previous || file.stat.mtime > previous.mtime) journeys.set(key, { path: file.path, name: file.basename, start, end, mtime: file.stat.mtime });
    }
    const today = todayISO();
    return { cities, tracks, years: availableYears(cities, tracks), diaries,
      journeys: [...journeys.values()].sort((a, b) => a.start.localeCompare(b.start)), today };
  }

  async run(year?: string): Promise<void> {
    const context = await this.context();
    if (!context.years.length) { new Notice("还没有带日期的到访或轨迹记录，先导入或建档。"); return; }
    if (year) {
      if (!context.years.includes(year)) { new Notice(`${year} 年还没有足迹记录。`); return; }
      await this.generate(year, context); return;
    }
    if (context.years.length === 1) { await this.generate(context.years[0], context); return; }
    new YearPicker(this.plugin, context.years, (selected) => { void this.generate(selected, context); }).open();
  }

  private async generate(year: string, context: ReviewContext, quiet = false): Promise<string> {
    await ensureFolder(this.plugin.app, `${this.plugin.settings.travelFolder}/年度回顾`);
    const path = await saveTravelNote(this.plugin.app, `${this.plugin.settings.travelFolder}/年度回顾/${year}.md`,
      yearNote(context.cities, context.tracks, year, context), YEAR_PERSONAL);
    if (!quiet) new Notice(`${year} 年度回顾已生成：${path}`);
    return path;
  }

  async runAll(): Promise<void> {
    const context = await this.context();
    if (!context.years.length) { new Notice("还没有可生成回顾的足迹记录。"); return; }
    const countries: string[] = [];
    for (const year of context.years) countries.push(...annualSnapshot(context.cities, context.tracks, year, year === context.today.slice(0, 4) ? context.today : `${year}-12-31`).countries);
    const lines = ["---", "type: year-index", `tags: ${JSON.stringify(travelTags([], countries))}`, `updated: ${context.today}`, "cssclasses: [atlas-note, atlas-trip]", "---", "", "# 一年一年，留在路上", "", "每一年都可以单独翻开。", "", "| 年份 | 到访地点 | 足迹日 | GPS 路程 |", "| --- | --- | --- | --- |"];
    this.plugin.setSuppressScan(true);
    try {
      for (const year of context.years) {
        const path = await this.generate(year, context, true);
        const snapshot = annualSnapshot(context.cities, context.tracks, year, year === context.today.slice(0, 4) ? context.today : `${year}-12-31`);
        lines.push(`| ${tableText(noteLink(path, `${year} 年`))} | ${snapshot.rows.length} | ${snapshot.days.length} | ${snapshot.km === null ? "未记录" : `${snapshot.km.toLocaleString()} km`} |`);
      }
      const path = await saveTravelNote(this.plugin.app, `${this.plugin.settings.travelFolder}/年度回顾/年度索引.md`, lines.join("\n"),
        "## 想把哪一页再翻开\n\n" + writingPrompt("给这些年份留一句旁白", "哪一年最想重温？哪段旅程还欠一个故事？", "可以写一句那一年的心情，再链接到最想重读的旅程或照片。"));
      new Notice(`已更新 ${context.years.length} 份年度回顾与年度索引：${path}`);
    } finally { this.plugin.setSuppressScan(false); }
  }
}

class YearPicker extends FuzzySuggestModal<string> {
  constructor(plugin: AtlasPlugin, private years: string[], private choose: (year: string) => void) {
    super(plugin.app); this.setPlaceholder("选择要翻开的年份…");
  }
  getItems(): string[] { return this.years; }
  getItemText(year: string): string { return `${year} 年度回顾`; }
  onChooseItem(year: string): void { this.choose(year); }
}
