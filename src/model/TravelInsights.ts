import type { City } from "./City";
import { TRANSPORT_LABELS } from "./StepLife";

export type TrackDays = Map<string, Record<string, unknown>>;
export interface AnnualDay {
  date: string;
  km: number | null;
  places: { name: string; note: string }[];
}
export interface TravelMonth {
  month: number;
  records: number;
  days: number;
  km: number | null;
  places: City[];
  fresh: City[];
}
export interface AnnualSnapshot {
  year: string;
  through: string;
  rows: { city: City; dates: string[] }[];
  fresh: City[];
  returning: City[];
  countries: string[];
  records: number;
  monthOnlyRecords: number;
  days: AnnualDay[];
  months: TravelMonth[];
  km: number | null;
  trackDays: number;
  longestStreak: { start: string; end: string; days: number } | null;
  transport: { mode: string; segments: number }[];
}
export interface AnnualGraphicData {
  year: string;
  through: string;
  days: AnnualDay[];
  months: { month: number; records: number; days: number; km: number | null }[];
}

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validVisit(value: string): boolean {
  return validDay(value) || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export const roundKm = (n: number): number => Math.round(n * 10) / 10;
export const nonNegative = (value: unknown): number => {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const visits = (c: City): string[] => [...new Set(c.visitDates.filter(validVisit))].sort();

export function availableYears(cities: City[], tracks: TrackDays): string[] {
  return [...new Set([
    ...cities.flatMap((c) => visits(c).map((d) => d.slice(0, 4))),
    ...[...tracks.keys()].filter(validDay).map((d) => d.slice(0, 4)),
  ])].filter((y) => Number(y) >= 1900 && Number(y) <= 9998).sort().reverse();
}

export function transportCounts(props: Iterable<Record<string, unknown>>): { mode: string; segments: number }[] {
  const counts = new Map<string, number>();
  const add = (mode: string, count: number): void => {
    if (mode && Number.isFinite(count) && count > 0) counts.set(mode, (counts.get(mode) ?? 0) + count);
  };
  for (const p of props) {
    if (Array.isArray(p.segments) && p.segments.length) {
      for (const segment of p.segments) {
        if (!segment || typeof segment !== "object") continue;
        const mode = TRANSPORT_LABELS[Number((segment as { m?: unknown }).m)] ?? "未知";
        add(mode, 1);
      }
    } else if (typeof p.transport === "string") {
      for (const part of p.transport.split(/\s*\+\s*/)) {
        const match = part.match(/^(.+?)(?:×(\d+))?$/);
        if (!match || match[1] === "无路径") continue;
        add(match[1].trim(), Math.min(100000, Number(match[2] ?? 1)));
      }
    }
  }
  return [...counts].map(([mode, segments]) => ({ mode, segments })).sort((a, b) => b.segments - a.segments || a.mode.localeCompare(b.mode));
}

/** 全日期可计入日历，按月记录仅计入月份；不把月份桩当作一整月旅行。 */
export function annualSnapshot(cities: City[], tracks: TrackDays, year: string, through = `${year}-12-31`): AnnualSnapshot {
  const inPeriod = (d: string): boolean => d.startsWith(`${year}-`) &&
    (d.length === 7 ? d <= through.slice(0, 7) : d <= through);
  const rows = cities.map((city) => ({ city, dates: visits(city).filter(inPeriod) }))
    .filter((r) => r.dates.length).sort((a, b) => b.dates.length - a.dates.length || a.city.name.localeCompare(b.city.name));
  const fresh = rows.filter(({ city }) => visits(city)[0]?.startsWith(`${year}-`)).map((r) => r.city);
  const returning = rows.filter(({ city }) => visits(city)[0]?.slice(0, 4) < year).map((r) => r.city);
  const byDay = new Map<string, AnnualDay>();
  for (const { city, dates } of rows) for (const d of dates) {
    if (!validDay(d)) continue;
    const day = byDay.get(d) ?? { date: d, km: null, places: [] };
    day.places.push({ name: city.name, note: city.note });
    byDay.set(d, day);
  }
  const trackEntries = [...tracks].filter(([d]) => validDay(d) && inPeriod(d));
  for (const [date, p] of trackEntries) {
    const day = byDay.get(date) ?? { date, km: null, places: [] };
    day.km = roundKm(nonNegative(p.km));
    byDay.set(date, day);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const months = Array.from({ length: 12 }, (_, i): TravelMonth => {
    const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
    const entries = trackEntries.filter(([d]) => d.startsWith(prefix));
    return {
      month: i + 1,
      records: rows.reduce((n, r) => n + r.dates.filter((d) => d.startsWith(prefix)).length, 0),
      days: days.filter((d) => d.date.startsWith(prefix)).length,
      km: entries.length ? roundKm(entries.reduce((n, [, p]) => n + nonNegative(p.km), 0)) : null,
      places: rows.filter((r) => r.dates.some((d) => d.startsWith(prefix))).map((r) => r.city),
      fresh: fresh.filter((c) => visits(c)[0]?.startsWith(prefix)),
    };
  });
  let streak: AnnualSnapshot["longestStreak"] = null;
  let streakStart = "";
  let lastDate = "";
  let consecutiveDays = 0;
  for (const day of days) {
    if (lastDate && Date.parse(`${day.date}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`) === 86400000) consecutiveDays++;
    else { streakStart = day.date; consecutiveDays = 1; }
    lastDate = day.date;
    if (!streak || consecutiveDays > streak.days) streak = { start: streakStart, end: day.date, days: consecutiveDays };
  }
  return {
    year, through, rows, fresh, returning,
    countries: [...new Set(rows.map((r) => r.city.country).filter((c) => c && !/^(未知|unknown)$/i.test(c)))].sort(),
    records: rows.reduce((n, r) => n + r.dates.length, 0),
    monthOnlyRecords: rows.reduce((n, r) => n + r.dates.filter((d) => d.length === 7).length, 0),
    days, months, km: trackEntries.length ? roundKm(trackEntries.reduce((n, [, p]) => n + nonNegative(p.km), 0)) : null,
    trackDays: trackEntries.length, longestStreak: streak, transport: transportCounts(trackEntries.map(([, p]) => p)),
  };
}

export function annualGraphicData(snapshot: AnnualSnapshot): AnnualGraphicData {
  return { year: snapshot.year, through: snapshot.through, days: snapshot.days,
    months: snapshot.months.map(({ month, records, days, km }) => ({ month, records, days, km })) };
}

/** 按日期去重后区分首次覆盖与重访，域外格点不参与中国覆盖率。 */
export function coverageGrowth(tracks: TrackDays, land: Set<string>): {
  date: string; visited: number; fresh: number; cumulative: number;
}[] {
  const seen = new Set<string>();
  return [...tracks].filter(([d]) => validDay(d)).sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, props]) => {
    const cells = new Set(Array.isArray(props.cells) ? props.cells.map(String).filter((c) => land.has(c)) : []);
    if (!cells.size) return [];
    let fresh = 0;
    for (const cell of cells) if (!seen.has(cell)) { seen.add(cell); fresh++; }
    return [{ date, visited: cells.size, fresh, cumulative: seen.size }];
  });
}
