export interface LatLng {
  lat: number;
  lng: number;
}

/** True when lat/lng are usable (finite, in range, and not 0,0). */
export function hasCoordsLatLng(lat: number, lng: number): boolean {
  return validLatLng(lat, lng) && !(lat === 0 && lng === 0);
}

/** Validate a coordinate pair without the 0,0 placeholder exclusion. */
function validLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Format coordinates for display, e.g. "35.6762, 139.6503". */
export function formatCoords(lat: number, lng: number, digits = 4): string {
  if (!hasCoordsLatLng(lat, lng)) return "未设置";
  return `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;
}

/** Great-circle distance between two points in kilometres (Haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Geocode a query string with a single provider call.
 * Accepts both Photon (features[].geometry.coordinates) and
 * Nominatim-style ([{lat, lon}]) responses, so `url` can point to either.
 * Returns null on any failure or empty result.
 */
// 会话级缓存：同端点同查询不重复请求（批量建档/反复搜索时省限额）
const geocodeCache = new Map<string, LatLng | null>();

/** 带会话级缓存的地理编码：同端点同查询本会话内只请求一次 */
export async function geocode(
  query: string,
  url: string,
  timeoutMs = 8000,
): Promise<LatLng | null> {
  const base = (url || "https://photon.komoot.io/api").trim();
  const cacheKey = `${base}|${query}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;
  const result = await geocodeFetch(query, base, timeoutMs);
  geocodeCache.set(cacheKey, result);
  return result;
}

async function geocodeFetch(
  query: string,
  base: string,
  timeoutMs = 8000,
): Promise<LatLng | null> {
  let endpoint: URL;
  try {
    endpoint = new URL(base);
  } catch {
    return null;
  }
  // `q` + `limit` work for both services. Only Nominatim-style endpoints
  // accept `format=json`; Photon rejects unknown parameters, so detect the
  // provider from the host and let response-shape parsing handle the rest.
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "1");
  if (/nominatim/i.test(base)) endpoint.searchParams.set("format", "json");

  let res: Response;
  try {
    res = await fetchWithTimeout(endpoint.toString(), timeoutMs);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  return parseGeocodeResponse(data);
}

function parseGeocodeResponse(data: unknown): LatLng | null {
  // Nominatim: [{"lat": ..., "lon": ...}, ...]
  if (Array.isArray(data)) {
    if (!data.length) return null;
    const first = data[0] as { lat?: unknown; lon?: unknown };
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!validLatLng(lat, lng)) return null;
    return { lat, lng };
  }
  // Photon: {"features": [{"geometry": {"coordinates": [lon, lat]}}]}
  const features = (data as { features?: unknown } | null)?.features;
  if (Array.isArray(features) && features.length) {
    const first = features[0] as { geometry?: { coordinates?: unknown } };
    const coords = first?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (validLatLng(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the list of geocoding queries for a place name.
 * The plain name is only tried when it looks like a Latin place name, to
 * avoid geocoders silently resolving CJK names to same-named towns elsewhere.
 */
export function geocodeQueries(name: string, country: string): string[] {
  const queries: string[] = [];
  const withCountry = [name, country].filter(Boolean).join(", ");
  if (withCountry !== name) queries.push(withCountry);
  if (/^[A-Za-z0-9 .'\-]+$/.test(name) && /[A-Za-z]/.test(name)) {
    queries.push(name);
  }
  return queries;
}
