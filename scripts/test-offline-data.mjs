import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildOptions } from "../esbuild.config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "atlas-offline-"));
const test = String.raw`
import assert from 'node:assert/strict';
import {setDataRoot} from './src/util/DataPath';
import {loadAdminGeoJson,availableAdmin2Iso3,pointInFeature} from './src/map/GeoJsonLoader';
import {loadWorldCityIndex,resolveWorldCity,geohashEncode} from './src/model/WorldCityIndex';
import {loadChinaCells} from './src/model/LandCoverage';
import {embeddedWorldCities} from './src/util/Embedded';
import {AIRPORTS} from './src/data/airports';

const mode=process.argv[2];
const directory='.my-config/plugins/renamed-atlas/data';
let warnings=0;
console.warn=()=>warnings++;
console.error=()=>warnings++;
const customGeo=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Custom city'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]});
const singleCity=JSON.stringify([JSON.parse(embeddedWorldCities())[0]]);
const read=async path=>{
  assert(path.startsWith(directory+'/'));
  if(mode==='missing')return null;
  if(mode==='broken')return path.endsWith('.txt')?'invalid grid':path.endsWith('worldcities.json')?'{}':'{bad-json';
  if(mode==='unreadable')throw Error('simulated read error');
  if(path.endsWith('/worldcities.json'))return singleCity;
  if(path.endsWith('/chinacells.txt'))return geohashEncode(31.3,120.6,5)+'\n';
  if(path.endsWith('/fra_admin2.lo.geojson'))return customGeo;
  return null;
};
setDataRoot({vault:{configDir:'.my-config',adapter:{exists:async p=>mode!=='missing',read,
  list:async()=>{if(mode!=='overrides')throw Error('no directory');return {files:[directory+'/admin2/fra_admin2.lo.geojson'],folders:[]}}}}},'.my-config/plugins/renamed-atlas');
const countries=await loadAdminGeoJson('country');assert(countries.features.length>150);
const china=countries.features.find(f=>f.properties.iso3==='CHN');assert(pointInFeature(121.5654,25.033,china));
const states=await loadAdminGeoJson('admin1',undefined,'lo');assert(states.features.length>4000);
const cities=await loadAdminGeoJson('admin2');assert(cities.features.length>350);
assert.strictEqual(await loadAdminGeoJson('admin2','chn'),cities);
assert((await loadAdminGeoJson('admin2','JPN')).features.length>1700);
const world=await loadWorldCityIndex(read);
const cells=await loadChinaCells(read);
assert.equal(AIRPORTS.length,131);
if(mode==='overrides'){
  assert.equal(world.cities.length,1);assert.equal(cells.size,1);
  assert((await availableAdmin2Iso3()).includes('FRA'));
  assert.equal((await loadAdminGeoJson('admin2','FRA','hi')).features[0].properties.name,'Custom city');
}else{
  assert.equal(world.cities.length,34149);assert.equal(cells.size,499757);
  assert(cells.has(geohashEncode(25.033,121.5654,5)));
  assert(resolveWorldCity(51.5074,-0.1278));
  if(mode!=='missing')assert(warnings>0);
}
console.log('Passed offline scenario: '+mode);
`;

try {
  // 与生产构建共用配置，核实实际打包依赖，而非仅检查源码中存在 import。
  const production = await build({ ...buildOptions, absWorkingDir: root, write: false, metafile: true, minify: true, sourcemap: false, logLevel: "silent" });
  const inputs = new Set(Object.keys(production.metafile.inputs));
  const expected = ["countries.geojson", "admin1.lo.geojson", "admin2/china_admin2.lo.geojson", "admin2/jpn_admin2.lo.geojson", "admin2/china_admin1.geojson", "china-country.geojson", "worldcities.json", "chinacells.txt"];
  for (const name of expected) assert(inputs.has(`data/${name}`), `Missing embedded data: ${name}`);
  for (const name of ["src/util/Template.ts", "src/model/TripNote.ts", "src/model/YearNote.ts", "src/model/PhotoNote.ts", "src/ui/CountryJournal.ts"]) assert(inputs.has(name), `Missing template: ${name}`);
  for (const name of ["data/admin1.geojson", "data/admin2/china_admin2.geojson", "data/admin2/jpn_admin2.geojson", "data.json"]) assert(!inputs.has(name), `Unexpected bundled input: ${name}`);
  assert(![...inputs].some(p=>p.includes("Travel/") || p.endsWith(".csv")));
  console.log(`Bundle audit: ${expected.length} datasets; ${production.outputFiles[0].contents.length.toLocaleString()} bytes; no personal Travel files.`);
  const outfile = join(temp, "test.mjs");
  await build({stdin:{contents:test,resolveDir:root},bundle:true,platform:"node",format:"esm",outfile,
    loader:buildOptions.loader,alias:{"atlas-worldcities":join(root,"data/worldcities.json")},
    plugins:[...buildOptions.plugins,{name:"obsidian-test",setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:"mock",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:'export class App {};export class TFile {};export const requestUrl=()=>{throw Error("unexpected network")};export const normalizePath=p=>p;'}));}}]});
  for (const mode of ["missing", "broken", "unreadable", "overrides"]) execFileSync(process.execPath,[outfile,mode],{stdio:"inherit"});
} finally { await rm(temp,{recursive:true,force:true}); }
