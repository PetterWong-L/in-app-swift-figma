import assert from "node:assert/strict";
import test from "node:test";

import { amendmentTaskLabels, clearPendingAmendment, createAmendmentSaveCoordinator, renderTaskUi, restoreTask, runSaveLifecycle, settleConfirmedAmendment, setRemovedTaskStatus, taskPendingGates } from "../scripts/editor/task_ui.mjs";
import { buildFlowGraph, placeIssues } from "../scripts/editor/model.mjs";
import { createBehavior, createPage, createState } from "../scripts/editor/model.mjs";

const t = (key) => ({
  "task.status": "Implementation status", "task.restore": "Restore task", "task.removed": "Removed tasks",
  "task.change.modified": "Modified", "task.change.added": "Added", "task.pending_count": "{count} pending task(s)"
}[key] || key);

test("task UI renders active change badges, removed task controls, and pending gates", () => {
  const page = fixturePage();
  const html = renderTaskUi({
    page,
    changes: { states: [{ id: "loading", change: "modified" }], behaviors: [{ id: "submit", change: "added" }] },
    statuses: ["todo", "done"],
    t,
    escape: (value) => String(value)
  });

  assert.match(html.active.state, /data-change-kind="modified"/);
  assert.match(html.active.behavior, /data-change-kind="added"/);
  assert.match(html.removed, /data-removed-task="state:retired"/);
  assert.match(html.removed, /data-removed-task="behavior:old-submit"/);
  assert.match(html.removed, /Old loading/);
  assert.match(html.removed, /Old submit/);
  assert.match(html.removed, /data-removed-status/);
  assert.match(html.removed, /data-restore-task="state:retired"/);
  assert.deepEqual(html.pending, { outline: 4, states: 4, behaviors: 4, status: 4 });
  assert.deepEqual(taskPendingGates(page), html.pending);
});

test("removed task status and restore affect only removed work", () => {
  const page = fixturePage();
  const graphBefore = JSON.stringify({ states: page.states, behaviors: page.behaviors });
  let queued = 0;

  const graphWhileRemoved = buildFlowGraph({ modules: [{ id: "account", pages: [page] }] });
  assert.equal(graphWhileRemoved.nodes[0].states.some((state) => state.id === "retired"), false);
  assert.equal(graphWhileRemoved.nodes[0].stateTransitions.some((transition) => transition.id.startsWith("old-submit:")), false);
  const validationInputsWhileRemoved = [
    ...page.states.map((state) => `states.${state.id}`),
    ...page.behaviors.map((behavior) => `behaviors.${behavior.id}`)
  ];
  assert.equal(placeIssues([
    { path: "states.retired.title", message: "removed state" },
    { path: "behaviors.old-submit.target", message: "removed behavior" }
  ], validationInputsWhileRemoved).size, 0);

  setRemovedTaskStatus(page, "state", "retired", "done", () => { queued += 1; });
  assert.equal(page.removed_tasks[0].implementation_status, "done");
  assert.equal(queued, 1);
  assert.equal(JSON.stringify({ states: page.states, behaviors: page.behaviors }), graphBefore);
  const restored = restoreTask(page, "state", "retired", () => { queued += 1; });
  assert.equal(restored.title, "Old loading");
  assert.equal(page.removed_tasks.some((task) => task.id === "retired"), false);
  assert.equal(page.states.some((task) => task.id === "retired"), true);
  assert.equal(queued, 2);

  setRemovedTaskStatus(page, "behavior", "old-submit", "done", () => { queued += 1; });
  assert.equal(page.removed_tasks.find((task) => task.id === "old-submit").implementation_status, "done");
  const restoredBehavior = restoreTask(page, "behavior", "old-submit", () => { queued += 1; });
  assert.equal(restoredBehavior.target, "Old submit");
  assert.equal(restoredBehavior.implementation_status, "done");
  assert.equal(page.behaviors.some((task) => task.id === "old-submit"), true);
  assert.equal(buildFlowGraph({ modules: [{ id: "account", pages: [page] }] }).nodes[0].states.some((state) => state.id === "retired"), true);
});

