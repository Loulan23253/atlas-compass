import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "atlas-notes-"));
const mock = `
export const parseYaml = (source) => {
  const result={};
  for (const line of source.split('\\n')) {
    const colon=line.indexOf(':');if(colon<0)continue;
    const key=line.slice(0,colon).trim(),value=line.slice(colon+1).trim();
    try{result[key]=JSON.parse(value);}catch{result[key]=value.startsWith('[')&&value.endsWith(']')?value.slice(1,-1).split(',').map(s=>s.trim()).filter(Boolean):value;}
  }
  return result;
};
const yaml={load:parseYaml,dump:(value)=>Object.entries(value).map(([key,v])=>key+': '+JSON.stringify(v)).join('\\n')+'\\n'};
export class TFile {
  constructor(path) { this.path=path; this.name=path.split('/').pop(); this.basename=this.name.replace(/\\.[^.]+$/, ''); this.extension=this.name.split('.').pop(); this.stat={mtime:1}; }
}
export class App {}
export class Modal { constructor(app) { this.app=app; } close() {} }
export class FuzzySuggestModal extends Modal {}
export class Notice { constructor() {} }
export class Setting {}
export const normalizePath = s => s;
export const requestUrl = async () => { throw Error('Unexpected network request'); };
export function makeApp(initial={}) {
  const data = new Map(Object.entries(initial)); const files = new Map(); const writes=[]; const folders=[];
  const file=(path) => { if (!files.has(path)) files.set(path,new TFile(path)); return files.get(path); };
  const app={metadataCache:{getFileCache:f=>{const m=data.get(f.path)?.match(/^---\\n([\\s\\S]*?)\\n---/);return {frontmatter:m?parseYaml(m[1]):{}};},getFirstLinkpathDest:()=>null},vault:{
    configDir:'.obsidian', getAbstractFileByPath:p=>data.has(p)?file(p):folders.includes(p)?{path:p}:null,
    getFiles:()=>[...data.keys()].map(file), getMarkdownFiles:()=>[...data.keys()].filter(p=>p.endsWith('.md')).map(file),
    createFolder:async p=>{folders.push(p);},read:async f=>data.get(f.path),
    create:async(p,s)=>{ if(data.has(p)) throw Error('overwrite on create');data.set(p,s);writes.push(p); return file(p);},
    process:async(f,fn)=>{const prev=data.get(f.path); const next=fn(prev);if(next!==prev){data.set(f.path,next);writes.push(f.path);}},
    adapter:{exists:async p=>data.has(p)||folders.includes(p),read:async p=>{if(!data.has(p))throw Error('missing '+p);return data.get(p);},write:async(p,s)=>{data.set(p,s);writes.push(p);}},
  },fileManager:{processFrontMatter:async(f,fn)=>{
    const s=data.get(f.path);const m=s.match(/^---\\n([\\s\\S]*?)\\n---\\n/);const fm=m?yaml.load(m[1]):{};fn(fm);
    data.set(f.path,'---\\n'+yaml.dump(fm)+'---\\n'+s.slice(m?.[0].length??0));
  }}};
  return {app,data,writes,folders};
}
`;
const test = `
import assert from 'node:assert/strict';
import { makeApp, parseYaml } from 'obsidian';
import { altitudeStats } from './src/model/TrackClean';
import { buildElevation, elevationSummary, readElevation } from './src/model/Elevation';
import { travelNote, replaceGenerated, upgradeCityBody } from './src/model/NoteFormat';
import { tripNote } from './src/model/TripNote';
import { cityTemplate, countryTemplate } from './src/util/Template';
import { saveTravelNote } from './src/util/TravelNote';
import { ImportModal } from './src/commands/Import';
import { YearReviewCommand } from './src/commands/YearReview';
import { TripsCommand } from './src/commands/Trips';
import { AtlasDB } from './src/model/TravelDB';
import { annualSnapshot, availableYears, coverageGrowth, validDay, transportCounts, annualGraphicData } from './src/model/TravelInsights';
import { yearNote } from './src/model/YearNote';
import { photoNote } from './src/model/PhotoNote';
import { parseAnnualGraphic } from './src/ui/YearCalendar';
import { countryJournal } from './src/model/CountryJournal';
import { todayISO } from './src/util/File';
import { enrichJournalBody } from './src/model/JournalEnrichment';
import { appendJournalSections, COMPANIONS } from './src/model/JournalSections';
import { relatedJournals } from './src/model/JournalReferences';
import { UpgradeTemplatesCommand } from './src/commands/UpgradeTemplates';
import { ensureCountryNote } from './src/util/CountryNote';
import { travelTags } from './src/model/TravelTags';

assert.deepEqual(travelTags(['旅行','travel','年度/2026']),['旅行','travel','年度/2026']);
assert.deepEqual(travelTags('family, memories'),['family','memories','travel']);
assert.deepEqual(travelTags(['私藏','travel'],['中国','日本','中国','[[United States]]']),['私藏','travel','中国','日本','United_States']);
assert.deepEqual(parseYaml(countryTemplate('日本').match(/^---\\n([\\s\\S]*?)\\n---/)[1]).tags,['travel','日本']);
const countriesVault=makeApp();
const [countryA,countryB]=await Promise.all([ensureCountryNote(countriesVault.app,'Travel','中国'),ensureCountryNote(countriesVault.app,'Travel','中国')]);
assert.equal(countryA.path,'Travel/中国/中国.md');assert.equal(countryB.path,countryA.path);assert.equal(countriesVault.writes.length,1);
assert.match(countriesVault.data.get(countryA.path),/atlas-country/);
assert.equal((await ensureCountryNote(countriesVault.app,'Travel','中国')).path,countryA.path);assert.equal(countriesVault.writes.length,1);
const collisionVault=makeApp({'Travel/日本/日本.md':'我的原有笔记'});
const countryFallback=await ensureCountryNote(collisionVault.app,'Travel','日本');
assert.equal(countryFallback.path,'Travel/日本/日本（国家手记）.md');assert.equal(collisionVault.data.get('Travel/日本/日本.md'),'我的原有笔记');
collisionVault.app.metadataCache.getFileCache=()=>null;
assert.equal((await ensureCountryNote(collisionVault.app,'Travel','日本')).path,countryFallback.path);assert.equal(collisionVault.writes.length,1);
const customCountry=makeApp({'Travel/索引/我的日本.md':countryTemplate('日本')});
assert.equal((await ensureCountryNote(customCountry.app,'Travel','日本')).path,'Travel/索引/我的日本.md');assert.equal(customCountry.writes.length,0);
await assert.rejects(ensureCountryNote(countriesVault.app,'Travel','../中国'));assert.equal(countriesVault.writes.length,1);

const points=[100,101,102,105,104,110].map((alt,i)=>({t:1760000000000+i*60000,lat:31+i*.001,lng:121,alt}));
assert.deepEqual(altitudeStats(points),{min:100,max:110,gain:11});
assert.equal(altitudeStats(points.map(({alt,...p})=>p)),null);
assert.equal(altitudeStats([{...points[0],alt:NaN}]),null);
const elevation=buildElevation(points);assert.equal(elevation.profile.length,6);assert.equal(elevation.profile[0][0],0);
const long=buildElevation(Array.from({length:2000},(_,i)=>({...points[0],lat:31+i*.00001,alt:i/10})));
assert.equal(long.profile.length,96);assert.equal(long.profile.at(-1)[1],199.9);
assert.equal(elevationSummary(elevation),'');assert.match(elevationSummary({min:100,max:600,gain:500}),/500/);
assert.equal(readElevation({min:NaN,max:1,gain:0}),null);

const raw='---\\ntype: trip\\nkm: 10\\ncssclasses: atlas-trip\\n---\\n\\n# Old auto';
const first=travelNote(raw,'## 我的照片\\n\\n手写内容 ![[我的照片.jpg]]');
const fresh=travelNote(raw.replace('# Old auto','# New auto').replace('km: 10','km: 20'));
const merged=replaceGenerated(first,fresh);assert.match(merged,/# New auto/);assert.match(merged,/手写内容 !\\[\\[我的照片.jpg\\]\\]/);
assert.equal(replaceGenerated(first.replace('# Old auto','# 我修改的标题'),fresh),null);
assert.equal(replaceGenerated('手写旧笔记',fresh),null);
const richer=enrichJournalBody(first,'trip');assert.match(richer,/一起走过的人/);assert.match(richer,/手写内容 !\\[\\[我的照片.jpg\\]\\]/);
assert.equal(richer.slice(0,richer.indexOf('<!-- atlas:generated:end -->')),first.slice(0,first.indexOf('<!-- atlas:generated:end -->')));
assert.equal(enrichJournalBody(richer,'trip'),null);assert(replaceGenerated(richer,fresh));
assert.equal(enrichJournalBody('我自己写的旅程','trip'),null);
const broken='# 手记\\n\\n~~~md\\n还没有关闭的代码块';assert.equal(appendJournalSections(broken,[COMPANIONS]),broken);
const aliases='## 同行的人\\n\\n我的朋友';assert.equal(appendJournalSections(aliases,[COMPANIONS]),aliases);
const crlf='## 原来的文字\\r\\n\\r\\n我的照片 ![[a.jpg]]\\r\\n';const crlfRich=appendJournalSections(crlf,[COMPANIONS]);assert(crlfRich.startsWith(crlf));assert(!/(?<!\\r)\\n/.test(crlfRich));
const old='---\\ntype: city\\n---\\n# 城市\\n\\n## Memories\\n\\n我的回忆\\n\\n~~~md\\n## Notes\\n~~~\\n\\n## Food\\n\\n好吃的店\\n';
const upgraded=upgradeCityBody(old);assert.match(upgraded,/想记住的片刻\\n\\n我的回忆/);assert.match(upgraded,/~~~md\\n## Notes/);assert.match(upgraded,/好吃的店/);assert.equal(upgradeCityBody(upgraded),null);
const city=cityTemplate('城"市','国:家',1,2,'place',{visitDates:['2026-02-02','2026-01-01'],notes:'导入的备注'});
const fm=parseYaml(city.match(/^---\\n([\\s\\S]*?)\\n---/)[1]);assert.equal(fm.name,'城"市');assert.equal(fm.type,'place');assert.equal(fm.visits,2);assert.equal(fm.lastVisit,'2026-02-02');assert.match(city,/导入的备注/);assert.match(countryTemplate('中国'),/type: country/);

const store=makeApp({'Travel/旧报告.md':'我的旧报告与手写内容'});
const path=await saveTravelNote(store.app,'Travel/旧报告.md',raw,'## 个人区\\n最喜欢的照片');
assert(store.data.get(path).includes('tags: [travel]'));
store.data.set(path,store.data.get(path).replace('tags: [travel]','tags: ["personal"]'));
assert.equal(path,'Travel/旧报告（旅行手记）.md');assert.equal(store.data.get('Travel/旧报告.md'),'我的旧报告与手写内容');
assert.equal(await saveTravelNote(store.app,'Travel/旧报告.md',raw.replace('km: 10','km: 20')),path);
assert.deepEqual(parseYaml(store.data.get(path).match(/^---\\n([\\s\\S]*?)\\n---/)[1]).tags,['personal','travel']);
assert.match(store.data.get(path),/最喜欢的照片/);assert.match(store.data.get(path),/km: 20/);
const reportWithCountries=raw.replace('type: trip','type: trip\\ntags: ["travel","日本"]');
await saveTravelNote(store.app,'Travel/旧报告.md',reportWithCountries);
assert.deepEqual(parseYaml(store.data.get(path).match(/^---\\n([\\s\\S]*?)\\n---/)[1]).tags,['personal','travel','日本']);
store.data.set(path,store.data.get(path).replace('# Old auto','# 自己写的故事'));
assert.equal(await saveTravelNote(store.app,'Travel/旧报告.md',raw),'Travel/旧报告（旅行手记 2）.md');assert.match(store.data.get(path),/自己写的故事/);

const linked=makeApp({
  'Travel/甲国/同名城.md':cityTemplate('同名城','甲国',1,2),
  'Travel/乙国/同名城.md':cityTemplate('同名城','乙国',3,4),
  'Travel/甲国/咖啡店.md':cityTemplate('咖啡店','甲国',1,2,'place'),
  '日记/2026-10-18.md':'[[Travel/甲国/同名城#沿途|这座城]] [[Travel/甲国/咖啡店.md]]',
  '日记/2026-10-19.md':'[[同名城]]',
  '日记/2026-10-20.md':'[[普通笔记|同名城]]',
  '普通笔记.md':'这不是城市笔记',
});
linked.app.metadataCache.getFirstLinkpathDest=(target)=>target==='同名城'?linked.app.vault.getAbstractFileByPath('Travel/乙国/同名城.md'):target==='普通笔记'?linked.app.vault.getAbstractFileByPath('普通笔记.md'):null;
const linkedDB=new AtlasDB(linked.app,{travelFolder:'Travel'});await linkedDB.scan();
assert.deepEqual(linkedDB.cities.find(c=>c.country==='甲国').visitDates,['2026-10-18']);
assert.deepEqual(linkedDB.cities.find(c=>c.country==='乙国').visitDates,['2026-10-19']);
assert.deepEqual(linkedDB.places[0].visitDates,['2026-10-18']);
linked.app.metadataCache.getFirstLinkpathDest=()=>null;await linkedDB.scan();
assert.deepEqual(linkedDB.cities.find(c=>c.country==='乙国').visitDates,[]);
assert(!linkedDB.suggestions.some(s=>s.name==='同名城'));

const c={name:'上海市',country:'中国',kind:'city',note:'Travel/中国/上海市.md',lat:31,lng:121,visits:2,visitDates:['2026-08-08','2026-08-10'],lastVisit:'2026-08-10'};
const crossBorder=tripNote('跨国',['2026-08-08'],new Map(),new Map([['2026-08-08',[c,{...c,name:'东京',country:'日本',note:'Travel/日本/东京.md'}]]]),'2026-10-20');
assert.deepEqual(parseYaml(crossBorder.match(/^---\\n([\\s\\S]*?)\\n---/)[1]).tags,['travel','中国','日本']);
const singleCountryYear=yearNote([c,{...c,country:'日本',visitDates:['2025-01-01']}],new Map(),'2026',{today:'2026-10-20'});
assert.deepEqual(parseYaml(singleCountryYear.match(/^---\\n([\\s\\S]*?)\\n---/)[1]).tags,['travel','中国']);
assert.equal(todayISO(new Date(2026,9,18,0,30)),'2026-10-18');
assert.equal(todayISO(new Date(2026,0,1,0,10)),'2026-01-01');
const country=countryJournal([c,{...c,name:'东京',country:'日本'},
  {...c,name:'小店',kind:'place'}, {...c,name:'想去',visits:0,visitDates:[],lastVisit:''}], '中国');
assert.equal(country.cities.length,1);assert.equal(country.places.length,1);assert.equal(country.wishlist.length,1);assert.equal(country.latest,'2026-08-10');
assert.match(countryTemplate('中国'),/atlas-country/);assert.match(city,/让我停下来的理由/);assert.match(city,/怎么去，什么时候去/);
assert.match(upgraded,/照片与沿途/);
const richerCity=enrichJournalBody(upgraded,'city');assert.match(richerCity,/一起走过的人/);assert.match(richerCity,/下次，再慢一点/);assert.equal(enrichJournalBody(richerCity,'city'),null);
assert.equal(enrichJournalBody(cityTemplate('上海市','中国',31,121),'city'),null);
assert.equal(upgradeCityBody(cityTemplate('上海市','中国',31,121)),null);
assert.equal(upgradeCityBody('# 自定义笔记\\n\\n手写的城市故事'),null);
const chineseOld='# 城市\\n\\n## 想记住的片刻\\n\\n我写的回忆\\n\\n## 我的相册\\n\\n![[照片.jpg]]';
const updatedChinese=upgradeCityBody(chineseOld);assert.match(updatedChinese,/atlas-city/);assert.match(updatedChinese,/我写的回忆/);assert.match(updatedChinese,/!\\[\\[照片.jpg\\]\\]/);assert.doesNotMatch(updatedChinese,/照片与沿途/);assert.equal(upgradeCityBody(updatedChinese),null);
const dayInfo=new Map([['2026-08-08',{km:23.8,transport:'地铁×1 + 步行×2',trips:3,stays:1,avgKmh:10,maxKmh:80,elev:{min:1,max:20,gain:19}}]]);
const rendered=tripNote('上海',['2026-08-08','2026-08-10'],dayInfo,new Map([['2026-08-08',[c]],['2026-08-10',[c]]]),'2026-10-15',new Map([['2026-08-08','日记/2026-08-08.md']]));
assert.match(rendered,/days: 3/);assert.match(rendered,/recordedDays: 2/);assert.match(rendered,/尚无 GPS 路程数据/);assert.match(rendered,/日记\\/2026-08-08/);assert.doesNotMatch(rendered,/海拔|svg|🚶/);assert.match(rendered,/Travel\\/中国\\/上海市/);
const references=[{path:'Travel/旅程/旧.md',name:'旧副本',type:'trip',start:'2026-08-08',end:'2026-08-10',mtime:1},
 {path:'Travel/旅程/新.md',name:'最新旅程',type:'trip',start:'2026-08-08',end:'2026-08-10',mtime:2},
 {path:'Travel/旅程/其他.md',name:'其他旅程',type:'trip',start:'2026-09-01',end:'2026-09-02',mtime:3},
 {path:'Travel/年度回顾/2026.md',name:'2026',type:'year-review',year:'2026',mtime:1}];
assert.deepEqual(relatedJournals([c],references).map(r=>r.path),['Travel/旅程/新.md','Travel/年度回顾/2026.md']);
assert.deepEqual(relatedJournals([{...c,visitDates:['2026-08']}],references).map(r=>r.type),['year-review']);
assert.deepEqual(relatedJournals([{...c,visitDates:['2026-02-30']}],references),[]);

function pluginFor(store) {return {app:store.app,settings:{travelFolder:'Travel',frequentCity:'苏州',visitMode:'standard',importHistory:[]},db:{cities:[],places:[],scan:async()=>{}},refreshViews(){},saveSettings:async()=>{},setSuppressScan(){}};}
const legacyReports=makeApp({'Travel/旅程/旧旅程.md':first});const enrichmentPlugin=pluginFor(legacyReports);
await new UpgradeTemplatesCommand(enrichmentPlugin).run(true);const enrichedReport=legacyReports.data.get('Travel/旅程/旧旅程.md');assert.match(enrichedReport,/一起走过的人/);assert.match(enrichedReport,/手写内容/);
await new UpgradeTemplatesCommand(enrichmentPlugin).run(true);assert.equal(legacyReports.data.get('Travel/旅程/旧旅程.md'),enrichedReport);
const gps=makeApp();const plugin=pluginFor(gps);
const importOnce=async pts=>{
 const modal=new ImportModal(plugin);modal.importBtn={disabled:false,setText(){}};modal.gpsDays=[{date:'2026-08-08',points:pts}];modal.gpsRawDays=modal.gpsDays;modal.cleanDays=[{date:'2026-08-08',cleaned:{points:pts,ignored:0,ignoredTs:[]}}];modal.gpsRecordVisits=false;
 await modal.runGpsImport();
};
await importOnce(points);
const trackPath='Travel/轨迹/2026-08-08.geojson';let track=JSON.parse(gps.data.get(trackPath));assert.equal(track.features[0].properties.elev.gain,11);assert.equal(track.features[0].properties.elev.profile.length,6);
assert(!gps.folders.some(p=>p.includes('海拔')));assert(!gps.writes.some(p=>p.endsWith('.svg')));
track.features[0].properties.transport='飞机×1';track.features[0].properties.segments=[{s:1,e:2,m:5}];gps.data.set(trackPath,JSON.stringify(track));
const before=gps.writes.filter(p=>p===trackPath).length;await importOnce(points);assert.equal(gps.writes.filter(p=>p===trackPath).length,before);
await importOnce(points.map(p=>({...p,alt:p.alt+20})));track=JSON.parse(gps.data.get(trackPath));assert.equal(track.features[0].properties.elev.min,120);assert.equal(track.features[0].properties.transport,'飞机×1');assert.equal(track.features[0].properties.segments[0].m,5);

// 使用真实命令验证年度路程只计当年、旅程重生成可保留个人文字。
plugin.db.cities=[c];await new TripsCommand(plugin).run();
const tripPath=[...gps.data.keys()].find(p=>p.startsWith('Travel/旅程/')&&p.endsWith('.md'));assert(tripPath);gps.data.set(tripPath,gps.data.get(tripPath)+'\\n我的旅途回忆\\n');await new TripsCommand(plugin).run();assert.match(gps.data.get(tripPath),/我的旅途回忆/);
gps.data.set('Travel/轨迹/2025-01-01.geojson',JSON.stringify({features:[{properties:{km:9000}}]}));
await new YearReviewCommand(plugin).run('2026');const yearly=gps.data.get('Travel/年度回顾/2026.md');assert(yearly);assert.doesNotMatch(yearly.split('## 和上一年对照')[0],/9000|9,000/);assert.match(yearly,/上海市/);

// 月份桩、去重、闰日、无城市的轨迹年份、非法值与同期比较。
const monthly={...c,note:'Travel/中国/苏州.md',name:'苏州',visitDates:['2026-01','2026-01','bad','2026-02-30','2026-13','2025-12-01']};
const newPlace={...c,note:'Travel/日本/東京.md',name:'東京',country:'日本',visitDates:['2026-02-28','2026-03-01','2026-11-01']};
const tracks=new Map([
 ['2026-02-28',{km:8,segments:[{m:1},{m:7}]}],['2026-03-01',{km:12,transport:'骑行×2 + 无路径'}],
 ['2026-11-01',{km:9999}],['2025-02-28',{km:6}],['2025-03-01',{km:4}],['2025-11-01',{km:8000}],
 ['2024-02-29',{km:3}],['bad',{km:10000}],['2026-02-30',{km:5000}],
]);
const snapshot=annualSnapshot([monthly,newPlace],tracks,'2026','2026-03-01');
assert.equal(snapshot.monthOnlyRecords,1);assert.equal(snapshot.records,3);assert.equal(snapshot.days.length,2);assert.equal(snapshot.km,20);assert.equal(snapshot.fresh.length,1);assert.equal(snapshot.returning.length,1);
assert.equal(snapshot.longestStreak.days,2);assert.equal(snapshot.months[0].days,0);assert.equal(snapshot.months[0].records,1);assert.equal(snapshot.transport.reduce((n,m)=>n+m.segments,0),4);
assert(validDay('2024-02-29'));assert(!validDay('2025-02-29'));assert(!validDay('2026-02-30'));
assert.deepEqual(availableYears([],tracks),['2026','2025','2024']);
const annual=yearNote([monthly,newPlace],tracks,'2026',{today:'2026-03-01'});
assert.doesNotMatch(annual,/9,999|8,000/);assert.match(annual,/两年各自/);assert.match(annual,/按月|月份/);assert.match(annual,/atlas-year/);assert.match(annual,/出行段/);
assert.match(annual,/把这一年，折成几张书签/);assert.match(annual,/1—3 月/);assert.doesNotMatch(annual,/10—12 月/);
const graphic=parseAnnualGraphic(JSON.stringify(annualGraphicData(snapshot)));assert.equal(graphic.days.length,2);assert.equal(parseAnnualGraphic('{}'),null);assert.equal(parseAnnualGraphic('not-json'),null);
const noGps=annualSnapshot([newPlace],new Map(),'2026');assert.equal(noGps.km,null);assert.equal(annualSnapshot([],new Map([['2026-01-01',{km:-2}]]),'2026').km,0);
const growth=coverageGrowth(new Map([['2026-01-02',{cells:['a','b','x']}],['2025-12-31',{cells:['a','a','x']}],['2026-01-03',{cells:['b']}],['bad',{cells:['c']}]]),new Set(['a','b','c']));
assert.deepEqual(growth.map(d=>[d.date,d.fresh,d.cumulative]),[['2025-12-31',1,1],['2026-01-02',1,2],['2026-01-03',0,2]]);
const album=photoNote([{file:'照片/最早.jpg',date:'2025-12-13',location:'東京',note:'Travel/日本/東京.md'},{file:'照片/最近.jpg',date:'2026-01-02',location:'上海'},{file:'照片/无日期.jpg',date:null,location:null}],2,'2026-10-15');
assert.match(album,/2025-12-13 — 2026-01-02/);assert.match(album,/最早.jpg/);assert.match(album,/最近.jpg/);assert.match(album,/未|没有拍摄日期/);assert.match(album,/Travel\\/日本\\/東京/);
assert.equal(transportCounts([{transport:'步行×2 + 高铁×1'}]).reduce((n,m)=>n+m.segments,0),3);
await new YearReviewCommand(plugin).runAll();assert(gps.data.has('Travel/年度回顾/年度索引.md'));assert(gps.data.has('Travel/年度回顾/2025.md'));
const db=new AtlasDB(gps.app,plugin.settings);await db.scan();assert.equal(db.trackKm,Math.round([...gps.data].filter(([p])=>p.endsWith('.geojson')).reduce((n,[,s])=>n+Number(JSON.parse(s).features[0].properties.km||0),0)));
const stayVault=makeApp({
 'Travel/轨迹/2026-01-01.geojson':JSON.stringify({features:[{properties:{km:2,stays:4}},{properties:{stays:99}}]}),
 'Travel/轨迹/2026-01-02.geojson':JSON.stringify({features:[{properties:{km:1,stays:2}}]}),
 'Travel/轨迹/2026-01-03.geojson':JSON.stringify({features:[{properties:{stays:-1}}]}),
 'Travel/轨迹/2026-01-04.geojson':'broken',
 'Travel/轨迹/2026-01-05.geojson':JSON.stringify({features:[{properties:{stays:1.5}}]}),
});
const stayDb=new AtlasDB(stayVault.app,{travelFolder:'Travel'});await stayDb.scan();
assert.equal(stayDb.getStats().pois,0);assert.equal(stayDb.trackStays,6);assert.equal(stayDb.trackStayDays,2);
await stayDb.scan();assert.equal(stayDb.trackStays,6);assert.equal(stayDb.trackStayDays,2);
stayVault.data.delete('Travel/轨迹/2026-01-01.geojson');await stayDb.scan();assert.equal(stayDb.trackStays,2);assert.equal(stayDb.trackStayDays,1);
const remaining=[...stayVault.data];stayVault.data.clear();await stayDb.scan();assert.equal(stayDb.trackStays,0);assert.equal(stayDb.trackStayDays,0);
for(const [p,v] of remaining)stayVault.data.set(p,v);await stayDb.scan();assert.equal(stayDb.trackStays,2);
console.log('Passed: note preservation, GPS imports, yearly snapshots/comparison, leap dates, month-only visits, transport, photo stories, coverage growth, and all-year index.');

`;
try {
  const outfile=join(temp,'checks.mjs');
  await build({stdin:{contents:test,resolveDir:root,loader:'js'},bundle:true,platform:'node',format:'esm',outfile,
    loader:{'.geojson':'text','.txt':'text','.json':'text'},alias:{'atlas-worldcities':join(root,'data/worldcities.json')},
    plugins:[{name:'obsidian-mock',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock,resolveDir:root,loader:'js'}));}}]});
  await import(pathToFileURL(outfile));
} finally {await rm(temp,{recursive:true,force:true});}
