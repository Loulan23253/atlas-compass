/**
 * 中国国土格点覆盖率 —— 数据为内置的中国陆地 5 位 geohash 格全集：
 * 全国陆地 5 位 geohash 格（约 4.9km×4.9km）共 585,426 格。
 * 「点亮」= 任一 GPS 点落在该格内；覆盖率 = 已点亮格 / 总格数（App 同口径）。
 */

import { geohashEncode } from "./WorldCityIndex";

const PLUGIN_DATA_PATH = ".obsidian/plugins/atlas_v3/data";

let chinaCells: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

/** 懒加载国土格集合（只在首次访问读盘） */
export function loadChinaCells(readText: (path: string) => Promise<string | null>): Promise<Set<string>> {
  if (chinaCells) return Promise.resolve(chinaCells);
  if (loading) return loading;
  loading = (async () => {
    const text = await readText(`${PLUGIN_DATA_PATH}/chinacells.txt`);
    const set = new Set<string>();
    if (text) {
      // 文件为 5 字符编码首尾相接的纯串
      for (let i = 0; i + 5 <= text.length; i += 5) set.add(text.slice(i, i + 5));
    }
    // 数据缺失/损坏时不缓存空集，允许下次重试
    if (set.size > 0) chinaCells = set;
    return set;
  })();
  return loading;
}

/** 一天轨迹点亮的所有 5 位 geohash 格（去重） */
export function uniqueCells(pts: Array<{ lat: number; lng: number }>): string[] {
  const set = new Set<string>();
  for (const p of pts) set.add(geohashEncode(p.lat, p.lng, 5));
  return [...set];
}
