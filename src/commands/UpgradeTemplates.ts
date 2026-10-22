import { Notice, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { upgradeCityBody } from "../model/NoteFormat";
import { enrichJournalBody } from "../model/JournalEnrichment";
import { travelTags } from "../model/TravelTags";

/** 升级已识别的旧栏目、补足足迹与照片区，原有正文保留。 */
export class UpgradeTemplatesCommand {
  constructor(private plugin: AtlasPlugin) {}

  async run(all = false): Promise<void> {
    let count = 0;
    const targets = new Map([...this.plugin.db.cities, ...this.plugin.db.places].map((c) => [c.note, c.kind] as [string, string]));
    if (all) for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${this.plugin.settings.travelFolder}/`)) continue;
      const type: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.type;
      if (typeof type === "string" && ["country", "trip", "year-review", "photo-report"].includes(type)) targets.set(file.path, type);
    }
    this.plugin.setSuppressScan(true);
    try {
      for (const [path, type] of targets) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        let changed = false;
        await this.plugin.app.vault.process(file, (content) => {
          const upgraded = all ? enrichJournalBody(content, type) : upgradeCityBody(content);
          if (upgraded === null) return content;
          changed = true;
          return upgraded;
        });
        if (!changed) continue;
        await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          const classes = Array.isArray(fm.cssclasses) ? fm.cssclasses.map(String) : typeof fm.cssclasses === "string" ? [fm.cssclasses] : [];
          const layout = type === "city" || type === "place" ? "atlas-city" : type === "country" ? "atlas-country" : "atlas-trip";
          fm.cssclasses = [...new Set([...classes, "atlas-note", layout])];
          const country = type === "country" ? fm.name : fm.country;
          fm.tags = travelTags(fm.tags, typeof country === "string" ? [country] : []);
        });
        count++;
      }
    } finally {
      this.plugin.setSuppressScan(false);
    }
    await this.plugin.db.scan();
    this.plugin.refreshViews();
    new Notice(all ? `已为 ${count} 篇手记补充栏目，原有文字、照片和自动区均已保留。`
      : `已升级 ${count} 篇城市/地点笔记的栏目与排版，原有内容已保留。`);
  }
}
