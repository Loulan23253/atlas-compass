import { App, TFile } from "obsidian";
import type { AtlasSettings } from "../settings";
import type { City, CityKind } from "./City";
import { hasCoords } from "./City";
import { frontmatter, num, str, strList } from "../util/File";
import { buildTravelRoute, type TravelRoute } from "./Route";

export type { City, CityKind };

export interface AtlasStats {
  countries: number;
  cities: number;
  pois: number;
  visits: number;
  visitedCities: number;
  unlocated: number;
  routeKm: number;
  trackKm: number;
}

/** 日记里提到但还未建档的城市名 */
export interface CitySuggestion {
  name: string;
  /** 提及它的日记篇数 */
  diaries: number;
}

/** 解析 [[country]] 格式的值 */
function parseWikiLink(value: string): string {
  if (!value) return "";
  // 去掉 [[ 和 ]]
  const match = value.match(/^\[\[(.+)\]\]$/);
  return match ? match[1] : value;
}

/** Scans the travel folder for city/place notes and derives visits from diaries. */
export class AtlasDB {

  /** 日记 [[链接]] 提取缓存（path → mtime + 目标列表） */
  private diaryLinksCache = new Map<string, { mtime: number; targets: string[] }>();
  app: App;
  settings: AtlasSettings;
  cities: City[] = [];
  places: City[] = [];
  /** 按日期串联的旅行路线 */
  route: TravelRoute = { stops: [], segments: [], totalKm: 0 };
  /** GPS 轨迹真实路径总里程（km，从 Travel/轨迹/*.geojson 的 km 属性汇总） */
  trackKm = 0;
  /** 日记里提到、还未建档的城市建议 */
  suggestions: CitySuggestion[] = [];

  constructor(app: App, settings: AtlasSettings) {
    this.app = app;
    this.settings = settings;
  }

  async scan(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const cities: City[] = [];
    const places: City[] = [];
    const cityByName = new Map<string, City>();

    for (const f of files) {
      if (!f.path.startsWith(this.settings.travelFolder + "/")) continue;

      const fm = frontmatter(this.app, f);
      const name = str(fm.name, f.basename);
      const countryRaw = str(fm.country, f.parent?.name || "Unknown");
      const country = parseWikiLink(countryRaw);
      const visitDates = strList(fm.visitDates);
      const typeRaw = str(fm.type, "").trim().toLowerCase();
      // 只收城市/地点笔记：旅程（trip）、覆盖率/年度回顾等生成报告一律跳过
      if (typeRaw && typeRaw !== "city" && typeRaw !== "place") continue;
      const latNum = num(fm.lat);
      const lngNum = num(fm.lng);
      const hasCoordsFM =
        Number.isFinite(latNum) && Number.isFinite(lngNum) && !(latNum === 0 && lngNum === 0);
      if (!typeRaw && !hasCoordsFM && visitDates.length === 0) continue; // 无类型无坐标的报告文件
      const kind: CityKind = typeRaw === "place" ? "place" : "city";

      const entry: City = {
        name,
        country,
        lat: latNum,
        lng: lngNum,
        visits: visitDates.length || num(fm.visits),
        visitDates,
        lastVisit: str(fm.lastVisit, visitDates.length ? visitDates[visitDates.length - 1] : ""),
        note: f.path,
        kind,
        created: str(fm.created) || undefined,
      };

      if (kind === "place") {
        places.push(entry);
      } else {
        cities.push(entry);
        cityByName.set(name.toLowerCase(), entry);
      }
    }

    // Derive visits from diary links, without requiring manual frontmatter updates.
    const derived = new Map<string, Set<string>>();
    // 日记里提到但未匹配到已有城市的链接（候选新城市）
    const pending = new Map<string, Set<string>>();
    const diaryFiles = this.collectDiaryFiles(files);
    for (const f of diaryFiles) {
      // 链接提取带 mtime 缓存：全库扫描时未变更的日记不重读
      let targets: string[];
      const cached = this.diaryLinksCache.get(f.path);
      if (cached && cached.mtime === f.stat.mtime) {
        targets = cached.targets;
      } else {
        const content = await this.app.vault.read(f);
        targets = [];
        const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          // 去掉别名与 #标题/#区块 部分，只留链接目标
          const target = m[1].split("#")[0].trim();
          if (target) targets.push(target);
        }
        this.diaryLinksCache.set(f.path, { mtime: f.stat.mtime, targets });
      }
      for (const target of targets) {
        const city = cityByName.get(target.toLowerCase());
        if (!city) {
          if (!pending.has(target)) pending.set(target, new Set());
          pending.get(target)!.add(f.basename);
          continue;
        }
        if (!derived.has(city.name)) derived.set(city.name, new Set());
        derived.get(city.name)!.add(f.basename);
      }
    }

