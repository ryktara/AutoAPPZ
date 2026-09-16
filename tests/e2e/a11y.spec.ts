import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");
// axe-core is injected through the debugger (page.evaluate), which the renderer CSP does not govern; the
// Playwright AxeBuilder needs a second page, which Electron windows cannot open.
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

interface AxeResult {
  violations: { id: string; impact?: string; help: string; nodes: { target: string[] }[] }[];
}

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-a11y-"));
  app = await electron.launch({
    args: [appDir],
    env: {
      ...process.env,
      AUTOAPPZ_DATA_DIR: path.join(root, "data"),
      AUTOAPPZ_PROJECTS_DIR: path.join(root, "projects"),
    },
  });
  page = await app.firstWindow();
  await expect(page).toHaveTitle("AutoAPPZ");
});

test.afterEach(async () => {
  await app.close();
});

/** WCAG 2.x A/AA rules; serious and critical violations fail the build. */
async function expectNoViolations(name: string) {
  await page.evaluate(axeSource);
  const results = await page.evaluate<AxeResult>(() =>
    (window as unknown as { axe: { run(options: unknown): Promise<AxeResult> } }).axe.run({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
    }),
  );
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = blocking.map(
    (v) => `${v.id} (${v.impact ?? "?"}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `${name}: ${summary.join("\n")}`).toEqual([]);
}

test("home and settings screens have no serious accessibility violations", async () => {
  await expectNoViolations("home");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectNoViolations("settings");
});

test("the project workspace has no serious accessibility violations across its tabs", async () => {
  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill("A11y Shop");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("A11y Shop");
  await expectNoViolations("workspace: transcript");
  for (const tab of ["Plan", "Execution", "Changes", "Validation", "Blueprint", "Memory", "Project"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expectNoViolations(`workspace: ${tab}`);
  }
});

test("keyboard: primary navigation and tab lists are operable without a mouse", async () => {
  // Sequential focus order through the primary navigation, then activation with Enter.
  await page.getByRole("button", { name: "Projects" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Projects" }).focus();
  await page.keyboard.press("Enter");

  const form = page.getByRole("form", { name: "New project" });
  await form.getByLabel("Name").fill("Keys");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Keys");
  const transcript = page.getByRole("tab", { name: "Transcript" });
  await transcript.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Plan" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Project" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(transcript).toBeFocused();
});

test("reduced motion is honoured from the OS preference and from the setting", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The title comes from the static HTML; poll so the token stylesheet injected at bootstrap is present.
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--motion-normal").trim(),
      ),
    )
    .toBe("0ms");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Reduce motion").check();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-reduced-motion")))
    .toBe("true");
  const fromSetting = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--motion-normal").trim(),
  );
  expect(fromSetting).toBe("0ms");
});
