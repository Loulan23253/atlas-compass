import { App, TFile, parseYaml } from "obsidian";
import { replaceGenerated, travelNote } from "../model/NoteFormat";
import { todayISO } from "./File";
import { travelTags } from "../model/TravelTags";

/** 只更新带标记的自动内容；旧版或手写笔记另存新版，不覆盖正文。 */
export async function saveTravelNote(app: App, requestedPath: string, content: string, personal?: string): Promise<string> {
  const fresh = travelNote(content, personal);
  let path = requestedPath;
  let index = 0;
  while (true) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) {
      await app.vault.create(path, fresh);
      return path;
    }
    if (file instanceof TFile) {
      // process 串行读取与更新正文，避免生成期间覆盖编辑器刚保存的个人文字。
      let updated = false;
      await app.vault.process(file, (existing) => {
        const merged = replaceGenerated(existing, fresh);
        if (merged === null) return existing;
        updated = true;
        return merged;
      });
      if (updated) {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          const header = fresh.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          const generated = header ? parseYaml(header[1]) as Record<string, unknown> : {};
          for (const key of ["type", "start", "end", "days", "recordedDays", "cities", "km", "year", "through"]) {
            if (Object.prototype.hasOwnProperty.call(generated, key)) fm[key] = generated[key];
          }
          fm.updated = todayISO();
          fm.tags = travelTags([...travelTags(fm.tags), ...travelTags(generated.tags)]);
          const classes = Array.isArray(fm.cssclasses) ? fm.cssclasses.map(String) : typeof fm.cssclasses === "string" ? [fm.cssclasses] : [];
          fm.cssclasses = [...new Set([...classes, "atlas-note", "atlas-trip"])];
        });
        return path;
      }
    }
    index++;
    path = requestedPath.replace(/\.md$/, `（旅行手记${index > 1 ? ` ${index}` : ""}）.md`);
  }
}
