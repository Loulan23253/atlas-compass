#!/usr/bin/env node
/**
 * LOD 边界简化脚本 —— 道格拉斯-普克（DP）逐环简化，data/*.lo.geojson 的唯一再生成入口。
 *
 * 算法：对每个环（ring）独立做 DP 抽稀。距离计算前把经度按各点纬度余弦缩放
 * （x' = lng·cos(lat°)，纬度不变），使经度方向的容差接近真实地面比例；
 * 距离取点到弦段的垂直距离，弦两端（环的首尾锚点）恒保留，因此环仍闭合。
 * 坐标值原样保留（不插值、不重排），properties 与 FeatureCollection 结构不动，
 * 只有 coordinates 被替换 —— 与 src/map/GeoJsonLoader.ts 的 .lo 回退加载逻辑配套。
 *
 * 用法：
 *   node scripts/generate-lod.mjs                                # 按内置映射重生成全部 .lo.geojson
 *   node scripts/generate-lod.mjs <输入> <输出> [容差度数]        # 简化单个文件（容差默认 0.01）
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 内置默认映射：源文件 → [输出文件, 容差（度）] */
const DEFAULT_JOBS = [
  ["data/admin1.geojson", "data/admin1.lo.geojson", 0.01],
  ["data/admin2/china_admin2.geojson", "data/admin2/china_admin2.lo.geojson", 0.003],
  ["data/admin2/jpn_admin2.geojson", "data/admin2/jpn_admin2.lo.geojson", 0.003],
];

/**
 * 单环 DP 简化：返回保留点（按原顺序，含首尾锚点）。
 * 2 点以下的环原样返回。用显式栈代替递归，深环不会爆栈；
 * 处理顺序不影响结果（分割方案只由每次的最远点决定）。
 */
function simplifyRing(ring, tolDeg) {
  const n = ring.length;
  if (n <= 2) return ring;

  // 经度按各点纬度余弦缩放（逐点缩放，等效局部等距圆柱近似）
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = ring[i][0] * Math.cos((ring[i][1] * Math.PI) / 180);
    ys[i] = ring[i][1];
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = xs[a], ay = ys[a];
    const dx = xs[b] - ax, dy = ys[b] - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1, fd = -1;
    for (let i = a + 1; i < b; i++) {
      // 点到弦段的距离；弦退化（闭合环首尾同点）时取到锚点的距离
      const px = xs[i] - ax, py = ys[i] - ay;
      let d;
      if (len2 === 0) {
        d = Math.hypot(px, py);
      } else {
        let t = (px * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(px - t * dx, py - t * dy);
      }
      if (d > fd) { fd = d; far = i; }
    }
    if (fd > tolDeg) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

/** 原地简化一个几何对象；仅处理面类型，其余（线/点等）原样保留 */
function simplifyGeometry(geom, tolDeg) {
  if (!geom) return 0;
  if (geom.type === "Polygon") {
    geom.coordinates = geom.coordinates.map((r) => simplifyRing(r, tolDeg));
  } else if (geom.type === "MultiPolygon") {
    geom.coordinates = geom.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tolDeg)));
  } else {
    return 0;
  }
  return 1;
}

/** 统计坐标点总数 */
function countVertices(geom) {
  let n = 0;
  const walk = (c) => {
    if (typeof c[0] === "number") n++;
    else c.forEach(walk);
  };
  if (geom?.coordinates) walk(geom.coordinates);
  return n;
}

function human(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

/** 执行单个 简化任务 并打印前后对比 */
function runJob(srcPath, dstPath, tolDeg) {
  const src = resolve(PROJECT_ROOT, srcPath);
  const dst = resolve(PROJECT_ROOT, dstPath);
  const beforeBytes = statSync(src).size;
  const geo = JSON.parse(readFileSync(src, "utf8"));

  let vertsBefore = 0, vertsAfter = 0, features = 0, simplified = 0;
  for (const f of geo.features ?? []) {
    if (!f.geometry) continue;
    features++;
    vertsBefore += countVertices(f.geometry);
    if (simplifyGeometry(f.geometry, tolDeg)) simplified++;
    vertsAfter += countVertices(f.geometry);
  }

  writeFileSync(dst, JSON.stringify(geo));
  const afterBytes = statSync(dst).size;
  console.log(
    `${srcPath} → ${dstPath}  容差=${tolDeg}°\n` +
    `  要素 ${features}（面 ${simplified}）| 顶点 ${vertsBefore} → ${vertsAfter}（- ${((1 - vertsAfter / vertsBefore) * 100).toFixed(1)}%）| ` +
    `体积 ${human(beforeBytes)} → ${human(afterBytes)}（- ${((1 - afterBytes / beforeBytes) * 100).toFixed(1)}%）`
  );
  return { vertsBefore, vertsAfter, beforeBytes, afterBytes };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("重生成全部 LOD 简化边界…");
    const totals = { vertsBefore: 0, vertsAfter: 0, beforeBytes: 0, afterBytes: 0 };
    for (const [src, dst, tol] of DEFAULT_JOBS) {
      const r = runJob(src, dst, tol);
      totals.vertsBefore += r.vertsBefore;
      totals.vertsAfter += r.vertsAfter;
      totals.beforeBytes += r.beforeBytes;
      totals.afterBytes += r.afterBytes;
    }
    console.log(
      `合计：顶点 ${totals.vertsBefore} → ${totals.vertsAfter}（- ${((1 - totals.vertsAfter / totals.vertsBefore) * 100).toFixed(1)}%）| ` +
      `体积 ${human(totals.beforeBytes)} → ${human(totals.afterBytes)}`
    );
  } else if (args.length >= 2) {
    const tol = args[2] !== undefined ? Number(args[2]) : 0.01;
    if (!Number.isFinite(tol) || tol <= 0) {
      console.error(`容差必须是正数（度），收到：${args[2]}`);
      process.exit(1);
    }
    runJob(args[0], args[1], tol);
  } else {
    console.error("用法：node scripts/generate-lod.mjs [输入文件 输出文件 容差度数]（无参数 = 重生成全部）");
    process.exit(1);
  }
}

main();
