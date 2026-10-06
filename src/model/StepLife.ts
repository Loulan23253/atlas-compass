/**
 * 行程识别模块：路径切分 / 交通方式分类 / 驻留判定（阈值经实机数据调校）
 *
 * 路径切分: 相邻点间隔 ≥1801s 切段；每段 ≥3 点且距离 ≥20m 才算一条路径；
 *           段内指标 → 交通方式分类器（枚举 1-8）。
 * 驻留判定: 邻接聚簇（相邻步距 ≤150m 归簇），簇跨度 ≥600s（10 分钟）、
 *           位移 ≤300m 或 迂回比 ≥2.5（路径长/位移，排除直线慢走与通勤式穿越）
 *           且坏点率 <0.35 → 驻留点。相比单锚点扩散，大范围漫游日不会碎片化。
 *
 * 全程纯 CSV 驱动：acc/speed/alt 列存在时直接使用，缺失时按相邻点几何粗算补齐（slPrepare）。
 */

export interface SLPoint {
  t: number; // ms
  lat: number;
  lng: number;
  /** 水平精度（米）；CSV 无此列时按 0（视为有效） */
  acc?: number;
  /** 速度（m/s）；CSV 无此列时由 slPrepare 按相邻点粗算 */
  speed?: number;
  /** 海拔（米） */
  alt?: number;
}

export interface SLStay {
  enter: number;
  leave: number;
  lat: number;
  lng: number;
  /** 簇内点数 */
  points: number;
}

export interface SLMove {
  idx0: number;
  idx1: number; // [idx0, idx1) 点区间
  from: number;
  to: number; // ms
  distanceM: number;
  displacementM: number;
  durationSec: number;
  maxGapSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  badAccRatio: number;
  maxAltitudeM: number;
  highSpeedRatio: number;
  /** 0=未知 1=步行 2=骑行 3=驾车 4=高铁 5=飞机 6=公交 7=地铁 8=火车 */
  mode: number;
}

/** 交通方式枚举与文案 */
export const TRANSPORT_LABELS: Record<number, string> = {
  0: "未知",
  1: "步行",
  2: "骑行",
  3: "驾车",
  4: "高铁",
  5: "飞机",
  6: "公交",
  7: "地铁",
  8: "火车",
};

// ---- 常量 ----
const STAY_SPREAD_M = 150; // 驻留簇邻接步距上限
const STAY_MIN_SEC = 600; // 驻留最短时长（10 分钟）
const STAY_DISPERSION = 0.35; // 坏点率上限
const MOVE_GAP_SEC = 1801; // 相邻点间隔 ≥1801s 视为断开
const MOVE_MIN_POINTS = 3; // 每段最少点数
const MOVE_MIN_METERS = 20; // 路径最短距离
const BAD_ACC_M = 35; // hAccuracy > 35m 计坏点
const WALK_SPEED_MS = 1.67; // 高速点占比的分界（m/s）
const AVG_SPEED_CAP_KMH = 1200; // 均速合理性上限
const PLANE_INVALID_KMH = 500; // 均速/峰值 ≥500 → 无法归类（巡航航班不标注）
const PLANE_INVALID_ALT_M = 4000; // 海拔 >4000m → 无法归类
const CAR_KMH = 120; // 长行程均速≥120 → 高铁
const CAR_MIN_KMH = 25; // 驾车均速下限
const CAR_MAX_KMH = 250; // 长行程峰值>250 → 高铁
const BIKE_MIN_KMH = 7; // 骑行均速下限
const BIKE_MAX_KMH = 45; // 骑行峰值上限（超过→驾车）
const WALK_MAX_KMH = 3.5; // 步行均速上限
const TRAIN_MIN_KMH = 60; // 均速≥60 进入火车/驾车判别
const TRAIN_MAX_KMH = 160; // 峰值>160 且长行程 → 火车
const METRO_MIN_DISP_KMH = 10; // 地铁位移速度下限
const METRO_MAX_DISP_KMH = 90; // 地铁位移速度上限
const METRO_MIN_GAP = 120; // 地铁最小间隔（s）
const METRO_MIN_DUR = 180; // 地铁最短时长（s）
const METRO_MIN_DISP_M = 1500; // 地铁最小位移
const LONG_DUR = 119; // 长行程时长下限（s）
const LONG_DISP_M = 3000; // 长行程位移下限

