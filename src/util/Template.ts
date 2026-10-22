import { todayISO } from "./File";
import { noteLink } from "../model/NoteFormat";
import { travelTags } from "../model/TravelTags";
import { writingPrompt, sectionMarkdown, COMPANIONS, NEXT_VISIT, COUNTRY_ROUTE, COUNTRY_PRACTICAL } from "../model/JournalSections";

interface CityDetails {
  visits?: number;
  visitDates?: string[];
  lastVisit?: string;
  notes?: string;
}

/** Markdown template for a new city/place note. */
export function cityTemplate(
  name: string,
  country: string,
  lat: number,
  lng: number,
  kind: "city" | "place" = "city",
  details: CityDetails = {},
): string {
  const dates = [...new Set(details.visitDates ?? [])].sort();
  return `---
tags: ${JSON.stringify(travelTags([], [country]))}
type: ${kind}
name: ${JSON.stringify(name)}
country: ${JSON.stringify(`[[${country}]]`)}
lat: ${lat}
lng: ${lng}
visits: ${details.visits ?? dates.length}
visitDates: ${JSON.stringify(dates)}
lastVisit: ${JSON.stringify(details.lastVisit || dates[dates.length - 1] || "")}
created: ${todayISO()}
cssclasses: [atlas-note, atlas-city]
---

# ${name}

> ${noteLink(country)} · ${kind === "place" ? "地点收藏" : "城市手记"}

\`\`\`atlas-city
\`\`\`

## ${kind === "place" ? "让我停下来的理由" : "想记住的片刻"}

${writingPrompt(kind === "place" ? "为什么想把这里留下来" : "从一个小细节开始", kind === "place" ? "是味道、风景、氛围，还是恰好发生的一件事？" : "抵达时听见了什么、看见了什么？哪一幕到现在还想得起来？")}

## 照片与沿途

${writingPrompt("选三张，就能讲一个小故事", "一张交代这里的样子，一张留下细节，一张收好当时的自己。", "把照片拖到正文，在下面写一句画面之外发生的事。")}

## ${kind === "place" ? "怎么去，什么时候去" : "值得再去"}

${writingPrompt(kind === "place" ? "留给下一次到访的提醒" : "把喜欢的东西收成一小串", kind === "place" ? "到达方式、预约入口、适合的时段，有什么亲身试过的小提醒？" : "一家小店、一条散步的街、一道菜。可用 [[地点笔记]] 收好位置和故事。")}

${sectionMarkdown(COMPANIONS)}

${sectionMarkdown(NEXT_VISIT)}

## 随手记
${details.notes ? `\n${details.notes}\n` : "\n<!-- 地址、花费、小提醒，或留给下一次旅行的念头。 -->\n"}
`;
}

/** Markdown template for a new country index note. */
export function countryTemplate(name: string): string {
  return `---
tags: ${JSON.stringify(travelTags([], [name]))}
type: country
name: ${JSON.stringify(name)}
created: ${todayISO()}
cssclasses: [atlas-note, atlas-country]
---

# ${name}

## 从这里开始

${writingPrompt("写下你与这里的缘分", "为什么想来？第一次抵达和原先想象的有什么不同？", "一段熟悉的旋律、一个一直想见的人，也可以成为开头。")}

## 我的目的地

\`\`\`atlas-country
\`\`\`

## 一路收藏

${writingPrompt("留一份自己的地方收藏", "照片、明信片、票根，以及喜欢的味道、声音和小习惯。", "写一句喜欢的理由，下一次翻开时就能想起来。")}

${sectionMarkdown(COUNTRY_ROUTE)}

${sectionMarkdown(COUNTRY_PRACTICAL)}
`;
}