test("popup structure changes appear in amendment summaries and removed popup work can be restored", () => {
  const page = fixturePage();
  page.accepted_baseline.popup = {
    fields: { title: true, subtitle: false, content: true },
    buttons: [{ id: "primary" }]
  };
  page.removed_tasks.push({ kind: "popup", id: "structure", implementation_status: "todo" });
  let queued = 0;

  const html = renderTaskUi({
    page,
    changes: { popup: [{ id: "structure", kind: "popup", change: "removed" }] },
    statuses: ["todo", "done"],
    t,
    escape: (value) => String(value)
  });
  assert.match(html.removed, /data-removed-task="popup:structure"/);
  assert.match(html.removed, /structure/);

  const restored = restoreTask(page, "popup", "structure", () => { queued += 1; });
  assert.deepEqual(restored.fields, { title: true, subtitle: false, content: true });
  assert.equal(restored.implementation_status, "todo");
  assert.equal(page.popup, restored);
  assert.equal(page.removed_tasks.some((task) => task.kind === "popup"), false);
  assert.equal(queued, 1);

  assert.deepEqual(amendmentTaskLabels({
    "common.confirmation": {
      states: [{ id: "default", change: "unchanged" }],
      behaviors: [{ id: "tap", change: "modified" }],
      popup: [{ id: "structure", change: "modified" }]
    }
  }), ["common.confirmation: tap", "common.confirmation: structure"]);
});

test("amendment coordinator retries the exact draft once and remains paused after cancel", async () => {
  const calls = [];
  const pauses = [];
  const prompts = [];
  const draft = { modules: [{ id: "account" }] };
  const coordinator = createAmendmentSaveCoordinator({
    request: async (body) => {
      calls.push(body);
      return calls.length === 1
        ? { status: 409, payload: { error: { code: "amendment_required", changes_by_page: {} } } }
        : { status: 200, payload: { snapshot: { config: { modules: [{ id: "server" }] } } } };
    },
    pause: () => pauses.push("pause"),
    showPrompt: () => prompts.push("show")
  });

  assert.equal((await coordinator.save({ config: draft, expectedRevision: "r1", acknowledge: false, version: 7 })).outcome, "pause");
  assert.equal((await coordinator.save({ config: draft, expectedRevision: "r1", acknowledge: false, version: 7 })).outcome, "pause");
  assert.deepEqual(pauses, ["pause"]);
  assert.deepEqual(prompts, ["show"]);
  const confirmed = await coordinator.confirm();
  assert.equal(confirmed.outcome, "saved");
  assert.equal(confirmed.version, 7);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].config, draft);
  assert.equal(calls[1].config, draft);
  assert.equal("version" in calls[0], false);
  assert.equal("version" in calls[1], false);
  assert.deepEqual(calls.map((call) => call.confirm_amendments), [false, true]);
  assert.deepEqual(calls.map((call) => call.expected_revision), ["r1", "r1"]);

  let cancelledRequests = 0;
  const cancelled = createAmendmentSaveCoordinator({
    request: async () => {
      cancelledRequests += 1;
      return { status: 409, payload: { error: { code: "amendment_required" } } };
    },
    pause: () => {},
    showPrompt: () => {}
  });
  await cancelled.save({ config: draft, expectedRevision: "r1", acknowledge: false });
  cancelled.cancel();
  assert.equal(cancelled.paused, true);
  assert.equal(await cancelled.confirm(), null);
  assert.equal(cancelledRequests, 1);
});

test("confirmed amendment failures retain the pending request and pause automatic saves", async () => {
  for (const result of [
    { status: 409, payload: { error: { code: "revision_conflict" } } },
    { status: 422, payload: { issues: [{ path: "modules.account", message: "invalid" }] } },
    { status: 503, payload: { error: { message: "offline" } } }
  ]) {
    const pauses = [];
    const coordinator = createAmendmentSaveCoordinator({
      request: async (body) => body.confirm_amendments
        ? result
        : { status: 409, payload: { error: { code: "amendment_required", changes_by_page: {} } } },
      pause: () => pauses.push("pause"),
      showPrompt: () => {}
    });

    await coordinator.save({ config: { modules: [] }, expectedRevision: "r1", acknowledge: false, version: 4 });
    const confirmed = await coordinator.confirm();

    assert.equal(confirmed.outcome, "failed");
    assert.equal(coordinator.pending, true);
    assert.equal(coordinator.paused, true);
    assert.equal(coordinator.promptOpen, false);
    assert.deepEqual(pauses, ["pause", "pause"]);
  }
});

