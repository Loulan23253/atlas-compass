import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["main.js", "esbuild.config.mjs"] },
  ...tseslint.configs.recommendedTypeChecked,
  obsidianmd.configs.recommended,
  {
    rules: {
      // 中文 UI 文案无大小写语义，"GPS/CSV" 会被误改为小写——官方审查机对非英文文案不启用此规则
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
