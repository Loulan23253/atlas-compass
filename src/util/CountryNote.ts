import { App, TFile, normalizePath, parseYaml } from "obsidian";
import { ensureFolder, str } from "./File";
import { countryTemplate } from "./Template";

const pending = new WeakMap<App, Map<string, Promise<TFile>>>();

/** 按需补建国家页；已有自定义国家页优先，同名普通笔记不覆盖。 */
export async function ensureCountryNote(app: App, travelFolder: string, country: string): Promise<TFile> {
  const name = country.trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|#^[\]\r\n]/.test(name)) {
    throw new Error("国家名含有不能用于笔记名称的字符");
  }
  const root = normalizePath(travelFolder).replace(/\/$/, "");
  const key = `${root}/${name}`;
  let jobs = pending.get(app);
  if (!jobs) { jobs = new Map(); pending.set(app, jobs); }
  const running = jobs.get(key);
  if (running) return running;
  const create = async (): Promise<TFile> => {
    for (const file of app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${root}/`)) continue;
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type === "country" && str(fm.name, file.basename) === name) return file;
    }
    await ensureFolder(app, key);
    for (let i = 0; ; i++) {
      const suffix = i === 0 ? "" : i === 1 ? "（国家手记）" : `（国家手记 ${i}）`;
      const path = `${key}/${name}${suffix}.md`;
      const existing = app.vault.getAbstractFileByPath(path);
      if (!existing) return app.vault.create(path, countryTemplate(name));
      if (!(existing instanceof TFile)) continue;
      // 创建后元数据缓存可能尚未更新，读取文件可避免重复创建。
      const content = await app.vault.read(existing);
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      try {
        const parsed: unknown = match ? parseYaml(match[1]) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const fm = parsed as Record<string, unknown>;
          if (fm.type === "country" && str(fm.name, existing.basename) === name) return existing;
        }
      } catch { /* 无效 YAML 或同名普通笔记保留，使用下一个空闲路径。 */ }
    }
  };
  const job = create();
  jobs.set(key, job);
  try { return await job; } finally { jobs.delete(key); }
}
