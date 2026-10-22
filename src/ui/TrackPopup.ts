import { readElevation, type Elevation } from "../model/Elevation";

export interface TrackPopupData {
  date?: string;
  km?: number;
  transport?: string;
  elev?: unknown;
  inferred?: boolean;
}

/** 海拔曲线按需构建为内联 SVG；不写附件，也不依赖网络。 */
function elevationChart(e: Elevation): SVGSVGElement | null {
  const profile = e.profile;
  if (!profile || profile.length < 2 || profile[profile.length - 1][0] <= 0) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 300 120");
  svg.setAttribute("class", "atlas-elevation-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `沿途海拔，最低 ${e.min} 米，最高 ${e.max} 米，横轴为累计路程`);
  const distances = profile.map(([d]) => d);
  const alts = profile.map(([, alt]) => alt);
  const low = Math.min(...alts) - 5;
  const span = Math.max(20, Math.max(...alts) - low + 5);
  const last = distances[distances.length - 1];
  const coords = profile.map(([d, a]) => `${(12 + d / last * 276).toFixed(1)},${(92 - (a - low) / span * 68).toFixed(1)}`);
  const addPath = (d: string, cls: string): void => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    svg.appendChild(p);
  };
  const line = `M${coords.join(" L")}`;
  addPath(`${line} L288,96 L12,96 Z`, "atlas-elevation-area");
  addPath(line, "atlas-elevation-line");
  for (const [text, x, y, anchor] of [
    [`${e.min}–${e.max} m`, "12", "14", "start"],
    ["0 km", "12", "114", "start"],
    [`${last.toFixed(1)} km`, "288", "114", "end"],
  ]) {
    const label = document.createElementNS(ns, "text");
    label.textContent = text;
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.setAttribute("text-anchor", anchor);
    svg.appendChild(label);
  }
  return svg;
}

export function createTrackPopup(data: TrackPopupData, fallbackDate: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "atlas-track-popup";
  el.createDiv({ cls: "atlas-popup-header", text: data.date || fallbackDate });
  if (data.inferred) {
    el.createDiv({ cls: "atlas-popup-line", text: "推测连接段 · 这一段没有连续 GPS 记录" });
    return el;
  }
  if (typeof data.km === "number" && Number.isFinite(data.km)) el.createDiv({ cls: "atlas-track-distance", text: `记录路程约 ${data.km} km` });
  if (data.transport && data.transport !== "无路径") el.createDiv({ cls: "atlas-popup-line", text: data.transport });
  const elev = readElevation(data.elev);
  if (elev) {
    const details = el.createEl("details", { cls: "atlas-elevation-details" });
    details.createEl("summary", { text: "沿途海拔 · GPS 估算" });
    details.createDiv({ cls: "atlas-popup-line", text: `${elev.min}–${elev.max} m${elev.gain > 0 ? ` · 累计上升约 ${elev.gain} m` : ""}` });
    let rendered = false;
    details.addEventListener("toggle", () => {
      if (!details.open || rendered) return;
      rendered = true;
      const chart = elevationChart(elev);
      if (chart) details.appendChild(chart);
      else details.createDiv({ cls: "atlas-popup-line", text: "本日仅保留海拔摘要；重新导入原始轨迹可补齐曲线。" });
    });
  }
  return el;
}
