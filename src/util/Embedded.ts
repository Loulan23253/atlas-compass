/**
 * 内置离线数据（esbuild loader:.geojson/.txt/.json=text 以原文内联进 main.js）。
 *
 * 数据文本随 main.js 加载；JSON 解析和空间索引在首次使用时建立。
 * 这些访问函数不会把静态导入变成独立的懒加载文件，也不消除文本本身的内存占用。
 *
 * data/ 目录里同名文件有效时优先读文件（用户可自行替换更新）；这里的内联
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
