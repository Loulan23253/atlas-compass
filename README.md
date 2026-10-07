# Atlas Compass

A fully offline geographic knowledge system for [Obsidian](https://obsidian.md). Bring your own GPS history (CSV / GPX exports from any tracking app) and Atlas Compass turns it into an interactive, completely offline world map with travel statistics — no network access required, ever.

## Features

- **Offline vector map** — country, province, and city boundaries (world, China, Japan) rendered with Leaflet; nothing is fetched from tile servers
- **GPS track import** — CSV / GPX with automatic trip segmentation and transport classification (walk / bike / car / coach / high-speed rail / metro / train / plane), plus teleport, spike, and U-turn cleaning
- **Stay detection** — adjacency-cluster stay points with a hybrid validity rule (time span, displacement, and accuracy quality), mirroring what commercial trackers do
- **Visit determination** — three strictness levels based on cumulative dwell time or single-stay length; home-city visits can be simplified to monthly entries
- **Lit map** — visited countries, provinces, and cities light up in warm gold; click a lit region for visit statistics
- **Land coverage grid** — 494,312 geohash cells across China's land area, lit by your tracks, with a coverage percentage and a printable SVG report
- **Trip notes** — auto-generated multi-day trip reports with emoji transport icons, wikilinked city notes, daily distances, and altitude profile SVGs
- **Year in review** — per-year rankings, monthly distribution bars, and newly visited cities
- **Photo footprint** — scans JPG EXIF in your vault (config folder excluded) and builds a photo-travel report
- **34,149-city geocoding fallback** (GeoNames) — worldwide city attribution for tracks outside covered admin2 datasets
- **131 airports** with Chinese names for flight detection

## Manual installation

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/Loulan23253/atlas-compass/releases) into `<vault>/.obsidian/plugins/atlas-compass/`, then enable the plugin.
2. **Data folder (optional).** Everything needed for daily use is embedded in the bundle: country, province, and city boundaries (China & Japan), the 34,149-city library, and the coverage grid — the map is fully functional straight from the release. The repository's `data/` folder (about 75 MB) only adds high-detail boundary rendering when zoomed in past z7 (LOD hot-swap). To install it:

   ```bash
   git clone --depth 1 https://github.com/Loulan23253/atlas-compass.git
   cp -R atlas-compass/data <vault>/.obsidian/plugins/atlas-compass/
   ```

   Then restart Obsidian.

## Usage

1. Run **打开 Atlas 旅行地图** (Open Atlas travel map) from the command palette.
2. Create city notes (`type: city` frontmatter) manually or import from CSV/JSON.
3. Drop GPS CSV / GPX files into the import dialog (ribbon or command palette) — tracks, stays, transport modes, and coverage are derived automatically into `Travel/`.

## Privacy & network

Atlas Compass performs **zero network requests**. All boundaries, the city library, and the coverage grid ship inside the plugin's `data/` folder. The only optional network feature is geocoding for the manual "add city" flow, which you can disable by leaving the endpoint setting on Photon or replacing it — no track, location, or vault data ever leaves your device.

## Documentation

完整的中文文档见下方（The rest of this README is in Chinese）.

---

# Atlas - 旅行地图插件

一个功能强大的 Obsidian 旅行地图插件，支持**完全离线**的世界地图和中国、日本的市级行政区划。

## ✨ 主要特性

### 🗺️ 离线世界地图
- **国家级**：全球 200+ 国家边界（Natural Earth）
- **省级**：全球省/州级行政区划（39MB）
- **市级**：中国 370+ 地级市（3.2MB）、日本 1800+ 市町村（2.6MB）
- **自动切换**：根据缩放级别自动显示对应层级

### 📍 旅行记录
- 城市/地点标记
- 访问次数统计
- 最近访问日期
- 自动生成坐标质心

### 🧭 路线与洞察
- **点亮地图**：去过的国家/省份/城市在地图上暖金色点亮（有到访记录即点亮），点击点亮区域查看到访统计
- **旅行路线连线**：按日期串联到访城市，按年份配色，点击线段查看两地距离，地图角标显示总里程
- **探索覆盖率**：中国城市、日本都道府县的到访进度条
- **常用机场**：内置 130+ 常用机场（中国干线与热门旅游、日本主要、国际枢纽，坐标取自 OurAirports）（✈ 按钮开关），点击查看详情与离家距离，可一键建档为地点
- **日记驱动建档**：日记里 `[[提到]]` 但未建档的城市，一键创建并自动定位

