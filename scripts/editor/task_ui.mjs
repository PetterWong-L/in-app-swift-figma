import { restoreRemovedTask, taskChangeFor, taskCounts } from "./model.mjs";

export async function runSaveLifecycle({
  performSave,
  state,
  automatic = false,
  acceptSnapshot,
  acceptRevision,
  currentVersion,
  render,
  notify,
  formatError
}) {
  const saved = await performSave();
  if (!saved || saved.outcome === "pause") {
    render("pause");
    return "pause";
  }

  const { status, payload = {} } = saved.result || {};
  if (status === 409) {
    state.conflict = true;
    render("conflict");
    notify("conflict", payload);
    return "pause";
  }
  if (status === 422) {
    state.issues = payload.issues || [];
    render("validation");
    if (!automatic) notify("validation", payload);
    return "failed";
  }
  if (!(status >= 200 && status < 300)) {
    throw new Error(formatError(payload, "save_failed"));
  }

  const stale = saved.version !== undefined && saved.version !== currentVersion();
  if (stale) acceptRevision(payload.snapshot);
  else acceptSnapshot(payload.snapshot);
  state.issues = [];
  state.conflict = false;
  if (!stale) state.dirty = false;
  render("saved");
  if (!automatic && !stale) notify("saved", payload);
  return "saved";
}

export function settleConfirmedAmendment({ state, coordinator, outcome, autoSave }) {
  if (outcome === "saved") {
    state.pendingAmendment = null;
    state.amendmentPaused = false;
    if (state.dirty) autoSave.resume();
    else autoSave.reset();
  } else {
    state.pendingAmendment = coordinator.pending;
    state.amendmentPaused = coordinator.paused;
  }
  state.confirmingAmendment = false;
}

export function clearPendingAmendment({ state, coordinator, autoSave }) {
  if (!state.pendingAmendment && !state.amendmentPaused) return false;
  state.pendingAmendment = null;
  state.amendmentPaused = false;
  coordinator.cancel();
  autoSave.resume({ schedulePending: false });
  return true;
}

export function taskPendingGates(page) {
  const pending = taskCounts(page).pending;
  return { outline: pending, states: pending, behaviors: pending, status: pending };
}

export function amendmentTaskLabels(changes) {
  return Object.entries(changes || {}).flatMap(([pageId, pageChanges]) => [
    ...(pageChanges.states || []),
    ...(pageChanges.behaviors || []),
    ...(pageChanges.popup || [])
  ].filter((task) => task.change !== "unchanged").map((task) => `${pageId}: ${task.id}`));
}

export function renderTaskChangeBadge({ changes, kind, id, t, escape }) {
  const change = taskChangeFor(changes, kind, id)?.change;
  return change && change !== "unchanged"
    ? `<span class="task-change-badge" data-change-kind="${escape(change)}">${escape(t(`task.change.${change}`))}</span>`
    : "";
}

export function renderTaskStatusSelect({ task, kind, key, statuses, t, escape, removed = false }) {
  return `<label class="task-status"><span class="sr-only">${escape(t("task.status"))}</span><select data-task-status-select="${kind}:${key}" ${removed ? "data-removed-status" : ""} aria-label="${escape(t("task.status"))}">${statuses.map((status) => `<option value="${escape(status)}" ${status === task.implementation_status ? "selected" : ""}>${escape(t(`status.${status}`))}</option>`).join("")}</select></label>`;
}

export function renderTaskUi({ page, changes, statuses, t, escape }) {
  const badge = (kind, id) => renderTaskChangeBadge({ changes, kind, id, t, escape });
  const select = (task, kind, key, removed = false) => renderTaskStatusSelect({ task, kind, key, statuses, t, escape, removed });
  const baseline = page.accepted_baseline || {};
  const removed = (page.removed_tasks || []).map((task) => {
    const accepted = task.kind === "popup"
      ? baseline.popup
      : (baseline[task.kind === "state" ? "states" : "behaviors"] || []).find((item) => item.id === task.id);
    const summary = accepted?.title || accepted?.target || accepted?.id || task.id;
    return `<div class="removed-task-row" data-removed-task="${escape(`${task.kind}:${task.id}`)}"><span>${escape(summary)}</span>${select(task, task.kind, task.id, true)}${badge(task.kind, task.id)}<button class="icon-button" type="button" data-restore-task="${escape(`${task.kind}:${task.id}`)}" title="${escape(t("task.restore"))}" aria-label="${escape(t("task.restore"))}">&#8634;</button></div>`;
  }).join("");
  const pending = taskPendingGates(page);
  return {
    active: {
      state: (page.states || []).map((task) => badge("state", task.id)).join(""),
      behavior: (page.behaviors || []).map((task) => badge("behavior", task.id)).join(""),
      popup: page.popup ? badge("popup", "structure") : ""
    },
    removed: removed ? `<section class="removed-task-section"><h3>${escape(t("task.removed"))}</h3>${removed}</section>` : "",
    pending,
    select
  };
}

export function setRemovedTaskStatus(page, kind, id, status, queueSave) {
  const task = (page.removed_tasks || []).find((item) => item.kind === kind && item.id === id);
  if (!task) return null;
  task.implementation_status = status;
  queueSave();
  return task;
}

export function restoreTask(page, kind, id, queueSave) {
  const restored = restoreRemovedTask(page, kind, id);
  if (restored) queueSave();
  return restored;
}

export function createAmendmentSaveCoordinator({ request, pause, showPrompt }) {
  let pending = null;
  let promptOpen = false;
  let isPaused = false;
  const invoke = async (body, version) => {
    const result = await request(body);
    if (result.status === 409 && result.payload?.error?.code === "amendment_required") {
      isPaused = true;
      pause();
      if (!pending) {
        pending = { body, version };
        promptOpen = true;
        showPrompt(result.payload.error.changes_by_page || {});
      }
      return { outcome: "pause", result, version };
    }
    return { outcome: result.status >= 200 && result.status < 300 ? "saved" : "failed", result, version };
  };
  return {
    save({ config, expectedRevision, acknowledge, version }) {
      if (pending) return Promise.resolve({ outcome: "pause", result: null });
      return invoke({ config, expected_revision: expectedRevision, acknowledge_comment_loss: acknowledge, confirm_amendments: false }, version);
    },
    async confirm() {
      if (!pending) return null;
      const { body: pendingBody, version } = pending;
      const body = { ...pendingBody, confirm_amendments: true };
      promptOpen = false;
      isPaused = false;
      const result = await request(body);
      if (result.status >= 200 && result.status < 300) {
        pending = null;
        return { outcome: "saved", result, version };
      }
      isPaused = true;
      pause();
      return { outcome: "failed", result, version };
    },
    cancel() { pending = null; promptOpen = false; },
    get pending() { return Boolean(pending); },
    get paused() { return isPaused; },
    get promptOpen() { return promptOpen; }
  };
}
