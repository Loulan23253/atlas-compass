/** esbuild loader:.geojson=text —— 内联为字符串，运行时 JSON.parse */
declare module "*.geojson" {
  const text: string;
  export default text;
}
