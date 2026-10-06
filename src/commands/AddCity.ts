import { Modal, Notice, TFile } from "obsidian";
import type AtlasPlugin from "../main";
import type { City } from "../model/City";
import { ensureFolder } from "../util/File";
import { cityTemplate } from "../util/Template";

export class CityModal extends Modal {
  plugin: AtlasPlugin;
  edit: City | null;
  presetName: string;
  submit: (d: { name: string; country: string; lat: number; lng: number }) => void;

  constructor(
    plugin: AtlasPlugin,
    submit: (d: { name: string; country: string; lat: number; lng: number }) => void,
    edit: City | null = null,
    presetName = "",
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.submit = submit;
    this.edit = edit;
    this.presetName = presetName;
  }

  onOpen(): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: this.edit ? "编辑城市" : "添加城市" });

    const input = (
      placeholder: string,
      value: string,
      disabled = false,
    ): HTMLInputElement => {
      const i = c.createEl("input", { type: "text", placeholder, value, cls: "atlas-modal-input" });
      i.disabled = disabled;
      return i;
    };

    const n = input("城市名，如 Tokyo", this.presetName || this.edit?.name || "");
    const country = input("国家，如 Japan", this.edit?.country ?? "");

    // Offer existing countries as suggestions.
    const existing = [...new Set(this.plugin.db.cities.map((x) => x.country))].sort();
    if (existing.length) {
      const dlId = `atlas-countries-${Date.now()}`;
      const dl = c.createEl("datalist", { attr: { id: dlId } });
      for (const cn of existing) dl.createEl("option", { value: cn });
      country.setAttr("list", dlId);
    }

    const lat = input("纬度，如 35.6762", this.edit ? String(this.edit.lat || "") : "");
    const lng = input("经度，如 139.6503", this.edit ? String(this.edit.lng || "") : "");

    const row = c.createDiv("atlas-modal-btn-row");
    const cancel = row.createEl("button", { text: "取消", cls: "atlas-modal-btn-gap" });
    cancel.onclick = () => this.close();

    const ok = row.createEl("button", { text: this.edit ? "保存" : "添加", cls: "mod-cta" });
    ok.onclick = () => {
      const name = n.value.trim();
      const ct = country.value.trim();
      if (!name || !ct) {
        new Notice("请填写城市名和国家");
        return;
      }
      const la = Number(lat.value);
      const lo = Number(lng.value);
      this.submit({
        name,
        country: ct,
        lat: Number.isFinite(la) ? la : 0,
        lng: Number.isFinite(lo) ? lo : 0,
      });
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class AddCityCommand {
  plugin: AtlasPlugin;

  constructor(plugin: AtlasPlugin) {
    this.plugin = plugin;
  }

  async run(edit: City | null = null, presetName?: string, onCreated?: (city: City) => void): Promise<void> {
    new CityModal(
      this.plugin,
      (d) => {
        void this.applyCity(d, edit, onCreated);
      },
      edit,
      presetName,
    ).open();
  }

  /** Modal submit 回调的异步实现（回调类型期望 void，用 void 操作符触发） */
  private async applyCity(
    d: { name: string; country: string; lat: number; lng: number },
    edit: City | null,
    onCreated?: (city: City) => void,
  ): Promise<void> {
    const folder = `${this.plugin.settings.travelFolder}/${d.country}`;
    const path = `${folder}/${d.name}.md`;

    if (edit) {
      const old = this.plugin.app.vault.getAbstractFileByPath(edit.note);
      if (old && (d.name !== edit.name || d.country !== edit.country)) {
        await ensureFolder(this.plugin.app, folder);
        const target = this.plugin.app.vault.getAbstractFileByPath(path);
        if (target && target.path !== edit.note) {
          new Notice("目标位置已存在同名笔记");
          return;
        }
        await this.plugin.app.fileManager.renameFile(old, path);
      }
      const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile | null;
      if (file) {
        await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
          fm.name = d.name;
          fm.country = d.country;
          fm.lat = d.lat;
          fm.lng = d.lng;
          fm.type = "city";
        });
      }
    } else {
      if (this.plugin.app.vault.getAbstractFileByPath(path)) {
        new Notice("该城市已存在");
        return;
      }
      await ensureFolder(this.plugin.app, folder);
      await this.plugin.app.vault.create(path, cityTemplate(d.name, d.country, d.lat, d.lng));
    }

    await this.plugin.db.scan();
    this.plugin.refreshViews();
    new Notice(edit ? `已更新 ${d.name}` : `已添加 ${d.name}`);
    if (onCreated && !edit) {
      const created =
        this.plugin.db.cities.find((c) => c.note === path) ??
        this.plugin.db.places.find((c) => c.note === path);
      if (created) onCreated(created);
    }
  }
}
