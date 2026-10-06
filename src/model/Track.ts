import { distanceKm } from "../util/Geo";
import { sniffDelimiter, tokenizeCsv } from "../util/Csv";
import { findCityFeature, pointInFeature, type AdminGeoJson, type AdminFeature } from "../map/GeoJsonLoader";
import { douglasPeucker, interpolateGaps } from "./TrackClean";

/** 一个 GPS 打点（时间戳已归一为毫秒；acc/speed/alt 为 CSV 提供时直接携带，供行程识别使用） */
export interface GpsPoint {
  t: number;
  lng: number;
  lat: number;
  /** 水平精度（米），CSV 无此列时缺省 0 */
  acc?: number;
  /** 速度（m/s），CSV 无此列时由行程识别按相邻点粗算 */
  speed?: number;
  /** 海拔（米） */
  alt?: number;
}

export interface GpsDay {
  date: string;
  points: GpsPoint[];
}

const GPS_TIME_RE = /^(datatime|data_time|datetime|time|timestamp|utc_time|时间戳?|时间)$/;
const GPS_LNG_RE = /^(longitude|lng|lon|经度)$/;
const GPS_LAT_RE = /^(latitude|lat|纬度)$/;
// 可选列：运动记录类 App 导出 CSV 的 accuracy/speed/altitude，供行程识别直接使用
const GPS_ACC_RE = /^(accuracy|haccuracy|horizontalaccuracy|精度|水平精度)$/;
const GPS_SPEED_RE = /^(speed|速度)$/;
const GPS_ALT_RE = /^(altitude|alt|elevation|海拔|高度)$/;

/** 从表头识别 GPS 轨迹列（时间/经度/纬度齐全才算；acc/speed/alt 为可选） */
export function detectGpsColumns(headers: string[]): {
  t: number;
  lng: number;
  lat: number;
  acc: number;
  speed: number;
  alt: number;
} | null {
  const col = { t: -1, lng: -1, lat: -1, acc: -1, speed: -1, alt: -1 };
  headers.forEach((h, i) => {
    if (col.t < 0 && GPS_TIME_RE.test(h)) col.t = i;
    if (col.lng < 0 && GPS_LNG_RE.test(h)) col.lng = i;
    if (col.lat < 0 && GPS_LAT_RE.test(h)) col.lat = i;
    if (col.acc < 0 && GPS_ACC_RE.test(h)) col.acc = i;
    if (col.speed < 0 && GPS_SPEED_RE.test(h)) col.speed = i;
    if (col.alt < 0 && GPS_ALT_RE.test(h)) col.alt = i;
  });
  return col.t >= 0 && col.lng >= 0 && col.lat >= 0 ? col : null;
}

/** GPX 解析正则提升到模块级（trkpt 主正则为全局复用，每次调用前归零 lastIndex） */
const GPX_TRKPT_RE = /<trkpt\b([^>]*?)>([\s\S]*?)<\/trkpt>/g;
const GPX_ATTR_LAT_RE = /lat="(-?[\d.]+)"/;
const GPX_ATTR_LON_RE = /lon="(-?[\d.]+)"/;
const GPX_INNER_TIME_RE = /<time>([^<]+)<\/time>/;
const GPX_INNER_ELE_RE = /<ele>(-?[\d.]+)<\/ele>/;

/** 解析 GPX 轨迹（trkpt 的 lat/lon/ele/time；支持多 trkseg） */
export function parseGpx(content: string): GpsPoint[] {
  const pts: GpsPoint[] = [];
  GPX_TRKPT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GPX_TRKPT_RE.exec(content))) {
    const attrs = m[1];
    const latM = attrs.match(GPX_ATTR_LAT_RE);
    const lonM = attrs.match(GPX_ATTR_LON_RE);
    if (!latM || !lonM) continue;
    const lat = Number(latM[1]);
    const lng = Number(lonM[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const inner = m[2];
    const timeM = inner.match(GPX_INNER_TIME_RE);
    const eleM = inner.match(GPX_INNER_ELE_RE);
    let t = timeM ? Date.parse(timeM[1].trim()) : NaN;
    if (!Number.isFinite(t)) continue;
    const p: GpsPoint = { t, lng, lat };
    if (eleM) {
      const a = Number(eleM[1]);
      if (Number.isFinite(a)) p.alt = a;
    }
    pts.push(p);
  }
  // GPX 常已按时间升序（多 trkseg 间可能乱序）：已序时跳过稳定排序，结果不变
  let sorted = true;
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].t < pts[k - 1].t) {
      sorted = false;
      break;
    }
  }
  if (!sorted) pts.sort((a, b) => a.t - b.t);
  return pts;
}

