import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const playwrightPath = process.env.IN_APP_FIGMA_PLAYWRIGHT;
const chromiumExecutable = process.env.IN_APP_FIGMA_CHROMIUM;

test("a popup-only module clears and disables its entry page", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-entry-page-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  await writeFile(configPath, JSON.stringify(editorConfig()));

  const server = await createEditorServer({
    configPath,
    bridgePath: path.join(skillRoot, "scripts", "task_config_web_bridge.rb"),
    editorRoot: path.join(skillRoot, "scripts", "editor"),
    port: 0
  });
  let browser;
  context.after(async () => {
    await browser?.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const playwright = await import(pathToFileURL(playwrightPath).href);
  browser = await playwright.default.chromium.launch({ headless: true, executablePath: chromiumExecutable });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(server.url);
  await page.locator("#module-entry").waitFor();

  assert.deepEqual(await page.locator("#module-entry option").allTextContents(), ["Home"]);
  await page.locator("#page-role").selectOption("popup");

  assert.equal(await page.locator("#module-entry").isDisabled(), true);
  assert.equal(await page.locator("#module-entry").inputValue(), "");
  assert.match(await page.locator("#module-entry option").innerText(), /popup modules need no entry|弹窗模块无需入口/);
  assert.equal(await page.locator("#popup-field-title").isChecked(), true);
  assert.equal(await page.locator("#popup-field-subtitle").isChecked(), false);
  assert.equal(await page.locator("#popup-field-content").isChecked(), true);
  assert.deepEqual(await inputValues(page.locator("[data-popup-button-id]")), ["primary"]);

  await page.locator("#add-popup-button").click();
  assert.deepEqual(await inputValues(page.locator("[data-popup-button-id]")), ["primary", "button"]);
  await page.locator('[data-move-popup-button="1"][data-delta="-1"]').click();
  assert.deepEqual(await inputValues(page.locator("[data-popup-button-id]")), ["button", "primary"]);
  await page.locator('[data-delete-popup-button="0"]').click();
  assert.deepEqual(await inputValues(page.locator("[data-popup-button-id]")), ["primary"]);

  await page.locator("#validate-button").click();
  assert.equal(await page.locator('#module-entry[aria-invalid="true"]').count(), 0);
  assert.equal(await page.locator('[data-issue-path="modules.common.entry_page"] .inline-field-errors').count(), 0);
});

async function inputValues(locator) {
  return locator.evaluateAll((inputs) => inputs.map((input) => input.value));
}

function editorConfig() {
  return {
    schema_version: 5,
    delivery: { profile: "strict" },
    execution: { parallel: false, max_parallel: 2 },
    system_ui: { tab_bar_controller: false, picker: false },
    mock_data_sources: [],
    modules: [{
      id: "common",
      title: "Common",
      entry_page: "home",
      pages: [{
        id: "home",
        title: "Home",
        page_type: "view",
        page_role: "screen",
        status: "todo",
        attempts: 0,
        commit: null,
        reason: null,
        started_at: null,
        completed_at: null,
        acceptance_history: [],
        accepted_baseline: null,
        removed_tasks: [],
        data_dependencies: [],
        behaviors: [],
        states: [{
          id: "default",
          title: "Default",
          figma_url: "https://www.figma.com/design/FILE/home?node-id=1-1",
          implementation_status: "todo"
        }]
      }]
    }]
  };
}
