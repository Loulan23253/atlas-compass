# AGENTS.md — Atlas（Obsidian 旅行地图插件）协作指南

TypeScript + esbuild + Leaflet 的 Obsidian 插件，完全离线：地图边界、城市库、国土格点全部内置在 `data/`。

## 命令

```bash
npm run build      # 生产构建 → main.js（esbuild.config.mjs production）
npm run dev        # 监听模式
npm run typecheck  # tsc --noEmit，等于 npx tsc --noEmit
npm run lod        # 重生成 data/*.lo.geojson（道格拉斯-普克简化）
npm run cells      # 重生成 data/chinacells.txt（中国陆地 geohash5 格点）
npm run china-boundaries -- 原始全国数据.json # 从 DataV 原始轮廓分离陆地与断续线符号
npm run test:map   # 编辑器标记隐藏与中国地图数据回归
npm run test:offline # 生产依赖清单、无 data/ 安装、损坏文件与本地覆盖回归
npm run test:bundle # 精简发布包与原数据消费结果逐项比对
```

## 结构（src/）

- `main.ts` 插件入口：注册命令/视图/设置，防抖触发 DB 扫描；`view.ts` 视图壳，拼装地图与侧栏
- `map/` Leaflet 渲染与数据加载：`MapView.ts`（渲染引擎）、`GeoJsonLoader.ts`（多级边界加载 + 点面匹配 + LOD 回退）
- `commands/` 命令面板命令（导入、轨迹工具、覆盖率/年度回顾/旅程/照片足迹等），薄壳调用 model
- `ui/` Sidebar / Dashboard / Statistics 面板；`util/` Csv、Exif、Geo、File、Template 纯工具
- `data/` 内置离线数据（见下）；`scripts/` 数据再生成脚本（node 内置模块，无依赖）

## 约定

- 纯函数放 `src/model`，UI 与 Obsidian 依赖留在外壳
- 生成类笔记（旅程、国土覆盖率、年度回顾、照片足迹）写在 `Travel/` 下并带非 city/place 的 `type` frontmatter —— `TravelDB.scan()` 靠它过滤，新建报告类型必须遵守
- 日记识别是全库扫描（形如 `2026-08-07.md`），与目录无关，不要加目录假设
- 数据文件大（data/ 共 ~75MB），不要整读进上下文；改结构前先看 GeoJsonLoader 的消费方式

## 数据文件（data/）来源与重生成

| 文件 | 来源 | 重生成 |
|------|------|--------|
| countries.geojson / admin1.geojson | Natural Earth（10m） | 手动下载替换 |
| admin1.lo.geojson | 上者 DP 简化（容差 0.01°） | `npm run lod` |
| admin2/china_admin2(.lo).geojson | DataV GeoAtlas（容差 0.003°） | 源手动维护，.lo 用 `npm run lod` |
| admin2/jpn_admin2(.lo).geojson | GADM 4.1（容差 0.003°） | 同上 |
| worldcities.json | GeoNames cities15000 | 手动导出 |
| china-country.geojson | DataV 全国轮廓（剔除匹配的断续线符号，陆地坐标保留） | `npm run china-boundaries -- 原始全国数据.json` |
| chinacells.txt | china-country.geojson 中国陆地栅格化（含台湾） | `npm run cells` |

`.lo.geojson` 与 chinacells.txt 是可再生成的派生产物：源文件更新后运行对应脚本，脚本会打印前后体积/顶点数/格数对比，异常跳变（>±20%）需人工确认。

中国制图使用 `map/ChinaBoundary.ts` 统一提供国家陆地轮廓、34 个省级行政区与独立断续线符号。不要把 `100000_JD` 当作城市/陆地，也不要让国家/省级视图与覆盖率报告退回缺少台湾的单一 Natural Earth CHN 要素。修改源数据后需同时检查地图三个层级、南海附图和 `chinacells.txt` 的分母。

构建时 `scripts/compact-boundaries.mjs` 只裁剪插件不消费的 GeoJSON 属性，不修改源文件或边界坐标。新增地图属性消费时更新保留字段，并运行 `test:bundle` 确认优化前后加载结果一致。
