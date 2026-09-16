import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

  // The builder step ran with retrieved context; each excerpt explains why it was included.
  const contextUsed = page.getByTestId("context-used");
  await expect(contextUsed).toContainText("Context:");
  await contextUsed.locator("summary").click();
  const excerpts = page.getByRole("list", { name: "Context excerpts" });
  await expect(excerpts).toContainText("src/App.tsx");
  await expect(excerpts).toContainText("named in the plan");

  // Validators ran after the edit: syntax passes on the changed file; tools needing node_modules explain why they were skipped.
  await page.getByRole("tab", { name: "Validation" }).click();
  const validationTab = page.getByTestId("validation");
  await expect(validationTab).toContainText("Attempt 1");
  await expect(validationTab).toContainText("syntax");
  await expect(validationTab).toContainText("passed");
  await expect(validationTab.getByRole("button", { name: "Diagnose & fix" })).toBeVisible();

  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByRole("list", { name: "Changed files" })).toContainText("src/App.tsx");
  const diff = page.getByLabel("Diff of src/App.tsx");
  await expect(diff).toContainText("- ");
  await expect(diff).toContainText("Welcome, builder");

  // Every writable task produces a checkpoint ref and a commit carrying the task trailer.
  const projectDir = path.join(projectsDir, "build-app");
  const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" });
  expect(existsSync(path.join(projectDir, ".git"))).toBe(true);
  await expect
    .poll(() => gitOut("log", "-1", "--format=%B"), { timeout: 10_000 })
    .toContain("AutoAPPZ-Task: ");
  expect(gitOut("for-each-ref", "refs/autoappz/checkpoints")).toContain("/base");
  expect(gitOut("show", "--stat", "--format=", "HEAD")).toContain("src/App.tsx");

  await page.getByRole("tab", { name: "Project" }).click();
  await expect(page.getByRole("list", { name: "Permission rules" })).toContainText("src/**");
  await expect(page.getByTestId("git-status")).toContainText("main");
  await expect(page.getByRole("list", { name: "Checkpoints" })).toContainText("committed");

  // Database integration hub: configure a Postgres connection that cannot be reached and see the status.
  const database = page.getByRole("region", { name: "Database" });
  await expect(database).toContainText("No database attached yet.");
  await database.getByLabel("Name").fill("Unreachable");
  await database.getByLabel("Connection string or password").fill("postgresql://u:p@127.0.0.1:1/app");
  await database.getByRole("button", { name: "Save and test" }).click();
  const databases = page.getByRole("list", { name: "Databases" });
  await expect(databases).toContainText("Unreachable", { timeout: 15_000 });
  await expect(databases).toContainText("attached");
  await expect(databases).toContainText("error", { timeout: 15_000 });

  // Undo restores the file to its pre-task content while keeping the commit history intact.
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByRole("button", { name: "Undo this task" }).click();
  await expect(page.getByText(/Restored 1 file/)).toBeVisible();
  expect(readFileSync(appFile, "utf8")).toContain("Your app is running");
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