### 📥 批量导入
- 命令面板 →「导入城市（CSV / TSV / JSON）」，可直接从电脑选文件，无需先拷进仓库
- CSV 首行列名支持中文：名称/城市、国家、纬度、经度、访问次数、访问日期（多个用 `|` 分隔）、最近访问、备注、类型（city/place）
- 自动识别逗号/分号/Tab 分隔符，支持带引号的跨行单元格；导入前预览，已有城市可选「补充坐标」
- **GPS 轨迹导入**：自动识别运动健康类 App 的打点导出（时间戳+经纬度列）——按天抽稀后保存为 `Travel/轨迹/日期.geojson` 并在地图上显示（GPS 按钮开关）；可选「自动记录到访城市」，按天驻留分析判定到访城市（中国、日本等已配置市级数据的国家）写入城市笔记：**「常用地点」（设置里指定）按月简化，其他城市记完整日期**，未建档的自动创建
- **行程识别**：导入时按天切分路径（间隔 ≥1801s 断段、≥3 点、≥20m）并识别交通方式（步行/骑行/驾车/高铁/火车/地铁），路径数与方式分布显示在导入预览、写入轨迹文件属性（`trips`/`transport`）；行程内驻留按 150m 邻接聚簇、簇时长 ≥10 分钟识别；「到访判定」（设置里）分三档：宽松 = 当天打点即可，标准 = 当天在该市累计 ≥2h 或单段连续 ≥30min，严格 = 当天累计 ≥6h；CSV 里的 accuracy/speed/altitude 列直接参与识别
- **全球城市兜底**：内置 34,149 城离线城市库（GeoNames，CC-BY 4.0；geohash 同格最近城匹配）——admin2 市级多边形未覆盖的国家，GPS 到访照样落城市
- **性能**：点面匹配使用 0.5° 网格空间索引（较线性扫描 ~8x）；地图边界按缩放级别加载 LOD 简化版（启动只解析简化边界，高缩放懒加载全精度热切换）；矢量层 canvas 渲染
- **轨迹清洗**：导入时自动剔除瞬移点（隐含速度 >300km/h）、三角/四角 GPS 折返尖峰、急转折返（转角 >135° 且有实际移动），Z 形漂移校正 + 近共线点平滑；剔除点的时间戳持久化到轨迹属性（`ignoredTs`）可审计
- **行程方式修正**：命令面板 →「修正行程交通方式」选日期，逐段下拉改方式（保存后 `segments`/`transport` 属性同步更新）
- **导入历史**：命令面板 →「查看导入历史」——每次导入的文件、哈希、天数、点数、清洗数
- **道格拉斯-普克抽稀**：轨迹按形状保留关键点（阈值 10m），同样的点数画出更真实的线
- **长间隔插值**：≥10 分钟且 ≥1km 的断口自动补插值点，地图上以虚线弱化显示（飞机/高铁关 GPS 的推断航段）
- **国土覆盖率**：导入时点亮中国陆地 5 位 geohash 格（约 4.9km 见方，共 494,312 格）；命令面板 →「生成国土覆盖率报告」输出 `Travel/国土覆盖率.md`；地图左上角「格」按钮可在地图上直接画出点亮的格点（半透明矩形）
- **年度回顾**：命令面板 →「生成年度回顾」生成 `Travel/年度回顾/年份.md`——到访城市数、新增城市、到访排行、月度分布
- **旅程笔记**：命令面板 →「生成旅程笔记」——把连续活动日（间隔 ≤2 天）聚合成一次旅程，生成 `Travel/旅程/` 笔记（frontmatter 含 start/end/cities/km，正文逐日表格）
- **照片点亮足迹**：命令面板 →「照片点亮足迹」——扫描库内 JPEG 的 EXIF GPS 与拍摄时间，点亮城市/格点并合并到访日期，报告写入 `Travel/照片足迹.md`
- **GPX 导入**：`.gpx` 文件走与 CSV 相同的清洗/识别管线（多 trkseg、海拔）
- **方式分色**：轨迹按段按交通方式上色（步行绿/骑行蓝/驾车橙/高铁红/火车深红/地铁紫），地图一眼看清当天怎么走的
- **增量导入**：重复导入时自动识别已导入的部分——预览里标记每天是「新」还是「已导入」，内容未变化的天直接跳过，只有新增天数和有变化的天会写入；到访日期已记录的自动跳过

### 🎯 自动定位
- 通过 Geocoding 服务按「城市名, 国家」自动查坐标（默认 Photon 免 key，可换 Nominatim）

## 📦 数据文件结构

