import { todayISO } from "./File";

/** Markdown template for a new city/place note. */
export function cityTemplate(
  name: string,
  country: string,
  lat: number,
  lng: number,
  kind: "city" | "place" = "city",
): string {
  return `---
tags: travel
type: ${kind}
country: "[[${country}]]"
lat: ${lat}
lng: ${lng}
visits: 0
lastVisit:
created: ${todayISO()}
---

# ${name}

## Memories

## Food

## Places

## Notes
`;
}

/** Markdown template for a new country index note. */
export function countryTemplate(name: string): string {
  return `---
tags: travel
created: ${todayISO()}
---

# ${name}

## Cities

## Notes
`;
}
