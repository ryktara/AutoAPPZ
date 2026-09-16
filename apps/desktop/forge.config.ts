import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const env = process.env;
/** Signing is configured from environment only (CI secrets); absent secrets produce unsigned builds. */
const macSigning =
  env["MAC_CERT_P12_BASE64"] && env["APPLE_ID"] && env["APPLE_APP_PASSWORD"] && env["APPLE_TEAM_ID"]
    ? {
        osxSign: {},
        osxNotarize: {
          appleId: env["APPLE_ID"],
          appleIdPassword: env["APPLE_APP_PASSWORD"],
          teamId: env["APPLE_TEAM_ID"],
        },
      }
    : {};
const windowsSigning =
  env["WIN_CERT_PFX"] && env["WIN_CERT_PASSWORD"]
    ? { windowsSign: { certificateFile: env["WIN_CERT_PFX"], certificatePassword: env["WIN_CERT_PASSWORD"] } }
    : {};

const config: ForgeConfig = {
  packagerConfig: {
    ...macSigning,
    ...windowsSigning,
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
  makers: [
    new MakerZIP({}, ["darwin", "win32", "linux"]),
    new MakerSquirrel({ name: "AutoAPPZ", setupExe: "AutoAPPZ-Setup.exe" }),
    new MakerDMG({ format: "ULFO" }, ["darwin"]),
    new MakerDeb({ options: { maintainer: "AutoAPPZ", homepage: "https://github.com/autoappz/autoappz" } }, [
      "linux",
    ]),
  ],
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
