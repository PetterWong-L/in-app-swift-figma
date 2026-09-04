import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const playwrightPath = process.env.IN_APP_FIGMA_PLAYWRIGHT;
const chromiumExecutable = process.env.IN_APP_FIGMA_CHROMIUM;

test("nested outline expands modules independently and adds pages to the chosen module", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-outline-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  const config = {
    schema_version: 3,
    delivery: { profile: "strict" },
    execution: { parallel: false, max_parallel: 2 },
    mock_data_sources: [],
    modules: [
      {
        id: "account",
        title: "Account",
        entry_page: "login",
        pages: [pageConfig("login", "Login"), pageConfig("profile", "Profile")]
      },
      {
        id: "settings",
        title: "Settings",
        entry_page: "privacy",
        pages: [pageConfig("privacy", "Privacy")]
      }
    ]
  };
  await writeFile(configPath, JSON.stringify(config));

  const server = await createEditorServer({
    configPath,
    bridgePath: path.join(skillRoot, "scripts", "task_config_web_bridge.rb"),
    editorRoot: path.join(skillRoot, "scripts", "editor"),
    port: 0
  });
  const playwright = await import(pathToFileURL(playwrightPath).href);
  const browser = await playwright.default.chromium.launch({ headless: true, executablePath: chromiumExecutable });
  context.after(async () => {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(server.url);
  await page.locator("#module-list .outline-module").first().waitFor();

  const modules = page.locator("#module-list .outline-module");
  assert.equal(await modules.count(), 2);
  assert.equal(await modules.nth(0).locator("[data-toggle-module]").getAttribute("aria-expanded"), "true");
  assert.equal(await modules.nth(0).locator(".outline-page-item").count(), 2);
  assert.equal(await modules.nth(1).locator("[data-toggle-module]").getAttribute("aria-expanded"), "false");
  assert.equal(await modules.nth(1).locator(".outline-page-item").count(), 0);

  await modules.nth(1).locator("[data-toggle-module]").click();
  assert.equal(await modules.nth(1).locator("[data-toggle-module]").getAttribute("aria-expanded"), "true");
  assert.equal(await modules.nth(1).locator(".outline-page-item").count(), 1);
  assert.equal(await modules.nth(0).locator("[data-select-module]").getAttribute("aria-current"), "true");

  await modules.nth(1).locator('[data-select-page="privacy"]').click();
  assert.equal(await modules.nth(1).locator("[data-select-module]").getAttribute("aria-current"), "true");
  await modules.nth(0).locator("[data-toggle-module]").click();
  assert.equal(await modules.nth(0).locator(".outline-page-item").count(), 0);

  await modules.nth(1).locator("[data-toggle-module]").click();
  assert.equal(await modules.nth(1).locator("[data-toggle-module]").getAttribute("aria-expanded"), "true");

  await modules.nth(1).locator("[data-add-page-to-module]").click();
  await page.locator("#add-item-name").fill("Notifications");
  await page.locator('#add-item-form button[type="submit"]').click();
  await page.locator('[data-select-page="notifications"]').waitFor();
  assert.equal(await modules.nth(1).locator(".outline-page-item").count(), 2);

  const screenshotDir = process.env.IN_APP_FIGMA_SCREENSHOT_DIR;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.locator(".sidebar").screenshot({ path: path.join(screenshotDir, "outline-desktop.png") });
  }
  await page.setViewportSize({ width: 900, height: 900 });
  const moduleLabelWidth = await modules.nth(0).locator("[data-select-module]").evaluate((element) => element.clientWidth);
  assert.ok(moduleLabelWidth >= 72, `expected a readable module label width, received ${moduleLabelWidth}px`);
  if (screenshotDir) await page.locator(".sidebar").screenshot({ path: path.join(screenshotDir, "outline-narrow.png") });
});

function pageConfig(id, title) {
  return {
    id,
    title,
    page_type: "view",
    page_role: "screen",
    status: "todo",
    attempts: 0,
    commit: null,
    reason: null,
    started_at: null,
    completed_at: null,
    acceptance_history: [],
    data_dependencies: [],
    behaviors: [],
    states: [{ id: "default", title: "Default", figma_url: `https://www.figma.com/design/FILE/${id}?node-id=1-1` }]
  };
}
