import { Plugin, Notice, TAbstractFile } from "obsidian";
import { AtlasView, VIEW_TYPE_ATLAS } from "./view";
import { DEFAULT_SETTINGS, AtlasSettings, AtlasSettingTab } from "./settings";
import { AtlasDB } from "./model/TravelDB";
import { AddCityCommand } from "./commands/AddCity";
import { AddCountryCommand } from "./commands/AddCountry";
import { ImportModal, ExportCommand } from "./commands/Import";
import { CoverageReportCommand } from "./commands/CoverageReport";
import { YearReviewCommand } from "./commands/YearReview";
import { ImportHistoryModal, TrackFilePickerModal } from "./commands/TrackTools";
import { TripsCommand } from "./commands/Trips";
import { PhotoFootprintCommand } from "./commands/Photos";
import { setDataRoot, pluginDataPath, vaultAdapter } from "./util/DataPath";

export default class AtlasPlugin extends Plugin {
  settings: AtlasSettings = DEFAULT_SETTINGS;
  db!: AtlasDB;
  private scanTimer: number | null = null;
  private suppressScan = 0;

  async onload(): Promise<void> {
    // 注入 App 与插件安装目录（data/ 资源按 manifest.dir 定位，禁止硬编码 .obsidian）
    setDataRoot(this.app, this.manifest.dir);

    const loaded = (await this.loadData()) as Partial<AtlasSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...loaded };

    // 数据目录探测：官方渠道安装只带 3 个文件，省/市级细节与覆盖率功能需要 data/
    void (async () => {
      const adapter = vaultAdapter();
      if (!adapter) return;
      try {
        if (!(await adapter.exists(`${pluginDataPath()}/admin1.lo.geojson`))) {
          new Notice(
            "Atlas Compass：未找到 data/ 数据目录，地图仅显示国家级轮廓。把插件仓库的 data/ 文件夹复制到本插件目录后重启 Obsidian，可获得省/市级边界与覆盖率功能（详见 README）。",
            12000,
          );
        }
      } catch {
        // adapter 不可用时静默——地图自身会再提示
      }
    })();
    this.db = new AtlasDB(this.app, this.settings);

    this.registerView(VIEW_TYPE_ATLAS, (leaf) => new AtlasView(leaf, this));

    this.addRibbonIcon("globe", "打开 Atlas", () => this.activateView());
    this.addCommand({ id: "open-atlas", name: "打开 Atlas 旅行地图", callback: () => this.activateView() });
    this.addCommand({ id: "add-city", name: "添加城市", callback: () => new AddCityCommand(this).run() });
    this.addCommand({ id: "add-country", name: "添加国家", callback: () => new AddCountryCommand(this).run() });
    this.addCommand({ id: "import-cities", name: "导入城市（CSV / TSV / JSON）", callback: () => new ImportModal(this).open() });
    this.addCommand({ id: "export-cities", name: "导出城市为 JSON", callback: async () => new ExportCommand(this).run() });
    this.addCommand({
      id: "land-coverage-report",
      name: "生成国土覆盖率报告",
      callback: () => new CoverageReportCommand(this).run(),
    });
    this.addCommand({ id: "year-review", name: "生成年度回顾", callback: () => new YearReviewCommand(this).run() });
    this.addCommand({
      id: "fix-transport-mode",
      name: "修正行程交通方式",
      callback: () => new TrackFilePickerModal(this).open(),
    });
    this.addCommand({ id: "import-history", name: "查看导入历史", callback: () => new ImportHistoryModal(this).open() });
    this.addCommand({ id: "generate-trips", name: "生成旅程笔记", callback: () => new TripsCommand(this).run() });
    this.addCommand({ id: "photo-footprint", name: "照片点亮足迹", callback: () => new PhotoFootprintCommand(this).run() });
    this.addCommand({
      id: "scan-cities",
      name: "重新扫描城市",
      callback: async () => {
        await this.rescan();
        new Notice("Atlas 扫描完成");
      },
    });

    this.addSettingTab(new AtlasSettingTab(this.app, this));

    await this.db.scan();

    this.registerEvent(this.app.vault.on("create", (file) => this.onFileEvent(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.onFileEvent(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onFileEvent(file)));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.onFileEvent(file)));

    // 打开城市笔记时地图联动聚焦（只读，不写访问记录）
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ATLAS)[0];
        const view = leaf?.view;
        if (!(view instanceof AtlasView)) return;
        const city =
          this.db.cities.find((c) => c.note === file.path) ??
          this.db.places.find((c) => c.note === file.path);
        if (city) view.focusOnMap(city);
      }),
    );
  }

  private onFileEvent(file: TAbstractFile | null): void {
    if (!this.isRelevant(file)) return;
    this.scheduleScan();
  }

  private isRelevant(file: TAbstractFile | null): boolean {
    if (!file?.path) return false;
    // 日记范围为全库：任何 markdown 变更都可能影响日记链接的派生到访
    return file.path.endsWith(".md");
  }

  /** 全量重扫城市库并刷新所有视图（命令、防抖定时器、设置保存共用）。 */
  private async rescan(): Promise<void> {
    await this.db.scan();
    this.refreshViews();
  }

  /** Temporarily block auto-rescans (used during bulk operations). */
  setSuppressScan(suppress: boolean): void {
    this.suppressScan = Math.max(0, this.suppressScan + (suppress ? 1 : -1));
  }

  /** Debounce rescans so typing in a diary doesn't trigger a scan per keystroke. */
  private scheduleScan(): void {
    if (this.suppressScan > 0) return;
    if (this.scanTimer !== null) window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      void this.rescan();
    }, 300);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ATLAS);
    if (existing.length) {
      // revealLeaf 在官方 typings 里标 @since 1.7.2，高于 minAppVersion 1.5.0，
      // 改用 1.5.0 前就存在的 setActiveLeaf（@since 0.16.3）
      this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_ATLAS, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  refreshViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_ATLAS).forEach((leaf) => {
      const v = leaf.view;
      if (v instanceof AtlasView) v.refresh();
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.rescan();
  }
}
