/** 合并 Obsidian 的字符串/列表标签，保留原有标签并补上 travel。 */
export function travelTags(value: unknown, countries: Iterable<string> = []): string[] {
  const values: readonly unknown[] = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const tags = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const tag of value.split(/[,\s]+/)) if (tag) tags.add(tag === "#travel" ? "travel" : tag);
  }
  tags.add("travel");
  for (const country of countries) {
    const tag = countryTag(country);
    if (tag) tags.add(tag);
  }
  return [...tags];
}

/** 国家名转换为可用标签；中文保留，空格等标签不支持的字符用下划线连接。 */
export function countryTag(country: string): string {
  const name = country.trim().replace(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/, "$1");
  const tag = name.replace(/[^\p{L}\p{N}_/-]+/gu, "_").replace(/^[_/]+|[_/]+$/g, "");
  return /^\d+$/.test(tag) ? `country_${tag}` : tag;
}
