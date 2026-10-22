import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOptions } from "../esbuild.config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "atlas-bundle-"));
const entry = `
import {loadAdminGeoJson} from './src/map/GeoJsonLoader';
import {chinaLandFeature,chinaProvinceFeatures,chinaBoundarySymbols} from './src/map/ChinaBoundary';
export async function snapshot() {
  return {countries:await loadAdminGeoJson('country'),
    states:await loadAdminGeoJson('admin1',undefined,'lo'),
    chinaCities:await loadAdminGeoJson('admin2','CHN','lo'),
    japanCities:await loadAdminGeoJson('admin2','JPN','lo'),
    land:chinaLandFeature(),provinces:chinaProvinceFeatures(),symbols:chinaBoundarySymbols()};
}`;
try {
  const snapshots = [];
  const sizes = [];
  for (const compact of [false, true]) {
    const plugins = compact ? buildOptions.plugins : [];
    const production = await build({...buildOptions,absWorkingDir:root,plugins,write:false,sourcemap:false,minify:true,logLevel:"silent"});
    sizes.push(production.outputFiles[0].contents.byteLength);
    const outfile = join(temp, compact ? "compact.mjs" : "original.mjs");
    await build({stdin:{contents:entry,resolveDir:root},bundle:true,platform:"node",format:"esm",outfile,
      loader:buildOptions.loader,alias:{"atlas-worldcities":join(root,"data/worldcities.json")},plugins});
    const api = await import(pathToFileURL(outfile));
    snapshots.push(await api.snapshot());
  }
  // 比较消费端的完整结果：所有坐标、名称、行政代码、父级、标签中心与独立符号。
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert(sizes[1] < sizes[0], "Bundle must shrink");
  console.log(`Passed: all boundary outputs identical. Bundle ${sizes[0].toLocaleString()} → ${sizes[1].toLocaleString()} bytes (-${((1-sizes[1]/sizes[0])*100).toFixed(1)}%).`);
} finally { await rm(temp,{recursive:true,force:true}); }