// 模块级常量：slDistanceM 单日被调数千次，π/180 与地球半径不再逐次求值（数值不变）
const EARTH_R_M = 6371000;
const DEG_RAD = Math.PI / 180;

/** haversine 距离（米） */
export function slDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG_RAD;
  const dLng = (lng2 - lng1) * DEG_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG_RAD) * Math.cos(lat2 * DEG_RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a));
}

/**
 * 补齐缺失的 speed/acc/alt 字段（就地修改）。
 * speed 缺失时按相邻点几何距离/时间差粗算；已有值（含 -1 无效标记）保持原样。
 */
function slPrepare(pts: SLPoint[]): void {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.speed === undefined) {
      if (i === 0) p.speed = 0;
      else {
        const prev = pts[i - 1];
        const dt = (p.t - prev.t) / 1000;
        p.speed = dt > 0 ? slDistanceM(prev.lat, prev.lng, p.lat, p.lng) / dt : 0;
      }
    }
    if (p.acc === undefined) p.acc = 0;
    if (p.alt === undefined) p.alt = 0;
  }
}

/**
 * 预计算相邻步距：adj[k] = dist(pts[k], pts[k+1])（米）。
 * 驻留聚簇与行程构建都逐对求步距，先算一遍全段共享，同一 haversine 不再重复计算。
 */
function slAdjacentDistances(pts: SLPoint[]): Float64Array {
  const n = pts.length;
  const adj = new Float64Array(n > 1 ? n - 1 : 0);
  for (let k = 0; k + 1 < n; k++) {
    adj[k] = slDistanceM(pts[k].lat, pts[k].lng, pts[k + 1].lat, pts[k + 1].lng);
  }
  return adj;
}

/**
 * 驻留检测核心：接收预计算的相邻步距。
 * 聚簇步距与迂回比的路径长均直接复用 adj（求和顺序与逐对累加一致，浮点结果不变）。
 */
function slDetectStaysCore(pts: SLPoint[], adj: Float64Array): SLStay[] {
  const stays: SLStay[] = [];
  const n = pts.length;
  if (n < 2) return stays;
  let i = 0;
  while (i < n) {
    let last = i;
    while (last + 1 < n && adj[last] <= STAY_SPREAD_M) {
      last++;
    }
    const spanSec = (pts[last].t - pts[i].t) / 1000;
    if (last > i && spanSec >= STAY_MIN_SEC) {
      const displacement = slDistanceM(pts[i].lat, pts[i].lng, pts[last].lat, pts[last].lng);
      let pathLen = 0;
      for (let k = i; k < last; k++) {
        pathLen += adj[k];
      }
      // 位移小（原地）或迂回比高（在小片区域兜圈子）都算停留；直线穿越不算
      const roaming = displacement <= 300 || pathLen >= displacement * 2.5;
      if (roaming) {
        let bad = 0;
        let latSum = 0;
        let lngSum = 0;
        for (let k = i; k <= last; k++) {
          const q = pts[k];
          latSum += q.lat;
          lngSum += q.lng;
          if ((q.acc ?? 0) > BAD_ACC_M) bad++;
        }
        if (bad / (last - i + 1) < STAY_DISPERSION) {
          stays.push({
            enter: pts[i].t,
            leave: pts[last].t,
            lat: latSum / (last - i + 1),
            lng: lngSum / (last - i + 1),
            points: last - i + 1,
          });
        }
      }
    }
    i = last + 1;
  }
  return stays;
}

/**
 * 驻留点检测（邻接聚簇版）：
 * 1. 相邻点步距 ≤150m 即归入同一簇（密度连接）——绕圈漫游的整片区域聚成一簇，不再碎片化；
 * 2. 簇成立条件：跨度 ≥10 分钟 且（首尾位移 ≤300m 或 迂回比 ≥2.5——路径长/位移，
 *    排除直线慢走与通勤式穿越） 且 坏点率 <0.35。
 */
export function slDetectStays(pts: SLPoint[]): SLStay[] {
  return slDetectStaysCore(pts, slAdjacentDistances(pts));
}

