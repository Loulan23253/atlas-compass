/** 通用 CSV/TSV 分词与分隔符嗅探（供城市导入与 GPS 轨迹导入共用） */

export function sniffDelimiter(text: string): string {
  const firstLineEnd = text.indexOf("\n") === -1 ? text.length : text.indexOf("\n");
  const firstLine = text.slice(0, firstLineEnd);
  const counts = [",", ";", "\t"].map((d) => ({ d, n: countChar(firstLine, d) }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/** 状态机式分词：引号内的分隔符/换行都算单元格内容 */
export function tokenizeCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** 取首行（去 BOM）并分词，得到表头单元格 */
export function sniffHeaders(text: string): string[] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLineEnd = clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n");
  const delim = sniffDelimiter(clean);
  const firstRow = tokenizeCsv(clean.slice(0, firstLineEnd), delim)[0] ?? [];
  return firstRow.map((h) => h.trim().toLowerCase());
}
