import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compactBoundariesPlugin } from "./scripts/compact-boundaries.mjs";

const production = process.argv.includes("production");

export const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "@codemirror/state", "@codemirror/view", ...builtinModules],
  format: "cjs",
  // manifest minAppVersion 1.5.0 → Obsidian 桌面端 Electron 28 (Chromium 120)，
  // 远高于 ES2020 所需 (Chromium 80 / Safari 13.1)；es2020 保留 ?. 与 ?? 原生语法，
  // 比es2018 降级产物再省 ~4KB。es2021+ 无进一步收益。
  target: "es2020",
  // 保留中文原文而非 \uXXXX 转义：产物更小、可直接 grep 验证
  charset: "utf8",
  // 基础边界、城市库、格点以文本内联进 main.js；只安装 3 个文件即可使用。
  // data/ 中的高清边界是可选覆盖文件，不全部打入构建。
  loader: { ".geojson": "text", ".txt": "text", ".json": "text" },
  plugins: [compactBoundariesPlugin],
  // worldcities.json 用别名导入：绕开 TS 对真实 .json 的类型推断（运行时是文本，惰性 JSON.parse）
  alias: { "atlas-worldcities": "./data/worldcities.json" },
  // production 只分发 main.js，压缩后体积约减半；dev 保持可读 + inline sourcemap
  minify: production,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  logLevel: "info"
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (production) {
    await esbuild.build(buildOptions);
  } else {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("Atlas watching...");
  }
}
