import type { Geometry, Position } from "geojson";
import { chinaLandFeature, chinaBoundarySymbols, chinaProvinceFeatures } from "../map/ChinaBoundary";
import { geohashBounds } from "./TrackClean";

interface Projection { x: number; y: number; width: number; height: number; west: number; east: number; south: number; north: number; }
const project = (p: Position, view: Projection): [number, number] => [
  view.x + (p[0] - view.west) / (view.east - view.west) * view.width,
  view.y + (view.north - p[1]) / (view.north - view.south) * view.height,
];

function geometryPath(geometry: Geometry, view: Projection): string {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.map((polygon) => polygon.map((ring) => ring.map((p, i) => {
    const [x, y] = project(p, view); return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join("") + "Z").join("")).join("");
}

function cellsSvg(cells: Set<string>, view: Projection, minimumSize: number): string {
  const rects: string[] = [];
  for (const cell of cells) {
    const b = geohashBounds(cell);
    if (b.maxLng < view.west || b.minLng > view.east || b.maxLat < view.south || b.minLat > view.north) continue;
    const [x0, y0] = project([b.minLng, b.maxLat], view);
    const [x1, y1] = project([b.maxLng, b.minLat], view);
    const width = Math.max(minimumSize, x1 - x0), height = Math.max(minimumSize, y1 - y0);
    rects.push(`<rect x="${((x0 + x1 - width) / 2).toFixed(2)}" y="${((y0 + y1 - height) / 2).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}"/>`);
  }
  return rects.join("");
}

/** 中国主图与南海诸岛附图共用完整陆地数据；断续线仅作符号，不参与格点计数。 */
export function buildCoverageMapSvg(litCells: Set<string>): string | null {
  if (!litCells.size) return null;
  const width = 720, height = 528;
  const main: Projection = { x: 8, y: 8, width: 704, height: 485, west: 73, east: 136, south: 18, north: 54 };
  const inset: Projection = { x: 579, y: 321, width: 122, height: 151, west: 105, east: 125, south: 2, north: 26 };
  const land = chinaLandFeature();
  const boundaries = chinaBoundarySymbols();
  const taiwan = chinaProvinceFeatures().find((f) => f.properties.adcode === 710000);
  const labelPoint = taiwan?.properties.centroid || taiwan?.properties.center;
  const label = labelPoint ? project(labelPoint, main) : null;
  const draw = (view: Projection, cellSize: number): string => [
    `<path data-layer="china-land" d="${geometryPath(land.geometry, view)}" fill="#e9ecef" stroke="#8b989c" stroke-width="0.8" fill-rule="evenodd" stroke-linejoin="round"/>`,
    `<path data-layer="boundary-symbols" d="${geometryPath(boundaries.geometry, view)}" fill="#66777d" stroke="#66777d" stroke-width="0.8" stroke-linejoin="round"/>`,
    `<g fill="#f76707">${cellsSvg(litCells, view, cellSize)}</g>`,
  ].join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="中国陆地足迹地图，含台湾省和南海诸岛附图">`,
    "<desc>底图使用 DataV GeoAtlas 中国陆地与省级数据；南海断续线及东海相关线段按源数据原样绘制，符号不计入陆地覆盖率。</desc>",
    `<defs><clipPath id="atlas-china-main"><rect x="${main.x}" y="${main.y}" width="${main.width}" height="${main.height}"/></clipPath>`,
    `<clipPath id="atlas-china-inset"><rect x="${inset.x}" y="${inset.y}" width="${inset.width}" height="${inset.height}"/></clipPath></defs>`,
    `<g clip-path="url(#atlas-china-main)">${draw(main, 2.4)}</g>`,
    ...(label ? [`<text x="${(label[0] - 8).toFixed(2)}" y="${label[1].toFixed(2)}" text-anchor="end" font-size="11" fill="#526269">台湾省</text>`] : []),
    `<rect x="572" y="296" width="136" height="187" rx="3" fill="#fff" stroke="#a6b1b5" stroke-width="0.8"/>`,
    `<text x="640" y="313" text-anchor="middle" font-size="12" fill="#526269">南海诸岛</text>`,
    `<g clip-path="url(#atlas-china-inset)">${draw(inset, 1.3)}</g>`,
    `<rect x="12" y="508" width="10" height="10" rx="2" fill="#f76707"/>`,
    `<text x="28" y="517" font-size="12" fill="#68777d">已点亮 ${litCells.size.toLocaleString()} 格</text>`,
    `<text x="708" y="517" text-anchor="end" font-size="10" fill="#8b989c">底图：DataV GeoAtlas</text>`,
    "</svg>",
  ].join("\n");
}
