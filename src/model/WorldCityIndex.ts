/**
 * 世界城市索引 —— 内置离线城市库（GeoNames cities15000，34,149 城），
 * 匹配方式同其 findeCityIndex:withLocation:andCityGeoArray:：算定位点 geohash，
 * 在同前缀格里取最近城市（g5 ≈ 4.9km 格 → g3 ≈ 156km 格逐级放宽）。
 *
 * 用途：admin2 市级多边形只覆盖中国/日本等已登记国家，其余国家用本索引兜底，
 * 让海外 GPS 轨迹也能落到"到访城市"。
 */


/** 库内城市条目（字段缩写以贴近 worldcities.json 的体积开销） */
interface WorldCity {
  n: string; // 英文名
  z: string; // 中文名（无译名时 = 英文名）
  c: string; // 国家英文名
  la: number;
  lo: number;
  g5: string;
  g3: string;
}

/** 解析命中结果 */
interface WorldCityHit {
  name: string;
  country: string;
  lat: number;
  lng: number;
  distKm: number;
}

import { pluginDataPath } from "../util/DataPath";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** 标准 geohash 编码（同 GNGeoHash 算法） */
export function geohashEncode(lat: number, lng: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bit = (bit << 1) + 1;
        lngMin = mid;
      } else {
        bit = bit << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }
    even = !even;
    bits++;
    if (bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface WorldCityCache {
  cities: WorldCity[];
  byG5: Map<string, number[]>;
  byG3: Map<string, number[]>;
}

let cache: WorldCityCache | null = null;

let loading: Promise<WorldCityCache> | null = null;

/** 懒加载 + 建 geohash 桶索引（只在首次访问读盘） */
export function loadWorldCityIndex(
  readText: (path: string) => Promise<string | null>,
): Promise<WorldCityCache> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = (async () => {
    let cities: WorldCity[] = [];
    try {
      const text = await readText(`${pluginDataPath()}/worldcities.json`);
      cities = text ? (JSON.parse(text) as WorldCity[]) : [];
    } catch (e) {
      // 数据文件损坏 → 空库降级（不抛出，允许下次重试加载）
      console.error("Atlas: worldcities.json 解析失败，世界城市兜底停用:", e);
      cities = [];
    }
    const byG5 = new Map<string, number[]>();
    const byG3 = new Map<string, number[]>();
    cities.forEach((c, i) => {
      const a = byG5.get(c.g5);
      if (a) a.push(i);
      else byG5.set(c.g5, [i]);
      const b = byG3.get(c.g3);
      if (b) b.push(i);
      else byG3.set(c.g3, [i]);
    });
    if (cities.length === 0) {
      loading = null; // 数据文件损坏/缺失：不落缓存，下次重试
      return { cities, byG5, byG3 };
    }
    cache = { cities, byG5, byG3 };
    return cache;
  })();
  return loading;
}

/** 最近城（同 g5 格优先，无则同 g3 格；格内按球面距离取最近） */
export function resolveWorldCity(lat: number, lng: number): WorldCityHit | null {
  if (!cache) return null;
  const g5 = geohashEncode(lat, lng, 5);
  let ids = cache.byG5.get(g5);
  if (!ids?.length) {
    const g3 = geohashEncode(lat, lng, 3);
    ids = cache.byG3.get(g3);
  }
  if (!ids?.length) return null;
  let best: WorldCity | null = null;
  let bestDist = Infinity;
  for (const i of ids) {
    const c = cache.cities[i];
    const d = distKm(lat, lng, c.la, c.lo);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best) return null;
  return { name: best.z, country: best.c, lat: best.la, lng: best.lo, distKm: Math.round(bestDist * 10) / 10 };
}