    for (const city of cities) {
      const d = derived.get(city.name);
      if (d && d.size) {
        const dates = [...new Set([...city.visitDates, ...d])].sort();
        city.visitDates = dates;
        city.visits = dates.length;
        city.lastVisit = dates[dates.length - 1] || "";
      }
    }

    const byCountryName = (a: City, b: City): number =>
      a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
    this.cities = cities.sort(byCountryName);
    this.places = places.sort(byCountryName);

    this.route = buildTravelRoute([...cities, ...places]);
    this.trackKm = Math.round(await this.sumTrackKm(files));

    // 未建档建议：排除日期命名（日记互链）、附件类链接，以及仓库中已有同名笔记的链接
    this.suggestions = [...pending.entries()]
      .filter(([name]) => name && !/^\d{4}-\d{2}-\d{2}$/.test(name))
      .filter(([name]) => !/\.[a-z0-9]{2,5}$/i.test(name))
      .filter(([name]) => !this.app.metadataCache.getFirstLinkpathDest(name, ""))
      .map(([name, diaries]) => ({ name, diaries: diaries.size }))
      .sort((a, b) => b.diaries - a.diaries || a.name.localeCompare(b.name));
  }

  /** 日记范围为全库：任何目录下以日期命名（YYYY-MM-DD.md）的笔记都视为日记 */
  private collectDiaryFiles(files: TFile[]): TFile[] {
    const re = /^\d{4}-\d{2}-\d{2}\.md$/;
    return files.filter((f) => f.extension === "md" && re.test(f.name));
  }

  /** 汇总 Travel/轨迹/*.geojson 的 km 属性（文件名+mtime 缓存，避免每次重扫全读） */
  private async sumTrackKm(files: TFile[]): Promise<number> {
    const folder = `${this.settings.travelFolder}/轨迹/`;
    const trackFiles = files.filter((f) => f.path.startsWith(folder) && f.extension === "geojson");
    if (!trackFiles.length) return 0;

    const sig = trackFiles.map((f) => `${f.path}:${f.stat.mtime}`).sort().join("|");
    if (sig === this.trackKmSig) return this.trackKmCache;

    let total = 0;
    for (const f of trackFiles) {
      try {
        const geo = JSON.parse(await this.app.vault.adapter.read(f.path)) as {
          features?: Array<{ properties?: { km?: unknown } }>;
        } | null;
        total += Number(geo?.features?.[0]?.properties?.km) || 0;
      } catch {
        // 单个文件损坏时跳过，不影响其余
      }
    }
    this.trackKmSig = sig;
    this.trackKmCache = total;
    return total;
  }

  private trackKmSig = "";
  private trackKmCache = 0;

  getStats(): AtlasStats {
    const countries = new Set(this.cities.map(c => c.country));
    const visits = this.cities.reduce((sum, c) => sum + c.visits, 0);
    const visitedCities = this.cities.filter(c => c.visits > 0).length;
    const unlocated = [...this.cities, ...this.places].filter(c => !hasCoords(c)).length;

    return {
      countries: countries.size,
      cities: this.cities.length,
      pois: this.places.length,
      visits,
      visitedCities,
      unlocated,
      routeKm: Math.round(this.route.totalKm),
      trackKm: Math.round(this.trackKm),
    };
  }
}