/** 交通方式分类（分支顺序与阈值经实机数据调校）。
 * 运动活动数据在 Obsidian 里拿不到，5=飞机/6=公交 归 0=未知。 */
export function slClassifyMove(m: SLMove): number {
  const cnt = m.idx1 - m.idx0;
  if (cnt < 2) return 0; // 点数<2
  if (m.avgSpeedKmh < 0 || m.avgSpeedKmh > AVG_SPEED_CAP_KMH) return 0;
  const dispSpeedKmh = m.durationSec >= 1 ? (m.displacementM / 1000) / (m.durationSec / 3600) : 0;
  const longTrip =
    m.durationSec > LONG_DUR && m.displacementM >= LONG_DISP_M && cnt > 5;

  // 地铁：长间隔 + 位移速度适中 + 坏点率低（隧道丢点特征）
  if (
    cnt >= 6 &&
    m.maxGapSec >= METRO_MIN_GAP &&
    m.durationSec >= METRO_MIN_DUR &&
    m.displacementM >= METRO_MIN_DISP_M &&
    m.badAccRatio < 0.35 &&
    dispSpeedKmh >= METRO_MIN_DISP_KMH &&
    dispSpeedKmh <= METRO_MAX_DISP_KMH
  ) {
    return 7;
  }
  // 数据自洽性：峰值×1.5 < 均速 → 异常
  if (m.maxSpeedKmh >= 3 && m.maxSpeedKmh * 1.5 < m.avgSpeedKmh) return 0;
  // 荒谬速度/海拔（巡航航班）→ 未知
  if (m.avgSpeedKmh >= PLANE_INVALID_KMH || m.maxSpeedKmh > PLANE_INVALID_KMH) return 0;
  if (m.maxAltitudeM > PLANE_INVALID_ALT_M) return 0;

  // 长行程：均速≥120 → 高铁；均速≥25 且峰值>250 → 高铁
  if (longTrip && m.avgSpeedKmh >= CAR_KMH) return 4;
  if (longTrip && m.avgSpeedKmh >= CAR_MIN_KMH && m.maxSpeedKmh > CAR_MAX_KMH) return 4;
  // 均速≥60：峰值>160 且长行程 → 火车；否则驾车
  if (m.avgSpeedKmh >= TRAIN_MIN_KMH && cnt >= 5) {
    return m.maxSpeedKmh > TRAIN_MAX_KMH && longTrip ? 8 : 3;
  }
  // 驾车
  if (m.avgSpeedKmh >= CAR_MIN_KMH && cnt > 4) return 3;
  // 骑行/驾车边界
  if (m.avgSpeedKmh >= BIKE_MIN_KMH && cnt >= 5) {
    return m.maxSpeedKmh > BIKE_MAX_KMH ? 3 : 2;
  }
  if (cnt >= 5 && m.maxSpeedKmh > 20) return 2;
  if (m.avgSpeedKmh < WALK_MAX_KMH) return 1;
  // 峰值 8.5km/h 以上按高速点占比细分
  if (m.maxSpeedKmh >= 8.5 && m.highSpeedRatio >= 0.3) return 2;
  return 1;
}

/** 开头坏定位判定：hAccuracy ≥200m 视为无效（acc 缺省按 0=有效）；提升为模块函数避免每次调用重建闭包 */
function isValidFix(p: SLPoint): boolean {
  const a = p.acc ?? 0;
  return a <= 0 || a < 200;
}

/**
 * 行程构建：排序 → 跳过开头坏定位 → 驻留聚簇 → 驻留间夹的区间按 ≥1801s 细切成路径。
 * 返回驻留点 + 路径（Move）列表；"路径数" = moves.length。
 */
