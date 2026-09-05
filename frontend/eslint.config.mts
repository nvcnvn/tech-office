import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "./node_modules/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dst/**",
      "**/build/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.expo/**",
      "**/tmp/**",
      "**/ios/**",
      "**/android/**",
      "**/out/**",
      "**/*_pb.ts",
      "**/*_connect.ts",
      "**/*.min.js",
      "**/*.log",
      "**/.env*",
    ],
  },
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  tseslint.configs.recommended,
  {
    // No raw colours in mobile screens.
    //
    // Every mobile file now builds its styles from the active palette, and this is
    // what keeps that true: a sweep of this size is undone within a month by the
    // first screen that reaches for `#fff`, which then paints a white card on a
    // dark background and nothing catches it but looking at the phone.
    //
    // Deliberately narrow. It matches a string that is *entirely* a colour, so a
    // composite value like a `boxShadow` string is not caught — those are handled
    // by taking their colour from the `shadows` tokens instead. A brand constant
    // that genuinely must be a literal belongs in one named export with a comment
    // and an inline disable, not scattered across screens.
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Raw colour literal. Use a token from the active palette — `t.…` inside makeStyles, `palette.…` from useTheme() outside it.",
        },
        {
          selector: "Literal[value=/^rgba?\\(/]",
          message:
            "Raw colour literal. Use a token from the active palette — `t.overlay.*` for scrims and chrome over media.",
        },
      ],
    },
  },
  { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", extends: ["json/recommended"] },
  { files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm", extends: ["markdown/recommended"] },
]);
