import { Notice, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureFolder, num, str, todayISO } from "../util/File";
import { hasCoords, type CityKind } from "../model/City";
import { sniffDelimiter, sniffHeaders, tokenizeCsv } from "../util/Csv";
import {
  parseGpsCsv,
  parseGpx,
  splitByDay,
  simplifyDay,
  toTrackGeoJson,
  detectGpsColumns,
  analyzeDayVisits,
  trackLengthKm,
  type GpsDay,
  type GpsPoint,
  type CountryDataset,
} from "../model/Track";
import { loadAdminGeoJson, availableAdmin2Iso3, findCityFeature } from "../map/GeoJsonLoader";
import { stripSuffix } from "../model/Coverage";
import { slAnalyzeDay, type SLDayResult } from "../model/StepLife";
import { cleanTrack, altitudeSvg, altitudeStats, type CleanResult } from "../model/TrackClean";
import { uniqueCells } from "../model/LandCoverage";
import { loadWorldCityIndex, resolveWorldCity } from "../model/WorldCityIndex";
import { readTrackMeta, writeTrackMeta } from "./TrackMeta";
import { distanceKm } from "../util/Geo";
import type { City } from "../model/City";

interface ImportRow {
  name: string;
  country: string;
  lat: number;
  lng: number;
  visits?: number;
  visitDates?: string[];
  lastVisit?: string;
  notes?: string;
  type?: CityKind;
}

/** CSV 表头别名 → 字段（表头会先转小写、去空格再查表） */
const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  name: "name", city: "name", cityname: "name", placename: "name", "城市名": "name", "城市": "name", "名称": "name",
  country: "country", "国家": "country",
  lat: "lat", latitude: "lat", "纬度": "lat",
  lng: "lng", lon: "lng", longitude: "lng", "经度": "lng",
  visits: "visits", "访问次数": "visits", "次数": "visits",
  visitdates: "visitDates", "visit dates": "visitDates", "访问日期": "visitDates", "到访日期": "visitDates",
  lastvisit: "lastVisit", lastvisitdate: "lastVisit", "最近访问": "lastVisit", "最近到访": "lastVisit",
  notes: "notes", note: "notes", "备注": "notes",
  type: "type", "类型": "type",
};

/** 导入入口：从电脑选文件，或从仓库选文件。自动识别城市列表 / GPS 轨迹两类格式 */
export class ImportModal extends Modal {
  plugin: AtlasPlugin;
  private rows: ImportRow[] | null = null;
  private fileName = "";
  private updateExisting = false;
  private statusEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private importBtn!: HTMLButtonElement;
  private cityOptsEl!: HTMLElement;
  private gpsOptsEl!: HTMLElement;
  private gpsDays: GpsDay[] | null = null;
  private gpsRawDays: GpsDay[] | null = null;
  private cleanDays: { date: string; cleaned: CleanResult }[] | null = null;
  private fileHash = "";
  private handleToken = 0;
  private gpsSaveTracks = true;
  private gpsRecordVisits = false;
  private gpsAutoCreate = false;

