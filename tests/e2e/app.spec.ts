import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../apps/desktop");

test("boots an empty window and round-trips workspace.info", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "autoappz-e2e-"));
  const app = await electron.launch({
    args: [appDir],
    env: { ...process.env, AUTOAPPZ_DATA_DIR: dataDir, AUTOAPPZ_LOG_LEVEL: "debug" },
  });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle("AutoAPPZ");
  await expect(page.getByTestId("status")).toHaveText(/Workspace ready/);
  await app.close();
});
