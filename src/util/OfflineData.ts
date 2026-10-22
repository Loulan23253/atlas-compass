/** 优先使用可解析的本地覆盖文件；缺失、读取失败或内容损坏时回退内置数据。 */
export async function loadOfflineData<T>(
  paths: string[],
  readText: (path: string) => Promise<string | null>,
  embedded: (() => string) | undefined,
  parse: (text: string) => T,
): Promise<T | null> {
  for (const path of paths) {
    try {
      const text = await readText(path);
      if (text !== null) return parse(text);
    } catch (error) {
      console.warn(`Atlas: 本地数据不可用，尝试备用数据：${path}`, error);
    }
  }
  if (embedded) {
    try { return parse(embedded()); }
    catch (error) { console.error("Atlas: 内置数据无法解析", error); }
  }
  return null;
}
