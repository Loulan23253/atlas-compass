import type { City } from "./City";
import { hasCoords } from "./City";
import { pointInFeature, type AdminGeoJson, type AdminFeature } from "../map/GeoJsonLoader";
import { distanceKm } from "../util/Geo";

export interface CoverageItem {
  label: string;
  done: number;
  total: number;
  /** 全部行政区名（按“已去在前”排序），带是否去过标记 */
  allNames: { name: string; visited: boolean }[];
  /** 邻近推荐：与某个已探索城市相距 < 80km 的未探索行政区 */
  nearbySuggestions: { name: string; near: string; km: number }[];
}

/** 去过该市的中国笔记 */
function isChina(c: City): boolean {
  return /^(中國|中国|china)$/i.test(c.country.trim());
}

/** 去过该县的日本笔记 */
function isJapan(c: City): boolean {
  return /^(日本|japan)$/i.test(c.country.trim());
}

/** 去掉行政区划后缀，比较“北京”与“北京市”这类差异 */
const SUFFIXES = ["特别行政区", "自治州", "自治县", "特别区", "地区", "市", "県", "县", "区", "町", "村", "都", "道", "府"];

export function stripSuffix(name: string): string {
  let s = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return s;
}

/** 常见 简体→日文汉字 字形差异（东/広/岡 等），提高日本地名匹配率 */
const JP_CHARS: Record<string, string> = {
  东: "東",
  广: "広",
  冈: "岡",
  滨: "浜",
  冲: "沖",
  绳: "縄",
  泽: "澤",
  樱: "桜",
};

function normalizeJp(name: string): string {
  const mapped = name.replace(/东|广|冈|滨|冲|绳|泽|樱/g, (ch) => JP_CHARS[ch] ?? ch);
  return stripSuffix(mapped);
}

/**
 * 计算探索覆盖率（有坐标的城市笔记全部计入——右键标注、GPS 反查、日记记录都算“已探索”）：
 *  - 中国城市：笔记名（去后缀）与 china_admin2 要素名匹配
 *  - 日本都道府县：笔记名匹配到市町村后归并到其所属都道府县，
 *    或直接匹配都道府县名（如“东京”→東京都）
 */
