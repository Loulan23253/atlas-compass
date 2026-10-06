/**
 * 轨迹清洗算法 —— 跳变过滤 / 尖峰检测 / Z 形校正 / 共线平滑（阈值经实机数据调校）
 * （反汇编提取的常量与形态判定，逆向报告 §3）
 *
 * 管线：跳变过滤 → 尖峰检测（三角/四角折返）→ Z 形校正 → 共线平滑
 * 清洗不丢信息：被剔除的点以 ignored 数量上报，原始点仍保留在调用方。
 */

import type { GpsPoint } from "./Track";

const RAD = Math.PI / 180;

/** 球面距离（米） */
function dist(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 线段方位角的数学角（弧度，atan2(Δlat, Δlng)，东=0 北=+π/2） */
function radian(a: GpsPoint, b: GpsPoint): number {
  return Math.atan2(b.lat - a.lat, b.lng - a.lng);
}

/** 两点直线中点 */
function midpoint(a: GpsPoint, b: GpsPoint): GpsPoint {
  return {
    t: a.t,
    lng: (a.lng + b.lng) / 2,
    lat: (a.lat + b.lat) / 2,
    acc: a.acc,
    speed: a.speed,
    alt: a.alt,
  };
}

// ---- 反汇编提取的常量 ----
/** 尖峰判定：回位距离 < 0.3 × 出去两腿之和 */
const SPIKE_RETURN_RATIO = 0.3;
/** 尖峰速度阈值按被测点精度分档（米/秒）：精度越差阈值越低，越倾向于判尖峰 */
const SPIKE_SPEED_TIERS: Array<{ acc: number; speed: number }> = [
  { acc: 200, speed: 2 },
  { acc: 100, speed: 8 },
  { acc: 20, speed: 10 },
  { acc: 0, speed: 15 },
];
/** 跳变过滤：只剔除"瞬移"——隐含速度超过 300km/h 的点（细微漂移交给尖峰检测） */
const TELEPORT_SPEED_MS = 83.3;
/** Z 形判定：第 1、3 段方位角弧度和 ∈ (0, π)（近似反向） */
const COLLINEAR_MAX_LEG_M = 180; // 共线平滑：相邻两腿都不超过 180m
const COLLINEAR_TURN_RAD = 30 * RAD; // 共线平滑：转角 < 30° 视为近共线

/**
 * 尖峰检测（findSpikeIndicesWithData:...dropTriSpike:dropQuadSpike: 移植）。
 * 三角折返：A→B→C 两腿速度均超阈值且 dist(A,C) < 0.3×(腿1+腿2)，标记 B；
 * 四角折返：A→B→C→D 三腿速度均超阈值且 dist(A,D) < 0.3×三腿之和，标记 B、C。
 * 返回被标记为尖峰的下标集合。
 */
export function detectSpikeIndices(
  pts: GpsPoint[],
  opts: { dropTri?: boolean; dropQuad?: boolean } = {},
): Set<number> {
  const { dropTri = true, dropQuad = true } = opts;
  const spikes = new Set<number>();
  const n = pts.length;
  if (n < 4) return spikes;
  const speedThreshold = (acc: number): number => {
    for (const t of SPIKE_SPEED_TIERS) if (acc > t.acc) return t.speed;
    return SPIKE_SPEED_TIERS[SPIKE_SPEED_TIERS.length - 1].speed;
  };
  // 相邻步距只算一遍：tri/quad 两条检测带与 total 都复用同一腿长（原先每窗重复算 2-3 次 haversine）
  const adj = new Float64Array(n - 1);
  for (let k = 0; k + 1 < n; k++) adj[k] = dist(pts[k], pts[k + 1]);

  if (dropTri) {
    for (let i = 0; i + 2 < n; i++) {
      const dt1 = (pts[i + 1].t - pts[i].t) / 1000;
      const dt2 = (pts[i + 2].t - pts[i + 1].t) / 1000;
      const ref = pts[Math.min(i + 3, n - 1)];
      const T = speedThreshold(ref.acc ?? 0);
      const s1 = dt1 > 0 ? adj[i] / dt1 : Infinity;
      const s2 = dt2 > 0 ? adj[i + 1] / dt2 : Infinity;
      if (s1 <= T || s2 <= T) continue;
      const total = adj[i] + adj[i + 1];
      if (total <= 0) continue;
      if (dist(pts[i], pts[i + 2]) < SPIKE_RETURN_RATIO * total) spikes.add(i + 1);
    }
  }
  if (dropQuad) {
    for (let i = 0; i + 3 < n; i++) {
      const dt1 = (pts[i + 1].t - pts[i].t) / 1000;
      const dt2 = (pts[i + 2].t - pts[i + 1].t) / 1000;
      const dt3 = (pts[i + 3].t - pts[i + 2].t) / 1000;
      const T = speedThreshold(pts[i + 3].acc ?? 0);
      const s1 = dt1 > 0 ? adj[i] / dt1 : Infinity;
      const s2 = dt2 > 0 ? adj[i + 1] / dt2 : Infinity;
      const s3 = dt3 > 0 ? adj[i + 2] / dt3 : Infinity;
      if (s1 <= T || s2 <= T || s3 <= T) continue;
      const total = adj[i] + adj[i + 1] + adj[i + 2];
      if (total <= 0) continue;
      if (dist(pts[i], pts[i + 3]) < SPIKE_RETURN_RATIO * total) {
        spikes.add(i + 1);
        spikes.add(i + 2);
      }
    }
  }
  return spikes;
}

/**
 * 跳变过滤：单步距离超出时间间隔分档上限的点视为跳变。
 * （filterLocationsWithData 的 135/180/360/2000 米分级，档位配对为近似还原）
 */
export function jumpFilterIndices(pts: GpsPoint[]): Set<number> {
  const bad = new Set<number>();
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt <= 0) continue;
    if (dist(pts[i - 1], pts[i]) / dt > TELEPORT_SPEED_MS) bad.add(i);
  }
  return bad;
}

