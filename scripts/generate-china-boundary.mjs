#!/usr/bin/env node
/** DataV 原始全国轮廓分离陆地与断续线符号；不抽稀、不手绘、不改变坐标。 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = "https://geo.datav.aliyun.com/areas_v3/bound/100000.json";
const source = process.argv[2]
  ? JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"))
  : await (await fetch(url)).json();
const provinces = JSON.parse(readFileSync(resolve(root, "data/admin2/china_admin1.geojson"), "utf8"));
const symbols = provinces.features.find((f) => String(f.properties?.adcode) === "100000_JD");
const national = source.features?.find((f) => f.properties?.adcode === 100000);
if (national?.geometry?.type !== "MultiPolygon" || symbols?.geometry?.type !== "MultiPolygon") throw Error("DataV 全国/断续线数据格式不符");
const keys = new Set(symbols.geometry.coordinates.map((p) => JSON.stringify(p)));
const land = national.geometry.coordinates.filter((p) => !keys.has(JSON.stringify(p)));
const removed = national.geometry.coordinates.length - land.length;
if (removed !== keys.size || removed < 9) throw Error("断续线符号无法完整匹配，停止生成以免混入陆地");
const output = {
  type: "FeatureCollection",
  source: { url, provider: "DataV GeoAtlas / AMAP", retrieved: new Date().toISOString().slice(0, 10), removedCartographicSymbols: removed },
  features: [{ type: "Feature", properties: { NAME: "China", NAME_ZH: "中国", ISO_A3: "CHN", ADM0_A3: "CHN", adcode: 100000 },
    geometry: { type: "MultiPolygon", coordinates: land } }],
};
writeFileSync(resolve(root, "data/china-country.geojson"), JSON.stringify(output));
console.log(`保留陆地多边形 ${land.length}，分离断续线符号 ${removed}；坐标原样保留。`);
