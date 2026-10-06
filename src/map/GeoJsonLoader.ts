import type { FeatureCollection, Feature, Geometry } from "geojson";
import { pluginDataPath, vaultAdapter } from "../util/DataPath";

/** 行政区划级别 */
export type AdminLevel = "country" | "admin1" | "admin2";

/** 行政区划属性（统一格式） */
export interface AdminProperties {
  name: string;
  nameLocal?: string;
  iso3?: string;
  adminCode?: string;
  adcode?: number;
  level: AdminLevel;
  parent?: {
    name: string;
    code: string | number;
  };
  center?: [number, number];
  centroid?: [number, number];
  childrenNum?: number;
}

export type AdminFeature = Feature<Geometry, AdminProperties>;
export type AdminGeoJson = FeatureCollection<Geometry, AdminProperties>;

/** 数据缓存 */
const geoJsonCache = new Map<string, AdminGeoJson>();

/**
 * 使用 Obsidian vault adapter 读取文件
 */
async function readVaultFile(path: string): Promise<string | null> {
  try {
    const adapter = vaultAdapter();
    if (adapter) {
      const exists = await adapter.exists(path);
      if (exists) {
        return await adapter.read(path);
      } else {
        console.warn(`Atlas: File not found: ${path}`);
      }
    } else {
      console.warn("Atlas: App instance or vault adapter not available");
    }
  } catch (e) {
    console.error(`Atlas: Failed to read ${path}:`, e);
  }
  return null;
}

/**
 * 加载指定级别的 GeoJSON 数据
 */
export async function loadAdminGeoJson(
  level: AdminLevel,
  countryIso3?: string,
  lod: "hi" | "lo" = "hi"
): Promise<AdminGeoJson> {
  const cacheKey = `${level}|${countryIso3 || ""}|${lod}`;
  
  if (geoJsonCache.has(cacheKey)) {
    return geoJsonCache.get(cacheKey)!;
  }

  let filePath: string;
  switch (level) {
    case "country":
      filePath = `${pluginDataPath()}/countries.geojson`;
      break;
    case "admin1":
      filePath = `${pluginDataPath()}/admin1${lod === "lo" ? ".lo" : ""}.geojson`;
      break;
    case "admin2":
      if (!countryIso3 || countryIso3 === "CHN") {
        filePath = `${pluginDataPath()}/admin2/china_admin2${lod === "lo" ? ".lo" : ""}.geojson`;
      } else {
        filePath = `${pluginDataPath()}/admin2/${countryIso3.toLowerCase()}_admin2${lod === "lo" ? ".lo" : ""}.geojson`;
      }
      break;
    default:
      return emptyGeoJson();
  }
  let text = await readVaultFile(filePath);
  if (!text && lod === "lo") {
    // 简化版缺失（旧数据目录）→ 回退全精度
    filePath = filePath.replace(".lo.geojson", ".geojson");
    text = await readVaultFile(filePath);
  }
  
  try {
    if (text) {
      const data = JSON.parse(text) as AdminGeoJson;
      normalizeFeatures(data, level);
      geoJsonCache.set(cacheKey, data);
      return data;
    } else {
      console.warn(`Atlas: No data returned for ${filePath}`);
    }
  } catch (e) {
    console.error(`Atlas: Error loading ${level}:`, e);
  }

  return emptyGeoJson();
}

/**
 * 三个来源（Natural Earth 国家/省级、DataV/GADM 市级）的原始属性字段，
 * 全部可选 —— normalizeFeatures 只做字段归一，不做来源假设。
 */
interface RawAdminProps {
  name?: string;
  NAME?: string;
  NAME_LONG?: string;
  ADMIN?: string;
  NAME_ZH?: string;
  name_zh?: string;
  name_local?: string;
  nameLocal?: string;
  ISO_A3?: string;
  ADM0_A3?: string;
  adm0_a3?: string;
  sov_a3?: string;
  iso_a2?: string;
  adm1_code?: string;
  adcode?: number;
  parent?: { name?: string; adcode?: number; code?: string | number };
  center?: [number, number];
  centroid?: [number, number];
  childrenNum?: number;
}

/**
 * 标准化属性字段
 */
