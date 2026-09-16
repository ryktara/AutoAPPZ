import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startFakeModelServer, type FakeModelServer } from "@autoappz/testing";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");
const API_KEY = "sk-e2e-provider-key-ZYXWVUTSRQPONMLK";

let app: ElectronApplication;
let page: Page;
let server: FakeModelServer;

test.beforeEach(async () => {
  server = await startFakeModelServer({
    apiKey: API_KEY,
    models: ["fake-coder", "fake-mini"],
    scenarios: [{ match: /.*/, turns: [{ text: "ok" }] }],
  });
  const dataDir = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-providers-"));
  app = await electron.launch({
    args: [appDir],
    env: { ...process.env, AUTOAPPZ_DATA_DIR: dataDir, AUTOAPPZ_LOG_LEVEL: "debug" },
  });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings" }).click();
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test("configure an OpenAI-compatible provider, validate it, and route to a discovered model", async () => {
  const card = page.getByTestId("provider-openai-compatible");
  await expect(page.getByTestId("providers").getByRole("region")).toHaveCount(6);

  await card.getByLabel("Base URL").fill(server.baseUrl);
  await card.getByLabel("Base URL").blur();
  await card.getByLabel("API key").fill(API_KEY);
  await card.getByRole("button", { name: "Save key" }).click();
  await expect(card.getByText("ready")).toBeVisible();

  await card.getByRole("button", { name: "Validate" }).click();
  await expect(card.getByTestId("validation-result")).toHaveText("Connected. 2 models available.");
  await expect(card.getByLabel("Default model")).toContainText("fake-coder (discovered)");

  await expect(page.getByTestId("route-preview")).toContainText("Coding tasks would use fake-coder");

  // the key never reaches the page, and reached the server only as a bearer header
  const html = await page.content();
  expect(html).not.toContain(API_KEY);
  expect(server.requests.some((r) => r.headers["authorization"] === `Bearer ${API_KEY}`)).toBe(true);
  expect(JSON.stringify(server.requests.map((r) => r.body))).not.toContain(API_KEY);
});

test("a wrong key is reported without exposing it", async () => {
  const card = page.getByTestId("provider-openai-compatible");
  await card.getByLabel("Base URL").fill(server.baseUrl);
  await card.getByLabel("Base URL").blur();
  await card.getByLabel("API key").fill("sk-wrong-key-1234567890");
  await card.getByRole("button", { name: "Save key" }).click();
  await card.getByRole("button", { name: "Validate" }).click();
  await expect(card.getByTestId("validation-result")).toHaveText("The API key was rejected.");
  expect(await page.content()).not.toContain("sk-wrong-key");
});