  constructor(plugin: AtlasPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "导入城市" });
    contentEl.createEl("p", {
      cls: "atlas-muted",
      text:
        "支持 CSV / TSV / JSON。CSV 首行为列名，支持中文列名：名称或城市、国家、纬度、经度、" +
        "访问次数、访问日期（多个用 | 分隔）、最近访问、备注、类型（city/place）。名称与国家为必填。",
    });

    const pick = contentEl.createDiv("atlas-import-pick-row");

    const fileInput = contentEl.createEl("input", {
      type: "file",
      cls: "atlas-import-file-input",
      attr: { accept: ".csv,.tsv,.tab,.json,.gpx,text/csv,application/json,application/gpx+xml" },
    });

    const sysBtn = pick.createEl("button", { text: "从电脑选择文件", cls: "mod-cta" });
    sysBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      void f
        .text()
        .then((text) => this.handleFile(f.name, text))
        .catch((e) => new Notice(`读取失败：${(e as Error).message}`));
    };

    const vaultBtn = pick.createEl("button", { text: "从仓库选择文件" });
    vaultBtn.onclick = () =>
      new VaultPickerModal(this.plugin, (file) => {
        void this.plugin.app.vault
          .read(file)
          .then((text) => this.handleFile(file.name, text))
          .catch((e) => new Notice(`读取失败：${(e as Error).message}`));
      }).open();

    this.statusEl = contentEl.createDiv("atlas-import-status");
    this.previewEl = contentEl.createDiv();

    // 城市列表模式选项（默认隐藏，解析出城市行后才显示）
    this.cityOptsEl = contentEl.createDiv("is-hidden");
    new Setting(this.cityOptsEl)
      .setName("为已有城市补充坐标")
      .setDesc("导入文件里的已有城市若缺少经纬度，用文件中的坐标补上")
      .addToggle((t) => t.setValue(false).onChange((v) => (this.updateExisting = v)));

    // GPS 轨迹模式选项（默认隐藏，识别为轨迹后才显示）
    this.gpsOptsEl = contentEl.createDiv("is-hidden");
    new Setting(this.gpsOptsEl)
      .setName("保存轨迹文件")
      .setDesc(`按天保存为 GeoJSON（${this.plugin.settings.travelFolder}/轨迹/日期.geojson），地图上可开关显示`)
      .addToggle((t) => t.setValue(true).onChange((v) => (this.gpsSaveTracks = v)));
    new Setting(this.gpsOptsEl)
      .setName("自动记录到访城市")
      .setDesc("按天驻留分析判定到访城市（中国、日本等已配置市级数据的国家）：设置里「常用地点」按月简化，其他城市逐日记完整日期")
      .addToggle((t) => t.setValue(false).onChange((v) => (this.gpsRecordVisits = v)));
    new Setting(this.gpsOptsEl)
      .setName("自动创建未建档的城市笔记")
      .setDesc("反查到的城市若没有笔记，自动在 Travel/中国/ 下创建（仅开启上一项时生效）")
      .addToggle((t) => t.setValue(false).onChange((v) => (this.gpsAutoCreate = v)));

    const btnRow = contentEl.createDiv("atlas-modal-btn-row");
    this.importBtn = btnRow.createEl("button", { text: "开始导入", cls: "mod-cta" });
    this.importBtn.disabled = true;
    this.importBtn.onclick = () => void this.runImport();
  }

  private handleFile(fileName: string, content: string): void {
    const token = ++this.handleToken; // 连续选文件时只认最后一次
    this.fileHash = contentHash(content);
    this.rows = null;
    this.gpsDays = null;
    this.gpsRawDays = null;
    this.fileName = fileName;

    // GPS 轨迹格式自动识别：GPX 文件，或有时间/经度/纬度列且没有城市名列
    const headers = sniffHeaders(content);
    const gpsCols = detectGpsColumns(headers);
    const hasNameCol = headers.some((h) => /^(name|city|cityname|placename|城市名?|名称)$/.test(h));
    const isGpx = /\.gpx$/i.test(fileName) || content.includes("<gpx");
    if (isGpx || (gpsCols && !hasNameCol)) {
      void this.handleGps(content, token);
      return;
    }

    const isJson = /\.json$/i.test(fileName);
    try {
      this.rows = isJson ? parseJson(content) : parseCsv(content);
    } catch (e) {
      this.statusEl.setText(`解析失败：${(e as Error).message}`);
      this.previewEl.empty();
      this.setCityOptionsVisible(false);
      this.setGpsOptionsVisible(false);
      this.importBtn.disabled = true;
      return;
    }

    if (!this.rows.length) {
      this.statusEl.setText(`「${fileName}」中没有可导入的城市`);
      this.previewEl.empty();
      this.setCityOptionsVisible(false);
      this.setGpsOptionsVisible(false);
      this.importBtn.disabled = true;
      return;
    }

    const existing = this.rows.filter((r) => this.pathOf(r) !== null).length;
    this.statusEl.setText(
      `「${fileName}」：共 ${this.rows.length} 行，其中 ${existing} 行已存在`,
    );

    this.previewEl.empty();
    const list = this.previewEl.createDiv("atlas-import-preview");
    for (const r of this.rows.slice(0, 5)) {
      list.createDiv({
        cls: "atlas-muted",
        text: `${r.name}（${r.country || "未知"}）${r.lat || r.lng ? ` @ ${r.lat}, ${r.lng}` : ""}`,
      });
    }
    if (this.rows.length > 5) {
      list.createDiv({ cls: "atlas-muted", text: `… 等共 ${this.rows.length} 行` });
    }

    this.setGpsOptionsVisible(false);
    this.setCityOptionsVisible(existing > 0);
    this.importBtn.disabled = false;
    this.importBtn.onclick = () => void this.runImport();
  }

  private async handleGps(content: string, token: number): Promise<void> {
    if (token !== this.handleToken) return; // 连续选文件：只认最后一次
    // GPX（含 <gpx> 或 .gpx 后缀）走同一套清洗/识别管线
    const isGpx = /\.gpx$/i.test(this.fileName) || content.includes("<gpx");
    const points = isGpx ? parseGpx(content) : parseGpsCsv(content);
    if (!points.length) {
      this.statusEl.setText(`「${this.fileName}」中没有解析到有效的 GPS 点`);
      this.previewEl.empty();
      this.setCityOptionsVisible(false);
      this.setGpsOptionsVisible(false);
      this.importBtn.disabled = true;
      return;
    }
    const raw = splitByDay(points);
    this.gpsRawDays = raw;
    // 轨迹清洗：跳变/尖峰剔除 + Z 形/共线校正，后续识别与落盘全用清洗后的点
    this.cleanDays = raw.map((d) => ({ date: d.date, cleaned: cleanTrack(d.points) }));
    this.gpsDays = this.cleanDays.map((d) => ({ date: d.date, points: simplifyDay(d.cleaned.points) }));
    const totalRaw = raw.reduce((n, d) => n + d.points.length, 0);
    const totalKept = this.gpsDays.reduce((n, d) => n + d.points.length, 0);
    const totalKm = raw.reduce((n, d) => n + trackLengthKm(d.points), 0);

    // 增量识别：多少天已导入过、多少天是新的
    const trackFolder = `${this.plugin.settings.travelFolder}/轨迹/`;
    const knownDates = new Set(
      this.plugin.app.vault
        .getFiles()
        .filter((f) => f.path.startsWith(trackFolder) && f.extension === "geojson")
        .map((f) => f.basename),
    );
    const newDays = this.gpsDays.filter((d) => !knownDates.has(d.date)).length;

    this.statusEl.setText(
      `识别为 GPS 轨迹：「${this.fileName}」共 ${totalRaw.toLocaleString()} 个点，` +
        `${this.gpsDays.length} 天（${this.gpsDays[0].date} ~ ${this.gpsDays[this.gpsDays.length - 1].date}），` +
        `抽稀后 ${totalKept.toLocaleString()} 个点，清洗剔除 ${this.cleanDays.reduce((n, d) => n + d.cleaned.ignored, 0).toLocaleString()} 个异常点，路径总里程约 ${Math.round(totalKm).toLocaleString()} km；` +
        `其中 ${newDays} 天为新增，${this.gpsDays.length - newDays} 天已导入（内容有变化的会自动更新）`,
    );

    this.previewEl.empty();
    const list = this.previewEl.createDiv("atlas-import-preview");
    const newFirst = [...this.gpsDays].sort((a, b) => Number(knownDates.has(a.date)) - Number(knownDates.has(b.date)));
    // 日期 → 清洗结果索引（避免逐日线性 find）
    const cleanByDate = new Map((this.cleanDays ?? []).map((d) => [d.date, d]));
    const mode = this.plugin.settings.visitMode;
    const { datasets, iso3OfCountryName } = await prepareMultiCountry();
    await loadWorldCityIndex((p) => readPluginText(this.plugin, p));
    if (token !== this.handleToken) return; // 用户已换文件
    // 世界城市库兜底对所有档位生效（admin2 未覆盖的国家 GPS 到访照样落城市）
    const resolver = makeStepLifeResolver(datasets, iso3OfCountryName);
    for (const d of newFirst.slice(0, 8)) {
      const tag = knownDates.has(d.date) ? "已导入" : "新";
      const visits = analyzeDayVisits(
        d,
        datasets,
        mode,
        (lat, lng) => resolver({ lat, lng }),
      );
      const visitCities = visits.filter((v) => v.cls === "visit").map((v) => stripSuffix(v.name));
      const passCount = visits.filter((v) => v.cls === "pass").length;
      const visitText = visitCities.length
        ? `到访：${visitCities.slice(0, 2).join("、")}${visitCities.length > 2 ? "等" : ""}`
        : "无到访";
      const passText = passCount ? `，路过 ${passCount} 市` : "";
      // 行程识别：用清洗后的完整点列
      const cleanedPts = cleanByDate.get(d.date)?.cleaned.points ?? d.points;
      const sl = slAnalyzeDay(cleanedPts);
      const elev = altitudeStats(cleanedPts);
      const slText =
        `，路径 ${sl.pathCount} 条（${sl.summary}）` + (elev && elev.gain > 0 ? `，爬升 ${elev.gain}m` : "");
      list.createDiv({
        cls: "atlas-muted",
        text: `${d.date}：${d.points.length} 点【${tag}】${visitText}${passText}${slText}`,
      });
    }
    if (this.gpsDays.length > 8) {
      list.createDiv({ cls: "atlas-muted", text: `… 等共 ${this.gpsDays.length} 天` });
    }

    this.setCityOptionsVisible(false);
    this.setGpsOptionsVisible(true);
    this.importBtn.disabled = false;
    this.importBtn.onclick = () => void this.runGpsImport();
  }

  private async runGpsImport(): Promise<void> {
    if (!this.gpsDays || this.importBtn.disabled) return;
    this.importBtn.disabled = true;
    this.importBtn.setText("导入中…");
    const plugin = this.plugin;
    let added = 0;
    let updatedDays = 0;
    let unchanged = 0;
    let visitNew = 0;
    let visitKnown = 0;
    let created = 0;
    const unmatched: string[] = [];

    const importContentHash = this.fileHash;
    if (this.gpsSaveTracks) {
      const folder = `${plugin.settings.travelFolder}/轨迹`;
      const elevFolder = `${plugin.settings.travelFolder}/轨迹/海拔`;
      await ensureFolder(plugin.app, folder);
      await ensureFolder(plugin.app, elevFolder);
      // 日期 → 当天原始点/清洗结果索引（循环外建一次，避免逐日线性 find 的 O(n²)）
      const rawByDate = new Map((this.gpsRawDays ?? []).map((d) => [d.date, d]));
      const cleanByDate = new Map((this.cleanDays ?? []).map((d) => [d.date, d]));
      // 边车元数据：一次性读入内存，逐日增量判定不再 JSON.parse 整份轨迹文件
      const meta = await readTrackMeta(plugin);
      let metaDirty = false;
      for (const day of this.gpsDays) {
        const path = `${folder}/${day.date}.geojson`;
        const rawDay = rawByDate.get(day.date);
        // 清洗后的完整点列：识别、里程、格点、插值都用它
        const cleaned = cleanByDate.get(day.date)?.cleaned
          ?? cleanTrack(rawDay?.points ?? day.points);
        const sl = slAnalyzeDay(cleaned.points);
        const elev = altitudeStats(cleaned.points);
        // 行程摘要：停留次数 / 均速 / 峰值速度（速度来自各路径段的距离与时长）
        const avgKmh = dayAvgKmh(sl);
        const maxKmh = sl.moves.length ? Math.round(Math.max(...sl.moves.map((m) => m.maxSpeedKmh))) : 0;
        // 里程与格点先算好：进 GeoJSON properties、进签名、也进边车
        const km = dayKmRounded(cleaned.points);
        const cells = uniqueCells(cleaned.points);
        const newContent = toTrackGeoJson(day.date, day.points, cleaned.points, {
          trips: sl.pathCount,
          transport: sl.summary,
          stays: sl.stays.length,
          avgKmh,
          maxKmh,
          ignored: cleaned.ignored,
          ignoredTs: cleaned.ignoredTs.map((t) => Math.round(t / 1000)),
          cells,
          elev,
          ts: day.points.map((p) => Math.round(p.t / 1000)),
          segments: sl.moves.map((m) => ({
            s: Math.round(m.from / 1000),
            e: Math.round(m.to / 1000),
            m: m.mode,
          })),
        });
        // 旧属性：优先查边车元数据（内存 O(1)，不再 JSON.parse 整份轨迹文件）；
        // 边车缺失（历史数据）才回退读文件解析 properties，并把算得的摘要回填边车，下次导入即走快路径
        let oldProps: Record<string, unknown> | null = null;
        let fileExists = false;
        const cached = meta[day.date];
        if (cached) {
          // 边车命中仍需确认轨迹文件在（用户可能手动删了文件；exists 是轻量调用，远比读整份文件便宜）
          fileExists = await plugin.app.vault.adapter.exists(path).catch(() => false);
          // 边车 sig 本身即五段签名，按段还原成 properties 形状走同一条比较路径
          // （恰好 5 段时重组与原串逐字节一致；损坏条目保持 null → 判为变化，与旧 oldSig≠newSig 等价）
          if (fileExists) {
            const seg = cached.sig.split("|");
            if (seg.length === 5) oldProps = { points: seg[0], km: seg[1], trips: seg[2], stays: seg[3], avgKmh: seg[4] };
          }
        } else if (plugin.app.vault.getAbstractFileByPath(path)) {
          fileExists = true;
          try {
            const props = (JSON.parse(await plugin.app.vault.adapter.read(path)) as {
              features?: Array<{ properties?: Record<string, unknown> }>;
            })?.features?.[0]?.properties;
            if (props) {
              oldProps = props;
              meta[day.date] = {
                sig: trackSig(props.points, props.km, props.trips, props.stays, props.avgKmh),
                km: num(props.km),
                trips: num(props.trips),
                stays: num(props.stays),
                avgKmh: num(props.avgKmh),
                cells: Array.isArray(props.cells) ? props.cells.map(String) : undefined,
                updated: new Date().toISOString(),
              };
              metaDirty = true;
            }
          } catch {
            oldProps = null; // 解析失败按缺失处理 → 判为变化（原行为 oldSig=""）
          }
        }
        // 新旧签名比较 + 是否变化判定（纯函数）：sig 的 km 段与 toTrackGeoJson 内部算法一致
        // （dayKmRounded(cleaned.points) 保留 1 位小数），免去逐日整份 GeoJSON 的回读解析
        const { changed, sig: newSig } = evaluateDayChange(
          oldProps,
          { points: day.points.length },
          cleaned.points,
          sl,
        );
        if (!changed) {
          unchanged += 1;
        } else {
          await plugin.app.vault.adapter.write(path, newContent);
          if (!fileExists) added += 1;
          else updatedDays += 1;
          // 写盘成功：把新内容摘要记入边车，下次导入该日期直接命中快路径
          meta[day.date] = {
            sig: newSig,
            km,
            trips: sl.pathCount,
            stays: sl.stays.length,
            avgKmh,
            cells,
            updated: new Date().toISOString(),
          };
          metaDirty = true;
          // 海拔剖面：CSV 带海拔列时生成 SVG（嵌入笔记可渲染；仅变化时写）
          if (elev && elev.max > elev.min) {
            try {
              const svg = altitudeSvg(cleaned.points);
              if (svg) {
                const svgPath = `${elevFolder}/${day.date}.svg`;
                const svgOld = plugin.app.vault.getAbstractFileByPath(svgPath);
                if (!svgOld) await plugin.app.vault.create(svgPath, svg);
                else await plugin.app.vault.adapter.write(svgPath, svg);
              }
            } catch (e) {
              console.error("Atlas: 海拔 SVG 写入失败（不影响导入）:", e);
            }
          }
        }
      }
      // 导入结束：一次性写回边车（点前缀文件 Obsidian 不索引，独立于 data.json，卸载重装不受影响）
      if (metaDirty) await writeTrackMeta(plugin, meta);
    }

    if (this.gpsRecordVisits) {
      // 驻留分析：按设置档位判定每天"到访"哪些城市（多国）；常用地点按月简化，其他城市记完整日期
      const { datasets, nameOf, iso3OfCountryName } = await prepareMultiCountry();
      const frequent = this.plugin.settings.frequentCity.trim();
      const mode = this.plugin.settings.visitMode;
      const byCity = new Map<
        string,
        { name: string; iso3: string; countryName: string; lng: number; lat: number; dates: string[] }
      >();
      let processed = 0;
      // 世界城市库兜底对所有档位生效
      await loadWorldCityIndex((p) => readPluginText(plugin, p));
      const resolver = makeStepLifeResolver(datasets, iso3OfCountryName);
      for (const day of this.gpsDays) {
        const visits = analyzeDayVisits(
          day,
          datasets,
          mode,
          (lat, lng) => resolver({ lat, lng }),
        ).filter((v) => v.cls === "visit");
        processed += 1;
        if (processed % 30 === 0 || processed === this.gpsDays.length) {
          this.statusEl.setText(`驻留分析中… ${processed}/${this.gpsDays.length} 天`);
          // 让出主线程一帧，使进度文本有机会渲染
          await new Promise((r) => setTimeout(r, 0));
        }
        // 同一天可能到访多个城市（上午 A 下午 B），都记录
        for (const v of visits) {
          const countryName = nameOf(v.iso3);
          const key = `${v.iso3}::${stripSuffix(v.name)}`;
          const entry = byCity.get(key) ?? {
            name: v.name,
            iso3: v.iso3,
            countryName,
            lng: v.lng,
            lat: v.lat,
            dates: [],
          };
          if (!entry.dates.includes(day.date)) entry.dates.push(day.date);
          byCity.set(key, entry);
        }
      }

      for (const [, info] of byCity) {
        const { name: cityName, countryName, dates } = info;
        // 常用地点：设置名与城市名去后缀后相同即视为命中
        const frequentHit = !!frequent && stripSuffix(frequent) === stripSuffix(cityName);
        const uniqueDates = [...new Set(dates)].sort();
        const recordVals = frequentHit
          ? [...new Set(uniqueDates.map((d) => d.slice(0, 7)))].sort() // 常用地点：按月
          : uniqueDates; // 其他城市：完整日期
        const target = findCityByStrippedName(plugin.db, cityName, countryName);
        const known = new Set(target?.visitDates ?? []);
        const newVals = recordVals.filter((v) => !known.has(v));
        if (!newVals.length) {
          visitKnown += recordVals.length;
          continue;
        }
        if (target) {
          await mergeVisitDates(plugin, target.note, newVals);
          visitNew += newVals.length;
          visitKnown += recordVals.length - newVals.length;
        } else if (this.gpsAutoCreate) {
          const folder = `${plugin.settings.travelFolder}/${countryName}`;
          await ensureFolder(plugin.app, folder);
          const path = `${folder}/${cityName}.md`;
          if (!plugin.app.vault.getAbstractFileByPath(path)) {
            await plugin.app.vault.create(
              path,
              buildCityNote(
                {
                  name: cityName,
                  country: countryName,
                  lng: info.lng,
                  lat: info.lat,
                  visitDates: recordVals,
                  type: "city",
                },
                countryName,
              ),
            );
            created += 1;
            visitNew += recordVals.length;
          } else {
            await mergeVisitDates(plugin, path, newVals);
            visitNew += newVals.length;
            visitKnown += recordVals.length - newVals.length;
          }
        } else if (!unmatched.includes(`${countryName}·${cityName}`)) {
          unmatched.push(`${countryName}·${cityName}`);
        }
      }
    }

    await plugin.db.scan();
    plugin.refreshViews();

    // 导入历史：记录文件、哈希、天数，供「查看导入历史」溯源（上限 50 条）
    const history = this.plugin.settings.importHistory ?? [];
    history.unshift({
      file: this.fileName,
      hash: importContentHash,
      days: this.gpsDays.length,
      points: this.gpsRawDays?.reduce((n, d) => n + d.points.length, 0) ?? 0,
      ignored: this.cleanDays?.reduce((n, d) => n + d.cleaned.ignored, 0) ?? 0,
      time: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
    this.plugin.settings.importHistory = history.slice(0, 50);
    await this.plugin.saveSettings();

    let msg =
      `轨迹导入完成：新增 ${added} 天、更新 ${updatedDays} 天、未变化 ${unchanged} 天；` +
      `到访新增 ${visitNew} 天、已记录 ${visitKnown} 天、新建城市 ${created} 个`;
    if (unmatched.length) msg += `；未建档城市：${unmatched.join("、")}`;
    new Notice(msg, 10000);
    this.close();
  }

  private pathOf(r: ImportRow): string | null {
    const country = r.country || "未知";
    const path = `${this.plugin.settings.travelFolder}/${country}/${r.name}.md`;
    return this.plugin.app.vault.getAbstractFileByPath(path) ? path : null;
  }

  private async runImport(): Promise<void> {
    if (!this.rows) return;
    const res = await importRows(this.plugin, this.rows, this.updateExisting);
    new Notice(
      `导入完成：新建 ${res.created}，更新坐标 ${res.updated}，跳过 ${res.skipped}`,
    );
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 显示/隐藏城市列表模式选项（改用 .is-hidden 类，替代内联 display 赋值） */
  private setCityOptionsVisible(visible: boolean): void {
    this.cityOptsEl.classList.toggle("is-hidden", !visible);
  }

  /** 显示/隐藏 GPS 轨迹模式选项（改用 .is-hidden 类，替代内联 display 赋值） */
  private setGpsOptionsVisible(visible: boolean): void {
    this.gpsOptsEl.classList.toggle("is-hidden", !visible);
  }
}

// ==== GPS 导入判定核心（纯函数：runGpsImport 写盘循环的签名与变化判定，供测试钉死格式） ====

/**
 * 轨迹签名格式（五段）：points|km|trips|stays|avgKmh —— 写盘 properties 五字段与边车 sig 同构。
 * 字段原样进模板、不做数值规整（unknown 入参按 ToString 拼接），保证与历史轨迹文件/边车逐字节兼容；
 * 恰好五段时 split("|") → 本函数重组与原串逐字节一致（边车 sig 还原路径的正确性依据）。
 */
export function trackSig(
  points: unknown,
  km: unknown,
  trips: unknown,
  stays: unknown,
  avgKmh: unknown,
): string {
  return `${points}|${km}|${trips}|${stays}|${avgKmh}`;
}

/** 单日里程（km，1 位小数）：与写盘 properties.km 同一算法（trackLengthKm 保留 1 位小数） */
export function dayKmRounded(points: GpsPoint[]): number {
  return Math.round(trackLengthKm(points) * 10) / 10;
}

/** 单日均速（km/h，1 位小数）：各移动段「Σ距离/Σ时长」整体加权，时长钳制 ≥1s；无移动段 → 0 */
export function dayAvgKmh(sl: Pick<SLDayResult, "moves">): number {
  return sl.moves.length
    ? Math.round((sl.moves.reduce((n, m) => n + m.distanceM, 0) /
        Math.max(sl.moves.reduce((n, m) => n + m.durationSec, 0), 1) * 3.6) * 10) / 10
    : 0;
}

/** 单日变化判定结果：changed 决定是否写盘，sig 为记入边车的新签名 */
export interface DayChangeEvaluation {
  changed: boolean;
  sig: string;
}

/**
 * 新旧签名比较 + 是否变化判定（runGpsImport 写盘循环的判定核心，纯函数）。
 * - oldProps：旧一天的五项属性（points/km/trips/stays/avgKmh）。边车命中时由 sig 五段还原，
 *   边车缺失的历史文件由 features[0].properties 解析；null = isNew 分支（文件不存在、
 *   边车条目损坏或旧属性不可得）→ 必然视为变化，走写盘。
 * - newProps.points：当天抽稀后的点数（与写盘 properties.points 同源）；
 *   km 由 cleanedPoints 重算、trips/stays/avgKmh 取自 slResult —— 与写盘内容同一算法。
 */
export function evaluateDayChange(
  oldProps: Record<string, unknown> | null,
  newProps: { points: number },
  cleanedPoints: GpsPoint[],
  slResult: Pick<SLDayResult, "pathCount" | "stays" | "moves">,
): DayChangeEvaluation {
  const km = dayKmRounded(cleanedPoints);
  const avgKmh = dayAvgKmh(slResult);
  const sig = trackSig(newProps.points, km, slResult.pathCount, slResult.stays.length, avgKmh);
  const oldSig = oldProps
    ? trackSig(oldProps.points, oldProps.km, oldProps.trips, oldProps.stays, oldProps.avgKmh)
    : "";
  return { changed: !oldProps || oldSig !== sig, sig };
}

/** ISO3 → 中文名兜底表（Natural Earth 的中文名缺失时使用） */
const ISO3_COUNTRY_FALLBACK: Record<string, string> = { CHN: "中国", JPN: "日本" };

/**
 * 准备多国驻留分析：自动发现 data/admin2/ 下已有的市级数据集，
 * 并从国家边界数据建立 ISO3 → 中文国名映射。
 * 注意：Natural Earth 的中文名是全称（中国→“中华人民共和国”），
 * 因此兜底表的规范名优先，nameLocal 只用于未登记的国家。
 */
/** 读插件 data/ 下的数据文件（vault adapter 不索引 .obsidian/，用 exists+read） */
async function readPluginText(plugin: AtlasPlugin, path: string): Promise<string | null> {
  try {
    return (await plugin.app.vault.adapter.exists(path)) ? await plugin.app.vault.adapter.read(path) : null;
  } catch {
    return null;
  }
}

/** 城市解析链：admin2 多边形优先 → 世界城市库兜底（国家英文名反查 ISO3） */
function makeStepLifeResolver(
  datasets: CountryDataset[],
  iso3OfCountryName: (name: string) => string | null,
): (p: { lat: number; lng: number }) => { name: string | null; iso3: string | null } {
  return (p: { lat: number; lng: number }) => {
    for (const ds of datasets) {
      const hit = findCityFeature(ds.geo, p.lng, p.lat);
      if (!hit) continue;
      return { name: (hit.properties as { name?: string })?.name ?? null, iso3: ds.iso3 };
    }
    const w = resolveWorldCity(p.lat, p.lng);
    if (w) return { name: w.name, iso3: iso3OfCountryName(w.country) };
    return { name: null, iso3: null };
  };
}

async function prepareMultiCountry(): Promise<{
  datasets: CountryDataset[];
  nameOf: (iso3: string) => string;
  iso3OfCountryName: (name: string) => string | null;
}> {
  const datasets: CountryDataset[] = [];
  for (const iso3 of await availableAdmin2Iso3()) {
    const geo = await loadAdminGeoJson("admin2", iso3);
    if (geo.features.length) datasets.push({ iso3, geo });
  }
  const countries = await loadAdminGeoJson("country");
  const byIso = new Map<string, string>();
  const byCountryName = new Map<string, string>();
  for (const f of countries.features) {
    const p = f.properties as { iso3?: string; nameLocal?: string; name?: string } | undefined;
    if (!p?.iso3) continue;
    if (!byIso.has(p.iso3)) byIso.set(p.iso3, p.nameLocal || p.name || p.iso3);
    if (p.name && !byCountryName.has(p.name.toLowerCase())) byCountryName.set(p.name.toLowerCase(), p.iso3);
    if (p.nameLocal && !byCountryName.has(p.nameLocal.toLowerCase())) byCountryName.set(p.nameLocal.toLowerCase(), p.iso3);
  }
  const nameOf = (iso3: string): string =>
    ISO3_COUNTRY_FALLBACK[iso3] ?? byIso.get(iso3) ?? iso3;
  const iso3OfCountryName = (name: string): string | null =>
    byCountryName.get(name.trim().toLowerCase()) ?? null;
  return { datasets, nameOf, iso3OfCountryName };
}

/** 按去后缀的城市名查找已有城市笔记，优先同一国家；同名多命中时按坐标最近消歧 */
function findCityByStrippedName(
  db: AtlasPlugin["db"],
  name: string,
  country?: string,
  near?: { lat: number; lng: number },
): City | null {
  const n = stripSuffix(name);
  const all = [...db.cities, ...db.places].filter((c) => stripSuffix(c.name) === n);
  if (!all.length) return null;
  if (country) {
    const same = all.filter((c) => c.country.trim().toLowerCase() === country.trim().toLowerCase());
    if (same.length) return near && near.lat !== 0 ? nearest(same, near) : same[0];
  }
  return near && near.lat !== 0 ? nearest(all, near) : all[0];
}

function nearest(cities: City[], near: { lat: number; lng: number }): City {
  let best = cities[0];
  let bestD = Infinity;
  for (const c of cities) {
    const d = distanceKm({ lat: near.lat, lng: near.lng }, { lat: c.lat, lng: c.lng });
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** 把若干天的到访日期并入城市笔记的 visitDates（去重、排序、同步 lastVisit/visits）。返回是否发生变化 */
export async function mergeVisitDates(plugin: AtlasPlugin, notePath: string, dates: string[]): Promise<boolean> {
  const file = plugin.app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return false;
  let changed = false;
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const existing = Array.isArray(fm.visitDates)
      ? fm.visitDates.map(String)
      : fm.visitDates
        ? [String(fm.visitDates)]
        : [];
    // 粒度互斥去重：已有月串（2025-09）时不加该月内的完整日期，反之亦然
    const add = dates.filter((d) => {
      if (existing.includes(d)) return false;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && existing.includes(d.slice(0, 7))) return false;
      if (/^\d{4}-\d{2}$/.test(d) && existing.some((k: string) => k.startsWith(d + "-"))) return false;
      return true;
    });
    if (!add.length) return;
    const all = [...new Set([...existing, ...add])].sort();
    fm.visitDates = all;
    fm.lastVisit = all[all.length - 1];
    fm.visits = all.length;
    changed = true;
  });
  return changed;
}

/** 从仓库里挑一个 CSV/TSV/JSON 文件 */
class VaultPickerModal extends FuzzySuggestModal<TFile> {
  plugin: AtlasPlugin;
  onPick: (file: TFile) => void;

  constructor(plugin: AtlasPlugin, onPick: (file: TFile) => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onPick = onPick;
    this.setPlaceholder("选择要导入的 CSV / TSV / JSON 文件…");
  }

  getItems(): TFile[] {
    return this.plugin.app.vault.getFiles().filter((f) => /\.(csv|tsv|tab|json)$/i.test(f.name));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/** 执行导入：新建笔记；已存在的按选项补充坐标 */
async function importRows(
  plugin: AtlasPlugin,
  rows: ImportRow[],
  updateExisting: boolean,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.name) {
      skipped += 1;
      continue;
    }
    const country = r.country || "未知";
    const folder = `${plugin.settings.travelFolder}/${country}`;
    const path = `${folder}/${r.name}.md`;
    const existing = plugin.app.vault.getAbstractFileByPath(path);

    if (existing) {
      const city =
        plugin.db.cities.find((c) => c.note === path) ??
        plugin.db.places.find((c) => c.note === path);
      if (updateExisting && city && !hasCoords(city) && (r.lat || r.lng) && existing instanceof TFile) {
        await plugin.app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
          fm.lat = r.lat;
          fm.lng = r.lng;
        });
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    await ensureFolder(plugin.app, folder);
    await plugin.app.vault.create(path, buildCityNote(r, country));
    created += 1;
  }

  await plugin.db.scan();
  plugin.refreshViews();
  return { created, updated, skipped };
}

function parseJson(content: string): ImportRow[] {
  const raw: unknown = JSON.parse(content);
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { cities?: unknown })?.cities)
      ? (raw as { cities: unknown[] }).cities
      : [];
  return list
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name),
        country: str(o.country),
        lat: num(o.lat),
        lng: num(o.lng),
        visits: o.visits === undefined || o.visits === null ? undefined : num(o.visits),
        visitDates: Array.isArray(o.visitDates) ? o.visitDates.map(String) : undefined,
        lastVisit: str(o.lastVisit),
        notes: str(o.notes),
        type: o.type === "place" ? "place" : o.type === "city" ? "city" : undefined,
      } as ImportRow;
    })
    .filter((r) => r.name);
}