function normalizeFeatures(geoJson: AdminGeoJson, level: AdminLevel): void {
  for (const feature of geoJson.features) {
    const rawProps = feature.properties as RawAdminProps | null;
    if (!rawProps) continue;

    // 跳过 CRS 元数据
    if (rawProps.name === 'urn:ogc:def:crs:OGC:1.3:CRS84' ||
        rawProps.name?.startsWith('ne_')) {
      continue;
    }

    // 根据来源格式提取名称
    let name = '';
    let nameLocal = '';

    if (level === 'country') {
      name = rawProps.NAME || rawProps.NAME_LONG || rawProps.ADMIN || '';
      nameLocal = rawProps.NAME_ZH || '';
    } else if (level === 'admin1') {
      name = rawProps.name || '';
      nameLocal = rawProps.name_zh || rawProps.name_local || '';
    } else {
      name = rawProps.name || '';
      nameLocal = rawProps.nameLocal || '';
    }

    // 设置统一属性
    feature.properties = {
      name: name,
      nameLocal: nameLocal || undefined,
      // ISO_A3 对法/挪等国是 "-99"，依次回退；注意 adm0_a3 必须先于 sov_a3——
      // Natural Earth 小写字段（admin1）里中国省份的 sov_a3 是无意义的 "CH1"
      iso3:
        [rawProps.ISO_A3, rawProps.ADM0_A3, rawProps.adm0_a3, rawProps.sov_a3, rawProps.iso_a2].find(
          (v) => isValidIso3(v),
        ) || undefined,
      adminCode: rawProps.adm1_code || (rawProps.adcode ? String(rawProps.adcode) : undefined),
      adcode: rawProps.adcode || undefined,
      level: level,
      parent: rawProps.parent ? {
        name: rawProps.parent.name || '',
        code: rawProps.parent.adcode || rawProps.parent.code || ''
      } : undefined,
      center: rawProps.center || undefined,
      centroid: rawProps.centroid || undefined,
      childrenNum: rawProps.childrenNum || undefined,
    };
  }
}

/**
 * 计算要素质心（带缓存，标签层每次 moveend 都会调用）
 */
const centroidCache = new WeakMap<AdminFeature, [number, number] | null>();

export function getCentroid(feature: AdminFeature): [number, number] | null {
  if (centroidCache.has(feature)) return centroidCache.get(feature)!;
  const result = computeCentroid(feature);
  centroidCache.set(feature, result);
  return result;
}

function computeCentroid(feature: AdminFeature): [number, number] | null {
  const props = feature.properties;
  if (props?.centroid) return props.centroid;
  if (props?.center) return props.center;

  if (!feature.geometry) return null;

  if (feature.geometry.type === "Polygon") {
    const coords = feature.geometry.coordinates[0];
    return calculateCentroid(coords as [number, number][]);
  } else if (feature.geometry.type === "MultiPolygon") {
    let maxArea = 0;
    let maxCoords: [number, number][] = [];
    for (const poly of feature.geometry.coordinates) {
      const ring = poly[0] as [number, number][];
      const area = calculatePolygonArea(ring);
      if (area > maxArea) {
        maxArea = area;
        maxCoords = ring;
      }
    }
    return calculateCentroid(maxCoords);
  }
  return null;
}

function calculateCentroid(coords: [number, number][]): [number, number] {
  let sumX = 0, sumY = 0;
  for (const [x, y] of coords) {
    sumX += x;
    sumY += y;
  }
  return [sumX / coords.length, sumY / coords.length];
}

function calculatePolygonArea(coords: [number, number][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area) / 2;
}

function emptyGeoJson(): AdminGeoJson {
  return { type: "FeatureCollection", features: [] };
}

/**
 * 判断经纬度是否落在某要素内部（射线法，带 bbox 预过滤）。
 * 用于 GPS 轨迹反查所在城市。
 */
const bboxCache = new WeakMap<AdminFeature, [number, number, number, number]>();

export function pointInFeature(lng: number, lat: number, feature: AdminFeature): boolean {
  const geom = feature.geometry;
  if (!geom) return false;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return false;

  let bbox = bboxCache.get(feature);
  if (!bbox) {
    bbox = [180, 90, -180, -90];
    collectBbox(geom.coordinates, bbox);
    bboxCache.set(feature, bbox);
  }
  if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return false;

  if (geom.type === "Polygon") return polygonContains(geom.coordinates, lng, lat);
  return geom.coordinates.some((poly) => polygonContains(poly, lng, lat));
}

/**
 * 取要素 bbox（复用 pointInFeature 的缓存，不重复遍历坐标）。
 * 供标签层做视口快筛：bbox 与视口不相交，则要素的质心必不在视口内。
 * 非面要素（无 bbox 概念）返回 null，调用方应回退到精确判断。
 */
export function getFeatureBbox(feature: AdminFeature): [number, number, number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return null;

  let bbox = bboxCache.get(feature);
  if (!bbox) {
    bbox = [180, 90, -180, -90];
    collectBbox(geom.coordinates, bbox);
    bboxCache.set(feature, bbox);
  }
  return bbox;
}

/**
 * 要素级空间索引：0.5° 均匀网格 + 要素 bbox，把点面匹配的候选从全部要素
 * 降到个位数（按数据集懒构建，WeakMap 随数据回收）。
 */
