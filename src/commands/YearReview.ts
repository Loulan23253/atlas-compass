import { Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { stripSuffix } from "../model/Coverage";
import { ensureFolder, todayISO } from "../util/File";
import { writeReportFile } from "./CoverageReport";

/** 生成年度城市回顾：某年的到访城市数、到访次数排行、新增城市、月度分布 */
export class YearReviewCommand {
  constructor(private plugin: AtlasPlugin) {}

  async run(): Promise<void> {
    // 只需确定最近有数据的一年；逐年明细由 generate 重新聚合
    const years = new Set<string>();
    for (const c of [...this.plugin.db.cities, ...this.plugin.db.places]) {
      for (const d of c.visitDates) {
        const y = d.slice(0, 4);
        if (/^\d{4}$/.test(y)) years.add(y);
      }
    }
    if (!years.size) {
      new Notice("还没有带到访日期的城市笔记，先导入或建档");
      return;
    }
    const year = [...years].sort().pop()!;
    await this.generate(year);
  }

  private async generate(year: string): Promise<void> {
    const cities = [...this.plugin.db.cities, ...this.plugin.db.places];
    type Row = { name: string; country: string; dates: string[]; count: number; first: string };
    const rows: Row[] = [];
    for (const c of cities) {
      const inYear = c.visitDates.filter((d) => d.startsWith(year));
      if (!inYear.length) continue;
      const first = c.visitDates.length ? c.visitDates[0] : c.created ?? "";
      rows.push({ name: stripSuffix(c.name), country: c.country, dates: c.visitDates, count: c.visits, first });
    }

    const visitedThisYear = new Set(rows.map((r) => r.name));
    const newCities = rows.filter((r) => r.first.startsWith(year));
    const totalVisits = rows.reduce((n, r) => n + inYearCount(r.dates, year), 0);

    // 月度分布
    const months = new Array(12).fill(0);
    for (const r of rows) for (const d of r.dates) if (d.startsWith(year)) months[Number(d.slice(5, 7)) - 1]++;

    // 排行：按当年到访次数
    const ranked = [...rows].sort((a, b) => inYearCount(b.dates, year) - inYearCount(a.dates, year));
    const maxCount = Math.max(1, ...ranked.map((r) => inYearCount(r.dates, year)));

    const lines: string[] = [
      "---",
      `type: year-review`,
      `year: ${year}`,
      `updated: ${todayISO()}`,
      "cssclasses: atlas-trip",
      "---",
      "",
      `# 🎉 ${year} 年度回顾`,
      "",
      `> [!summary] 到访 **${visitedThisYear.size}** 城 · 新增 **${newCities.length}** 城 · 到访 **${totalVisits}** 次`,
      "",
      "## 到访排行",
      "",
      "| 城市 | 次数 | 累计 |",
      "| --- | --- | --- |",
    ];
    for (const r of ranked.slice(0, 10)) {
      const n = inYearCount(r.dates, year);
      const bar = "█".repeat(Math.max(1, Math.round((n / maxCount) * 30)));
      lines.push(`| ${r.name}（${r.country}）| ${bar} ${n} | ${r.count} |`);
    }
    lines.push("", "## 月度分布", "", "```");
    const maxM = Math.max(1, ...months);
    for (let m = 0; m < 12; m++) {
      lines.push(`${String(m + 1).padStart(2, "0")}月 ${"█".repeat(Math.round((months[m] / maxM) * 24)).padEnd(0)} ${months[m]}`);
    }
    lines.push("```", "");

    const path = `${this.plugin.settings.travelFolder}/年度回顾/${year}.md`;
    await ensureFolder(this.plugin.app, `${this.plugin.settings.travelFolder}/年度回顾`);
    await writeReportFile(this.plugin.app, path, lines.join("\n"));
    new Notice(`${year} 年度回顾已生成：${visitedThisYear.size} 座城市 → ${path}`);
  }
}

function inYearCount(dates: string[], year: string): number {
  return dates.filter((d) => d.startsWith(year)).length;
}
