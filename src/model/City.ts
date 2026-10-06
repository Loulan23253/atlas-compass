import { hasCoordsLatLng } from "../util/Geo";

/** What kind of geographic entry a note represents. */
export type CityKind = "city" | "place";

/**
 * A geographic entry (city or place) loaded from a note under the travel folder.
 */
export interface City {
  /** Display name (frontmatter `name`, falling back to the note basename). */
  name: string;
  /** Country name (frontmatter `country`, falling back to the parent folder). */
  country: string;
  lat: number;
  lng: number;
  /** Total number of recorded visits. */
  visits: number;
  /** All visit dates (YYYY-MM-DD), from frontmatter and derived from diaries. */
  visitDates: string[];
  /** Most recent visit date (YYYY-MM-DD) or empty string. */
  lastVisit: string;
  /** Path of the note this entry was loaded from. */
  note: string;
  kind: CityKind;
  /** Frontmatter `created` date, when present. */
  created?: string;
}

/** Stable key that uniquely identifies an entry across notes and markers. */
export function cityKey(city: Pick<City, "name" | "country">): string {
  return `${city.country.toLowerCase()}::${city.name.toLowerCase()}`;
}

/** True when the entry has usable coordinates (i.e. not missing or 0,0). */
export function hasCoords(city: Pick<City, "lat" | "lng">): boolean {
  return hasCoordsLatLng(city.lat, city.lng);
}

/** True when the entry has at least one recorded visit. */
export function isVisited(city: Pick<City, "visits" | "lastVisit">): boolean {
  return city.visits > 0 || !!city.lastVisit;
}