/** 解析 GPS 轨迹 CSV：时间支持秒/毫秒时间戳，剔除无效坐标，按时间排序；可选列一并携带 */
export function parseGpsCsv(content: string): GpsPoint[] {
  const text = content.replace(/^\uFEFF/, "");
  const delim = sniffDelimiter(text);
  const table = tokenizeCsv(text, delim);
  if (table.length < 2) return [];
  const cols = detectGpsColumns(table[0].map((h) => h.trim().toLowerCase()));
  if (!cols) return [];

  // 列下标与可选列开关提到循环外（每行不再重复属性查找）；用下标遍历省去 table.slice(1) 的整表复制
  const tCol = cols.t;
  const lngCol = cols.lng;
  const latCol = cols.lat;
  const accCol = cols.acc;
  const speedCol = cols.speed;
  const altCol = cols.alt;
  const hasAcc = accCol >= 0;
  const hasSpeed = speedCol >= 0;
  const hasAlt = altCol >= 0;

  const pts: GpsPoint[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const tv = Number(cells[tCol]);
    const lng = Number(cells[lngCol]);
    const lat = Number(cells[latCol]);
    if (!Number.isFinite(tv) || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng === 0 && lat === 0) continue;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
    const p: GpsPoint = { t: tv > 1e12 ? tv : tv * 1000, lng, lat };
    if (hasAcc) {
      const v = Number(cells[accCol]);
      if (Number.isFinite(v)) p.acc = v;
    }
    if (hasSpeed) {
      const v = Number(cells[speedCol]);
      if (Number.isFinite(v)) p.speed = v;
    }
    if (hasAlt) {
      const v = Number(cells[altCol]);
      if (Number.isFinite(v)) p.alt = v;
    }
    pts.push(p);
  }
  // 导出 CSV 通常已按时间升序：已序时跳过稳定排序，结果不变
  let sorted = true;
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].t < pts[k - 1].t) {
      sorted = false;
      break;
    }
  }
  if (!sorted) pts.sort((a, b) => a.t - b.t);
  return pts;
}

/** 时间戳 → 本地时区日期（YYYY-MM-DD） */
export function localDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 按本地日期拆分轨迹 */
export function splitByDay(points: GpsPoint[]): GpsDay[] {
  const days: GpsDay[] = [];
  let cur: GpsDay | null = null;
  for (const p of points) {
    const date = localDate(p.t);
    if (!cur || cur.date !== date) {
      cur = { date, points: [] };
      days.push(cur);
    }
    cur.points.push(p);
  }
  return days;
}

const MAX_PER_DAY = 1200;

/** 抽稀：与上一保留点相距 ≥100m 或时间断档 ≥15 分钟才保留，单日上限 1200 点 */
export function simplifyDay(points: GpsPoint[]): GpsPoint[] {
  if (points.length <= 2) return points;
  // 道格拉斯-普克保形状抽稀，阈值 10m；超出每日上限时均匀再抽
  let out = douglasPeucker(points, 10);
  if (out.length > MAX_PER_DAY) {
    const step = out.length / MAX_PER_DAY;
    const thin: GpsPoint[] = [];
    for (let i = 0; i < MAX_PER_DAY - 1; i++) thin.push(out[Math.floor(i * step)]);
    thin.push(out[out.length - 1]);
    out = thin;
  }
  return out;
}

/** 单日真实路径里程：在完整打点上逐段累加（Haversine），单位 km */
export function trackLengthKm(points: GpsPoint[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    // 内联 util/Geo.distanceKm（逐运算一致），省去每段两个 {lat,lng} 中间对象分配
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(s));
  }
  return km;
}

