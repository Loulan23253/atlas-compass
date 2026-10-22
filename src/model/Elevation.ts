import type { GpsPoint } from "./Track";
import { altitudeStats } from "./TrackClean";

export interface Elevation {
  min: number;
  max: number;
  gain: number;
  /** 累计水平里程（km）与海拔（m），最多 96 个采样，随轨迹保存。 */
  profile?: [number, number][];
}

export function readElevation(value: unknown): Elevation | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Partial<Elevation>;
  if (![e.min, e.max, e.gain].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (e.max! < e.min! || e.gain! < 0) return null;
  const profile = Array.isArray(e.profile)
    ? e.profile.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0).slice(0, 96)
    : undefined;
  return { min: e.min!, max: e.max!, gain: e.gain!, profile };
}

export function buildElevation(points: GpsPoint[]): Elevation | null {
  const stats = altitudeStats(points);
  if (!stats) return null;
  const samples: [number, number][] = [];
  let km = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const a = points[i - 1];
      const rad = Math.PI / 180;
      const h = Math.sin((p.lat - a.lat) * rad / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(p.lat * rad) * Math.sin((p.lng - a.lng) * rad / 2) ** 2;
      km += 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
    }
    if (typeof p.alt === "number" && Number.isFinite(p.alt)) samples.push([km, p.alt]);
  }
  const count = Math.min(96, samples.length);
  const profile: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const p = samples[Math.round(i * (samples.length - 1) / Math.max(1, count - 1))];
    profile.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 10) / 10]);
  }
  return { ...stats, profile };
}

/** 平地日不占据手记版面；数值为 GPS 估算，不推断徒步强度。 */
export function elevationSummary(e: Elevation | null): string {
  if (!e || (e.max - e.min < 60 && e.gain < 100 && e.max < 1000)) return "";
  return `海拔 ${e.min}–${e.max} m${e.gain >= 100 ? ` · 累计上升约 ${e.gain} m` : ""}（GPS 估算）`;
}