export function slBuildItinerary(pts: SLPoint[]): {
  stays: SLStay[];
  moves: SLMove[];
  pathCount: number;
} {
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  // 跳过开头 hAccuracy ≥200m 的坏定位，第一个 acc<200 或 acc=0 的点起步
  let start = 0;
  while (start < sorted.length && !isValidFix(sorted[start])) start++;
  if (start >= sorted.length) start = 0;
  // start=0 时直接复用排序数组，省一次整段复制（内容与 slice(0) 完全一致）
  const points = start > 0 ? sorted.slice(start) : sorted;
  slPrepare(points);
  // 相邻步距全段只算一遍：驻留聚簇与 emitMove 共用（单日数千次 haversine 的主要来源）
  const adj = slAdjacentDistances(points);

  const stays = slDetectStaysCore(points, adj);

  // 驻留之间夹的区间作为候选路径段（按点区间切，时间只用于找驻留簇的收尾点）
  const moves: SLMove[] = [];
  const bounds: Array<[number, number]> = [];
  let cursor = 0;
  for (const st of stays) {
    let endIdx = cursor;
    while (endIdx < points.length && points[endIdx].t <= st.leave) endIdx++;
    if (endIdx > cursor) bounds.push([cursor, endIdx]);
    cursor = endIdx;
  }
  if (cursor < points.length) bounds.push([cursor, points.length]);

  const emitMove = (from: number, to: number): void => {
    if (to - from < MOVE_MIN_POINTS) return; // 不足 3 点
    let distanceM = 0;
    let maxSpeedMs = 0;
    let maxGapSec = 0;
    let bad = 0;
    let maxAlt = 0;
    let high = 0;
    for (let k = from + 1; k < to; k++) {
      const prev = points[k - 1];
      const cur = points[k];
      distanceM += adj[k - 1]; // 与 slDistanceM(prev, cur) 同值：adj 为预计算的相邻步距
      const dt = (cur.t - prev.t) / 1000;
      if (dt > maxGapSec) maxGapSec = dt;
      if ((cur.acc ?? 0) > BAD_ACC_M) bad++;
      const alt = cur.alt ?? 0;
      if (alt > maxAlt) maxAlt = alt;
      const spd = cur.speed ?? 0;
      if (spd > maxSpeedMs) maxSpeedMs = spd;
      if (spd > WALK_SPEED_MS) high++;
    }
    const cnt = to - from;
    const badAccRatio = bad / Math.max(cnt - 1, 1);
    if (badAccRatio > 0.9) return; // 几乎全坏点的段丢弃
    const durationSec = (points[to - 1].t - points[from].t) / 1000;
    const displacementM = slDistanceM(
      points[from].lat,
      points[from].lng,
      points[to - 1].lat,
      points[to - 1].lng,
    );
    const move: SLMove = {
      idx0: from,
      idx1: to,
      from: points[from].t,
      to: points[to - 1].t,
      distanceM,
      displacementM,
      durationSec,
      maxGapSec,
      avgSpeedKmh: durationSec > 0 ? (distanceM / 1000) / (durationSec / 3600) : 0,
      maxSpeedKmh: maxSpeedMs * 3.6,
      badAccRatio,
      maxAltitudeM: maxAlt,
      highSpeedRatio: cnt > 1 ? high / (cnt - 1) : 0,
      mode: 0,
    };
    if (move.distanceM < MOVE_MIN_METERS) return; // 距离 ≥20m 才算路径
    move.mode = slClassifyMove(move);
    moves.push(move);
  };

  for (const [idx0, idx1] of bounds) {
    // 段内相邻点间隔 ≥1801s 切段
    let segStart = idx0;
    for (let k = idx0 + 1; k < idx1; k++) {
      if ((points[k].t - points[k - 1].t) / 1000 < MOVE_GAP_SEC) continue;
      emitMove(segStart, k);
      segStart = k;
    }
    if (segStart < idx1) emitMove(segStart, idx1);
  }

  return { stays, moves, pathCount: moves.length };
}

export interface SLDayResult {
  pathCount: number;
  modeCounts: Record<number, number>;
  stays: SLStay[];
  /** 各路径段明细（供手动修正交通方式） */
  moves: SLMove[];
  summary: string;
}

/** 单日识别：路径数 + 方式分布（供导入预览与轨迹文件属性） */
export function slAnalyzeDay(pts: SLPoint[]): SLDayResult {
  const { stays, moves, pathCount } = slBuildItinerary(pts);
  const modeCounts: Record<number, number> = {};
  for (const m of moves) modeCounts[m.mode] = (modeCounts[m.mode] ?? 0) + 1;
  const parts = Object.entries(modeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${TRANSPORT_LABELS[Number(k)] ?? "未知"}×${v}`);
  return {
    pathCount,
    modeCounts,
    stays,
    moves,
    summary: parts.length ? parts.join(" + ") : "无路径",
  };
}
