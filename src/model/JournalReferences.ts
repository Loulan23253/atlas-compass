import type { City } from "./City";
import { validDay, validVisit } from "./TravelInsights";

export interface JournalReference {
  path: string; name: string; type: string; start?: string; end?: string; year?: string; mtime: number;
}

/** 只链接有对应到访日期的现有报告；按月记录不会被推定成某一次旅程。 */
export function relatedJournals(cities: City[], reports: JournalReference[]): JournalReference[] {
  const visits = [...new Set(cities.flatMap((c) => c.visitDates).filter(validVisit))].sort();
  const days = visits.filter(validDay);
  const years = new Set(visits.map((date) => date.slice(0, 4)));
  const matches = reports.filter((r) => r.type === "year-review" ? years.has(r.year ?? "")
    : r.type === "trip" && validDay(r.start ?? "") && validDay(r.end ?? "") && r.start! <= r.end! && days.some((d) => d >= r.start! && d <= r.end!));
  const latest = new Map<string, JournalReference>();
  for (const report of matches) {
    const key = report.type === "trip" ? `trip:${report.start}:${report.end}` : `year:${report.year}`;
    if (!latest.has(key) || report.mtime > latest.get(key)!.mtime) latest.set(key, report);
  }
  return [...latest.values()].sort((a, b) => (b.start || b.year || "").localeCompare(a.start || a.year || "") || a.path.localeCompare(b.path));
}