/** 导出所有城市为带日期的 JSON 文件（写在仓库根目录） */
export class ExportCommand {
  plugin: AtlasPlugin;

  constructor(plugin: AtlasPlugin) {
    this.plugin = plugin;
  }

  async run(): Promise<void> {
    const data = this.plugin.db.cities.map((c) => ({
      name: c.name,
      country: c.country,
      lat: c.lat,
      lng: c.lng,
      visits: c.visits,
      visitDates: c.visitDates,
      lastVisit: c.lastVisit,
    }));
    const path = `atlas-export-${todayISO()}.json`;
    await this.plugin.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    new Notice(`已导出 ${data.length} 个城市到 ${path}`);
  }
}

/** 解析 CSV/TSV：自动识别分隔符，支持带引号的跨行单元格与中文表头 */
export function parseCsv(content: string): ImportRow[] {
  const text = content.replace(/^\uFEFF/, "");
  const table = tokenizeCsv(text, sniffDelimiter(text));
  if (!table.length) return [];

  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
  const colOf = new Map<keyof ImportRow, number>();
  headers.forEach((h, idx) => {
    const key = HEADER_ALIASES[h];
    if (key && !colOf.has(key)) colOf.set(key, idx);
  });
  if (!colOf.has("name")) throw new Error("缺少 name/城市 列");

  return table
    .slice(1)
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => {
      const get = (key: keyof ImportRow): string => {
        const idx = colOf.get(key);
        return idx === undefined ? "" : (cells[idx] ?? "").trim();
      };
      const dates = get("visitDates")
        ? get("visitDates").split(/[;|，,]/).map((s) => s.trim()).filter(Boolean)
        : undefined;
      const type = get("type").toLowerCase();
      return {
        name: get("name"),
        country: get("country"),
        lat: num(get("lat")),
        lng: num(get("lng")),
        visits: get("visits") ? num(get("visits")) : undefined,
        visitDates: dates,
        lastVisit: get("lastVisit"),
        notes: get("notes") || undefined,
        type: type === "place" ? "place" : type === "city" ? "city" : undefined,
      } as ImportRow;
    })
    .filter((r) => r.name);
}

function buildCityNote(r: ImportRow, country: string): string {
  const dates = r.visitDates ?? [];
  const lastVisit = r.lastVisit ?? (dates.length ? dates[dates.length - 1] : "");
  const visits = r.visits ?? (dates.length ? dates.length : 0);
  const kind = r.type === "place" ? "place" : "city";

  const yamlSafe = (v: string): string => `"${v.replace(/"/g, '\\\\"')}"`;
  let body = `---
type: ${kind}
name: ${yamlSafe(r.name)}
country: ${yamlSafe(country)}
lat: ${r.lat}
lng: ${r.lng}
visits: ${visits}
visitDates:
${dates.map((d) => `  - ${d}`).join("\n") || "  []"}
lastVisit: ${lastVisit}
created: ${todayISO()}
---

# ${r.name}

## Memories

## Food

## Places

## Notes
`;
  if (r.notes) body += `\n${r.notes}\n`;
  return body;
}

/** djb2 内容哈希：用于导入历史识别同一文件（体积小、无需 crypto） */
function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
