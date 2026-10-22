export const GENERATED_START = "<!-- atlas:generated:start -->";
export const GENERATED_END = "<!-- atlas:generated:end -->";

function contentHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16);
}

/** Markdown 表格中的文本；链接目标与展示文本分别处理。 */
export function tableText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

export function noteLink(path: string, label = path.split("/").pop()?.replace(/\.md$/, "") ?? path): string {
  const target = path.replace(/\.md$/, "").replace(/[[\]|#\r\n]/g, "");
  return `[[${target}|${label.replace(/[[\]|\r\n]/g, "")}]]`;
}

/** 只把机器生成部分放进标记；个人文字始终在标记之外。 */
export function travelNote(content: string, personal = "## 留给自己的几句话\n\n<!-- 写下一个想记住的画面、一次相遇，或下次还想去的地方。 -->"): string {
  const fm = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!fm) throw new Error("旅行笔记缺少 frontmatter");
  let header = fm[0].replace(/^cssclasses:.*$/m, "cssclasses: [atlas-note, atlas-trip]");
  if (!/^tags\s*:/m.test(header)) header = header.replace(/^(---\r?\n)/, "$1tags: [travel]\n");
  const body = content.slice(fm[0].length).trim();
  return `${header.replace(/\s+$/, "")}\n\n${GENERATED_START}\n<!-- atlas:hash:${contentHash(body)} -->\n${body}\n${GENERATED_END}\n\n${personal}\n`;
}

export function replaceGenerated(existing: string, fresh: string): string | null {
  const from = existing.indexOf(GENERATED_START);
  const to = existing.indexOf(GENERATED_END, from + GENERATED_START.length);
  const freshFrom = fresh.indexOf(GENERATED_START);
  const freshTo = fresh.indexOf(GENERATED_END, freshFrom + GENERATED_START.length);
  if (from < 0 || to < from || freshFrom < 0 || freshTo < freshFrom) return null;
  const block = existing.slice(from + GENERATED_START.length, to).trim();
  const hash = block.match(/^<!-- atlas:hash:([a-f0-9]+) -->\r?\n/);
  // 用户也可能直接在逐日摘要中写字；这种情况下另存新版，不覆盖改写过的自动区。
  if (!hash || contentHash(block.slice(hash[0].length)) !== hash[1]) return null;
  return existing.slice(0, from) + fresh.slice(freshFrom, freshTo + GENERATED_END.length) +
    existing.slice(to + GENERATED_END.length);
}

/** 不猜测链接指向城市；仅用来升级原模板的栏目，原有正文原样保留。 */
export function upgradeCityBody(content: string): string | null {
  const headings: Record<string, string> = {
    Memories: "想记住的片刻", Food: "这一口，值得再来", Places: "走过的地方", Notes: "随手记",
  };
  const header = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0] ?? "";
  let fence = "";
  let changed = false;
  let knownTemplate = false;
  let hasPhotos = false;
  let hasFootprints = false;
  let titleLine = -1;
  const parts = content.slice(header.length).split(/(\r?\n)/).map((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) {
        fence = marker[1];
        if (/^ {0,3}(?:`{3,}|~{3,})atlas-city\s*$/.test(line)) hasFootprints = true;
      }
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      return line;
    }
    if (fence) return line;
    if (titleLine < 0 && /^# .+/.test(line)) titleLine = index;
    if (/^## .*?(照片|相册|影像)/.test(line)) hasPhotos = true;
    if (/^## (想记住的片刻|这一口，值得再来|走过的地方|随手记)\s*$/.test(line)) knownTemplate = true;
    return line.replace(/^## (Memories|Food|Places|Notes)[ \t]*$/, (_, key: string) => {
      changed = true;
      return `## ${headings[key]}`;
    });
  });
  if (!changed && !knownTemplate && !hasFootprints) return null;
  // 未闭合代码块的笔记留给用户修正，避免把新栏目插进代码示例。
  if (fence) return null;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  if (!hasFootprints && titleLine >= 0) {
    parts[titleLine] += `${newline}${newline}\`\`\`atlas-city${newline}\`\`\``;
    changed = true;
  }
  let body = parts.join("");
  if (!hasPhotos) {
    body += `${newline}${newline}## 照片与沿途${newline}${newline}<!-- 把照片拖到这里，在照片下面写一句当时的故事。 -->${newline}`;
    changed = true;
  }
  return changed ? header + body : null;
}