/** 单日轨迹 → GeoJSON LineString 文件内容（properties.km 保存真实路径里程，rawPoints 为抽稀前的完整打点；extra 合并进 properties） */
export function toTrackGeoJson(
  date: string,
  points: GpsPoint[],
  rawPoints: GpsPoint[],
  extra?: Record<string, unknown>,
  inferredCoords?: number[][],
): string {
  const features: Array<Record<string, unknown>> = [
    {
      type: "Feature",
      properties: {
        name: date,
        date,
        points: points.length,
        km: Math.round(trackLengthKm(rawPoints) * 10) / 10,
        ...extra,
      },
      geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
    },
  ];
  // 长间隔插值段（飞机/高铁关 GPS 的推断航线），地图上以虚线弱化显示
  const interp = interpolateGaps(rawPoints.length ? rawPoints : points);
  if (interp.length >= 2) {
    features.push({
      type: "Feature",
      properties: { date, inferred: true },
      geometry: { type: "LineString", coordinates: interp },
    });
  }
  return JSON.stringify({ type: "FeatureCollection", features });
}

/** 到访判定档位 */
export type VisitMode = "loose" | "standard" | "strict";

/** 停留判定参数（毫秒） */
const DWELL_TOTAL_MS: Record<VisitMode, number> = {
  loose: 0, // 宽松：不要求停留（旧行为，路过也算）
  standard: 2 * 60 * 60 * 1000, // 标准：当天在该市累计 ≥2 小时，或单段连续 ≥30 分钟
  strict: 6 * 60 * 60 * 1000, // 严格：当天在该市累计 ≥6 小时（约等于过夜/半天以上）
};
const DWELL_CONTIG_MS: Record<VisitMode, number> = {
  loose: 0,
  standard: 30 * 60 * 1000,
  strict: 4 * 60 * 60 * 1000,
};
/** 相邻打点超过该间隔视为"离开再回来"（分段边界），默认 60 分钟 */
const SEGMENT_GAP_MS = 60 * 60 * 1000;
/** 高于该速度（km/h，按相邻点粗算）视为在途移动，不打断停留段但不算驻留锚点 */
const MOVING_SPEED_KMH = 35;

/** 单个国家的市级数据集 */
export interface CountryDataset {
  iso3: string;
  geo: AdminGeoJson;
}

export type VisitClass = "visit" | "pass";

export interface CityVisit {
  name: string;
  /** 所属国家 ISO3 */
  iso3: string;
  lng: number;
  lat: number;
  /** 当天在该市的累计停留毫秒数 */
  dwellMs: number;
  cls: VisitClass;
}

interface PtCity {
  p: GpsPoint;
  city: string | null;
  iso3: string | null;
  /** 与前一个点的粗略速度 km/h（首点为 0） */
  speed: number;
}

/**
 * 当天每个点归属哪个市（只做一次点面匹配，供驻留分析复用）。
 * 依次在各国数据集中查找，命中即停；全部未命中（海上/无数据国家）为 null。
 */
function classifyPoints(
  day: GpsDay,
  datasets: CountryDataset[],
  fallback?: (lat: number, lng: number) => { name: string | null; iso3: string | null } | null,
): PtCity[] {
  const out: PtCity[] = [];
  for (let i = 0; i < day.points.length; i++) {
    const p = day.points[i];
    let city: string | null = null;
    let iso3: string | null = null;
    for (const ds of datasets) {
      const hit = findCityFeature(ds.geo, p.lng, p.lat);
      if (!hit) continue;
      city = (hit.properties as { name?: string })?.name ?? null;
      iso3 = ds.iso3;
      break;
    }
    if (!city && fallback) {
      const hit = fallback(p.lat, p.lng);
      if (hit?.name && hit.iso3) {
        city = hit.name;
        iso3 = hit.iso3;
      }
    }
    let speed = 0;
    if (i > 0) {
      const prev = day.points[i - 1];
      const dtH = (p.t - prev.t) / 3600000;
      if (dtH > 0) {
        speed = (distanceKm({ lat: prev.lat, lng: prev.lng }, { lat: p.lat, lng: p.lng }) / dtH);
      }
    }
    out.push({ p, city, iso3, speed });
  }
  return out;
}

