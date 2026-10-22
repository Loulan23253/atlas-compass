/** 合并 Obsidian 的字符串/列表标签，保留原有标签并补上 travel。 */
export function travelTags(value: unknown, countries: Iterable<string> = []): string[] {
  const tags = (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .filter((tag): tag is string => typeof tag === "string")
    .flatMap((tag) => tag.split(/[,\s]+/))
    .filter(Boolean)
    .map((tag) => tag === "#travel" ? "travel" : tag);
  return [...new Set([...tags, "travel", ...[...countries].map(countryTag).filter(Boolean)])];
}

/** 国家名转换为可用标签；中文保留，空格等标签不支持的字符用下划线连接。 */
export function countryTag(country: string): string {
  const name = country.trim().replace(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/, "$1");
  const tag = name.replace(/[^\p{L}\p{N}_\/-]+/gu, "_").replace(/^[_/]+|[_/]+$/g, "");
  return /^\d+$/.test(tag) ? `country_${tag}` : tag;
}