test("confirmed amendment cleanup keeps page state aligned with every save outcome", () => {
  const successfulState = { pendingAmendment: true, confirmingAmendment: true, amendmentPaused: false, dirty: false };
  const successfulAutoSave = { reset: 0, resume: 0 };
  settleConfirmedAmendment({
    state: successfulState,
    coordinator: { pending: false, paused: false },
    outcome: "saved",
    autoSave: { reset: () => { successfulAutoSave.reset += 1; }, resume: () => { successfulAutoSave.resume += 1; } }
  });
  assert.deepEqual(successfulState, { pendingAmendment: null, confirmingAmendment: false, amendmentPaused: false, dirty: false });
  assert.deepEqual(successfulAutoSave, { reset: 1, resume: 0 });

  for (const outcome of ["pause", "failed"]) {
    const failedState = { pendingAmendment: true, confirmingAmendment: true, amendmentPaused: false, dirty: true };
    const failedAutoSave = { reset: 0, resume: 0 };
    settleConfirmedAmendment({
      state: failedState,
      coordinator: { pending: true, paused: true },
      outcome,
      autoSave: { reset: () => { failedAutoSave.reset += 1; }, resume: () => { failedAutoSave.resume += 1; } }
    });
    assert.deepEqual(failedState, { pendingAmendment: true, confirmingAmendment: false, amendmentPaused: true, dirty: true });
    assert.deepEqual(failedAutoSave, { reset: 0, resume: 0 });
  }
});

test("editing after a failed amendment confirmation cancels the retained request", () => {
  const state = { pendingAmendment: true, amendmentPaused: true };
  let cancelled = 0;
  let resumed = 0;
  assert.equal(clearPendingAmendment({
    state,
    coordinator: { cancel: () => { cancelled += 1; } },
    autoSave: { resume: (options) => { resumed += 1; assert.deepEqual(options, { schedulePending: false }); } }
  }), true);
  assert.deepEqual(state, { pendingAmendment: null, amendmentPaused: false });
  assert.equal(cancelled, 1);
  assert.equal(resumed, 1);
});

test("save lifecycle accepts authoritative snapshots for ordinary and confirmed saves", async () => {
  for (const confirmed of [false, true]) {
    const saveVersion = confirmed ? 12 : 11;
    const serverSnapshot = {
      revision: confirmed ? "confirmed-r2" : "ordinary-r2",
      config: { modules: [{ id: confirmed ? "confirmed-server" : "ordinary-server" }] },
      yaml_preview: confirmed ? "confirmed" : "ordinary"
    };
    let requestCount = 0;
    const coordinator = createAmendmentSaveCoordinator({
      request: async () => {
        requestCount += 1;
        if (confirmed && requestCount === 1) {
          return { status: 409, payload: { error: { code: "amendment_required", changes_by_page: {} } } };
        }
        return { status: 200, payload: { snapshot: serverSnapshot } };
      },
      pause: () => {},
      showPrompt: () => {}
    });
    const lifecycle = lifecycleHarness();

    if (confirmed) {
      const paused = await runSaveLifecycle({
        performSave: () => coordinator.save({ config: { modules: [] }, expectedRevision: "r1", acknowledge: false, version: saveVersion }),
        ...lifecycle.options,
        currentVersion: () => saveVersion
      });
      assert.equal(paused, "pause");
      assert.deepEqual(lifecycle.events, ["render:pause"]);
      lifecycle.events.length = 0;
    }

    const outcome = await runSaveLifecycle({
      performSave: confirmed
        ? () => coordinator.confirm()
        : () => coordinator.save({ config: { modules: [] }, expectedRevision: "r1", acknowledge: false, version: saveVersion }),
      ...lifecycle.options,
      currentVersion: () => saveVersion
    });

    assert.equal(outcome, "saved");
    assert.equal(lifecycle.state.dirty, false);
    assert.equal(lifecycle.state.conflict, false);
    assert.deepEqual(lifecycle.state.issues, []);
    assert.equal(lifecycle.state.snapshot, serverSnapshot);
    assert.deepEqual(lifecycle.state.draft, serverSnapshot.config);
    assert.deepEqual(lifecycle.accepted, [serverSnapshot]);
    assert.deepEqual(lifecycle.events, ["render:saved", "notify:saved"]);
  }
});

