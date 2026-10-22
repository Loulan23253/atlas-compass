/**
 * 中国国土格点覆盖率 —— 数据为内置的中国陆地 5 位 geohash 格全集：
 * 总格数以有效数据集为准（内置基线为 499,757 格）。
 * 「点亮」= 任一 GPS 点落在该格内；覆盖率 = 已点亮格 / 总格数（App 同口径）。
 */

import { geohashEncode } from "./WorldCityIndex";
import { pluginDataPath } from "../util/DataPath";
import { embeddedChinaCells } from "../util/Embedded";
import { loadOfflineData } from "../util/OfflineData";


let chinaCells: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

/** 懒加载国土格集合（只在首次访问读盘） */
export function loadChinaCells(readText: (path: string) => Promise<string | null>): Promise<Set<string>> {
  if (chinaCells) return Promise.resolve(chinaCells);
  if (loading) return loading;
  loading = (async () => {
    const set = await loadOfflineData([`${pluginDataPath()}/chinacells.txt`], readText, embeddedChinaCells, (raw) => {
      const text = raw.trim();
      if (!text.length || text.length % 5 || /[^0123456789bcdefghjkmnpqrstuvwxyz]/.test(text)) throw new Error("国土格点格式错误");
      const cells = new Set<string>();
      for (let i = 0; i < text.length; i += 5) cells.add(text.slice(i, i + 5));
      return cells;
    }) ?? new Set<string>();
    // 数据缺失/损坏时不缓存空集，允许下次重试
    if (set.size > 0) chinaCells = set;
    return set;
  })().finally(() => { loading = null; });
  return loading;
}

/** 一天轨迹点亮的所有 5 位 geohash 格（去重） */
export function uniqueCells(pts: Array<{ lat: number; lng: number }>): string[] {
  const set = new Set<string>();
  for (const p of pts) set.add(geohashEncode(p.lat, p.lng, 5));
  return [...set];
}
