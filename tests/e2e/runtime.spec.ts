import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

let app: ElectronApplication;
let page: Page;
let projectsDir: string;
let dataDir: string;

test.beforeEach(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-runtime-"));
  projectsDir = path.join(root, "projects");
  dataDir = path.join(root, "data");
  app = await electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      AUTOAPPZ_DATA_DIR: dataDir,
      AUTOAPPZ_PROJECTS_DIR: projectsDir,
      AUTOAPPZ_LOG_LEVEL: "debug",
    },
  });
  page = await app.firstWindow();
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill("Runtime App");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Runtime App");
});

test.afterEach(async (_fixtures, testInfo) => {
  await app.close();
  // The dev server's fate is only visible in the app's own log (readiness timeouts, spawn failures and the
  // process output tail are logged there); surface it in the report when a test fails.
  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      const log = readFileSync(path.join(dataDir, "logs", "main.log"), "utf8");
      const tail = log.trimEnd().split("\n").slice(-80).join("\n");
      console.log(`--- main.log tail (${testInfo.title}) ---\n${tail}`);
      await testInfo.attach("main.log", { body: log, contentType: "application/x-ndjson" });
    } catch {
      /* no log was written */
    }
  }
});

test("install, start the dev server, see the app in the preview, capture a runtime error, stop", async () => {
  test.setTimeout(240_000);
  const preview = page.getByTestId("preview");

  // Install (real pnpm, real network) — attributed to its own phase
  await preview.getByTestId("runtime-install").getByRole("button", { name: "Run" }).click();
  await expect(preview.getByTestId("runtime-install")).toContainText("Install: RUNNING", { timeout: 20_000 });
  await expect(preview.getByTestId("runtime-install")).toContainText("Install: STOPPED", {
    timeout: 180_000,
  });
  const appFile = path.join(projectsDir, "runtime-app", "src", "App.tsx");
  expect(readFileSync(path.join(projectsDir, "runtime-app", "package.json"), "utf8")).toContain("vite");

  // Dev server: port from the reserved band, readiness by probe, preview via the proxy
  await preview.getByTestId("runtime-serve").getByRole("button", { name: "Start" }).click();
  await expect(preview.getByTestId("runtime-serve")).toContainText("Dev server: RUNNING", {
    timeout: 60_000,
  });
  const frame = page.frameLocator('iframe[title="Preview"]');
  await expect(frame.getByText("Your app is running")).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText(
    /Dev server on port 41\d{3} · preview via http:\/\/127\.0\.0\.1:42\d{3}\//,
  );

  // Logs dock shows the phase-tagged output
  await page.getByRole("tab", { name: "Logs" }).click();
  await expect(page.getByTestId("runtime-logs")).toContainText("[serve]");

  // Break the app at render time; HMR reloads the preview and the error is surfaced
  const original = readFileSync(appFile, "utf8");
  writeFileSync(
    appFile,
    original.replace(
      "export function App() {",
      'export function App() {\n  throw new Error("Deliberate runtime failure for e2e");',
    ),
  );
  const banner = page.getByTestId("runtime-error-banner");
  await expect(banner).toContainText("Deliberate runtime failure for e2e", { timeout: 20_000 });
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(page.getByRole("list", { name: "Problems" })).toContainText("Deliberate runtime failure");

  // Stop: preview disappears and the phase is STOPPED
  await preview.getByTestId("runtime-serve").getByRole("button", { name: "Stop" }).click();
  await expect(preview.getByTestId("runtime-serve")).toContainText("Dev server: STOPPED", {
    timeout: 20_000,
  });
  await expect(page.locator('iframe[title="Preview"]')).toHaveCount(0);
});
