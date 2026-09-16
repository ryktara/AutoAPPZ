import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startFakeModelServer, type FakeModelServer } from "@autoappz/testing";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

let app: ElectronApplication;
let page: Page;
let server: FakeModelServer;
let dataDir: string;
let projectsDir: string;

async function launch() {
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
  await expect(page).toHaveTitle("AutoAPPZ");
}

test.beforeEach(async () => {
  server = await startFakeModelServer({
    models: ["fake-coder"],
    scenarios: [
      { match: "slowly", turns: [{ text: "word ".repeat(60).trim(), chunkDelayMs: 50 }] },
      {
        match: /.*/,
        turns: [
          {
            text: "This project is a React + Vite app. Start with src/App.tsx.",
            usage: { input: 30, output: 12 },
          },
        ],
      },
    ],
  });
  const root = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-chat-"));
  dataDir = path.join(root, "data");
  projectsDir = path.join(root, "projects");
  await launch();
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

async function enableFakeProvider() {
  await page.getByRole("button", { name: "Settings" }).click();
  const card = page.getByTestId("provider-openai-compatible");
  await card.getByLabel("Base URL").fill(server.baseUrl);
  await card.getByLabel("Base URL").blur();
  await card.getByLabel("Enabled").check();
  await card.getByRole("button", { name: "Validate" }).click();
  await expect(card.getByTestId("validation-result")).toContainText("Connected");
  await page.getByRole("button", { name: "Projects" }).click();
}

async function createProject(name: string) {
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(name);
}

test("asking without a provider explains what to do", async () => {
  await createProject("Chat App");
  const form = page.getByRole("form", { name: "Request" });
  await form.getByLabel("Mode").selectOption("ask");
  await form.getByLabel("Request").fill("What is this?");
  await form.getByRole("button", { name: "Ask" }).click();
  await expect(form.getByText("No model provider is ready")).toBeVisible();
  await form.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByTestId("providers")).toBeVisible();
});

test("streams an answer, records cost, persists the transcript across restart", async () => {
  await enableFakeProvider();
  await createProject("Chat App");
  const form = page.getByRole("form", { name: "Request" });
  await form.getByLabel("Mode").selectOption("ask");
  await form.getByLabel("Request").fill("What does this project do?");
  await form.getByRole("button", { name: "Ask" }).click();

  const transcript = page.getByRole("tabpanel").or(page.locator(".az-transcript"));
  await expect(transcript.getByText("What does this project do?")).toBeVisible();
  await expect(page.getByText("This project is a React + Vite app. Start with src/App.tsx.")).toBeVisible();
  await expect(page.getByTestId("task-status")).toContainText("Done");
  await expect(page.getByTestId("task-status")).toContainText("42 tokens");
  await expect(page.getByTestId("task-status")).toContainText("fake-coder");

  await app.close();
  await launch();
  await page.getByRole("list", { name: "Projects" }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("What does this project do?")).toBeVisible();
  await expect(page.getByText("This project is a React + Vite app. Start with src/App.tsx.")).toBeVisible();
});

test("cancel mid-stream keeps the partial answer", async () => {
  await enableFakeProvider();
  await createProject("Chat App");
  const form = page.getByRole("form", { name: "Request" });
  await form.getByLabel("Mode").selectOption("ask");
  await form.getByLabel("Request").fill("Explain slowly");
  await form.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("live-answer")).toContainText("word");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("task-status")).toContainText("Cancelled");
  await expect(page.getByText("Stopped early — partial answer.")).toBeVisible();
});