export function computeCoverage(
  cities: City[],
  china: AdminGeoJson | null,
  japan: AdminGeoJson | null,
): CoverageItem[] {
  const tracked = cities.filter((c) => hasCoords(c));
  const items: CoverageItem[] = [];

  if (china && china.features.length) {
    const all = new Set<string>();
    for (const f of china.features) {
      const name = String((f.properties as { name?: string })?.name ?? "");
      if (name) all.add(stripSuffix(name));
    }
    const done = new Set<string>();
    for (const c of tracked) {
      if (!isChina(c)) continue;
      const n = stripSuffix(c.name);
      if (all.has(n)) {
        done.add(n);
        continue;
      }
      // 名称匹配不到（如县级市“昆山”不在地级市数据里）时，用坐标反查所属地级市
      for (const f of china.features as AdminFeature[]) {
        if (!pointInFeature(c.lng, c.lat, f)) continue;
        const nm = stripSuffix(String((f.properties as { name?: string })?.name ?? ""));
        if (nm) {
          done.add(nm);
        }
        break;
      }
    }

    // 邻近推荐：每个未探索的地级市，找与它最近（<80km）的已探索城市
    const nearbySuggestions: { name: string; near: string; km: number }[] = [];
    const centroidOf = (f: AdminFeature): [number, number] | null => {
      const props = f.properties as { center?: [number, number]; centroid?: [number, number] };
      if (props?.centroid) return props.centroid;
      if (props?.center) return props.center;
      return null;
    };
    const visitedCoords: { name: string; lng: number; lat: number }[] = [];
    // 用已探索笔记自身的坐标（更准确，县级市也在自己位置）
    for (const c of tracked) {
      if (!isChina(c)) continue;
      visitedCoords.push({ name: stripSuffix(c.name), lng: c.lng, lat: c.lat });
    }
    if (visitedCoords.length && visitedCoords.length < all.size) {
      for (const f of china.features as AdminFeature[]) {
        const props = f.properties as { name?: string };
        const nm = props?.name ? stripSuffix(props.name) : "";
        if (!nm || done.has(nm)) continue;
        const c0 = centroidOf(f);
        if (!c0) continue;
        let best: { name: string; near: string; km: number } | null = null;
        for (const v of visitedCoords) {
          const km = distanceKm({ lat: c0[1], lng: c0[0] }, { lat: v.lat, lng: v.lng });
          if (km < 80 && (!best || km < best.km)) {
            best = { name: props.name ?? nm, near: v.name, km };
          }
        }
        if (best) nearbySuggestions.push(best);
      }
      nearbySuggestions.sort((a, b) => a.km - b.km);
      nearbySuggestions.splice(8);
    }

    // 全部城市列表（原始名），已去的排前面
    const allNames = (china.features as AdminFeature[])
      .map((f) => String((f.properties as { name?: string })?.name ?? ""))
      .filter(Boolean)
      .map((name) => ({ name, visited: done.has(stripSuffix(name)) }))
      .sort((a, b) => Number(b.visited) - Number(a.visited) || a.name.localeCompare(b.name, "zh"));

    items.push({
      label: "中国城市",
      done: done.size,
      total: all.size,
      allNames,
      nearbySuggestions,
    });
  }

  if (japan && japan.features.length) {
    const muniToPref = new Map<string, string>();
    const prefByStripped = new Map<string, string>();
    const prefSet = new Set<string>();
    for (const f of japan.features) {
      const props = f.properties as { name?: string; parent?: { name?: string } };
      const pref = String(props?.parent?.name ?? "");
      const muni = String(props?.name ?? "");
      if (!pref || !muni) continue;
      prefSet.add(pref);
      muniToPref.set(normalizeJp(muni), pref);
      if (!prefByStripped.has(normalizeJp(pref))) prefByStripped.set(normalizeJp(pref), pref);
    }

    const done = new Set<string>();
    for (const c of tracked) {
      if (!isJapan(c)) continue;
      const n = normalizeJp(c.name);
      const pref = muniToPref.get(n) ?? prefByStripped.get(n);
      if (pref) {
        done.add(pref);
        continue;
      }
      // 名称匹配不到时，用坐标反查所在市町村 → 所属都道府县
      for (const f of japan.features as AdminFeature[]) {
        if (!pointInFeature(c.lng, c.lat, f)) continue;
        const pref2 = String((f.properties as { parent?: { name?: string } })?.parent?.name ?? "");
        if (pref2) {
          done.add(pref2);
        }
        break;
      }
    }

    // 邻近推荐：未去都道府县中，与已去都道府县中心相距 < 200km 的
    const nearbySuggestions: { name: string; near: string; km: number }[] = [];
    const prefCenter = new Map<string, [number, number]>();
    for (const f of japan.features as AdminFeature[]) {
      const props = f.properties as { parent?: { name?: string }; center?: [number, number]; centroid?: [number, number] };
      const pref = String(props?.parent?.name ?? "");
      if (!pref || prefCenter.has(pref)) continue;
      const c0 = props?.centroid ?? props?.center;
      if (c0) prefCenter.set(pref, c0);
    }
    const visitedPrefCoords = [...done]
      .map((p) => ({ name: p, c: prefCenter.get(p) }))
      .filter((x): x is { name: string; c: [number, number] } => !!x.c);
    if (visitedPrefCoords.length && visitedPrefCoords.length < prefSet.size) {
      for (const pref of prefSet) {
        if (done.has(pref)) continue;
        const c0 = prefCenter.get(pref);
        if (!c0) continue;
        let best: { name: string; near: string; km: number } | null = null;
        for (const v of visitedPrefCoords) {
          const km = distanceKm({ lat: c0[1], lng: c0[0] }, { lat: v.c[1], lng: v.c[0] });
          if (km < 200 && (!best || km < best.km)) {
            best = { name: pref, near: v.name, km };
          }
        }
        if (best) nearbySuggestions.push(best);
      }
      nearbySuggestions.sort((a, b) => a.km - b.km);
      nearbySuggestions.splice(8);
    }

    // 全部都道府县列表，已去的排前面
    const allNames = [...prefSet]
      .map((name) => ({ name, visited: done.has(name) }))
      .sort((a, b) => Number(b.visited) - Number(a.visited) || a.name.localeCompare(b.name, "ja"));

    items.push({
      label: "日本都道府县",
      done: done.size,
      total: prefSet.size,
      allNames,
      nearbySuggestions,
    });
  }

  return items;
}