/**
 * Z 形漂移校正（TraceUtils.correctZShapeFromLocations: 移植）。
 * 4 点滑窗：第 1、3 段方位角弧度和 ∈ (0, π)（近反向）→ 中间两点合并为中点
 * （时间/精度取前一个点），消除 GPS 的横移折返。
 */
export function correctZShape(pts: GpsPoint[]): GpsPoint[] {
  if (pts.length <= 5) return pts.slice();
  const out: GpsPoint[] = [];
  let i = 0;
  while (i < pts.length) {
    if (i + 3 < pts.length) {
      const s = radian(pts[i], pts[i + 1]) + radian(pts[i + 2], pts[i + 3]);
      if (s > 0 && s < Math.PI) {
        out.push(pts[i]);
        out.push(midpoint(pts[i + 1], pts[i + 2]));
        i += 3;
        continue;
      }
    }
    out.push(pts[i]);
    i++;
  }
  return out;
}

/**
 * 共线平滑（TraceUtils.correctLocations:ratio: 近似还原）。
 * 相邻两腿均 ≤180m 且转角 <30°（近共线）的 interior 点替换为前后两点中点，抑制抖动。
 */
export function smoothCollinear(pts: GpsPoint[]): GpsPoint[] {
  if (pts.length < 3) return pts.slice();
  const out: GpsPoint[] = [pts[0]];
  let prevD = dist(pts[0], pts[1]); // 滚动缓存：d2(i-1) 即 d1(i)，相邻窗口共享一条腿
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const d1 = prevD;
    const d2 = dist(b, c);
    prevD = d2;
    if (d1 <= COLLINEAR_MAX_LEG_M && d2 <= COLLINEAR_MAX_LEG_M && d1 + d2 > 0) {
      const d3 = dist(a, c);
      // 点 B 处的夹角（余弦定理）：θ 接近 π 表示近共线
      const cos = Math.min(1, Math.max(-1, (d1 * d1 + d2 * d2 - d3 * d3) / (2 * d1 * d2)));
      const turn = Math.PI - Math.acos(cos);
      if (turn < COLLINEAR_TURN_RAD) {
        out.push({ ...midpoint(a, c), t: b.t }); // 时间取被替换点，保持时间序列单调
        continue;
      }
    }
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export interface CleanResult {
  /** 清洗后的点（原对象引用，顺序不变） */
  points: GpsPoint[];
  /** 被剔除的点数（跳变 + 尖峰 + 折返） */
  ignored: number;
  /** 被剔除点的时间戳（ms），持久化到轨迹文件供审计 */
  ignoredTs: number[];
}

/**
 * 折返检测（filterLocationsWithData 的转角判定，常量为反汇编原值；2000m 腿长上限为推断配对）：
 * 3 点窗内方向急转 >135°、且转角点腿长 ≤119s、≤2000m → 标记转角点。
 */
export function detectReversalIndices(pts: GpsPoint[]): Set<number> {
  const bad = new Set<number>();
  let prevD = 0;
  let havePrevD = false; // 上一轮的 d2 即本轮 d1（相邻窗口共享一条腿）；dt 短路时缓存作废
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const dt = (b.t - a.t) / 1000;
    if (dt > 119 || dt <= 0) {
      havePrevD = false;
      continue;
    }
    const d1 = havePrevD ? prevD : dist(a, b);
    const d2 = dist(b, c);
    prevD = d2;
    havePrevD = true;
    // 折返必须发生在有意义的移动上：两腿 ≥30m，否则静止抖动的随机方位角会大量误报
    if (d1 < 30 || d2 < 30) continue;
    if (d1 > 2000) continue;
    const speed = d1 / dt;
    // 速度超过精度分档阈值（与尖峰检测同档）：静止/慢速的转向不视为异常
    const acc = b.acc ?? 0;
    const T = acc > 200 ? 2 : acc > 100 ? 8 : acc > 20 ? 10 : 15;
    if (speed <= T) continue;
    const r1 = radian(a, b);
    const r2 = radian(b, c);
    let turn = Math.abs(r1 - r2); // 0=直行 π=掉头
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 135 * RAD) bad.add(i);
  }
  return bad;
}

