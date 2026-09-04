import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const execFileAsync = promisify(execFile);
const playwrightPath = process.env.IN_APP_FIGMA_PLAYWRIGHT;
const chromiumExecutable = process.env.IN_APP_FIGMA_CHROMIUM;

test("completed page amendments reopen and complete only changed item tasks", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-amendment-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  await writeFile(configPath, JSON.stringify(completedConfig()));

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
  page.setDefaultTimeout(8000);
  await page.goto(server.url);
  await page.locator('[data-tab="states"]').click();
  await page.locator('[data-task-status="state:loading"]').waitFor();

  await page.evaluate(() => {
    const input = (selector, value) => {
      const element = document.querySelector(selector);
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const change = (selector, value) => {
      const element = document.querySelector(selector);
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };

    input("#state-1-figma_url", "https://www.figma.com/design/FILE/payment?node-id=9-9");
    document.querySelector('[data-tab="behaviors"]').click();
    document.querySelector('[data-task-status="behavior:open-details"] [data-delete-behavior]').click();
    document.querySelector("#add-behavior").click();
    input("#behavior-1-id", "retry");
    input("#behavior-1-target", "retry_button");
    change("#behavior-1-type", "interaction");
    change("#behavior-1-state-change", "loading");
  });

  await page.locator("#save-button").click();
  const amendmentDialog = page.locator("#amendment-dialog");
  await amendmentDialog.waitFor({ state: "visible" });
  const amendmentText = await page.locator("#amendment-summary").innerText();
  for (const id of ["loading", "open-details", "retry"]) assert.match(amendmentText, new RegExp(`\\b${id}\\b`));
  assert.equal((amendmentText.match(/account\.payment:/g) || []).length, 3);

  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await captureResponsive(page, amendmentDialog, screenshotDir, "amendment-dialog");
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/config") && response.request().method() === "PUT" && response.status() === 200),
    page.locator("#amendment-confirm").click()
  ]);
  await amendmentDialog.waitFor({ state: "hidden" });

  const amended = await readConfig(configPath);
  const amendedPage = configPage(amended);
  assert.equal(amendedPage.status, "in_progress");
  assert.equal(amendedPage.attempts, 2);
  assertTaskStatuses(amendedPage, {
    "state:default": "done",
    "state:loading": "todo",
    "behavior:keep-alive": "done",
    "behavior:retry": "todo",
    "removed:behavior:open-details": "todo"
  });

  const { stdout: changesOutput } = await execFileAsync("ruby", [
    path.join(skillRoot, "scripts", "task_config.rb"),
    "changes", "account", "payment", "--config", configPath
  ]);
  assertCliChanges(changesOutput);

  await page.locator('[data-tab="states"]').click();
  await assertActiveTask(page, "state", "default", "done", null);
  await assertActiveTask(page, "state", "loading", "todo", "modified");
  await page.locator('[data-task-status="state:loading"] [data-task-status-select]').selectOption("done");

  await page.locator('[data-tab="behaviors"]').click();
  await assertActiveTask(page, "behavior", "keep-alive", "done", null);
  await assertActiveTask(page, "behavior", "retry", "todo", "added");
  const removedRow = page.locator('[data-removed-task="behavior:open-details"]');
  await removedRow.waitFor();
  assert.equal(await removedRow.locator("[data-removed-status]").inputValue(), "todo");
  assert.equal(await removedRow.locator('[data-change-kind="removed"]').count(), 1);

  if (screenshotDir) await captureResponsive(page, page.locator(".editor-pane"), screenshotDir, "removed-task");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-task-status="behavior:retry"] [data-task-status-select]').selectOption("done");
  const removedStatus = page.locator('[data-removed-task="behavior:open-details"] [data-removed-status]');
  await removedStatus.selectOption("done");
  assert.equal(await removedStatus.inputValue(), "done");
  await Promise.all([
    page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/config") || response.request().method() !== "PUT" || response.status() !== 200) return false;
      const body = response.request().postDataJSON();
      const savedPage = body.config.modules[0].pages[0];
      return savedPage.removed_tasks.some((task) => task.kind === "behavior" && task.id === "open-details" && task.implementation_status === "done");
    }),
    page.locator("#save-button").click()
  ]);

  const readyToComplete = configPage(await readConfig(configPath));
  assertTaskStatuses(readyToComplete, {
    "state:default": "done",
    "state:loading": "done",
    "behavior:keep-alive": "done",
    "behavior:retry": "done",
    "removed:behavior:open-details": "done"
  });

  await page.locator('[data-tab="status"]').click();
  assert.equal(await page.locator("#editor-content > .editor-heading .task-pending-badge").innerText(), "0");
  await page.locator('[data-status-action="complete"]').click();
  await page.locator("#status-commit").fill("accepted456");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/status") && response.request().method() === "POST" && response.status() === 200),
    page.locator('#status-form button[type="submit"]').click()
  ]);

  const completed = await readConfig(configPath);
  const completedPage = configPage(completed);
  assert.equal(completedPage.status, "done");
  assert.equal(completedPage.commit, "accepted456");
  assert.deepEqual(completedPage.removed_tasks, []);
  assert.deepEqual(completedPage.states.map((item) => [item.id, item.implementation_status]), [["default", "done"], ["loading", "done"]]);
  assert.deepEqual(completedPage.behaviors.map((item) => [item.id, item.implementation_status]), [["keep-alive", "done"], ["retry", "done"]]);
  assert.deepEqual(completedPage.accepted_baseline.states.map((item) => item.id), ["default", "loading"]);
  assert.deepEqual(completedPage.accepted_baseline.behaviors.map((item) => item.id), ["keep-alive", "retry"]);
  assert.equal(completedPage.accepted_baseline.states[1].figma_url, "https://www.figma.com/design/FILE/payment?node-id=9-9");
  assert.equal(completedPage.acceptance_history.length, 1);
  assert.equal(completedPage.acceptance_history[0].commit, "accepted123");
});

