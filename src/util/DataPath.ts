import type { App, DataAdapter } from "obsidian";

let appInstance: App | null = null;
let manifestDir: string | null = null;

/**
 * main.ts onload 时注入。manifest.dir 是插件在用户库中的真实安装目录
 * （目录名 = manifest id，如 .obsidian/plugins/atlas-compass），与开发仓库
 * 目录名可能不同，禁止硬编码 —— data/ 资源一律经 pluginDataPath() 定位。
 */
export function setDataRoot(app: App, dir?: string): void {
  appInstance = app;
  manifestDir = dir ?? null;
}

/** 插件 data/ 目录（vault 相对路径） */
export function pluginDataPath(): string {
  if (manifestDir) return `${manifestDir}/data`;
  const configDir = appInstance?.vault.configDir ?? "";
  return `${configDir}/plugins/atlas-compass/data`;
}

/** vault adapter。注意 adapter 不索引 .obsidian/ 目录，读文件须 exists+read */
export function vaultAdapter(): DataAdapter | null {
  return appInstance?.vault.adapter ?? null;
}
