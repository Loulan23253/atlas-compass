import { upgradeCityBody, GENERATED_END, GENERATED_START } from "./NoteFormat";
import { appendJournalSections, COMPANIONS, NEXT_VISIT, COUNTRY_ROUTE, COUNTRY_PRACTICAL, YEAR_CHOICES, PHOTO_BEYOND } from "./JournalSections";

export function enrichJournalBody(content: string, type: string): string | null {
  let enriched = content;
  if (type === "city" || type === "place") {
    const upgraded = upgradeCityBody(content);
    // 任意手写城市笔记不强制套模板；识别过的旧/新 Atlas 模板才补栏目。
    if (upgraded === null && !/^ {0,3}(?:`{3,}|~{3,})atlas-city\s*$/m.test(content)) return null;
    enriched = appendJournalSections(upgraded ?? content, [COMPANIONS, NEXT_VISIT]);
  } else if (type === "country") {
    if (!/^ {0,3}(?:`{3,}|~{3,})atlas-country\s*$/m.test(content)) return null;
    enriched = appendJournalSections(content, [COUNTRY_ROUTE, COUNTRY_PRACTICAL]);
  } else {
    const start = content.indexOf(GENERATED_START);
    const end = content.indexOf(GENERATED_END, start + GENERATED_START.length);
    if (start < 0 || end < start) return null;
    const before = content.slice(0, end + GENERATED_END.length);
    const personal = content.slice(end + GENERATED_END.length);
    const sections = type === "trip" ? [COMPANIONS] : type === "year-review" ? [YEAR_CHOICES] : type === "photo-report" ? [PHOTO_BEYOND] : [];
    enriched = before + appendJournalSections(personal, sections);
  }
  return enriched === content ? null : enriched;
}
