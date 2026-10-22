import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AdminFeature, AdminProperties, AdminLevel } from "./GeoJsonLoader";
import nationalText from "../../data/china-country.geojson";
import provincesText from "../../data/admin2/china_admin1.geojson";

type LandGeometry = Polygon | MultiPolygon;
interface RawProvince {
  name?: string; adcode?: number | string; center?: [number, number]; centroid?: [number, number];
}
let land: Feature<LandGeometry, AdminProperties> | null = null;
let provinces: Feature<LandGeometry, AdminProperties>[] | null = null;
let symbols: Feature<MultiPolygon, { name: string; role: string }> | null = null;

/** DataV 原始国家轮廓；已分离断续线符号，陆地仍含台湾、港澳及南海岛礁。 */
export function chinaLandFeature(): Feature<LandGeometry, AdminProperties> {
  if (!land) {
    const raw = JSON.parse(nationalText) as FeatureCollection<LandGeometry>;
    land = { type: "Feature", geometry: raw.features[0].geometry,
      properties: { name: "中国", nameLocal: "中国", iso3: "CHN", adcode: 100000, level: "country" } };
  }
  return land;
}

function prepareProvinces(): void {
  if (provinces && symbols) return;
  const raw = JSON.parse(provincesText) as FeatureCollection<LandGeometry, RawProvince>;
  provinces = [];
  for (const feature of raw.features) {
    const p = feature.properties;
    if (String(p.adcode) === "100000_JD") {
      if (feature.geometry.type !== "MultiPolygon") throw Error("断续线数据类型不符");
      symbols = { type: "Feature", geometry: feature.geometry, properties: { name: "南海断续线及东海相关线段", role: "boundary-symbol" } };
      continue;
    }
    provinces.push({ type: "Feature", geometry: feature.geometry, properties: {
      name: p.name || "", nameLocal: p.name, iso3: "CHN", adcode: Number(p.adcode), level: "admin1",
      center: p.center, centroid: p.centroid, parent: { name: "中国", code: 100000 },
    } });
  }
  if (!symbols || provinces.length !== 34) throw Error("中国省级或断续线数据不完整");
}

export function chinaProvinceFeatures(): Feature<LandGeometry, AdminProperties>[] {
  prepareProvinces(); return provinces!;
}

/** 采用数据源内置的离散符号原坐标；不把海域符号当作陆地或城市。 */
export function chinaBoundarySymbols(): Feature<MultiPolygon, { name: string; role: string }> {
  prepareProvinces(); return symbols!;
}

export function applyChinaCartography(features: AdminFeature[], level: AdminLevel, country?: string): AdminFeature[] {
  const chinaCodes = new Set(["CHN", "TWN", "HKG", "MAC"]);
  if (level === "country") {
    return [...features.filter((f) => !chinaCodes.has(f.properties?.iso3 ?? "")), chinaLandFeature()];
  }
  if (level === "admin1") {
    return [...features.filter((f) => !chinaCodes.has(f.properties?.iso3 ?? "")), ...chinaProvinceFeatures()];
  }
  if (!country || country === "CHN") {
    return features.filter((f) => String(f.properties?.adcode) !== "100000_JD").map((f) => {
      f.properties.iso3 = "CHN";
      // 仅有省级轮廓的区域如实标为省级，不能冒充地级市数据。
      if ([710000, 810000, 820000].includes(Number(f.properties.adcode))) f.properties.level = "admin1";
      return f;
    });
  }
  return features;
}
