import type AtlasPlugin from "../main";
import { ensureFolder } from "../util/File";

/**
 * 轨迹边车元数据（Travel/轨迹/.atlas-meta.json）：
 * 每日轨迹写盘后把签名与摘要属性记在边车里，下次导入的增量判定直接查内存表，
 * 不再逐日 JSON.parse 整份 GeoJSON（几百个轨迹文件时能省去导入前的明显延迟）。
 * 点前缀文件 Obsidian 不索引（不进搜索/图谱/反链），且独立于 data.json——卸载重装插件不受影响。
 */

/** 单日轨迹的边车条目（按日期为 key，如 "2025-08-12"） */
export interface TrackMetaEntry {
  /** 增量签名：points|km|trips|stays|avgKmh，与轨迹文件 features[0].properties 一致 */
  sig: string;
  /** 里程（km，1 位小数） */
  km: number;
  /** 出行段数 */
  trips: number;
  /** 停留次数 */
  stays: number;
  /** 平均速度（km/h） */
  avgKmh: number;
  /** 格点覆盖（与轨迹文件 properties.cells 一致），随签名一起缓存 */
  cells?: string[];
  /** 最后写盘时间（ISO） */
  updated: string;
}

/** 边车文件路径：跟随设置里的旅行根目录（Travel/轨迹/.atlas-meta.json） */
export function trackMetaPath(plugin: AtlasPlugin): string {
  return `${plugin.settings.travelFolder}/轨迹/.atlas-meta.json`;
}

/**
 * 读入边车元数据。任何异常都安全降级：
 * 文件不存在或整体损坏/非法 JSON → 返回 {}（本次导入全部回退读文件算签名）；
 * 个别条目非法（缺 sig）→ 丢弃该条目，该日期回退读文件并回填——边车随之自愈。
 */
export async function readTrackMeta(plugin: AtlasPlugin): Promise<Record<string, TrackMetaEntry>> {
  try {
    const path = trackMetaPath(plugin);
    const adapter = plugin.app.vault.adapter;
    if (!(await adapter.exists(path))) return {};
    const raw: unknown = JSON.parse(await adapter.read(path));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, TrackMetaEntry> = {};
    for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
      const e = (value ?? {}) as Partial<TrackMetaEntry>;
      if (typeof e.sig !== "string") continue; // 无签名的条目不可信 → 走回退路径重建
      out[date] = {
        sig: e.sig,
        km: Number(e.km) || 0,
        trips: Number(e.trips) || 0,
        stays: Number(e.stays) || 0,
        avgKmh: Number(e.avgKmh) || 0,
        cells: Array.isArray(e.cells) ? e.cells.map(String) : undefined,
        updated: typeof e.updated === "string" ? e.updated : "",
      };
    }
    return out;
  } catch {
    return {}; // 损坏视为空：本次导入回退读文件，结束时重建边车
  }
}

/** 一次性写回边车（每次导入结束时调用）。写失败不影响导入结果：下次导入回退读文件并重建。 */
export async function writeTrackMeta(
  plugin: AtlasPlugin,
  meta: Record<string, TrackMetaEntry>,
): Promise<void> {
  try {
    const path = trackMetaPath(plugin);
    await ensureFolder(plugin.app, path.slice(0, path.lastIndexOf("/")));
    await plugin.app.vault.adapter.write(path, JSON.stringify(meta));
  } catch {
    // 边车写失败可容忍：下次导入会因边车缺失/过期回退读文件，自行重建
  }
}
