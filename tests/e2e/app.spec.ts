import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

let app: ElectronApplication;
let page: Page;
let dataDir: string;

async function launch(dir: string) {
  app = await electron.launch({
    args: [appDir],
    env: { ...process.env, AUTOAPPZ_DATA_DIR: dir, AUTOAPPZ_LOG_LEVEL: "debug" },
  });
  page = await app.firstWindow();
  await expect(page).toHaveTitle("AutoAPPZ");
}

test.beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-"));
  await launch(dataDir);
});

test.afterEach(async () => {
  await app.close();
});

test("boots to the projects page and round-trips workspace.info in Settings", async () => {
  await expect(page.getByRole("form", { name: "New project" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("status")).toHaveText(/Workspace ready/);
});

test("renderer is sandboxed: no Node globals, only the bridge", async () => {
  const globals = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridgeKeys: Object.keys((window as unknown as { autoappz: object }).autoappz).sort(),
  }));
  expect(globals.require).toBe("undefined");
  expect(globals.process).toBe("undefined");
  expect(globals.bridgeKeys).toEqual(["hello", "onMessage", "send", "version"]);
});

test("settings persist across restarts", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  const theme = page.getByLabel("Theme");
  await expect(theme).toHaveValue("system");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await app.close();
  await launch(dataDir);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Theme")).toHaveValue("dark");
});

test("secrets are stored by reference and never echoed to the page", async () => {
  const secret = "sk-e2e-fixture-secret-value-ABCDEFGH1234";
  await page.getByRole("button", { name: "Settings" }).click();
  const form = page.getByRole("form", { name: "Add secret" });
  await form.getByLabel("Label").fill("E2E key");
  await form.getByLabel("Value").fill(secret);
  await form.getByRole("button", { name: "Save secret" }).click();

  const list = page.getByRole("list", { name: "Stored secrets" });
  await expect(list).toContainText("E2E key");
  await expect(list).toContainText("····1234");
  const html = await page.content();
  expect(html).not.toContain(secret);
  expect(html).not.toContain("fixture-secret");

  await list.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No secrets stored yet.")).toBeVisible();
});
