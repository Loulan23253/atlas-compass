export interface MarkerRange { from: number; to: number; }

/** 只识别 Atlas 自身的整行标记；示例代码与其他注释仍可见。 */
export function generatedMarkerRanges(source: string): MarkerRange[] {
  const ranges: MarkerRange[] = [];
  let offset = 0;
  let fence = "";
  // 保留换行长度以计算编辑器偏移；避免旧版 iOS 不支持的后行断言。
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const text = line.replace(/\r?\n$/, "");
    const delimiter = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(text)) fence = "";
    } else if (!fence && /^ {0,3}<!-- atlas:(?:generated:(?:start|end)|hash:[a-f0-9]+) -->[ \t]*$/.test(text)) {
      const previous = ranges[ranges.length - 1];
      if (previous && previous.to === offset) previous.to += line.length;
      else ranges.push({ from: offset, to: offset + line.length });
    }
    offset += line.length;
  }
  return ranges;
}
