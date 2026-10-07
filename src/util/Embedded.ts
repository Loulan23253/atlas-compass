/**
 * 内置离线数据（esbuild loader:.geojson/.txt/.json=text 以原文内联进 main.js）。
 *
 * 为什么是函数而不是顶层常量：字面量放在函数体内，V8 首次调用才完整编译并
 * 物化字符串——Obsidian 启动加载所有插件，~25MB 的数据必须在首次打开地图 /
 * 首次导入时才占用内存，而不是启动瞬间。
 *
 * data/ 目录里同名文件存在时优先读文件（用户可自行替换更新）；这里的内联
 * 副本保证官方渠道安装（只分发 main.js/manifest/styles 三个文件）功能完整。
 * data/ 独有的高清 LOD（admin1.geojson 等无 .lo 后缀的大文件）不内联。
 */
import admin1LoText from "../../data/admin1.lo.geojson";
import chinaAdmin2LoText from "../../data/admin2/china_admin2.lo.geojson";
import jpnAdmin2LoText from "../../data/admin2/jpn_admin2.lo.geojson";
import worldCitiesText from "atlas-worldcities";
import chinaCellsText from "../../data/chinacells.txt";

let admin1Lo: string | null = null;
export function embeddedAdmin1Lo(): string {
  return (admin1Lo ??= admin1LoText);
}

let chinaAdmin2Lo: string | null = null;
export function embeddedChinaAdmin2Lo(): string {
  return (chinaAdmin2Lo ??= chinaAdmin2LoText);
}

let jpnAdmin2Lo: string | null = null;
export function embeddedJpnAdmin2Lo(): string {
  return (jpnAdmin2Lo ??= jpnAdmin2LoText);
}

let worldCities: string | null = null;
export function embeddedWorldCities(): string {
  return (worldCities ??= worldCitiesText);
}

let chinaCells: string | null = null;
export function embeddedChinaCells(): string {
  return (chinaCells ??= chinaCellsText);
}
