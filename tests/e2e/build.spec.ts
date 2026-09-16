import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { startFakeModelServer, type FakeModelServer } from "@autoappz/testing";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

let app: ElectronApplication;
let page: Page;
let server: FakeModelServer;
let projectsDir: string;

const PLAN = JSON.stringify({
  summary: "Change the app heading",
  steps: [
    {
      id: "s1",
      title: "Edit src/App.tsx heading",
      detail: "Replace the greeting text",
      files: ["src/App.tsx"],
    },
  ],
  acceptanceCriteria: ["The page shows the new greeting"],
  risks: [],
});

test.beforeEach(async () => {
  server = await startFakeModelServer({
    models: ["fake-coder"],
    scenarios: [
      { match: /^Plan this request/, turns: [{ text: PLAN }] },
      {
        match: "Change the heading",
        turns: [
          { toolCalls: [{ name: "fs.read", input: { path: "src/App.tsx" } }] },
          {
            toolCalls: [
              {
                name: "fs.patch",
                input: {
                  path: "src/App.tsx",
                  edits: [{ find: "Your app is running", replace: "Welcome, builder" }],
                },
              },
            ],
          },
          { text: "Updated the heading to “Welcome, builder”." },
        ],
      },
    ],
  });
  const root = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-build-"));
  projectsDir = path.join(root, "projects");
  app = await electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      AUTOAPPZ_DATA_DIR: path.join(root, "data"),
      AUTOAPPZ_PROJECTS_DIR: projectsDir,
      AUTOAPPZ_LOG_LEVEL: "debug",
    },
  });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings" }).click();
  const card = page.getByTestId("provider-openai-compatible");
  await card.getByLabel("Base URL").fill(server.baseUrl);
  await card.getByLabel("Base URL").blur();
  await card.getByLabel("Enabled").check();
  await card.getByRole("button", { name: "Validate" }).click();
  await expect(card.getByTestId("validation-result")).toContainText("Connected");
  await page.getByRole("button", { name: "Projects" }).click();
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill("Build App");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Build App");
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test("plan → approve → consent → changes: the vertical slice core", async () => {
  const request = page.getByRole("form", { name: "Request" });
  await request.getByLabel("Mode").selectOption("build");
  await request
    .getByLabel("Request")
    .fill(
      "Change the heading of the app so that it greets builders warmly when they open the page for the first time",
    );
  await request.getByRole("button", { name: "Build" }).click();

  // The plan is visible before anything changes on disk.
  const plan = page.getByTestId("plan");
  await expect(plan).toContainText("Change the app heading");
  await expect(plan).toContainText("Edit src/App.tsx heading");
  const appFile = path.join(projectsDir, "build-app", "src", "App.tsx");
  expect(readFileSync(appFile, "utf8")).toContain("Your app is running");
  await page.getByRole("button", { name: "Approve and build" }).click();

  // The first write asks for consent; allow it for the project.
  const sheet = page.getByTestId("consent-sheet");
  await expect(sheet).toContainText("Edit src/App.tsx");
  await expect(sheet).toContainText("fs.patch");
  await sheet.getByRole("button", { name: "Always for this project" }).click();

  await expect(page.getByTestId("task-status")).toContainText("Done", { timeout: 15_000 });
  expect(readFileSync(appFile, "utf8")).toContain("Welcome, builder");

  await page.getByRole("tab", { name: "Execution" }).click();
  const activity = page.getByRole("list", { name: "Tool activity" });
  await expect(activity).toContainText("fs.read");
  await expect(activity).toContainText("fs.patch");

  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByRole("list", { name: "Changed files" })).toContainText("src/App.tsx");
  const diff = page.getByLabel("Diff of src/App.tsx");
  await expect(diff).toContainText("- ");
  await expect(diff).toContainText("Welcome, builder");

  await page.getByRole("tab", { name: "Project" }).click();
  await expect(page.getByRole("list", { name: "Permission rules" })).toContainText("src/**");
});

test("reject leaves the project untouched", async () => {
  const request = page.getByRole("form", { name: "Request" });
  await request
    .getByLabel("Request")
    .fill(
      "Change the heading of the app so that it greets builders warmly when they open the page for the first time",
    );
  await request.getByRole("button", { name: "Build" }).click();
  await expect(page.getByTestId("plan")).toContainText("Change the app heading");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByTestId("task-status")).toContainText("Cancelled");
  expect(readFileSync(path.join(projectsDir, "build-app", "src", "App.tsx"), "utf8")).toContain(
    "Your app is running",
  );
});
