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

test("the behavior editor supports count-up timers and conditional navigation", {
  skip: !playwrightPath || !chromiumExecutable
}, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "in-app-figma-timer-navigation-"));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = path.join(root, "InAppFigma.yaml");
  await writeFile(configPath, JSON.stringify(configFixture()));

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

  const firstAction = browserPage.locator(".behavior-action-row").nth(0);
  const actionTypes = await firstAction.locator('select[id$="-type"] option').evaluateAll((options) => options.map((option) => option.value));
  assert.ok(actionTypes.includes("start_countup"));
  assert.ok(actionTypes.includes("stop_countup"));
  assert.equal(await firstAction.locator(".parameters").count(), 0, "countdown must not render a generic parameter editor");

  await firstAction.locator('select[id$="-type"]').selectOption("start_countup");
  await browserPage.locator(".behavior-action-row").nth(0).locator('input[id$="-target"]').fill("elapsed_time_label");
  assert.equal(await browserPage.locator(".behavior-action-row").nth(0).locator(".parameters").count(), 0);

  await browserPage.locator('[data-conditional-navigation="0|1"]').check();
  const branches = browserPage.locator(".navigation-branch");
  assert.equal(await branches.count(), 2);
  await branches.nth(0).locator("[data-navigation-branch-condition]").fill("session.is_member");
  await branches.nth(0).locator("[data-navigation-branch-destination]").selectOption("account.member-home");
  await branches.nth(1).locator("[data-navigation-branch-condition]").fill("!session.is_member");
  await branches.nth(1).locator("[data-navigation-branch-destination]").selectOption("auth.sign-in");

  const saveResponsePromise = browserPage.waitForResponse((response) => (
    response.url().endsWith("/api/config") && response.request().method() === "PUT"
  ));
  await browserPage.locator("#save-button").click();
  const saveResponse = await saveResponsePromise;
  assert.equal(saveResponse.status(), 200, JSON.stringify(await saveResponse.json()));

  const persisted = await readConfig(configPath);
  const actions = persisted.modules[0].pages[0].behaviors[0].actions;
  assert.deepEqual(actions[0], { type: "start_countup", target: "elapsed_time_label" });
  assert.deepEqual(actions[1], {
    type: "navigate",
    branches: [
      { condition: "session.is_member", style: "push", destination: "account.member-home", parameters: {} },
      { condition: "!session.is_member", style: "push", destination: "auth.sign-in", parameters: {} }
    ]
  });

  const screenshotDir = process.env.IN_APP_FIGMA_SCREENSHOT_DIR;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await browserPage.screenshot({ path: path.join(screenshotDir, "timer-navigation-desktop.png"), fullPage: true });
    await browserPage.setViewportSize({ width: 390, height: 844 });
    await browserPage.screenshot({ path: path.join(screenshotDir, "timer-navigation-mobile.png"), fullPage: true });
  }

  await browserPage.locator('[data-tab="page"]').click();
  await browserPage.locator("#module-id").fill("members");
  await browserPage.locator("#module-id").press("Tab");
  const renameResponsePromise = browserPage.waitForResponse((response) => (
    response.url().endsWith("/api/config") && response.request().method() === "PUT"
  ));
  await browserPage.locator("#save-button").click();
  assert.equal((await renameResponsePromise).status(), 200);
  const renamed = await readConfig(configPath);
  assert.equal(renamed.modules[0].id, "members");
  assert.equal(renamed.modules[0].pages[0].behaviors[0].actions[1].branches[0].destination, "members.member-home");
});

async function readConfig(configPath) {
  const { stdout } = await execFileAsync("ruby", [
    "-ryaml", "-rjson", "-e",
    "puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false))",
    configPath
  ]);
  return JSON.parse(stdout);
}

function configFixture() {
  return {
    schema_version: 7,
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
          pageFixture("home", [{
            id: "start-and-route",
            type: "interaction",
            target: "start_button",
            implementation_status: "todo",
            trigger: { event: "tap" },
            actions: [
              { type: "start_countdown", target: "countdown_label" },
              { type: "navigate", style: "push", destination: "account.member-home", parameters: {} }
            ],
            run_policy: "every_time"
          }]),
          pageFixture("member-home")
        ]
      },
      {
        id: "auth",
        title: "Auth",
        entry_page: "sign-in",
        pages: [pageFixture("sign-in")]
      }
    ]
  };
}

function pageFixture(id, behaviors = []) {
  return {
    id,
    title: id,
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
