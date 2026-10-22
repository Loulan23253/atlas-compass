import type { City } from "./City";
import { validVisit } from "./TravelInsights";

/** 国家手记只汇总用户已建档的笔记，内置地名库不算作到访。 */
export function countryJournal(cities: City[], country: string) {
  const entries = cities.filter((c) => c.country.trim().toLowerCase() === country.trim().toLowerCase());
  const latest = (c: City): string => [...c.visitDates, c.lastVisit].filter(validVisit).sort().slice(-1)[0] ?? "";
  const visited = (c: City): boolean => c.visits > 0 || !!latest(c);
  const sort = (a: City, b: City): number => latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name);
  return {
    cities: entries.filter((c) => c.kind === "city" && visited(c)).sort(sort),
    places: entries.filter((c) => c.kind === "place" && visited(c)).sort(sort),
    wishlist: entries.filter((c) => !visited(c)).sort(sort),
    latest: entries.map(latest).sort().slice(-1)[0] ?? "",
  };
}
