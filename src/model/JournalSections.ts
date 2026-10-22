export interface JournalSection { heading: string; body: string; aliases?: RegExp; }

/** 线索默认折叠，正文留给用户写自己的故事。 */
export function writingPrompt(title: string, ...ideas: string[]): string {
  return [`> [!tip]- ${title}`, ...ideas.map((idea) => `> ${idea}`)].join("\n");
}

export const COMPANIONS: JournalSection = {
  heading: "一起走过的人",
  aliases: /^.*(同行|一起走|路上的人|遇见的人).*$/,
  body: writingPrompt("留下一段只属于你们的记忆", "是谁陪你走了这一段？也可以写独自出发时的心情。", "记下一句原话、一个小默契，或一位只遇见一次的人。"),
};
export const NEXT_VISIT: JournalSection = {
  heading: "下次，再慢一点",
  aliases: /^.*(下次|下一次|再出发).*$/,
  body: writingPrompt("给下一次留三个小线索", "一处还没走到的地方，一样还没尝到的味道，一段想留白的时间。", "如果只回来半天，最想先去哪里？可用 [[地点笔记]] 收好答案。"),
};
export const COUNTRY_ROUTE: JournalSection = {
  heading: "一条想慢慢走的线",
  aliases: /^.*(想走的|慢慢走|路线灵感).*$/,
  body: writingPrompt("先把想去的名字连起来", "从一座城市出发，挑两三个感兴趣的目的地，用已有笔记链接串起来。", "哪一站想多留一天？哪一段适合散步、乘车或临时改变主意？"),
};
export const COUNTRY_PRACTICAL: JournalSection = {
  heading: "出发前的小抄",
  aliases: /^.*(小抄|出发准备|实用提醒).*$/,
  body: writingPrompt("只留亲自用得上的信息", "交通与支付怎么安排？预约、开放时间和季节限制有哪些要再核实？", "写下信息来源和核实日期，给下次出发的自己留一个靠谱入口。"),
};
export const YEAR_CHOICES: JournalSection = {
  heading: "这一年，我的五个选择",
  aliases: /^.*(五个选择|年度私选|年度最爱).*$/,
  body: writingPrompt("凭喜欢选，不按次数排名", "一处愿意重返的地方 · 一段喜欢的路 · 一顿还记得的饭", "一张最想留下的照片 · 一次没按计划发生的相遇", "可放照片、链接到地点笔记，或者只写一句理由。"),
};
export const PHOTO_BEYOND: JournalSection = {
  heading: "画面之外的几秒钟",
  aliases: /^.*(画面之外|快门之外|照片背后).*$/,
  body: writingPrompt("照片没有拍进去的部分", "按下快门之前，你在等什么？拍完以后又发生了什么？", "写下现场的声音、气味，或拍照的人说过的一句话。"),
};

export function sectionMarkdown(section: JournalSection): string {
  return `## ${section.heading}\n\n${section.body}`;
}

/** 只补缺失栏目，逐字保留原文；代码示例中的标题不当作正文栏目。 */
export function appendJournalSections(content: string, sections: JournalSection[]): string {
  let fence = "";
  const headings = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)) fence = "";
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^ {0,3}## (.+?)(?: +#+)?[ \t]*$/);
    if (heading) headings.add(heading[1]);
  }
  if (fence) return content;
  const missing = sections.filter((s) => !headings.has(s.heading) && ![...headings].some((h) => s.aliases?.test(h)));
  if (!missing.length) return content;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return content + (content.endsWith(newline + newline) ? "" : content.endsWith(newline) ? newline : newline + newline) +
    missing.map(sectionMarkdown).join("\n\n").replace(/\n/g, newline) + newline;
}
