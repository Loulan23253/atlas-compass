import { FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import { TRANSPORT_LABELS } from "../model/StepLife";

/** 轨迹文件 properties.segments 的交通方式修正（保存后写回轨迹属性） */
interface SegmentRow {
  /** 起止（秒） */
  s: number;
  e: number;
  /** 方式枚举 */
  m: number;
}

const fmtTime = (sec: number): string => {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 第一步：模糊选择轨迹文件 */
export class TrackFilePickerModal extends FuzzySuggestModal<TFile> {
  constructor(private plugin: AtlasPlugin) {
    super(plugin.app);
  }
  getItems(): TFile[] {
    const folder = `${this.plugin.settings.travelFolder}/轨迹/`;
    return this.plugin.app.vault
      .getFiles()
      .filter((f) => f instanceof TFile && f.path.startsWith(folder) && f.extension === "geojson")
      .sort((a, b) => b.basename.localeCompare(a.basename)) as TFile[];
  }
  getItemText(f: TFile): string {
    return f.basename;
  }
  onChooseItem(f: TFile): void {
    new FixTransportModal(this.plugin, f).open();
  }
}

/** 第二步：列出当日各路径段，逐段下拉改方式，保存写回文件 */
export class FixTransportModal extends Modal {
  private rows: SegmentRow[] = [];
  private edited: number[] = [];
  constructor(
    private plugin: AtlasPlugin,
    private file: TFile,
  ) {
    super(plugin.app);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.titleEl.setText(`修正行程方式 — ${this.file.basename}`);
    let geo: {
      features?: Array<{ properties?: Record<string, unknown> }>;
    } | null = null;
    try {
      geo = JSON.parse(await this.plugin.app.vault.adapter.read(this.file.path));
    } catch {
      new Notice("轨迹文件读取失败");
      this.close();
      return;
    }
    const props = geo?.features?.[0]?.properties as Record<string, unknown> | undefined;
    this.rows = ((props?.segments as SegmentRow[] | undefined) ?? []).map((r) => ({ ...r }));
    if (!this.rows.length) {
      this.contentEl.createEl("p", { text: "该文件没有行程段数据（用「导入」重新跑一遍即会生成）。" });
      return;
    }
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      new Setting(this.contentEl)
        .setName(`${fmtTime(r.s)} → ${fmtTime(r.e)}`)
        .setDesc(`${Math.round((r.e - r.s) / 60)} 分钟`)
        .addDropdown((d) => {
          for (let m = 0; m <= 8; m++) d.addOption(String(m), TRANSPORT_LABELS[m] ?? "未知");
          d.setValue(String(r.m)).onChange((v) => {
            this.rows[i].m = Number(v);
            this.edited.push(i);
          });
        });
    }
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("保存修改")
        .setCta()
        .onClick(() => void this.save()),
    );
  }

  private async save(): Promise<void> {
    if (!this.edited.length) {
      this.close();
      return;
    }
    const geo = JSON.parse(await this.plugin.app.vault.adapter.read(this.file.path)) as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };
    const props = geo?.features?.[0]?.properties;
    if (!props) return;
    props.segments = this.rows;
    // 重算 transport 汇总
    const counts: Record<number, number> = {};
    for (const r of this.rows) counts[r.m] = (counts[r.m] ?? 0) + 1;
    props.trips = this.rows.length;
    props.transport = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${TRANSPORT_LABELS[Number(k)] ?? "未知"}×${v}`)
      .join(" + ") || "无路径";
    await this.plugin.app.vault.adapter.write(this.file.path, JSON.stringify(geo));
    new Notice(`已保存：${this.edited.length} 段方式已修正`);
    this.plugin.refreshViews();
    this.close();
  }
}

/** 导入历史列表 */
export class ImportHistoryModal extends Modal {
  constructor(private plugin: AtlasPlugin) {
    super(plugin.app);
  }
  onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText("导入历史");
    const history = this.plugin.settings.importHistory ?? [];
    if (!history.length) {
      this.contentEl.createEl("p", { cls: "atlas-muted", text: "还没有导入记录。" });
      return;
    }
    for (const h of history) {
      new Setting(this.contentEl)
        .setName(h.file)
        .setDesc(
          `${h.time} · ${h.days} 天 · ${h.points.toLocaleString()} 点 · 清洗剔除 ${h.ignored.toLocaleString()} · hash ${h.hash}`,
        );
    }
  }
}
