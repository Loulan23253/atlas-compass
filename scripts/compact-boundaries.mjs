import { readFile } from "node:fs/promises";

// GeoJsonLoader.normalizeFeatures 与 ChinaBoundary 消费的属性。
// 仅裁剪发布包中的属性；不简化坐标、不修改 data/ 原始文件。
const retainedProperties = new Set([
  "name", "NAME", "NAME_LONG", "ADMIN", "NAME_ZH", "name_zh", "name_local", "nameLocal",
  "ISO_A3", "ADM0_A3", "adm0_a3", "sov_a3", "iso_a2", "adm1_code", "adcode",
  "parent", "center", "centroid", "childrenNum",
]);

export function compactBoundaries(text) {
  const data = JSON.parse(text);
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Invalid boundary collection");
  for (const feature of data.features) {
    if (!feature.properties) continue;
    feature.properties = Object.fromEntries(Object.entries(feature.properties).filter(([key]) => retainedProperties.has(key)));
  }
  return JSON.stringify(data);
}

export const compactBoundariesPlugin = {
  name: "compact-boundary-properties",
  setup(build) {
    build.onLoad({ filter: /\.geojson$/ }, async ({ path }) => ({
      contents: compactBoundaries(await readFile(path, "utf8")),
      loader: "text",
      watchFiles: [path],
    }));
  },
};
