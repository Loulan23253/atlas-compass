# Atlas Compass

An offline travel map and journal for [Obsidian](https://obsidian.md). Bring your own GPS history (CSV / GPX exports from tracking apps) and Atlas Compass turns it into an interactive map with travel statistics. Map rendering, GPS imports, and reports work offline; name-based automatic coordinate lookup uses the configured geocoding service.

## Features

- **Offline vector map** — country, province, and city boundaries (world, China, Japan) rendered with Leaflet; nothing is fetched from tile servers
- **GPS track import** — CSV / GPX with automatic trip segmentation and transport classification (walk / bike / car / coach / high-speed rail / metro / train / plane), plus teleport, spike, and U-turn cleaning
- **Stay detection** — adjacency-cluster stay points with a hybrid validity rule (time span, displacement, and accuracy quality), mirroring what commercial trackers do
- **Visit determination** — three strictness levels based on cumulative dwell time or single-stay length; home-city visits can be simplified to monthly entries
- **Lit map** — visited countries, provinces, and cities light up in warm gold; click a lit region for visit statistics
- **Land coverage grid** — 499,757 geohash cells across China's land area, lit by your tracks, with a coverage percentage and a printable SVG report
- **Travel journals** — trip highlights, linked city notes and diaries, daily distances, photo space, and personal writing preserved on regeneration
- **Elevation in context** — compact GPS elevation summaries in journals and on-demand charts in track popups; no daily SVG folders
- **Year in review** — per-year rankings, monthly distribution bars, and newly visited cities
- **Photo footprint** — scans JPG EXIF in your vault (config folder excluded) and builds a photo-travel report
- **34,149-city geocoding fallback** (GeoNames) — worldwide city attribution for tracks outside covered admin2 datasets
- **131 airports** with Chinese names for flight detection

## Manual installation

The bundle removes unused boundary metadata during build while retaining every coordinate and all fields used by Atlas. This reduces `main.js` by about 36% (31.3 MB to 20.0 MB); `npm run test:bundle` verifies that loaded map data remains identical.

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
3. Open Atlas and click **导入数据**, or find the import command in the command palette. Select GPS CSV / GPX files — tracks, stays, transport modes, and coverage are derived automatically into `Travel/`.

## Privacy & network

Map rendering, GPS processing, and reports use data embedded in `main.js`. The optional `data/` directory supplies valid local overrides and higher-detail boundaries; missing or damaged baseline files fall back to embedded data. Personal cities, visits, tracks, and notes remain in your vault and are not bundled into the plugin. Automatic coordinate lookup sends the queried place/country names to the configured Photon/Nominatim-compatible service. The default Photon endpoint is an online service; leaving it unchanged does not disable networking.

## Documentation

完整的中文文档见下方（The rest of this README is in Chinese）.

---

# Atlas - 旅行地图插件

一个功能强大的 Obsidian 旅行地图插件，支持**完全离线**的世界地图和中国、日本的市级行政区划。

## ✨ 主要特性

### 🗺️ 离线世界地图
- **国家级**：全球国家/地区轮廓（Natural Earth 原始数据含 177 个要素，另统一替换中国轮廓）
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
- Atlas 顶部 →「导入数据」，或命令面板 →「导入数据（CSV / GPX / TSV / JSON）」；可直接从电脑选文件，无需先拷进仓库
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
- **国土覆盖率**：导入时点亮中国陆地 5 位 geohash 格（约 4.9km 见方，共 499,757 格）；命令面板 →「生成国土覆盖率报告」输出 `Travel/国土覆盖率.md`；地图左上角「格」按钮可在地图上直接画出点亮的格点（半透明矩形）
- **年度回顾**：命令面板 →「生成年度回顾」生成 `Travel/年度回顾/年份.md`——到访城市数、新增城市、到访排行、月度分布
- **旅程笔记**：命令面板 →「生成旅程笔记」——把连续活动日（间隔 ≤2 天）聚合成一次旅程，生成 `Travel/旅程/` 笔记（frontmatter 含 start/end/cities/km，正文逐日表格）
- **照片点亮足迹**：命令面板 →「照片点亮足迹」——扫描库内 JPEG 的 EXIF GPS 与拍摄时间，为已建档地点补充到访日期，报告写入 `Travel/照片足迹.md`；照片格点目前不计入 GPS 国土覆盖率
- **GPX 导入**：`.gpx` 文件走与 CSV 相同的清洗/识别管线（多 trkseg、海拔）
- **方式分色**：轨迹按段按交通方式上色（步行绿/骑行蓝/驾车橙/高铁红/火车深红/地铁紫），地图一眼看清当天怎么走的
- **增量导入**：重复导入时自动识别已导入的部分——预览里标记每天是「新」还是「已导入」，内容未变化的天直接跳过，只有新增天数和有变化的天会写入；到访日期已记录的自动跳过

### 旅行手记模板

- **统一标签**：相关笔记带 `travel` 及国家名标签（如 `中国`、`日本`），跨国旅程和回顾合并涉及国家。国家名中的空格转为下划线；更新报告和升级模板时保留已有标签。

- **国家页入口**：Atlas 总览 → 国家列表 →「打开国家手记」。缺少时自动创建 `Travel/国家名/国家名.md`，已有国家页直接打开，同名普通笔记会保留。命令「添加国家」也会在完成后打开国家手记。导入城市仅创建城市笔记，国家文件夹本身不是国家页。
- **GPS 停留与地点笔记**：总览分别统计独立地点笔记、GPS 停留片段及有停留的日期。国家页不会把零篇地点笔记显示成“没有停留地点”；GPS 停留独立标明为全库统计，同一地点的多次停留仍算多段。历史轨迹只保存每日停留次数，尚不能按国家精确分配。

- **写得下去的线索**：照片三幕、同行记忆、重访愿望、国家路线灵感及出发小抄采用默认折叠的写作提示。年度回顾另有按季度整理的目的地书签和手选“年度五选”；照片手记留出“画面之外”的故事区。
- **再翻几页**：城市和国家的动态足迹区会链接到与真实到访日期对应的已有旅程和年度回顾；按月记录只关联年度，不推定具体旅程日期。
- **轻量翻阅**：城市页先展示最近六个到访日期，更早的足迹可展开；相关手记超过五份时可继续展开并直接跳转。国家页将城市、地点和待出发收藏分列展示。折叠提示收成轻量旁注，深浅色与窄屏排版同步适配；这些显示优化在重载插件后生效，无需重写笔记。
- **已有笔记补栏目**：运行“丰富现有旅行手记栏目”，为已识别的城市、地点、国家、旅程、年度及照片手记补充缺失栏目。重复执行不会重复追加，已有正文、照片和报告自动区保留。季度摘要在重新生成年度回顾时更新。

- **城市与地点**：各创建入口统一使用中文手记模板；城市侧重见闻与收藏，具体地点侧重停留理由、到达方式和适合的时段。内置 `atlas-city` 代码块动态显示到访记录、最早/最近日期，已有日期日记可直接打开。升级命令可为已识别的旧模板补上缺失的足迹与照片区，保留原有文字和照片。
- **国家索引**：添加国家后，`atlas-country` 自动汇总该国已建档的城市、地点与愿望清单，链接到真实笔记；随着到访记录更新，无需 Dataview。识别名称使用国家笔记的 `name` 属性，旧笔记可使用文件名。
- **旅程**：先呈现日期、路程与目的地，再提炼路程最多的一天、首次出现在记录里的地点；逐日记录使用真实笔记链接，已有同日期日记可直接打开。速度、停留等细节默认折叠，不推测没有记录的见闻。
- **年度与覆盖率**：用简短回顾和清晰表格呈现数据，去掉字符堆叠的进度条，并留出年度照片、出发愿望等个人记录区。
- **照片手记**：按地点展示少量照片预览，再列目的地和年份；目前仅支持 JPEG EXIF，中国、日本以外的城市归为未识别。
- **海拔**：导入不再创建 `轨迹/海拔/` 或逐日 SVG。摘要与最多 96 个曲线采样保存在轨迹 GeoJSON 中；点击地图 GPS 轨迹，展开「沿途海拔」按需查看。手记仅在起伏、累计上升或高海拔有参考价值时显示摘要，均标注 GPS 估算。旧轨迹可显示已有最低/最高摘要，重新导入原始数据可补曲线并修正过去一直为 0 的累计上升；旧 SVG 不自动删除。
- **旧笔记升级**：运行「升级城市笔记为旅行手记」，只替换旧版英文栏目标题并添加样式，原有段落与代码块保留。已有旅程/报告重新生成时另存 `（旅行手记）` 新版；新版可反复更新自动部分，个人记录区保留。如果自动部分也被手写修改，会再另存一份，避免覆盖。

开发验证：`npm run typecheck`、`npm run test:notes`、`npm run test:map`、`npm run build`。

### 年度回顾与旅行档案

- 「生成年度回顾」可选择有到访或 GPS 数据的年份；「生成全部年度回顾与索引」批量整理各年的手记，并生成可跳转的年度目录。
- 年度回顾包含首次记录/重访地点、国家地区、路程最多的一天、最密集月份、连续记录、逐月目的地、交通方式段数分布和已生成的旅程链接。当年按生成日截止，与上一年同期比较；历史年份比较完整年度。没有上一年记录时不推算变化。
- 内置 `atlas-year` 日历可切换月份与足迹日/GPS 路程，点击有记录的日期查看地点或打开已有日记。日历是写在回顾里的生成快照，重新生成即可更新，无需其他插件或额外图片文件。
- 到访记录、足迹日、GPS 路程分别统计：同一天多个地点在日历中只计一天；按月记录只计入月份；出行方式占比按段数计算；GPS 路程不等同于步行距离。
- 旅程手记增加地点记录变化、重访地点、停留片段与交通方式汇总。地点同日并列，不根据文件顺序推断行进先后。
- 照片手记增加最早/最近照片、镜头密集日、按地点相册与照片链接。没有 EXIF 日期的照片不参与时间线，不自动编写见闻。
- 覆盖率报告增加每日首次点亮统计、每月增长与累计里程碑；区分当年走过的格点和扣除既有足迹后首次点亮的格点。

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

- 地图、轨迹导入与报告生成在本地完成，基础边界、城市库和国土格点随 `main.js` 内置；个人记录保存在笔记库。
- 自动查找坐标会向配置的 Photon/Nominatim 服务发送查询的地点及国家名称；添加城市、日记建议建档或手动定位可能调用它。保留默认 Photon 地址仍会联网。

### 中国底图与编辑器显示

- 自动生成标记（`atlas:generated` / `atlas:hash`）由编辑器扩展隐藏，正文仍可编辑，底层标记仍用于保护个人内容。代码示例中的同类文字不会隐藏；重载插件即可应用到已有笔记。
- 国家级中国陆地轮廓采用 DataV GeoAtlas 的全国数据，省级采用项目内置的 34 个省级行政区数据，包含台湾省、香港及澳门。市级资料只有省级轮廓的区域按真实层级标示。
- 南海断续线及东海相关线段使用 `100000_JD` 的原始离散符号，独立于国家/省/市图层渲染，不手绘、不把符号算作城市或陆地。该源数据包含 10 个离散符号（含东海相关线段）。
- 覆盖率 SVG 主图显示台湾省，并增加“南海诸岛”附图。陆地覆盖格点已从同一份陆地轮廓重算为 499,757 格，覆盖率分母随之更新；近海符号不计入分母。
- 数据来源：[DataV GeoAtlas](https://help.aliyun.com/en/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)，全国原始接口为 `https://geo.datav.aliyun.com/areas_v3/bound/100000.json`，省级及断续线为 `100000_full.json`。世界其他地区仍使用项目原有 Natural Earth / GADM 数据。
- 维护数据时先用 `npm run china-boundaries -- 原始全国数据.json` 分离陆地与符号，再用 `npm run cells` 重算陆地格点。脚本核对全部符号坐标，匹配不完整会停止生成。
