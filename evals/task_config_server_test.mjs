import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createEditorServer } from "../scripts/task_config_server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(here, "../scripts/task_config_web_bridge.rb");
const rubyPath = process.env.RUBY || "ruby";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "in-app-figma-server-"));
  const editorRoot = path.join(root, "editor");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(editorRoot));
  await Promise.all([
    writeFile(path.join(editorRoot, "index.html"), "<!doctype html><title>Editor</title>"),
    writeFile(path.join(editorRoot, "app.mjs"), "export const ready = true;"),
    writeFile(path.join(editorRoot, "i18n.mjs"), "export const locale = 'zh-CN';"),
    writeFile(path.join(editorRoot, "model.mjs"), "export const model = true;"),
    writeFile(path.join(editorRoot, "task_ui.mjs"), "export const taskUi = true;"),
    writeFile(path.join(editorRoot, "styles.css"), "body { color: #111; }")
  ]);
  const configPath = path.join(root, "InAppFigma.yaml");
  await writeFile(configPath, validYaml());
  const instance = await createEditorServer({
    configPath,
    bridgePath,
    rubyPath,
    editorRoot,
    port: 0,
    openBrowser: false
  });
  return { root, configPath, instance };
}

function auth(instance, extra = {}) {
  return { Authorization: `Bearer ${instance.token}`, ...extra };
}

test("binds to loopback and protects API with a fragment bearer token", async () => {
  const { root, instance } = await fixture();
  try {
    assert.match(instance.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(instance.url, `${instance.origin}/#token=${instance.token}`);
    assert.match(instance.token, /^[0-9a-f]{64}$/);

    const unauthorized = await fetch(`${instance.origin}/api/snapshot`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${instance.origin}/api/snapshot`, { headers: auth(instance) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.snapshot.schema.version, 6);
    assert.ok(!JSON.stringify(payload).includes(instance.token));
  } finally {
    await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("serves only fixed static assets with security headers and content types", async () => {
  const { root, instance } = await fixture();
  try {
    const css = await fetch(`${instance.origin}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css/);
    assert.equal(css.headers.get("cache-control"), "no-store");
    assert.match(css.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(css.headers.get("content-security-policy"), /frame-src https:\/\/www\.figma\.com/);

    const i18n = await fetch(`${instance.origin}/i18n.mjs`);
    assert.equal(i18n.status, 200);
    assert.match(i18n.headers.get("content-type"), /^text\/javascript/);

    const taskUi = await fetch(`${instance.origin}/task_ui.mjs`);
    assert.equal(taskUi.status, 200);
    assert.match(taskUi.headers.get("content-type"), /^text\/javascript/);

    const missing = await fetch(`${instance.origin}/package.json`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${instance.origin}/..%2f..%2fetc%2fpasswd`);
    assert.equal(traversal.status, 404);
  } finally {
    await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid origin, method, content type, and oversized bodies", async () => {
  const { root, instance } = await fixture();
  try {
    const wrongOrigin = await fetch(`${instance.origin}/api/validate`, {
      method: "POST",
      headers: auth(instance, { Origin: "http://example.test", "Content-Type": "application/json" }),
      body: "{}"
    });
    assert.equal(wrongOrigin.status, 403);

    const wrongMethod = await fetch(`${instance.origin}/api/snapshot`, {
      method: "POST",
      headers: auth(instance, { "Content-Type": "application/json" }),
      body: "{}"
    });
    assert.equal(wrongMethod.status, 405);

    const wrongType = await fetch(`${instance.origin}/api/validate`, {
      method: "POST",
      headers: auth(instance, { Origin: instance.origin, "Content-Type": "text/plain" }),
      body: "{}"
    });
    assert.equal(wrongType.status, 415);

    const oversized = await fetch(`${instance.origin}/api/validate`, {
      method: "POST",
      headers: auth(instance, { Origin: instance.origin, "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "x".repeat(2 * 1024 * 1024) })
    });
    assert.equal(oversized.status, 413);
  } finally {
    await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("propagates Ruby validation and revision statuses", async () => {
  const { root, instance } = await fixture();
  try {
    const snapshotResponse = await fetch(`${instance.origin}/api/snapshot`, { headers: auth(instance) });
    const snapshot = (await snapshotResponse.json()).snapshot;
    const invalid = structuredClone(snapshot.config);
    invalid.modules[0].pages[0].behaviors[0].actions[0].destination = "account.missing";

    const validation = await fetch(`${instance.origin}/api/validate`, {
      method: "POST",
      headers: auth(instance, { "Content-Type": "application/json", Origin: instance.origin }),
      body: JSON.stringify({ config: invalid })
    });
    assert.equal(validation.status, 422);
    assert.equal((await validation.json()).issues[0].code, "unknown_destination");

    const conflict = await fetch(`${instance.origin}/api/config`, {
      method: "PUT",
      headers: auth(instance, { "Content-Type": "application/json", Origin: instance.origin }),
      body: JSON.stringify({ config: snapshot.config, expected_revision: "stale" })
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "revision_conflict");
  } finally {
    await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown endpoint acknowledges then closes the listener", async () => {
  const { root, instance } = await fixture();
  try {
    const response = await fetch(`${instance.origin}/api/shutdown`, {
      method: "POST",
      headers: auth(instance, { "Content-Type": "application/json", Origin: instance.origin }),
      body: "{}"
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(instance.server.listening, false);
  } finally {
    await instance.close();
    await rm(root, { recursive: true, force: true });
  }
});

function validYaml() {
  return `---
schema_version: 2
execution:
  parallel: false
  max_parallel: 2
modules:
- id: account
  title: Account
  entry_page: page-a
  pages:
  - id: page-a
    title: Page A
    page_type: view
    status: todo
    attempts: 0
    commit:
    reason:
    started_at:
    completed_at:
    states:
    - id: default
      title: Default
      figma_url: https://www.figma.com/design/file/Page?node-id=1-2
    behaviors:
    - id: to-page-b
      type: interaction
      target: continue
      trigger:
        event: tap
      action:
        type: navigate
        style: push
        destination: account.page-b
      run_policy: every_time
  - id: page-b
    title: Page B
    page_type: view
    status: todo
    attempts: 0
    commit:
    reason:
    started_at:
    completed_at:
    states:
    - id: default
      title: Default
      figma_url: https://www.figma.com/design/file/Page?node-id=1-2
    behaviors:
    - id: close
      type: interaction
      target: close
      trigger:
        event: tap
      action:
        type: navigate
        style: back
      run_policy: every_time
`;
}
