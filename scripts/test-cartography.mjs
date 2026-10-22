import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temp=await mkdtemp(join(tmpdir(),'atlas-cartography-'));
const code=`
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {generatedMarkerRanges} from './src/model/GeneratedMarkers';
import {hideGeneratedMarkers,generatedMarkersField} from './src/editor/GeneratedMarkers';
import {EditorState} from '@codemirror/state';
import {chinaLandFeature,chinaProvinceFeatures,chinaBoundarySymbols} from './src/map/ChinaBoundary';
import {loadAdminGeoJson,pointInFeature,getCentroid} from './src/map/GeoJsonLoader';
import {setDataRoot} from './src/util/DataPath';
import {geohashEncode} from './src/model/WorldCityIndex';
import {buildCoverageMapSvg} from './src/model/CoverageMap';

const doc='---\\ntype: year-review\\n---\\n\\n<!-- atlas:generated:start -->\\n<!-- atlas:hash:abc123 -->\\n# 我的年度回顾\\n\\n<!-- atlas:generated:end -->\\n\\n## 手写回忆\\n我的照片和故事';
const ranges=generatedMarkerRanges(doc);assert.equal(ranges.length,2);assert.match(doc.slice(ranges[0].from,ranges[0].to),/atlas:generated:start/);
assert.deepEqual(generatedMarkerRanges(''),[]);
for(const ending of [String.fromCharCode(10),String.fromCharCode(13,10)]){
  const prefix='照片🧭'+ending;
  const first='<!-- atlas:generated:start -->'+ending;
  const last='<!-- atlas:hash:abc123 -->';
  assert.deepEqual(generatedMarkerRanges(prefix+first+last),[{from:prefix.length,to:prefix.length+first.length+last.length}]);
  assert.deepEqual(generatedMarkerRanges(first+ending+'正文'+ending+last),[{from:0,to:first.length},{from:first.length+ending.length+'正文'.length+ending.length,to:first.length+ending.length+'正文'.length+ending.length+last.length}]);
}
assert.equal(generatedMarkerRanges('<!-- 普通注释 -->\\n    <!-- atlas:hash:abc -->').length,0);
assert.equal(generatedMarkerRanges('~~~html\\n<!-- atlas:generated:start -->\\n<!-- atlas:hash:abc -->\\n~~~').length,0);
const state=EditorState.create({doc,extensions:[hideGeneratedMarkers]});assert.equal(state.field(generatedMarkersField).size,2);assert.equal(state.doc.toString(),doc);
const edited=state.update({changes:{from:doc.length,insert:'\\n新写的见闻'}}).state;assert.match(edited.doc.toString(),/新写的见闻/);assert.equal(edited.field(generatedMarkersField).size,2);

assert.equal(getCentroid({type:'Feature',properties:{name:'空几何',level:'admin1'},geometry:{type:'MultiPolygon',coordinates:[]}}),null);
const land=chinaLandFeature();assert.equal(pointInFeature(121.5654,25.033,land),true);assert.equal(pointInFeature(116.4,39.9,land),true);assert.equal(pointInFeature(139.7,35.7,land),false);
const provinces=chinaProvinceFeatures();assert.equal(provinces.length,34);assert(provinces.some(f=>f.properties.adcode===710000&&f.properties.name==='台湾省'));
const symbols=chinaBoundarySymbols();assert.equal(symbols.geometry.coordinates.length,10);
const cellsText=await readFile(${JSON.stringify(join(root,'data/chinacells.txt'))},'utf8');const cells=new Set(cellsText.match(/.{5}/g));assert.equal(cells.size,499757);assert(cells.has(geohashEncode(25.033,121.5654,5)));assert(!cells.has(geohashEncode(35.7,139.7,5)));
for(const polygon of symbols.geometry.coordinates){const ring=polygon[0];const x=(Math.min(...ring.map(p=>p[0]))+Math.max(...ring.map(p=>p[0])))/2;const y=(Math.min(...ring.map(p=>p[1]))+Math.max(...ring.map(p=>p[1])))/2;assert(!pointInFeature(x,y,land));assert(!cells.has(geohashEncode(y,x,5)));}
setDataRoot({vault:{adapter:{exists:async p=>{try{await access(p);return true}catch{return false}},read:p=>readFile(p,'utf8')}}},${JSON.stringify(root)});
const countries=await loadAdminGeoJson('country');assert(!countries.features.some(f=>f.properties.iso3==='TWN'));assert(pointInFeature(121.5654,25.033,countries.features.find(f=>f.properties.iso3==='CHN')));
const states=await loadAdminGeoJson('admin1',undefined,'lo');assert.equal(states.features.filter(f=>f.properties.iso3==='CHN').length,34);assert(states.features.some(f=>f.properties.adcode===710000));
const cities=await loadAdminGeoJson('admin2','CHN','lo');assert(!cities.features.some(f=>String(f.properties.adcode)==='100000_JD'));assert(cities.features.some(f=>f.properties.adcode===710000&&f.properties.level==='admin1'));
const svg=buildCoverageMapSvg(new Set([geohashEncode(31.3,120.6,5),geohashEncode(25.033,121.5654,5)]));assert.match(svg,/台湾省/);assert.match(svg,/南海诸岛/);assert.match(svg,/boundary-symbols/);assert.match(svg,/atlas-china-inset/);assert.equal(buildCoverageMapSvg(new Set()),null);
console.log('Passed: marker hiding without text edits, code examples preserved, Taiwan at all levels, 10 original boundary symbols, land-only cells, China report inset.');
`;
try{
 const outfile=join(temp,'test.mjs');
 await build({stdin:{contents:code,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile,
 loader:{'.geojson':'text','.txt':'text','.json':'text'},alias:{'atlas-worldcities':join(root,'data/worldcities.json')},
 plugins:[{name:'obsidian-test',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export class App {};export class TFile {};export const requestUrl=()=>{throw Error("unexpected network")};export const normalizePath=p=>p;'}));}}]});
 await import(pathToFileURL(outfile));
}finally{await rm(temp,{recursive:true,force:true});}
