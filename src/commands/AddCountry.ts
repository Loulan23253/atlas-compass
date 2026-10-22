import { Modal, Notice } from "obsidian";
import type AtlasPlugin from "../main";
import { ensureCountryNote } from "../util/CountryNote";

export class CountryModal extends Modal {
  plugin: AtlasPlugin;

  constructor(plugin: AtlasPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: "添加国家" });
    c.createEl("p", {
      cls: "atlas-muted",
      text: "将创建旅行根目录下的国家文件夹与索引笔记。",
    });
    const input = c.createEl("input", {
      type: "text",
      placeholder: "国家名，如 Japan / 日本",
      cls: "atlas-modal-input",
    });
    input.focus();

    const row = c.createDiv("atlas-modal-btn-row");
    const cancel = row.createEl("button", { text: "取消", cls: "atlas-modal-btn-gap" });
    cancel.onclick = () => this.close();

    const ok = row.createEl("button", { text: "添加", cls: "mod-cta" });
    ok.onclick = async () => {
      const name = input.value.trim();
      if (!name) {
        new Notice("请填写国家名");
        return;
      }
      ok.disabled = true;
      try {
        const file = await ensureCountryNote(this.plugin.app, this.plugin.settings.travelFolder, name);
        await this.plugin.db.scan();
        this.plugin.refreshViews();
        await this.plugin.app.workspace.openLinkText(file.path, "", false);
        this.close();
      } catch (error) {
        new Notice(`国家手记未能打开：${error instanceof Error ? error.message : String(error)}`);
      } finally { ok.disabled = false; }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class AddCountryCommand {
  plugin: AtlasPlugin;

  constructor(plugin: AtlasPlugin) {
    this.plugin = plugin;
  }

  async run(): Promise<void> {
    new CountryModal(this.plugin).open();
  }
}
