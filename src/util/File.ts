import { App, TFile, normalizePath } from "obsidian";

/** Create every missing folder in `path` (e.g. "Travel/Japan"). */
export async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/");
  let cur = "";
  for (const p of parts) {
    if (!p) continue;
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      await app.vault.createFolder(cur);
    }
  }
}

/** Read the frontmatter object of a file (empty object when absent). */
export function frontmatter(app: App, file: TFile): Record<string, unknown> {
  return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

/** Coerce an unknown value into a finite number, defaulting to 0. */
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an unknown value into a string with a fallback. */
export function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

/** Coerce an unknown value into a list of non-empty strings. */
export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

/** Today's date as YYYY-MM-DD in UTC. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve after `ms` milliseconds (used to respect geocoder rate limits). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
