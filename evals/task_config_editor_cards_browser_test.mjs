import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const playwrightPath = process.env.IN_APP_FIGMA_PLAYWRIGHT;
const chromiumExecutable = process.env.IN_APP_FIGMA_CHROMIUM;

test("behavior and state cards stay compact while preserving editing and validation", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-cards-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  await writeFile(configPath, JSON.stringify(editorConfig()));

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
  const screenshotDir = process.env.IN_APP_FIGMA_SCREENSHOT_DIR;
  page.setDefaultTimeout(5000);
  await page.goto(server.url);
  await page.locator('[data-tab="behaviors"]').click();

  const behaviorCards = page.locator('.editor-card[data-card-kind="behavior"]');
  await behaviorCards.first().waitFor();
  assert.equal(await behaviorCards.count(), 2);
  assert.equal(await behaviorCards.nth(0).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await behaviorCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(await behaviorCards.nth(0).getAttribute("data-task-status"), "behavior:submit");
  assert.equal(await behaviorCards.nth(0).locator("[data-task-status-select]").inputValue(), "todo");
  await behaviorCards.nth(0).locator("[data-task-status-select]").selectOption("in_progress");
  assert.equal(await behaviorCards.nth(0).locator("[data-task-status-select]").inputValue(), "in_progress");
  assert.match(await behaviorCards.nth(0).locator(".editor-card-summary").innerText(), /interaction.*submit_button.*tap.*1 个动作/s);
  assert.equal(await page.locator(".behavior-hint").count(), 0);
  assert.equal(await behaviorCards.nth(0).locator(".behavior-action-row.repeated-card").count(), 0);

  const firstExpandedHeight = await behaviorCards.nth(0).evaluate((element) => element.getBoundingClientRect().height);
  const collapsedHeight = await behaviorCards.nth(1).evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(collapsedHeight < firstExpandedHeight / 2, `expected a compact collapsed card, received ${collapsedHeight}px versus ${firstExpandedHeight}px`);
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.locator(".editor-pane").screenshot({ path: path.join(screenshotDir, "behavior-cards-desktop.png") });
  }
  await behaviorCards.nth(1).locator(".editor-card-toggle").click();
  assert.equal(await behaviorCards.nth(0).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await behaviorCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");

  await page.locator("#behavior-0-target").fill("updated_submit_button");
  await page.waitForFunction(() => document.querySelector("#dirty-state")?.textContent?.trim() === "已保存");
  assert.deepEqual(await page.evaluate(() => ({
    id: document.activeElement?.id,
    selectionStart: document.activeElement?.selectionStart,
    selectionEnd: document.activeElement?.selectionEnd
  })), {
    id: "behavior-0-target",
    selectionStart: "updated_submit_button".length,
    selectionEnd: "updated_submit_button".length
  });
  assert.equal(await behaviorCards.nth(0).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await behaviorCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");

  await page.locator("#add-behavior").click();
  assert.equal(await behaviorCards.count(), 3);
  assert.equal(await behaviorCards.nth(2).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  await page.locator("#behavior-2-target").fill("footer");
  await page.waitForFunction(() => document.querySelector("#dirty-state")?.textContent?.trim() === "已保存");
  assert.equal(await behaviorCards.nth(2).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  await page.locator("#behavior-2-target").fill("");

  await page.locator('[data-tab="states"]').click();
  const stateCards = page.locator('.editor-card[data-card-kind="state"]');
  await stateCards.first().waitFor();
  assert.equal(await stateCards.count(), 2);
  assert.equal(await stateCards.nth(0).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await stateCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(await stateCards.nth(0).getAttribute("data-task-status"), "state:default");
  assert.equal(await stateCards.nth(0).locator("[data-task-status-select]").inputValue(), "todo");

  const wideTops = await stateCards.evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
  assert.equal(wideTops[0], wideTops[1]);
  await stateCards.nth(1).locator(".editor-card-toggle").click();
  await page.locator("#state-1-figma_url").fill("");
  await stateCards.nth(1).locator(".editor-card-toggle").click();
  assert.equal(await stateCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "false");
  assert.match(await stateCards.nth(1).locator(".editor-card-summary").innerText(), /缺少 Figma/);
  await page.locator("#validate-button").click();
  await stateCards.nth(1).locator(".inline-field-errors").waitFor();
  assert.equal(await stateCards.nth(1).locator(".editor-card-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#state-1-figma_url").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#editor-content > .inline-error-anchor > .inline-field-errors").count(), 0);
  assert.equal(await page.locator('[data-tab="behaviors"] .tab-error-badge').innerText(), "1");

  if (screenshotDir) {
    await page.locator(".editor-pane").screenshot({ path: path.join(screenshotDir, "cards-desktop.png") });
  }

  await page.setViewportSize({ width: 700, height: 900 });
  const narrowTops = await stateCards.evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
  assert.ok(narrowTops[1] > narrowTops[0], `expected state cards to stack, received tops ${narrowTops.join(", ")}`);
  if (screenshotDir) await page.locator(".editor-pane").screenshot({ path: path.join(screenshotDir, "cards-narrow.png") });
});

function editorConfig() {
  return {
    schema_version: 3,
    delivery: { profile: "strict" },
    execution: { parallel: false, max_parallel: 2 },
    mock_data_sources: [],
    modules: [{
      id: "checkout",
      title: "Checkout",
      entry_page: "payment",
      pages: [{
        id: "payment",
        title: "Payment",
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
        behaviors: [
          {
            id: "submit",
            type: "interaction",
            target: "submit_button",
            states: ["default"],
            trigger: { event: "tap" },
            actions: [{ type: "emit_event", name: "submitted" }],
            run_policy: "every_time"
          },
          {
            id: "content-scroll",
            type: "scroll",
            target: "content",
            states: ["default"],
            axis: "vertical",
            fixed_regions: ["header"]
          }
        ],
        states: [
          { id: "default", title: "Default", figma_url: "https://www.figma.com/design/FILE/payment?node-id=1-1" },
          { id: "loading", title: "Loading", figma_url: "https://www.figma.com/design/FILE/payment?node-id=1-2" }
        ]
      }]
    }]
  };
}