/** 清洗管线：跳变过滤 + 尖峰剔除 + 折返剔除 → Z 形校正 → 共线平滑 */
export function cleanTrack(pts: GpsPoint[]): CleanResult {
  if (pts.length < 4) return { points: pts.slice(), ignored: 0, ignoredTs: [] };
  const bad = jumpFilterIndices(pts);
  for (const i of detectSpikeIndices(pts)) bad.add(i);
  for (const i of detectReversalIndices(pts)) bad.add(i);
  const kept = pts.filter((_, i) => !bad.has(i));
  const zFixed = correctZShape(kept);
  const smoothed = smoothCollinear(zFixed);
  const ignoredTs = [...bad].sort((a, b) => a - b).map((i) => pts[i].t);
  return { points: smoothed, ignored: bad.size, ignoredTs };
}

// ---- 长间隔插值（社区"插点策略"同思路：断口按直线补点，画虚线标记为推断段）----

/** 间隔 ≥10 分钟且直线距离 ≥1km 才插值 */
const INTERP_GAP_SEC = 600;
const INTERP_MIN_M = 1000;
const INTERP_SPACING_M = 100;
const INTERP_MAX_PER_GAP = 400;

/** 长间隔插值：返回 [lng, lat] 坐标数组（不含两端实测点），供地图画推断虚线 */
export function interpolateGaps(pts: GpsPoint[]): number[][] {
  const coords: number[][] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt < INTERP_GAP_SEC) continue;
    const d = dist(pts[i - 1], pts[i]);
    if (d < INTERP_MIN_M) continue;
    const n = Math.min(INTERP_MAX_PER_GAP, Math.floor(d / INTERP_SPACING_M));
    for (let k = 1; k < n; k++) {
      const f = k / n;
      coords.push([
        pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f,
        pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f,
      ]);
    }
  }
  return coords;
}

// ---- 道格拉斯-普克抽稀（TraceUtils.douglasAlgorithm:threshold: 同算法）----

