// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Layering rules (see docs/design/SYSTEM-ARCHITECTURE.md §2):
 *  - renderer/ui may import only @autoappz/contracts and @autoappz/ui, never Node/Electron.
 *  - contracts is a leaf: it imports no other @autoappz package.
 *  - packages never import from apps/.
 *  - main-side packages never import from @autoappz/ui.
 */
const rendererForbidden = [
  {
    group: ["electron", "electron/*"],
    message: "Renderer code must not import Electron; use the command bus client.",
  },
  {
    group: ["node:*", "fs", "fs/*", "path", "child_process", "os", "crypto", "net", "http", "https"],
    message: "Renderer code must not import Node built-ins.",
  },
  {
    group: [
      "@autoappz/*",
      "!@autoappz/contracts",
      "!@autoappz/contracts/*",
      "!@autoappz/ui",
      "!@autoappz/ui/*",
      "!@autoappz/command-bus",
    ],
    message: "Renderer/UI may only depend on @autoappz/contracts, @autoappz/ui and the command-bus client.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.vite/**",
      "**/out/**",
      "_reference/**",
      "templates/**",
      "**/*.d.ts",
      "coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": "allow-with-description" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/*", "@autoappz/desktop"],
              message: "Packages must never import from apps/.",
            },
            {
              group: ["**/_reference/**"],
              message: "The reference clone is analysis-only and must never be imported.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@autoappz/*"], message: "contracts is a leaf package." },
            { group: ["node:*", "electron"], message: "contracts must stay runtime-agnostic." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}", "apps/desktop/src/renderer/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": ["error", { patterns: rendererForbidden }],
    },
  },
  {
    files: [
      "packages/{core,agent,ai-providers,tools,project,runtime,git,storage,secrets,diagnostics,permissions,validation,context,integrations,plugins,command-bus}/src/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@autoappz/ui", "@autoappz/ui/*", "react", "react-dom"],
              message: "Main-side packages must not depend on UI.",
            },
            { group: ["**/apps/*"], message: "Packages must never import from apps/." },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "packages/testing/src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["tools/**"],
    rules: { "no-console": "off" },
  },
);
