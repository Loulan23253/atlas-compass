/** esbuild loader:.geojson/.txt/.json=text —— 内联为字符串，运行时 JSON.parse */
declare module "*.geojson" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
/** esbuild alias → data/worldcities.json（text loader，运行时为字符串） */
declare module "atlas-worldcities" {
  const text: string;
  export default text;
}
