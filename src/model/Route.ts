import type { City } from "./City";
import { hasCoords } from "./City";
import { distanceKm } from "../util/Geo";

/** 路线中的一站：某天到访某地 */
export interface RouteStop {
  city: City;
  date: string;
}

/** 相邻两站之间的一段 */
export interface RouteSegment {
  from: RouteStop;
  to: RouteStop;
  km: number;
  /** 行程所属年份（取到达日），用于分段配色 */
  year: string;
}

export interface TravelRoute {
  stops: RouteStop[];
  segments: RouteSegment[];
  totalKm: number;
}

const EMPTY_ROUTE: TravelRoute = { stops: [], segments: [], totalKm: 0 };

function dist(a: City, b: City): number {
  return distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}

/**
 * 把所有访问事件按日期串成旅行路线。
 * 同一天到访多个城市时，从上一站出发按就近串联，避免路线在图上乱跳。
 */
export function buildTravelRoute(cities: City[]): TravelRoute {
  const events: RouteStop[] = [];
  for (const c of cities) {
    if (!hasCoords(c) || !c.visits) continue;
    for (const d of c.visitDates) events.push({ city: c, date: d });
  }
  if (events.length < 2) return EMPTY_ROUTE;
  events.sort((a, b) => a.date.localeCompare(b.date));

  // 按日期分组，天内多站就近串联
  const stops: RouteStop[] = [];
  let group: RouteStop[] = [];
  const flushGroup = (): void => {
    if (!group.length) return;
    let cur = stops.length ? stops[stops.length - 1].city : group[0].city;
    const rest = group.slice();
    while (rest.length) {
      let best = 0;
      let bestKm = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const km = dist(cur, rest[i].city);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      }
      const next = rest.splice(best, 1)[0];
      stops.push(next);
      cur = next.city;
    }
    group = [];
  };
  for (const e of events) {
    if (group.length && group[0].date !== e.date) flushGroup();
    group.push(e);
  }
  flushGroup();

  // 连续停在同一城市的事件合并为一站
  const deduped: RouteStop[] = [];
  for (const s of stops) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.city.note !== s.city.note) deduped.push(s);
  }

  const segments: RouteSegment[] = [];
  let totalKm = 0;
  for (let i = 1; i < deduped.length; i++) {
    const from = deduped[i - 1];
    const to = deduped[i];
    const km = dist(from.city, to.city);
    totalKm += km;
    segments.push({ from, to, km, year: to.date.slice(0, 4) });
  }
  return { stops: deduped, segments, totalKm };
}
