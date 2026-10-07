import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv.includes("production");

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", ...builtinModules],
  format: "cjs",
  // manifest minAppVersion 1.5.0 → Obsidian 桌面端 Electron 28 (Chromium 120)，
  // 远高于 ES2020 所需 (Chromium 80 / Safari 13.1)；es2020 保留 ?. 与 ?? 原生语法，
  // 比es2018 降级产物再省 ~4KB。es2021+ 无进一步收益。
  target: "es2020",
  // 保留中文原文而非 \uXXXX 转义：产物更小、可直接 grep 验证
  charset: "utf8",
  // 国家级边界以文本内联进 main.js：官方渠道安装只分发 3 个文件，
  // 无 data/ 目录时世界地图仍可打开（省/市级仍需 data/）
  loader: { ".geojson": "text", ".txt": "text", ".json": "text" },
  // worldcities.json 用别名导入：绕开 TS 对真实 .json 的类型推断（运行时是文本，惰性 JSON.parse）
  alias: { "atlas-worldcities": "./data/worldcities.json" },
  // production 只分发 main.js，压缩后体积约减半；dev 保持可读 + inline sourcemap
  minify: production,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  logLevel: "info"
};

if (production) {
  await esbuild.build(buildOptions);
} else {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Atlas watching...");
}