test("save lifecycle preserves edits newer than the completed request", async () => {
  const lifecycle = lifecycleHarness();
  const newerDraft = lifecycle.state.draft;
  const serverSnapshot = { revision: "r2", config: { modules: [{ id: "saved-request" }] }, yaml_preview: "saved" };

  assert.equal(await runSaveLifecycle({
    performSave: async () => ({ outcome: "saved", version: 3, result: { status: 200, payload: { snapshot: serverSnapshot } } }),
    ...lifecycle.options,
    automatic: false,
    currentVersion: () => 4,
    acceptRevision: (snapshot) => { lifecycle.state.snapshot = snapshot; }
  }), "saved");

  assert.equal(lifecycle.state.snapshot, serverSnapshot);
  assert.equal(lifecycle.state.draft, newerDraft);
  assert.equal(lifecycle.state.dirty, true);
  assert.deepEqual(lifecycle.accepted, []);
  assert.deepEqual(lifecycle.events, ["render:saved"]);
});

test("save lifecycle preserves conflict, validation, and general error branches", async () => {
  const conflict = lifecycleHarness();
  assert.equal(await runSaveLifecycle({
    performSave: async () => ({ outcome: "failed", result: { status: 409, payload: { error: { code: "revision_conflict" } } } }),
    ...conflict.options
  }), "pause");
  assert.equal(conflict.state.conflict, true);
  assert.deepEqual(conflict.events, ["render:conflict", "notify:conflict"]);

  const validation = lifecycleHarness();
  const issues = [{ path: "modules.account", message: "invalid" }];
  assert.equal(await runSaveLifecycle({
    performSave: async () => ({ outcome: "failed", result: { status: 422, payload: { issues, error: { message: "bad config" } } } }),
    ...validation.options
  }), "failed");
  assert.equal(validation.state.issues, issues);
  assert.deepEqual(validation.events, ["render:validation", "notify:validation"]);

  const general = lifecycleHarness();
  await assert.rejects(runSaveLifecycle({
    performSave: async () => ({ outcome: "failed", result: { status: 503, payload: { error: { message: "offline" } } } }),
    ...general.options
  }), /formatted:save_failed:offline/);
  assert.deepEqual(general.events, []);
});

function lifecycleHarness() {
  const state = {
    snapshot: { revision: "r1", config: { modules: [{ id: "local" }] } },
    draft: { modules: [{ id: "local-draft" }] },
    issues: [{ path: "old", message: "old" }],
    dirty: true,
    conflict: true
  };
  const accepted = [];
  const events = [];
  return {
    state,
    accepted,
    events,
    options: {
      state,
      automatic: false,
      acceptSnapshot: (snapshot) => {
        accepted.push(snapshot);
        state.snapshot = snapshot;
        state.draft = structuredClone(snapshot.config);
      },
      render: (branch) => events.push(`render:${branch}`),
      notify: (branch) => events.push(`notify:${branch}`),
      formatError: (payload, fallback) => `formatted:${fallback}:${payload.error?.message || "none"}`
    }
  };
}

function fixturePage() {
  return createPage({
    states: [createState({ id: "loading", implementation_status: "todo" })],
    behaviors: [createBehavior({ id: "submit", implementation_status: "todo" })],
    accepted_baseline: {
      states: [createState({ id: "retired", title: "Old loading", implementation_status: "done" })],
      behaviors: [createBehavior({ id: "old-submit", type: "interaction", target: "Old submit", state_change: "loading", implementation_status: "done" })]
    },
    removed_tasks: [
      { kind: "state", id: "retired", implementation_status: "todo" },
      { kind: "behavior", id: "old-submit", implementation_status: "todo" }
    ]
  });
}