```
atlas_v3/
├── data/
│   ├── countries.geojson        # 国家边界 (819KB)
│   ├── admin1.geojson           # 世界省级边界 (39MB)
│   ├── admin1.lo.geojson        # 省级 LOD 简化版 (18MB，启动加载)
│   ├── worldcities.json         # 全球城市兜底库 34,149 城 (3.3MB)
│   ├── chinacells.txt           # 中国国土覆盖率 geohash 格点 (2.4MB)
│   └── admin2/
│       ├── china_admin1.geojson # 中国省级 (569KB)
│       ├── china_admin2.geojson # 中国地级市 (3.2MB)
│       ├── china_admin2.lo.geojson # 中国地级市 LOD 简化版 (2.6MB)
│       ├── jpn_admin2.geojson   # 日本市町村 (2.6MB)
│       └── jpn_admin2.lo.geojson   # 日本市町村 LOD 简化版 (1.4MB)
└── src/
    └── map/
        ├── GeoJsonLoader.ts     # 多级数据加载器
        └── MapView.ts           # 地图渲染引擎
```

其中 `.lo.geojson` 简化边界由 `npm run lod` 重生成（道格拉斯-普克逐环简化，脚本为 `scripts/generate-lod.mjs`）；`chinacells.txt` 由 `npm run cells` 重生成（Natural Earth 中国边界栅格化，脚本为 `scripts/generate-cells.mjs`）。其余为来源数据，更新后可直接运行对应脚本重算派生产物。

## 🚀 安装

1. 下载插件到 `.obsidian/plugins/atlas_v3/`
2. 运行 `npm install`
3. 运行 `npm run build`
4. 在 Obsidian 中启用插件

## 🗺️ 地图使用

### 视图切换
- **自动**：根据缩放级别自动切换
- **国家级**：缩放级别 ≤ 4
- **省级**：缩放级别 5-7
- **市级**：缩放级别 ≥ 8

### 交互操作
- **鼠标悬停**：高亮区域
- **鼠标点击**：选中区域并显示详情
- **滚轮缩放**：切换显示层级
- **⌖ 按钮**：重置视图到全球范围

### 数据加载
- 中国、日本的市级数据已内置，进入市级缩放级别时**同时显示**
- 点击其他国家会尝试加载该国的市级数据文件（如 `fra_admin2.geojson`），没有则提示

## 📝 旅行笔记格式

在笔记的 frontmatter 中添加：

```yaml
---
type: city  # 或 place
name: 城市名称
country: 国家
lat: 39.9042
lng: 116.4074
visits: 3
lastVisit: 2024-01-15
---
```

## 🔧 设置选项

| 选项 | 说明 |
|------|------|
| 旅行笔记根目录 | 扫描此目录下的笔记 |
| 日记链接扫描 | 已改为全库扫描：任何目录下形如 2026-08-07.md 的日记都参与 [[城市]] 链接统计与到访派生，无需配置 |
| 默认地图中心 | 地图初始中心点（可用「采用当前视野」一键取自地图） |
| 默认缩放 | 地图初始缩放级别 |
| 常用地点 | 常住地城市名（如「苏州市」）：GPS 导入时该城市按月简化记录，其他城市记完整日期；留空则全部完整日期 |
| 到访判定 | GPS 轨迹怎样算「到访」：宽松 = 当天打点即可；标准 = 当天累计 ≥2h 或单段 ≥30min；严格 = 当天累计 ≥6h |
| 地理编码服务（自动定位） | Geocoding 服务地址（默认 Photon 免 key，可换 Nominatim） |

## 📊 数据来源

| 数据 | 来源 | 说明 |
|------|------|------|
| 国家边界 | Natural Earth | 全球 200+ 国家 |
| 省级边界 | Natural Earth | 全球省/州级 |
| 中国地级市 | DataV GeoAtlas | 阿里云数据可视化 |
| 日本市町村 | GADM 4.1 | 全球行政区划数据库 |

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```

## 📄 许可证

MIT License

## 🙏 致谢

- [Natural Earth](https://www.naturalearthdata.com/) - 全球地理数据
- [DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) - 中国行政区划数据
- [GADM](https://gadm.org/) - 全球行政区划数据
- [Leaflet](https://leafletjs.com/) - 地图库

## 🔐 隐私与网络

- 本插件**完全离线**运行：地图边界、城市库、国土格点全部内置，无任何遥测或数据上报
- 唯一的网络请求是「地理编码服务」——仅当你手动创建新城市笔记并使用自动定位时，向 Photon/Nominatim 发送城市名称（不含你的位置或轨迹数据）