/**
 * 基于驻留分析的当天到访判定：
 * 把打点按"所在市 + 时间断档"分段，统计每个市的累计停留与最长连续停留，
 * 满足档位阈值的记为到访（visit），否则记为路过（pass）。
 * 返回按停留时长降序的所有候选市。
 */
const dayAnalysisCache = new WeakMap<GpsDay, Map<VisitMode, CityVisit[]>>();

export function analyzeDayVisits(
  day: GpsDay,
  datasets: CountryDataset[],
  mode: VisitMode,
  fallback?: (lat: number, lng: number) => { name: string | null; iso3: string | null } | null,
): CityVisit[] {
  if (!day.points.length || !datasets.length) return [];
  let byMode = dayAnalysisCache.get(day);
  if (!byMode) {
    byMode = new Map();
    dayAnalysisCache.set(day, byMode);
  }
  const cached = byMode.get(mode);
  if (cached) return cached;

  const result = analyzeDayVisitsInner(day, datasets, mode, fallback);
  byMode.set(mode, result);
  return result;
}

function analyzeDayVisitsInner(
  day: GpsDay,
  datasets: CountryDataset[],
  mode: VisitMode,
  fallback?: (lat: number, lng: number) => { name: string | null; iso3: string | null } | null,
): CityVisit[] {
  const pts = classifyPoints(day, datasets, fallback);

  // 分段：同市连续（允许中途 null 点桥接），时间断档超过 SEGMENT_GAP_MS 切段。
  // 键为 iso3::city，避免不同国家的同名区划混淆
  type Seg = { key: string; city: string; iso3: string; start: number; end: number; anchor: GpsPoint };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  for (const { p, city, iso3, speed } of pts) {
    if (!city || !iso3) continue; // 边界外点不参与分段
    const key = `${iso3}::${city}`;
    if (
      cur &&
      cur.key === key &&
      p.t - cur.end <= SEGMENT_GAP_MS &&
      speed <= MOVING_SPEED_KMH * 3
    ) {
      cur.end = p.t;
      cur.anchor = speed <= MOVING_SPEED_KMH ? p : cur.anchor;
    } else {
      cur = { key, city, iso3, start: p.t, end: p.t, anchor: p };
      segs.push(cur);
    }
  }

  // 汇总每个市的驻留：段与段之间若属同一次停留（间隔 < SEGMENT_GAP_MS 的 null 桥接已在分段保留，
  // 这里把相邻同市段的间隔也计入累计时长）
  const agg = new Map<string, { dwellMs: number; contigMs: number; anchor: GpsPoint }>();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const span = s.end - s.start;
    const a = agg.get(s.key) ?? { dwellMs: 0, contigMs: 0, anchor: s.anchor };
    const prev = segs[i - 1];
    // 与上一段之间的空档若仍属同一停留（中间无其他市），计入累计
    const gapAfterPrev =
      prev && prev.key === s.key ? Math.max(0, s.start - prev.end) : 0;
    a.dwellMs += span + gapAfterPrev;
    a.contigMs = Math.max(a.contigMs, span + gapAfterPrev);
    a.anchor = span > 0 ? s.anchor : a.anchor;
    agg.set(s.key, a);
  }
  // 单点市（无时长）：给一个最小驻留，仅 loose 模式有效
  for (const [, a] of agg) {
    if (a.dwellMs === 0) a.dwellMs = 1;
  }

  const needTotal = DWELL_TOTAL_MS[mode];
  const needContig = DWELL_CONTIG_MS[mode];

  const visits: CityVisit[] = [];
  for (const [key, a] of agg) {
    const ok = mode === "loose" || a.dwellMs >= needTotal || a.contigMs >= needContig;
    const [iso3, city] = key.split("::");
    visits.push({
      name: city,
      iso3,
      lng: a.anchor.lng,
      lat: a.anchor.lat,
      dwellMs: a.dwellMs,
      cls: ok ? "visit" : "pass",
    });
  }
  visits.sort((x, y) => y.dwellMs - x.dwellMs);
  return visits;
}