interface PointIndex {
  cell: number;
  minLng: number;
  minLat: number;
  cols: number;
  cells: Map<number, number[]>;
  bboxes: Array<[number, number, number, number]>;
  features: AdminFeature[];
}

const pointIndexCache = new WeakMap<object, PointIndex>();

function buildPointIndex(geo: { features: AdminFeature[] }): PointIndex {
  const features = geo.features;
  const bboxes: Array<[number, number, number, number]> = [];
  const cell = 0.5;
  const minLng = -180;
  const minLat = -90;
  const cols = Math.ceil(360 / cell);
  const cells = new Map<number, number[]>();
  features.forEach((feat, fi) => {
    const bbox: [number, number, number, number] = [180, 90, -180, -90];
    const g = feat.geometry;
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) collectBbox(g.coordinates, bbox);
    bboxes[fi] = bbox;
    const [minx, miny, maxx, maxy] = bbox;
    if (maxx < minx) return;
    const ix0 = Math.max(0, Math.floor((minx - minLng) / cell));
    const ix1 = Math.min(cols - 1, Math.floor((maxx - minLng) / cell));
    const iy0 = Math.max(0, Math.floor((miny - minLat) / cell));
    const iy1 = Math.min(cols - 1, Math.floor((maxy - minLat) / cell));
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const key = iy * cols + ix;
        const arr = cells.get(key);
        if (arr) arr.push(fi);
        else cells.set(key, [fi]);
      }
    }
  });
  return { cell, minLng, minLat, cols, cells, bboxes, features };
}

/** 在数据集中定位包含该点的要素（网格索引加速），未命中返回 null */
export function findCityFeature(
  geo: { features: AdminFeature[] },
  lng: number,
  lat: number,
): AdminFeature | null {
  let idx = pointIndexCache.get(geo);
  if (!idx) {
    idx = buildPointIndex(geo);
    pointIndexCache.set(geo, idx);
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  const ix = Math.floor((lng - idx.minLng) / idx.cell);
  const iy = Math.floor((lat - idx.minLat) / idx.cell);
  if (ix < 0 || iy < 0 || ix >= idx.cols) return null;
  const cand = idx.cells.get(iy * idx.cols + ix);
  if (!cand) return null;
  for (const fi of cand) {
    const bbox = idx.bboxes[fi];
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    const feat = idx.features[fi];
    if (pointInFeature(lng, lat, feat)) return feat;
  }
  return null;
}

function collectBbox(coords: unknown, bbox: [number, number, number, number]): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    const [lng, lat] = coords as [number, number];
    if (lng < bbox[0]) bbox[0] = lng;
    if (lat < bbox[1]) bbox[1] = lat;
    if (lng > bbox[2]) bbox[2] = lng;
    if (lat > bbox[3]) bbox[3] = lat;
    return;
  }
  for (const c of coords) collectBbox(c, bbox);
}

function polygonContains(poly: number[][][], lng: number, lat: number): boolean {
  if (!poly.length || !pointInRing(lng, lat, poly[0])) return false;
  // 落在内环（孔洞）里则不算包含
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(lng, lat, poly[i])) return false;
  }
  return true;
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Natural Earth 用 "-99" 表示缺失的 ISO 代码。 */
export function isValidIso3(iso3: string | undefined): iso3 is string {
  return !!iso3 && iso3 !== "-99";
}

/** ISO3 → 中文国名兜底表（Natural Earth 的中文名是全称，如「中华人民共和国」） */
export const ISO3_ZH_FALLBACK: Record<string, string> = {
  CHN: "中国",
  JPN: "日本",
};

/** data/admin2/ 文件名前缀 → ISO3（新增国家市级数据时在此登记） */
const ADMIN2_PREFIX_ISO3: Record<string, string> = {
  china: "CHN",
  japan: "JPN",
};

/** 扫描 data/admin2/ 下实际存在的市级数据文件，返回可用的 ISO3 列表。
 *  注意必须用 adapter.list —— vault.getFiles() 不索引 .obsidian/ 目录 */
export async function availableAdmin2Iso3(): Promise<string[]> {
  const adapter = vaultAdapter();
  if (!adapter) return [];
  try {
    const dir = `${pluginDataPath()}/admin2`;
    const listed = await adapter.list(dir);
    const out = new Set<string>();
    for (const full of listed.files) {
      const name = full.split("/").pop() ?? "";
      const m = name.match(/^(.+?)_admin2\.geojson$/i);
      if (!m) continue;
      out.add(ADMIN2_PREFIX_ISO3[m[1].toLowerCase()] ?? m[1].toUpperCase());
    }
    return [...out];
  } catch (e) {
    console.warn("Atlas: list admin2 datasets failed:", e);
    return [];
  }
}
