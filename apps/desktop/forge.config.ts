import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    name: "AutoAPPZ",
    executableName: "autoappz",
    // Native prebuilds must stay on disk (not inside the asar) to be dlopen-able.
    asar: {
      unpack:
        "{**/node_modules/better-sqlite3/**,**/node_modules/@vscode/ripgrep/**,**/node_modules/dugite/**}",
    },
    // Bundled project templates are read at runtime from <resources>/templates.
    extraResource: ["../../templates"],
    appBundleId: "dev.autoappz.desktop",
    protocols: [{ name: "AutoAPPZ", schemes: ["autoappz"] }],
  },
  // better-sqlite3 ships N-API prebuilds; nothing needs an Electron-specific rebuild.
  rebuildConfig: { onlyModules: [] },
  makers: [new MakerZIP({}, ["darwin", "win32", "linux"])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
