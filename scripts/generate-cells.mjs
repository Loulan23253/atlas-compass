#!/usr/bin/env node
/**
 * 中国国土格点栅格化脚本 —— data/chinacells.txt 的唯一再生成入口。
 *
 * 遍历 geohash5 规范格（纬度 12bit × 经度 13bit，共 4096×8192 格，约 4.9km×4.9km），
 * 取格心（索引中心）对 Natural Earth 中国多边形做包含测试，命中的格输出为
 * 排序后的 5 字符格串首尾相接纯文本（无分隔符、无换行），
 * 与 src/model/LandCoverage.ts 的读取方式（每 5 字符一格）一致。
 *
 * 包含测试用扫描线法：先按行（纬度）收集多边形所有环的扫描线交叉点
 * （公式、边的方向与 src/map/GeoJsonLoader.ts 的 pointInRing 射线法完全一致），
 * 再对格心经度二分数交叉点 —— 与逐点射线法结果相同，但快几个数量级。
 *
 * 用法：node scripts/generate-cells.mjs
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(PROJECT_ROOT, "data/countries.geojson");
const DST = resolve(PROJECT_ROOT, "data/chinacells.txt");

const LAT_CELLS = 1 << 12; // 纬度 12bit → 4096 行
const LNG_CELLS = 1 << 13; // 经度 13bit → 8192 列
const LAT_STEP = 180 / LAT_CELLS;
const LNG_STEP = 360 / LNG_CELLS;
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** 行索引 → 该行格心纬度 */
function rowLat(i) {
  return -90 + (i + 0.5) * LAT_STEP;
}
/** 列索引 → 该列格心经度 */
function colLng(j) {
  return -180 + (j + 0.5) * LNG_STEP;
}

/**
 * (latIdx, lngIdx) → 5 字符 geohash。
 * 25bit 交错：偶数位（自高位起）取经度、奇数位取纬度，与标准 geohash 一致；
 * 直接由格索引拼位，比"格心坐标再编码"少一次浮点往返，结果相同且无边界误差。
 */
function cellGeohash(latIdx, lngIdx) {
  let hash = "";
  for (let c = 0; c < 5; c++) {
    let bit = 0;
    for (let p = c * 5; p < c * 5 + 5; p++) {
      bit <<= 1;
      if (p % 2 === 0) bit |= (lngIdx >> (12 - p / 2)) & 1;
      else bit |= (latIdx >> (11 - (p - 1) / 2)) & 1;
    }
    hash += BASE32[bit];
  }
  return hash;
}

/** 从 FeatureCollection 里按 ISO3 找中国要素（iso3 / adm0_a3 / ISO_A3 任一匹配） */
function findChinaFeature(geo) {
  for (const f of geo.features ?? []) {
    const p = f.properties ?? {};
    for (const key of ["iso3", "adm0_a3", "ISO_A3", "ADM0_A3", "iso_a3"]) {
      if (p[key] === "CHN") return f;
    }
  }
  return null;
}

/** 提取所有多边形（每个多边形 = [外环, ...内环]） */
function collectPolygons(feature) {
  const g = feature.geometry;
  const polys = [];
  if (g?.type === "Polygon") polys.push(g.coordinates);
  else if (g?.type === "MultiPolygon") polys.push(...g.coordinates);
  return polys;
}

/**
 * 扫描线预计算：返回 Map<行索引, Float64Array[]> —— 该行上每个多边形的
 * 交叉点经度序列（升序）。交叉点公式与 GeoJsonLoader.pointInRing 一致：
 *   x = (xj - xi) · (y - yi) / (yj - yi) + xi，边条件 (yi > y) !== (yj > y)
 * 偶奇规则下，点在某多边形内 ⇔ 该行该多边形交叉点中严格大于 x 的个数为奇数。
 */
function buildScanlines(polys) {
  const rows = new Map();
  for (const rings of polys) {
    let minLat = Infinity, maxLat = -Infinity;
    for (const [x, y] of rings[0]) {
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    const i0 = Math.max(0, Math.floor((minLat + 90) / LAT_STEP) - 1);
    const i1 = Math.min(LAT_CELLS - 1, Math.ceil((maxLat + 90) / LAT_STEP) + 1);
    for (let i = i0; i <= i1; i++) {
      const y = rowLat(i);
      const xs = [];
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k++) {
          const j = k === 0 ? ring.length - 1 : k - 1; // 同 pointInRing 的边方向
          const yi = ring[k][1], yj = ring[j][1];
          if ((yi > y) !== (yj > y)) {
            xs.push((ring[j][0] - ring[k][0]) * (y - yi) / (yj - yi) + ring[k][0]);
          }
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      let list = rows.get(i);
      if (!list) rows.set(i, (list = []));
      list.push(Float64Array.from(xs));
    }
  }
  return rows;
}

/** 升序序列里严格大于 x 的个数（二分） */
function countGreater(xs, x) {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return xs.length - lo;
}

function main() {
  const geo = JSON.parse(readFileSync(SRC, "utf8"));
  const china = findChinaFeature(geo);
  if (!china) {
    console.error("data/countries.geojson 里没找到 CHN 要素（iso3/adm0_a3/ISO_A3 均未命中）");
    process.exit(1);
  }

  const polys = collectPolygons(china);
  const rows = buildScanlines(polys);
  console.log(`CHN 要素：${polys.length} 个多边形，覆盖 ${rows.size} 个格点行（共 ${LAT_CELLS} 行）`);

  const cells = [];
  for (const [i, lists] of rows) {
    // 该行交叉点的经度范围 → 只需测这个范围内的列（范围外交叉点数为偶数，必不在多边形内）
    let minX = Infinity, maxX = -Infinity;
    for (const xs of lists) {
      if (xs[0] < minX) minX = xs[0];
      if (xs[xs.length - 1] > maxX) maxX = xs[xs.length - 1];
    }
    const j0 = Math.max(0, Math.floor((minX + 180) / LNG_STEP - 0.5) - 1);
    const j1 = Math.min(LNG_CELLS - 1, Math.ceil((maxX + 180) / LNG_STEP - 0.5) + 1);
    for (let j = j0; j <= j1; j++) {
      const x = colLng(j);
      for (const xs of lists) {
        if (countGreater(xs, x) % 2 === 1) {
          cells.push(cellGeohash(i, j));
          break;
        }
      }
    }
  }

  cells.sort();
  const text = cells.join("");
  writeFileSync(DST, text);

  console.log(`命中格数：${cells.length}（去重 ${new Set(cells).size}）`);
  console.log(`输出：${DST}  ${statSync(DST).size} 字节（${cells.length} 格 × 5 字符）`);
}

main();