/** 道格拉斯-普克：保留轨迹形状的关键点，其余剔除（threshold 单位：米） */
export function douglasPeucker(pts: GpsPoint[], threshold: number): GpsPoint[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    // 段端点与投影参数提到扫描外（原先每个点在 seg 闭包里重算一遍）；内联 dist 消去 proj 中间对象
    const a = pts[lo];
    const ax = a.lng;
    const ay = a.lat;
    const dx = pts[hi].lng - ax;
    const dy = pts[hi].lat - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = pts[i];
      let d: number;
      if (len2 === 0) {
        d = dist(a, p);
      } else {
        // 点到线段的球面近似距离（平面投影足够：相邻点跨度小）；与原 seg/dist 逐运算一致
        const t = Math.min(1, Math.max(0, ((p.lng - ax) * dx + (p.lat - ay) * dy) / len2));
        const projLng = ax + t * dx;
        const projLat = ay + t * dy;
        const dLat = (p.lat - projLat) * RAD;
        const dLng = (p.lng - projLng) * RAD;
        const s =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(projLat * RAD) * Math.cos(p.lat * RAD) * Math.sin(dLng / 2) ** 2;
        d = 2 * 6371000 * Math.asin(Math.sqrt(s));
      }
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > threshold && maxI > 0) {
      keep[maxI] = true;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}


// ---- 折返检测（filterLocationsWithData 的转角判定：转角 >135°、B 腿 ≤119s、腿长 ≤2000m）----

/** 5 位 geohash → 格子边界（GNGeoHash.divideRangeDecode 同算法），供覆盖率画格 */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohashBounds(gh: string): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;
  for (const ch of gh) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit--) {
      const val = (idx >> bit) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (val) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (val) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { minLat: latMin, maxLat: latMax, minLng: lngMin, maxLng: lngMax };
}

/** 单日海拔统计：最低/最高/累计爬升（1m 死区抑制 GPS 抖动） */
export function altitudeStats(pts: GpsPoint[]): { min: number; max: number; gain: number } | null {
  let has = false;
  let min = Infinity;
  let max = -Infinity;
  let gain = 0;
  let prev: number | null = null;
  for (const p of pts) {
    const a = p.alt;
    if (a === undefined || !Number.isFinite(a)) continue;
    has = true;
    if (a < min) min = a;
    if (a > max) max = a;
    if (prev !== null && Math.abs(a - prev) >= 1) {
      if (a > prev) gain += a - prev;
      prev = a; // 仅在变化超过死区时推进基准，缓坡累计不漏
    }
  }
  return has ? { min: Math.round(min), max: Math.round(max), gain: Math.round(gain) } : null;
}

/** 单日海拔剖面 SVG（600×140，嵌入笔记即渲染；无海拔数据的点跳过） */
export function altitudeSvg(pts: GpsPoint[], width = 600, height = 140): string | null {
  // 单遍合并：有效海拔过滤与 min/max 统计一次完成（原实现 filter → min/max → map 三趟）
  const alts: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const a = p.alt;
    if (a === undefined || !Number.isFinite(a)) continue;
    alts.push(a);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const cnt = alts.length;
  if (cnt < 2) return null;
  const span = Math.max(max - min, 1);
  const pad = 8;
  const coords = new Array<string>(cnt);
  for (let i = 0; i < cnt; i++) {
    const x = pad + (i / (cnt - 1)) * (width - pad * 2);
    const y = height - pad - ((alts[i] - min) / span) * (height - pad * 2);
    coords[i] = `${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="none"/>`,
    `  <polyline fill="none" stroke="#495057" stroke-width="1.5" points="${coords.join(" ")}"/>`,
    `  <text x="${pad}" y="${height - 2}" font-size="10" fill="#868e96">最低 ${Math.round(min)}m</text>`,
    `  <text x="${width - pad}" y="${height - 2}" font-size="10" fill="#868e96" text-anchor="end">最高 ${Math.round(max)}m</text>`,
    "</svg>",
  ].join("\n");
}
