import type { City } from "./City";
import { hasCoords, isVisited } from "./City";

/** Aggregated statistics for a single country. */
export interface CountrySummary {
  name: string;
  cities: City[];
  cityCount: number;
  /** Number of cities in this country that have been visited. */
  visitedCityCount: number;
  /** Total visits across all cities in the country. */
  visits: number;
  /** Most recent visit date across the country. */
  lastVisit: string;
  /** Representative coordinates (first city that has coordinates). */
  lat: number;
  lng: number;
}

/** Group cities into per-country summaries, sorted by country name. */
export function buildCountries(cities: City[]): CountrySummary[] {
  const byName = new Map<string, CountrySummary>();

  for (const city of cities) {
    let c = byName.get(city.country);
    if (!c) {
      c = {
        name: city.country,
        cities: [],
        cityCount: 0,
        visitedCityCount: 0,
        visits: 0,
        lastVisit: "",
        lat: 0,
        lng: 0,
      };
      byName.set(city.country, c);
    }
    c.cities.push(city);
    if (hasCoords(city) && !(c.lat !== 0 || c.lng !== 0)) {
      c.lat = city.lat;
      c.lng = city.lng;
    }
    c.visits += city.visits;
    if (isVisited(city)) {
      c.visitedCityCount += 1;
      if (city.lastVisit && city.lastVisit > c.lastVisit) {
        c.lastVisit = city.lastVisit;
      }
    }
  }

  const list = [...byName.values()];
  for (const c of list) c.cityCount = c.cities.length;
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
