import type { AtlasDB } from "../model/TravelDB";

export interface StatCard {
  label: string;
  value: number;
  hint?: string;
}

/** Compute the headline statistics shown on the dashboard. */
export function computeStats(db: AtlasDB): StatCard[] {
  const s = db.getStats();
  return [
    { label: "国家", value: s.countries },
    { label: "城市", value: s.cities },
    { label: "地点", value: s.pois },
    { label: "访问记录", value: s.visits },
    { label: "已访问城市", value: s.visitedCities },
    { label: "路线里程", value: s.routeKm, hint: "km" },
    { label: "轨迹里程", value: s.trackKm, hint: "km" },
    { label: "未定位", value: s.unlocated, hint: "缺少坐标" },
  ];
}

/** Renders a grid of stat cards into a container. */
export class StatisticsPanel {
  el: HTMLElement;
  db: AtlasDB;

  constructor(el: HTMLElement, db: AtlasDB) {
    this.el = el;
    this.db = db;
  }

  render(): void {
    this.el.empty();
    const grid = this.el.createDiv("atlas-stat-grid");
    for (const card of computeStats(this.db)) {
      const d = grid.createDiv("atlas-stat-card");
      d.createDiv("atlas-stat-value").textContent = String(card.value);
      d.createDiv("atlas-stat-label").textContent = card.hint
        ? `${card.label} · ${card.hint}`
        : card.label;
    }
  }
}
