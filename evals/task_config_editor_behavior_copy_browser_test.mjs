import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const playwrightPath = process.env.IN_APP_FIGMA_PLAYWRIGHT;
const chromiumExecutable = process.env.IN_APP_FIGMA_CHROMIUM;
const execFileAsync = promisify(execFile);

test("a behavior can be copied to multiple other pages", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-behavior-copy-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  const sourceBehavior = {
    id: "submit",
    type: "interaction",
    target: "submit-button",
    implementation_status: "done",
    trigger: { event: "tap" },
    actions: [{ type: "emit_event", name: "submitted" }],
    run_policy: "every_time"
  };
  const config = {
    schema_version: 6,
    delivery: { profile: "strict" },
    execution: { parallel: false, max_parallel: 2 },
    system_ui: { tab_bar_controller: false, picker: false },
    mock_data_sources: [],
    modules: [
      {
        id: "account",
        title: "Account",
        entry_page: "home",
        pages: [
          pageConfig("home", "Home", [sourceBehavior]),
          completedPageConfig("details", "Details", [{ id: "submit-copy", type: "scroll", target: "content", implementation_status: "done", axis: "vertical" }])
        ]
      },
      {
        id: "activity",
        title: "Activity",
        entry_page: "history",
        pages: [pageConfig("history", "History")]
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

  const browserPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await browserPage.goto(server.url);
  await browserPage.locator('[data-select-page="home"]').click();
  await browserPage.locator('[data-tab="behaviors"]').click();
  await browserPage.locator('[data-copy-behavior="0"]').click();

  const dialog = browserPage.locator("#copy-behavior-dialog");
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("aria-describedby"), "copy-behavior-dialog-hint");
  assert.equal(await browserPage.locator("#copy-behavior-dialog-hint").isVisible(), true);
  assert.equal(await dialog.locator("[data-copy-behavior-target]").count(), 2);
  assert.equal(await dialog.locator('[data-copy-behavior-target-page="home"]').count(), 0);
  assert.equal(await browserPage.locator("#copy-behavior-confirm").isDisabled(), true);

  await browserPage.locator("#copy-behavior-select-all").click();
  assert.equal(await browserPage.locator("#copy-behavior-confirm").isDisabled(), false);
  const screenshotDir = process.env.IN_APP_FIGMA_SCREENSHOT_DIR;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await dialog.screenshot({ path: path.join(screenshotDir, "behavior-copy-dialog.png") });
  }
  await browserPage.setViewportSize({ width: 390, height: 844 });
  await assertDialogFitsViewport(dialog, 390, 844);
  if (screenshotDir) await dialog.screenshot({ path: path.join(screenshotDir, "behavior-copy-dialog-mobile.png") });
  await browserPage.setViewportSize({ width: 1440, height: 1000 });
  await browserPage.locator("#copy-behavior-confirm").click();
  await dialog.waitFor({ state: "hidden" });

  const amendmentDialog = browserPage.locator("#amendment-dialog");
  const amendmentResponsePromise = browserPage.waitForResponse((response) => response.url().endsWith("/api/config") && response.request().method() === "PUT");
  await browserPage.locator("#save-button").click();
  const amendmentResponse = await amendmentResponsePromise;
  const amendmentPayload = await amendmentResponse.json();
  assert.equal(amendmentResponse.status(), 409, JSON.stringify(amendmentPayload));
  assert.equal(amendmentPayload.error?.code, "amendment_required");
  await amendmentDialog.waitFor({ state: "visible" });
  assert.match(await browserPage.locator("#amendment-summary").innerText(), /account\.details: submit-copy-2/);
  await Promise.all([
    browserPage.waitForResponse((response) => response.url().endsWith("/api/config") && response.request().method() === "PUT" && response.status() === 200),
    browserPage.locator("#amendment-confirm").click()
  ]);
  await amendmentDialog.waitFor({ state: "hidden" });

  const persisted = await readConfig(configPath);
  const persistedDetails = persisted.modules[0].pages[1];
  const persistedHistory = persisted.modules[1].pages[0];
  assert.equal(persistedDetails.status, "in_progress");
  assert.equal(persistedDetails.attempts, 2);
  assert.equal(persistedDetails.behaviors[1].id, "submit-copy-2");
  assert.equal(persistedDetails.behaviors[1].implementation_status, "todo");
  assert.deepEqual(persistedDetails.behaviors[1].actions, sourceBehavior.actions);
  assert.equal(persistedHistory.behaviors[0].id, "submit-copy");
  assert.equal(persistedHistory.behaviors[0].implementation_status, "todo");
  assert.deepEqual(persistedHistory.behaviors[0].actions, sourceBehavior.actions);

  await browserPage.locator('[data-select-page="details"]').click();
  await browserPage.locator('[data-tab="behaviors"]').click();
  assert.equal(await browserPage.locator('[data-task-status="behavior:submit-copy-2"]').count(), 1);

  await browserPage.locator('[data-toggle-module="activity"]').click();
  await browserPage.locator('[data-select-page="history"]').click();
  await browserPage.locator('[data-tab="behaviors"]').click();
  assert.equal(await browserPage.locator('[data-task-status="behavior:submit-copy"]').count(), 1);
});

async function assertDialogFitsViewport(dialog, width, height) {
  const box = await dialog.boundingBox();
  assert.ok(box, "expected the copy dialog to be visible");
  assert.ok(box.x >= 0 && box.y >= 0, `expected dialog origin inside viewport, received ${JSON.stringify(box)}`);
  assert.ok(box.x + box.width <= width && box.y + box.height <= height, `expected dialog inside viewport, received ${JSON.stringify(box)}`);
  const clippedTargets = await dialog.locator("[data-copy-behavior-target]").evaluateAll((inputs) => inputs.filter((input) => {
    const box = input.getBoundingClientRect();
    return box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight;
  }).length);
  assert.equal(clippedTargets, 0);
}

async function readConfig(configPath) {
  const { stdout } = await execFileAsync("ruby", [
    "-ryaml", "-rjson", "-e",
    "puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false))",
    configPath
  ]);
  return JSON.parse(stdout);
}

function pageConfig(id, title, behaviors = []) {
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
    accepted_baseline: null,
    removed_tasks: [],
    data_dependencies: [],
    behaviors,
    states: [{
      id: "default",
      title: "Default",
      figma_url: `https://www.figma.com/design/FILE/${id}?node-id=1-1`,
      implementation_status: "todo"
    }]
  };
}

function completedPageConfig(id, title, behaviors) {
  const page = pageConfig(id, title, behaviors);
  page.status = "done";
  page.attempts = 1;
  page.commit = "accepted123";
  page.started_at = "2026-09-01T08:00:00Z";
  page.completed_at = "2026-09-01T09:00:00Z";
  page.states.forEach((state) => { state.implementation_status = "done"; });
  page.behaviors.forEach((behavior) => { behavior.implementation_status = "done"; });
  page.accepted_baseline = {
    states: page.states.map(({ implementation_status: _status, ...state }) => structuredClone(state)),
    behaviors: page.behaviors.map(({ implementation_status: _status, ...behavior }) => structuredClone(behavior)),
    popup: null
  };
  return page;
}
