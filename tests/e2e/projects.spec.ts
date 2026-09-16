import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

let app: ElectronApplication;
let page: Page;
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
  const root = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-projects-"));
  dataDir = path.join(root, "data");
  projectsDir = path.join(root, "projects");
  await launch();
});

test.afterEach(async () => {
  await app.close();
});

test("create from template, open the workspace, survive a restart", async () => {
  const form = page.getByRole("form", { name: "New project" });
  await expect(form.getByLabel("Location")).toHaveValue(projectsDir);
  await form.getByLabel("Name").fill("E2E Shop");
  await form.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("project-name")).toHaveText("E2E Shop");
  const expectedDir = path.join(projectsDir, "e2e-shop");
  expect(existsSync(path.join(expectedDir, "package.json"))).toBe(true);
  expect(existsSync(path.join(expectedDir, "node_modules"))).toBe(false);

  // workspace layout is present with its empty states
  await expect(page.getByRole("region", { name: "Request" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Validation" })).toBeVisible();

  await app.close();
  await launch();
  const list = page.getByRole("list", { name: "Projects" });
  await expect(list).toContainText("E2E Shop");
  await list.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("E2E Shop");
});

test("import in place executes nothing and cannot delete the folder", async () => {
  const src = path.join(path.dirname(projectsDir), "existing");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    path.join(src, "package.json"),
    JSON.stringify({ name: "existing", scripts: { postinstall: "exit 1" } }),
  );
  const marker = path.join(src, "untouched.txt");
  writeFileSync(marker, "keep me");

  const form = page.getByRole("form", { name: "Import project" });
  await form.getByLabel("Folder").fill(src);
  await form.getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("existing");
  expect(existsSync(path.join(src, "node_modules"))).toBe(false);

  await page.getByRole("tab", { name: "Project" }).click();
  await expect(page.getByText("AutoAPPZ never deletes it")).toBeVisible();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(page.getByRole("form", { name: "New project" })).toBeVisible();
  expect(existsSync(marker)).toBe(true);
});

test("blueprint and memory persist per project", async () => {
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill("Spec App");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Spec App");

  await page.getByRole("tab", { name: "Blueprint" }).click();
  const bp = page.getByRole("form", { name: "Blueprint form" });
  await bp.getByLabel("Product name").fill("Spec");
  await bp.getByLabel("Summary").fill("A small spec");
  await bp.getByRole("button", { name: "Create blueprint" }).click();
  await expect(page.getByText("Blueprint v1")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved")).toBeVisible();
  await page.getByRole("button", { name: "Derive requirements" }).click();
  await expect(page.getByRole("list", { name: "Requirements" })).toContainText("REQ-001");

  await page.getByRole("tab", { name: "Memory" }).click();
  const mem = page.getByRole("form", { name: "Add memory" });
  await mem.getByLabel("Statement").fill("Always use pnpm");
  await mem.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("list", { name: "Project memory" })).toContainText("Always use pnpm");
});