async function captureResponsive(page, locator, screenshotDir, name) {
  await page.locator("#toast").waitFor({ state: "hidden" });
  for (const viewport of [
    { suffix: "desktop", width: 1440, height: 1000 },
    { suffix: "700", width: 700, height: 900 },
    { suffix: "mobile", width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await locator.waitFor({ state: "visible" });
    await assertNoOverlappingControls(locator);
    await locator.screenshot({ path: path.join(screenshotDir, `${name}-${viewport.suffix}.png`) });
  }
}

async function assertNoOverlappingControls(locator) {
  const overlaps = await locator.locator("button, select").evaluateAll((controls) => {
    const visible = controls.filter((control) => {
      const style = getComputedStyle(control);
      const box = control.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
    const boxes = visible.map((control) => ({
      label: control.getAttribute("aria-label") || control.textContent.trim() || control.tagName,
      box: control.getBoundingClientRect()
    }));
    return boxes.flatMap((left, index) => boxes.slice(index + 1).filter((right) => (
      Math.min(left.box.right, right.box.right) - Math.max(left.box.left, right.box.left) > 1 &&
      Math.min(left.box.bottom, right.box.bottom) - Math.max(left.box.top, right.box.top) > 1
    )).map((right) => `${left.label} / ${right.label}`));
  });
  assert.deepEqual(overlaps, []);
}

async function assertActiveTask(page, kind, id, status, change) {
  const card = page.locator(`[data-task-status="${kind}:${id}"]`);
  await card.waitFor();
  assert.equal(await card.locator("[data-task-status-select]").inputValue(), status);
  if (change) assert.equal(await card.locator(`[data-change-kind="${change}"]`).count(), 1);
  else assert.equal(await card.locator("[data-change-kind]").count(), 0);
}

function assertCliChanges(output) {
  for (const [id, change] of [["loading", "modified"], ["retry", "added"], ["open-details", "removed"]]) {
    assert.match(output, new RegExp(`id: ${id}\\n(?:.*\\n){0,4}  change: ${change}`, "m"));
  }
  assert.doesNotMatch(output, /id: default\b/);
  assert.doesNotMatch(output, /id: keep-alive\b/);
}

async function readConfig(configPath) {
  const { stdout } = await execFileAsync("ruby", [
    "-ryaml", "-rjson", "-e",
    "puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false))",
    configPath
  ]);
  return JSON.parse(stdout);
}

function configPage(config) {
  return config.modules[0].pages[0];
}

function assertTaskStatuses(page, expected) {
  const actual = Object.fromEntries([
    ...page.states.map((item) => [`state:${item.id}`, item.implementation_status]),
    ...page.behaviors.map((item) => [`behavior:${item.id}`, item.implementation_status]),
    ...page.removed_tasks.map((item) => [`removed:${item.kind}:${item.id}`, item.implementation_status])
  ]);
  assert.deepEqual(actual, expected);
}

function completedConfig() {
  const states = [
    { id: "default", title: "Default", figma_url: "https://www.figma.com/design/FILE/payment?node-id=1-1" },
    { id: "loading", title: "Loading", figma_url: "https://www.figma.com/design/FILE/payment?node-id=1-2" }
  ];
  const behaviors = [
    {
      id: "open-details",
      type: "interaction",
      target: "details_button",
      trigger: { event: "tap" },
      actions: [{ type: "emit_event", name: "details_opened" }],
      run_policy: "every_time"
    },
    { id: "keep-alive", type: "scroll", target: "content", axis: "vertical" }
  ];
  return {
    schema_version: 5,
    delivery: { profile: "strict" },
    execution: { parallel: false, max_parallel: 2 },
    mock_data_sources: [],
    modules: [{
      id: "account",
      title: "Account",
      entry_page: "payment",
      pages: [{
        id: "payment",
        title: "Payment",
        page_type: "view",
        page_role: "screen",
        status: "done",
        attempts: 1,
        commit: "accepted123",
        reason: null,
        started_at: "2026-09-04T01:00:00Z",
        completed_at: "2026-09-04T01:10:00Z",
        acceptance_history: [],
        accepted_baseline: { states, behaviors },
        removed_tasks: [],
        data_dependencies: [],
        states: states.map((item) => ({ ...item, implementation_status: "done" })),
        behaviors: behaviors.map((item) => ({ ...item, implementation_status: "done" }))
      }]
    }]
  };
}
