import {
  actionTypesForPage,
  buildFlowGraph,
  buildOutlineRows,
  changeActionType,
  changeBehaviorType,
  cloneDraft,
  collectionIssuePath,
  copyBehaviorToPages,
  createAutoSaveCoordinator,
  createAction,
  createBehavior,
  createDataDependency,
  createNavigationBranch,
  entryPageCandidates,
  createModule,
  createMockDataSource,
  createPage,
  createPopupStructure,
  createState,
  figmaEmbedUrl,
  flowEdgeChannels,
  flowEdgeGeometry,
  flowEdgeLabel,
  formatListInput,
  incomingRoutes,
  indexDestinations,
  issueBelongsToPath,
  issueLocation,
  layoutFlowGraph,
  parseListInput,
  placeIssues,
  reconcilePopupPresentation,
  reconcileEditorCardExpansion,
  rebindEditorCardExpansion,
  reconcileModuleEntryPage,
  reconcileOutlineExpansion,
  remapCollectionIssuePath,
  moveAction,
  mutatePageTaskContracts,
  navigationRoutes,
  removeActionAt,
  removeTaskAt,
  removeMockDataSourceAt,
  navigationFields,
  setConditionalNavigation,
  retargetBehaviorReferences,
  retargetMockDataSourceReferences,
  retargetPageReferences,
  retargetStateReferences,
  slugify,
  stepFlowZoom,
  statusActions,
  swiftPageArtifacts,
  toggleEditorCard,
  toggleOutlineModule,
  triggerEventsForPage,
  updateTaskContract,
  walkActions
} from "/model.mjs";
import { createI18n, localizeIssue, resolveLocale } from "/i18n.mjs";
import { amendmentTaskLabels, clearPendingAmendment, createAmendmentSaveCoordinator, renderTaskChangeBadge, renderTaskStatusSelect, renderTaskUi, restoreTask, runSaveLifecycle, settleConfirmedAmendment, setRemovedTaskStatus, taskPendingGates } from "/task_ui.mjs";

const LOCALE_STORAGE_KEY = "in-app-figma.locale";
let i18n = createI18n(readStoredLocale());
const t = (key, values) => i18n.t(key, values);

const fragmentToken = new URLSearchParams(location.hash.slice(1)).get("token");
const token = fragmentToken || history.state?.editorToken;
if (fragmentToken) {
  history.replaceState({ editorToken: fragmentToken }, "", `${location.pathname}${location.search}`);
}

const state = {
  snapshot: null,
  draft: null,
  selectedModuleId: null,
  selectedPageId: null,
  expandedModuleIds: [],
  expandedBehaviorCards: null,
  expandedStateCards: null,
  editorCardPage: null,
  addPageModuleId: null,
  pendingBehaviorCopy: null,
  activeTab: "page",
  issues: [],
  dirty: false,
  busy: false,
  saving: false,
  conflict: false,
  yamlPreview: "",
  flowZoom: 100,
  flowFullscreen: false,
  pendingAmendment: null,
  confirmingAmendment: false,
  amendmentPaused: false,
  locale: i18n.locale
};

const elements = Object.fromEntries([
  "app", "project-path", "dirty-state", "reload-button", "validate-button", "preview-button",
  "save-button", "shutdown-button", "conflict-banner", "conflict-reload-button", "module-list",
  "add-module-button", "delivery-profile-input", "parallel-input", "max-parallel-input",
  "system-tab-bar-controller-input", "system-picker-input",
  "tabs", "editor-content", "validation-status", "issue-count", "validation-summary", "preview-dialog",
  "yaml-preview", "status-dialog", "status-form", "status-dialog-title", "status-action",
  "status-reason-row", "status-reason", "status-commit-row", "status-commit", "add-item-dialog",
  "add-item-form", "add-item-title", "add-item-kind", "add-item-name", "language-switch", "toast",
  "copy-behavior-dialog", "copy-behavior-form", "copy-behavior-pages", "copy-behavior-select-all",
  "copy-behavior-clear", "copy-behavior-confirm",
  "flow-canvas-panel", "flow-canvas-count", "flow-scroll", "flow-canvas", "flow-zoom-out",
  "flow-zoom-reset", "flow-zoom-in", "flow-fullscreen", "flow-panel-button", "amendment-dialog",
  "amendment-summary", "amendment-confirm"
].map((id) => [id, document.getElementById(id)]));

const autoSave = createAutoSaveCoordinator({ save: autoSaveDraft });
const amendmentSave = createAmendmentSaveCoordinator({
  request: async (body) => {
    const { response, payload } = await api("/api/config", { method: "PUT", body });
    return { status: response.status, payload };
  },
  pause: () => { autoSave.pause(); state.amendmentPaused = true; },
  showPrompt: (changes) => {
    state.pendingAmendment = true;
    showAmendmentDialog(changes);
  }
});

applyStaticTranslations();
bindStaticEvents();
if (!token) {
  fatal(t("message.missing_token"));
} else {
  loadSnapshot(false);
}

async function api(endpoint, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(endpoint, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, status: response.status, error: { message: t("message.invalid_response") } };
  }
  return { response, payload };
}

async function loadSnapshot(confirmDirty = true) {
  if (confirmDirty && state.dirty && !confirm(t("message.confirm_reload"))) return;
  await withBusy(async () => {
    const { response, payload } = await api("/api/snapshot");
    if (!response.ok) throw new Error(localizedServerError(payload.error?.message, "message.load_failed"));
    acceptSnapshot(payload.snapshot);
    state.conflict = false;
    render();
    toast(t("message.loaded"));
  });
}

function acceptSnapshot(snapshot) {
  const previousModuleId = state.selectedModuleId;
  const previousPageId = state.selectedPageId;
  const previousEditorPage = state.editorCardPage;
  const previousExpandedBehaviorCards = state.expandedBehaviorCards;
  const previousExpandedStateCards = state.expandedStateCards;
  state.snapshot = snapshot;
  state.issues = structuredClone(snapshot.issues || []);
  state.draft = cloneDraft(snapshot.config);
  state.draft.delivery ||= { profile: "strict" };
  state.draft.system_ui ||= { tab_bar_controller: false, picker: false };
  state.draft.system_ui.tab_bar_controller ??= false;
  state.draft.system_ui.picker ??= false;
  state.draft.mock_data_sources ||= [];
  for (const module of state.draft.modules || []) {
    for (const page of module.pages || []) {
      page.behaviors ||= [];
      page.data_dependencies ||= [];
      page.acceptance_history ||= [];
    }
  }
  state.yamlPreview = snapshot.yaml_preview;
  state.dirty = false;
  autoSave.reset();
  const module = state.draft.modules.find((item) => item.id === previousModuleId) || state.draft.modules[0];
  state.selectedModuleId = module?.id || null;
  const page = module?.pages.find((item) => item.id === previousPageId) || module?.pages[0];
  state.selectedPageId = page?.id || null;
  if (page && module?.id === previousModuleId && page.id === previousEditorPage?.id) {
    state.editorCardPage = page;
    state.expandedBehaviorCards = rebindEditorCardExpansion(page.behaviors, previousExpandedBehaviorCards);
    state.expandedStateCards = rebindEditorCardExpansion(page.states, previousExpandedStateCards);
  }
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    state.selectedModuleId
  );
}

async function validateDraft({ quiet = false } = {}) {
  if (!state.draft) return false;
  let valid = false;
  await withBusy(async () => {
    const { response, payload } = await api("/api/validate", {
      method: "POST",
      body: { config: state.draft }
    });
    state.issues = payload.issues || [];
    state.yamlPreview = payload.yaml_preview || state.yamlPreview;
    valid = response.status === 200 && payload.valid === true;
    renderOutline();
    renderEditorTabs();
    renderValidation();
    renderInlineValidation();
    if (!quiet) toast(valid ? t("message.valid") : t("validation.issue_count", { count: state.issues.length }));
  });
  if (!valid && !quiet && state.issues[0]) revealIssue(state.issues[0]);
  return valid;
}

async function saveDraft() {
  if (!state.draft || !state.snapshot) return;
  autoSave.pause();
  const acknowledge = state.snapshot.comment_warning
    ? confirm(t("message.normalize_comments"))
    : false;
  if (state.snapshot.comment_warning && !acknowledge) {
    renderChrome();
    return;
  }

  let outcome = "failed";
  await withBusy(async () => {
    outcome = await persistDraft(autoSave.version, { acknowledge, automatic: false });
  });
  if (outcome === "saved") {
    if (state.dirty) {
      autoSave.resume();
    } else {
      autoSave.reset();
    }
  } else if (!state.conflict && !state.snapshot.comment_warning && !amendmentSave.paused) {
    autoSave.resume({ schedulePending: false });
  }
}

async function autoSaveDraft(version) {
  if (!state.dirty) return "saved";
  if (state.busy) return "defer";
  if (state.conflict || state.snapshot?.comment_warning) return "pause";
  state.saving = true;
  renderChrome();
  try {
    return await persistDraft(version, { acknowledge: false, automatic: true });
  } catch (error) {
    toast(error.message || t("message.save_failed"));
    return "failed";
  } finally {
    state.saving = false;
    renderChrome();
  }
}

async function persistDraft(version, { acknowledge, automatic }) {
  const config = cloneDraft(state.draft);
  const expectedRevision = state.snapshot.revision;
  return persistConfig({ config, expectedRevision, version, acknowledge, automatic, confirmAmendments: false });
}

async function persistConfig({ config, expectedRevision, version, acknowledge, automatic, confirmAmendments }) {
  let acceptedSnapshot = false;
  const acceptSnapshotMetadata = (snapshot) => {
    state.snapshot = snapshot;
    state.yamlPreview = snapshot.yaml_preview;
  };
  return runSaveLifecycle({
    performSave: confirmAmendments
      ? () => amendmentSave.confirm()
      : () => amendmentSave.save({ config, expectedRevision, acknowledge, version }),
    state,
    automatic,
    acceptSnapshot: (snapshot) => {
      if (confirmAmendments) {
        acceptSnapshot(snapshot);
        acceptedSnapshot = true;
      } else {
        acceptSnapshotMetadata(snapshot);
      }
    },
    acceptRevision: acceptSnapshotMetadata,
    currentVersion: () => autoSave.version,
    render: (branch) => {
      renderChrome();
      if (branch === "pause" || branch === "conflict") return;
      renderOutline();
      if (branch === "saved" && acceptedSnapshot) renderEditor();
      else renderEditorTabs();
      renderValidation();
      renderInlineValidation();
    },
    notify: (branch, payload) => {
      if (branch === "conflict") toast(t("message.disk_changed_save"));
      if (branch === "validation") toast(localizedServerError(payload.error?.message, "message.invalid_config"));
      if (branch === "saved") toast(t("message.saved"));
    },
    formatError: (payload, fallback) => localizedServerError(payload.error?.message, `message.${fallback}`)
  });
}

function showAmendmentDialog(changes) {
  const tasks = amendmentTaskLabels(changes);
  elements["amendment-summary"].textContent = t("amendment.summary", { tasks: tasks.join(", ") });
  if (!elements["amendment-dialog"].open) elements["amendment-dialog"].showModal();
}

async function confirmAmendment() {
  if (!state.pendingAmendment) return;
  state.amendmentPaused = false;
  state.confirmingAmendment = true;
  elements["amendment-dialog"].close();
  let outcome = "failed";
  try {
    await withBusy(async () => {
      outcome = await persistConfig({ confirmAmendments: true });
    });
  } finally {
    settleConfirmedAmendment({ state, coordinator: amendmentSave, outcome, autoSave });
  }
}

function render() {
  if (!state.draft) return;
  renderChrome();
  renderOutline();
  renderEditor();
  renderFlowCanvas();
  renderValidation();
  renderInlineValidation();
  elements.app.setAttribute("aria-busy", String(state.busy));
}

function renderChrome() {
  const path = state.snapshot?.project?.config_path || "";
  elements["project-path"].textContent = path;
  elements["dirty-state"].textContent = state.busy
    ? t("chrome.working")
    : state.saving
      ? t("chrome.saving")
      : state.dirty && state.snapshot?.comment_warning
        ? t("chrome.manual_save_required")
        : state.dirty ? t("chrome.unsaved") : t("chrome.saved");
  elements["dirty-state"].classList.toggle("is-dirty", state.dirty);
  elements["conflict-banner"].hidden = !state.conflict;
  for (const id of ["reload-button", "validate-button", "preview-button", "save-button", "shutdown-button"]) {
    elements[id].disabled = state.busy || state.saving || !state.draft;
  }
  elements["save-button"].disabled ||= !state.dirty;
}

function renderOutline() {
  const moduleIds = state.draft.modules.map((item) => item.id);
  state.expandedModuleIds = reconcileOutlineExpansion(moduleIds, state.expandedModuleIds, state.selectedModuleId);
  const rows = buildOutlineRows(state.draft.modules, state.expandedModuleIds, state.selectedModuleId, state.selectedPageId);
  elements["module-list"].innerHTML = state.draft.modules.map((item, index) => {
    const row = rows.find((candidate) => candidate.kind === "module" && candidate.moduleId === item.id);
    const pageRows = rows.filter((candidate) => candidate.kind === "page" && candidate.moduleId === item.id);
    const issueCount = countIssues((location) => location.moduleId === item.id);
    const name = item.title || item.id;
    const toggleLabel = t(row.expanded ? "outline.collapse_module" : "outline.expand_module", { name });
    const addPageLabel = t("action.add_page_to_module", { name });
    return `
    <li class="outline-module" data-outline-module="${h(item.id)}">
      <div class="outline-item outline-module-row">
        <button class="outline-toggle" type="button" data-toggle-module="${h(item.id)}" aria-expanded="${row.expanded}" title="${h(toggleLabel)}" aria-label="${h(toggleLabel)}"><span aria-hidden="true">&#8250;</span></button>
        <button class="outline-select" type="button" data-select-module="${h(item.id)}" aria-current="${row.selected}"><span class="outline-select-label"><span>${h(name)}</span>${errorBadge(issueCount, "outline-error-badge")}</span></button>
        <span class="outline-actions">
          ${orderButtons("module", index, state.draft.modules.length)}
          <button class="mini-button" type="button" data-add-page-to-module="${h(item.id)}" title="${h(addPageLabel)}" aria-label="${h(addPageLabel)}">+</button>
          <button class="mini-button" type="button" data-duplicate-module="${h(item.id)}" title="${h(t("action.duplicate_module"))}" aria-label="${h(t("action.duplicate_module"))}">&#10697;</button>
          <button class="mini-button danger" type="button" data-delete-module="${h(item.id)}" title="${h(t("action.delete_module"))}" aria-label="${h(t("action.delete_module"))}">&times;</button>
        </span>
      </div>
      ${row.expanded ? `<ol class="outline-page-list" aria-label="${h(t("outline.pages"))}">${pageRows.map((pageRow) => {
        const page = item.pages.find((candidate) => candidate.id === pageRow.pageId);
        const pageIndex = item.pages.indexOf(page);
        const pageIssueCount = countIssues((location) => location.moduleId === item.id && location.pageId === page.id);
        const pendingCount = taskPendingGates(page).outline;
        return `<li class="outline-item outline-page-item">
          <button class="outline-select" type="button" data-select-page="${h(page.id)}" data-page-module="${h(item.id)}" aria-current="${pageRow.selected}"><span class="outline-select-label"><span class="status-dot ${h(page.status)}"></span><span>${h(page.title || page.id)}</span>${pendingCount ? `<span class="task-pending-badge" aria-label="${h(t("task.pending_count", { count: pendingCount }))}">${pendingCount}</span>` : ""}${errorBadge(pageIssueCount, "outline-error-badge")}</span></button>
          <span class="outline-actions">
            ${orderButtons("page", pageIndex, item.pages.length, item.id)}
            <button class="mini-button" type="button" data-duplicate-page="${h(page.id)}" data-page-module="${h(item.id)}" title="${h(t("action.duplicate_page"))}" aria-label="${h(t("action.duplicate_page"))}">&#10697;</button>
            <button class="mini-button danger" type="button" data-delete-page="${h(page.id)}" data-page-module="${h(item.id)}" title="${h(t("action.delete_page"))}" aria-label="${h(t("action.delete_page"))}">&times;</button>
          </span>
        </li>`;
      }).join("")}</ol>` : ""}
    </li>`;
  }).join("");

  const deliveryProfiles = state.snapshot.schema.delivery_profiles || ["strict"];
  elements["delivery-profile-input"].innerHTML = deliveryProfiles.map((profile) =>
    `<option value="${h(profile)}" ${profile === state.draft.delivery.profile ? "selected" : ""}>${h(t(`delivery.profile.${profile}`))}</option>`
  ).join("");
  elements["parallel-input"].checked = Boolean(state.draft.execution?.parallel);
  elements["max-parallel-input"].value = state.draft.execution?.max_parallel ?? 1;
  elements["system-tab-bar-controller-input"].checked = Boolean(state.draft.system_ui?.tab_bar_controller);
  elements["system-picker-input"].checked = Boolean(state.draft.system_ui?.picker);
}

function renderEditor() {
  renderEditorTabs();
  const page = selectedPage();
  if (!selectedModule() || !page) {
    state.editorCardPage = null;
    state.expandedBehaviorCards = null;
    state.expandedStateCards = null;
    elements["editor-content"].innerHTML = `<div class="empty-state">${h(t("empty.select_page"))}</div>`;
    return;
  }
  if (state.editorCardPage !== page) {
    state.editorCardPage = page;
    state.expandedBehaviorCards = null;
    state.expandedStateCards = null;
  }
  if (state.activeTab === "page") renderPageTab();
  if (state.activeTab === "data") renderDataTab();
  if (state.activeTab === "behaviors") renderBehaviorsTab();
  if (state.activeTab === "states") renderStatesTab();
  if (state.activeTab === "status") renderStatusTab();
}

function renderEditorTabs() {
  for (const button of elements.tabs.querySelectorAll("button")) {
    if (!button.dataset.tab) continue;
    button.setAttribute("aria-selected", String(button.dataset.tab === state.activeTab));
    const issueCount = selectedTabIssueCount(button.dataset.tab);
    const pending = button.dataset.tab === "status" ? taskPendingGates(selectedPage()).status : 0;
    button.innerHTML = `${h(t(`tabs.${button.dataset.tab}`))}${pending ? `<span class="task-pending-badge" aria-label="${h(t("task.pending_count", { count: pending }))}">${pending}</span>` : ""}${errorBadge(issueCount, "tab-error-badge")}`;
  }
}

function countIssues(predicate) {
  return state.issues.reduce((count, issue) => count + (predicate(issueLocation(issue.path)) ? 1 : 0), 0);
}

function selectedTabIssueCount(tab) {
  const module = selectedModule();
  const page = selectedPage();
  if (!module || !page) return 0;
  return countIssues((location) => {
    if (location.tab !== tab) return false;
    if (location.pageId) return location.moduleId === module.id && location.pageId === page.id;
    if (location.moduleId) return location.moduleId === module.id;
    return true;
  });
}

function errorBadge(count, className) {
  return count > 0 ? `<span class="${className}" aria-label="${h(t("validation.issue_count", { count }))}">${count}</span>` : "";
}

function cardOwnerPaths(kind, page, pagePath, index) {
  const collection = kind === "behavior" ? page.behaviors : page.states;
  const key = kind === "behavior" ? "behaviors" : "states";
  const collectionPath = `${pagePath}.${key}`;
  return [...new Set([
    collectionIssuePath(collectionPath, collection[index], index),
    `${collectionPath}[${index}]`
  ])];
}

function cardItemsOwningIssues(kind, page, pagePath) {
  const items = kind === "behavior" ? page.behaviors : page.states;
  return items.filter((_, index) => state.issues.some((issue) => (
    cardOwnerPaths(kind, page, pagePath, index).some((path) => issueBelongsToPath(issue.path, path))
  )));
}

function cardIssueCount(kind, page, pagePath, index) {
  const ownerPaths = cardOwnerPaths(kind, page, pagePath, index);
  return state.issues.filter((issue) => ownerPaths.some((path) => issueBelongsToPath(issue.path, path))).length;
}

function syncCurrentEditorCards() {
  const module = selectedModule();
  const page = selectedPage();
  if (!module || !page) return;
  const pagePath = `modules.${module.id}.pages.${page.id}`;
  state.expandedBehaviorCards = reconcileEditorCardExpansion(
    page.behaviors,
    state.expandedBehaviorCards,
    cardItemsOwningIssues("behavior", page, pagePath)
  );
  state.expandedStateCards = reconcileEditorCardExpansion(
    page.states,
    state.expandedStateCards,
    cardItemsOwningIssues("state", page, pagePath)
  );
  document.querySelectorAll(".editor-card[data-card-kind]").forEach((card) => {
    const kind = card.dataset.cardKind;
    const index = Number(card.dataset.cardIndex);
    const item = kind === "behavior" ? page.behaviors[index] : page.states[index];
    const expandedItems = kind === "behavior" ? state.expandedBehaviorCards : state.expandedStateCards;
    if (!item) return;
    setEditorCardExpanded(card, expandedItems.includes(item), kind, item, index);
    updateCardErrorBadge(card, cardIssueCount(kind, page, pagePath, index));
  });
}

function setEditorCardExpanded(card, expanded, kind, item, index) {
  card.classList.toggle("is-expanded", expanded);
  const toggle = card.querySelector(":scope > .editor-card-header > .editor-card-toggle");
  const body = card.querySelector(":scope > .editor-card-body");
  const name = (kind === "behavior" ? item.id : item.title || item.id) || `#${index + 1}`;
  const heading = toggle?.querySelector(".editor-card-heading");
  if (heading) {
    heading.querySelector("strong").textContent = name;
    heading.querySelector(".editor-card-summary").innerHTML = kind === "behavior" ? behaviorSummary(item) : stateSummary(item);
  }
  const label = t(expanded ? `card.collapse_${kind}` : `card.expand_${kind}`, { name });
  toggle?.setAttribute("aria-expanded", String(expanded));
  toggle?.setAttribute("aria-label", label);
  toggle?.setAttribute("title", label);
  if (body) body.hidden = !expanded;
}

function updateCardErrorBadge(card, count) {
  const toggle = card.querySelector(":scope > .editor-card-header > .editor-card-toggle");
  let badge = toggle?.querySelector(":scope > .card-error-badge");
  if (count === 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "card-error-badge";
    toggle?.append(badge);
  }
  badge.textContent = String(count);
  badge.setAttribute("aria-label", t("validation.issue_count", { count }));
}

function renderDataTab() {
  const module = selectedModule();
  const page = selectedPage();
  const pagePath = `modules.${module.id}.pages.${page.id}`;
  const sources = state.draft.mock_data_sources || [];
  const accessModes = state.snapshot.schema.data_access_modes || ["read_only", "read_write"];
  elements["editor-content"].innerHTML = `
    <div class="inline-error-anchor" data-issue-path="mock_data_sources"></div>
    <div class="inline-error-anchor" data-issue-path="${h(pagePath)}"></div>
    <div class="behavior-hint" role="note">
      <strong>${h(t("data.runtime_title"))}</strong>
      <p>${h(t("data.runtime_hint"))}</p>
    </div>
    <div class="editor-heading">
      <h2>${h(t("field.mock_data_sources"))}</h2>
      <button id="add-mock-data-source" type="button">${h(t("action.add_mock_data_source"))}</button>
    </div>
    <div class="repeated-list">${sources.map((source, index) => {
      const sourcePath = `mock_data_sources[${index}]`;
      return `<section class="repeated-card" data-issue-path="${h(sourcePath)}">
        <div class="repeated-heading"><h3>${h(source.id)}</h3><button class="mini-button danger" type="button" data-delete-mock-data-source="${index}" title="${h(t("action.delete_mock_data_source"))}" aria-label="${h(t("action.delete_mock_data_source"))}">&times;</button></div>
        <div class="form-grid">
          ${field(t("field.data_source_id"), `mock-source-${index}-id`, source.id, `${sourcePath}.id`)}
          ${field(t("field.swift_type"), `mock-source-${index}-swift-type`, source.swift_type, `${sourcePath}.swift_type`)}
          ${field(t("field.fixture"), `mock-source-${index}-fixture`, source.fixture, `${sourcePath}.fixture`)}
        </div>
      </section>`;
    }).join("") || `<div class="empty-state">${h(t("data.no_sources"))}</div>`}</div>
    <div class="editor-heading">
      <h2>${h(t("field.data_dependencies"))}</h2>
      <button id="add-data-dependency" type="button">${h(t("action.add_data_dependency"))}</button>
    </div>
    <div class="repeated-list">${page.data_dependencies.map((dependency, index) => {
      const dependencyPath = `${pagePath}.data_dependencies[${index}]`;
      return `<section class="repeated-card" data-issue-path="${h(dependencyPath)}">
        <div class="repeated-heading"><h3>${h(dependency.source || t("field.unspecified"))}</h3><button class="mini-button danger" type="button" data-delete-data-dependency="${index}" title="${h(t("action.delete_data_dependency"))}" aria-label="${h(t("action.delete_data_dependency"))}">&times;</button></div>
        <div class="form-grid">
          <label><span>${h(t("field.data_source"))}</span><select id="data-dependency-${index}-source" data-issue-path="${h(`${dependencyPath}.source`)}"><option value="">${h(t("field.unspecified"))}</option>${sources.map((source) => `<option value="${h(source.id)}" ${source.id === dependency.source ? "selected" : ""}>${h(source.id)} · ${h(source.swift_type)}</option>`).join("")}</select></label>
          <label><span>${h(t("field.data_access"))}</span><select id="data-dependency-${index}-access" data-issue-path="${h(`${dependencyPath}.access`)}">${accessModes.map((mode) => `<option value="${h(mode)}" ${mode === dependency.access ? "selected" : ""}>${h(t(`data.access.${mode}`))}</option>`).join("")}</select></label>
        </div>
      </section>`;
    }).join("") || `<div class="empty-state">${h(t("data.no_dependencies"))}</div>`}</div>`;

  document.getElementById("add-mock-data-source").addEventListener("click", () => {
    const id = uniqueId(sources, "data-source");
    sources.push(createMockDataSource({ id }));
    dirty(true);
  });
  sources.forEach((source, index) => {
    bindChange(`mock-source-${index}-id`, (value) => {
      const next = slugify(value);
      if (sources.some((candidate) => candidate !== source && candidate.id === next)) return alert(t("message.data_source_id_exists"));
      const previous = source.id;
      source.id = next;
      retargetMockDataSourceReferences(state.draft, previous, next);
      dirty(true);
    });
    bindInput(`mock-source-${index}-swift-type`, (value) => { source.swift_type = value; dirty(); });
    bindInput(`mock-source-${index}-fixture`, (value) => { source.fixture = value; dirty(); });
  });
  document.getElementById("add-data-dependency").addEventListener("click", () => {
    const used = new Set(page.data_dependencies.map((dependency) => dependency.source));
    const source = sources.find((candidate) => !used.has(candidate.id));
    page.data_dependencies.push(createDataDependency({ source: source?.id || "" }));
    dirty(true);
  });
  page.data_dependencies.forEach((dependency, index) => {
    bindChange(`data-dependency-${index}-source`, (value) => { dependency.source = value; dirty(true); });
    bindChange(`data-dependency-${index}-access`, (value) => { dependency.access = value; dirty(); });
  });
}

function renderPageTab() {
  const module = selectedModule();
  const page = selectedPage();
  const modulePath = `modules.${module.id}`;
  const pagePath = `${modulePath}.pages.${page.id}`;
  const pageTypes = state.snapshot.schema.page_types || ["view", "view_controller"];
  const pageRoles = state.snapshot.schema.page_roles || ["screen", "popup"];
  const entryPages = entryPageCandidates(module);
  const entryPageOptions = entryPages.length
    ? entryPages.map((item) => `<option value="${h(item.id)}" ${item.id === module.entry_page ? "selected" : ""}>${h(item.title)}</option>`).join("")
    : `<option value="" selected>${h(t("page.no_screen_entry"))}</option>`;
  elements["editor-content"].innerHTML = `
    <div class="inline-error-anchor" data-issue-path="${h(modulePath)}"></div>
    <div class="inline-error-anchor" data-issue-path="${h(pagePath)}"></div>
    <div class="editor-heading"><h2>${h(page.title)}</h2></div>
    <div class="form-grid">
      ${field(t("field.module_id"), "module-id", module.id, `${modulePath}.id`)}
      ${field(t("field.module_title"), "module-title", module.title, `${modulePath}.title`)}
      <label><span>${h(t("field.entry_page"))}</span><select id="module-entry" data-issue-path="${h(`${modulePath}.entry_page`)}" ${entryPages.length ? "" : "disabled"}>${entryPageOptions}</select></label>
      <span></span>
      ${field(t("field.page_id"), "page-id", page.id, `${pagePath}.id`)}
      ${field(t("field.page_title"), "page-title", page.title, `${pagePath}.title`)}
      <label><span>${h(t("field.page_type"))}</span><select id="page-type" data-issue-path="${h(`${pagePath}.page_type`)}">${pageTypes.map((item) => `<option value="${h(item)}" ${item === page.page_type ? "selected" : ""}>${h(t(`page_type.${item}`))}</option>`).join("")}</select></label>
      <label><span>${h(t("field.page_role"))}</span><select id="page-role" data-issue-path="${h(`${pagePath}.page_role`)}">${pageRoles.map((item) => `<option value="${h(item)}" ${item === page.page_role ? "selected" : ""}>${h(t(`page_role.${item}`))}</option>`).join("")}</select></label>
      <div id="generated-files" class="generated-files">${swiftArtifactsMarkup(page)}</div>
    </div>
    ${page.page_role === "popup" ? renderPopupStructure(page, pagePath) : ""}`;

  bindInput("module-title", (value) => { module.title = value; dirty(); });
  bindChange("module-id", (value) => renameModule(module, value));
  bindChange("module-entry", (value) => { module.entry_page = value; dirty(); });
  bindInput("page-title", (value) => {
    page.title = value;
    document.getElementById("generated-files").innerHTML = swiftArtifactsMarkup(page);
    dirty();
  });
  bindChange("page-type", (value) => { page.page_type = value; dirty(true); });
  bindChange("page-role", (value) => {
    if (value === "screen" && page.popup && !confirm(t("message.confirm_remove_popup"))) {
      document.getElementById("page-role").value = "popup";
      return;
    }
    mutatePageTaskContracts(page, () => {
      page.page_role = value;
      if (value === "popup") page.popup ||= createPopupStructure();
      else delete page.popup;
    });
    reconcileModuleEntryPage(module);
    dirty(true);
  });
  bindChange("page-id", (value) => renamePage(module, page, value));
  bindPopupStructure(page);
}

function renderPopupStructure(page, pagePath) {
  const popup = page.popup || createPopupStructure();
  return `<section id="popup-structure" class="page-section popup-structure" data-task-status="popup:structure" data-issue-path="${h(`${pagePath}.popup`)}">
    <div class="section-heading">
      <h3>${h(t("section.popup_structure"))}</h3>
      <span class="row-actions">${taskChangeBadge("popup", "structure")}${taskStatusSelect(popup, "popup", "structure")}</span>
    </div>
    <div class="popup-field-toggles">
      ${["title", "subtitle", "content"].map((fieldName) => `<label class="toggle-row"><input id="popup-field-${fieldName}" type="checkbox" ${popup.fields?.[fieldName] ? "checked" : ""} data-issue-path="${h(`${pagePath}.popup.fields.${fieldName}`)}"><span>${h(t(`field.popup_${fieldName}`))}</span></label>`).join("")}
    </div>
    <div class="section-heading popup-buttons-heading">
      <h3>${h(t("field.popup_button_id"))}</h3>
      <button id="add-popup-button" class="mini-button" type="button" title="${h(t("action.add_popup_button"))}" aria-label="${h(t("action.add_popup_button"))}">+</button>
    </div>
    <div class="popup-button-list">${(popup.buttons || []).map((button, index) => `<div class="popup-button-row" data-issue-path="${h(`${pagePath}.popup.buttons[${index}]`)}">
      <label><span>${h(t("field.popup_button_id"))}</span><input data-popup-button-id="${index}" value="${h(button.id || "")}"></label>
      <span class="row-actions">${orderButtons("popup-button", index, popup.buttons.length)}<button class="mini-button danger" type="button" data-delete-popup-button="${index}" title="${h(t("action.delete_popup_button"))}" aria-label="${h(t("action.delete_popup_button"))}">&times;</button></span>
    </div>`).join("")}</div>
  </section>`;
}

function bindPopupStructure(page) {
  if (page.page_role !== "popup" || !page.popup) return;
  for (const fieldName of ["title", "subtitle", "content"]) {
    document.getElementById(`popup-field-${fieldName}`)?.addEventListener("change", (event) => {
      mutatePageTaskContracts(page, () => { page.popup.fields[fieldName] = event.target.checked; });
      dirty();
    });
  }
  document.querySelectorAll("[data-popup-button-id]").forEach((input) => {
    input.addEventListener("input", () => {
      mutatePageTaskContracts(page, () => { page.popup.buttons[Number(input.dataset.popupButtonId)].id = input.value; });
      dirty();
    });
  });
}

function swiftArtifactsMarkup(page) {
  const artifacts = swiftPageArtifacts(page);
  if (!artifacts) return `<span>${h(t("page.invalid_swift_name"))}</span>`;
  const files = [artifacts.view.fileName];
  if (artifacts.viewController) files.unshift(artifacts.viewController.fileName);
  return `<span>${h(t("page.generated_files"))}</span><strong>${files.map(h).join(" + ")}</strong>`;
}

function renderBehaviorsTab() {
  const module = selectedModule();
  const page = selectedPage();
  const pagePath = `modules.${module.id}.pages.${page.id}`;
  const behaviorTypes = state.snapshot.schema.behavior_types || [];
  const behaviorAxes = state.snapshot.schema.behavior_axes || [];
  const issueItems = cardItemsOwningIssues("behavior", page, pagePath);
  state.expandedBehaviorCards = reconcileEditorCardExpansion(page.behaviors, state.expandedBehaviorCards, issueItems);
  elements["editor-content"].innerHTML = `
    <div class="inline-error-anchor" data-issue-path="${h(pagePath)}"></div>
    <div class="editor-heading">
      <h2>${h(t("section.behaviors"))}</h2>
      <button id="add-behavior" type="button">${h(t("action.add_behavior"))}</button>
    </div>
    <div class="editor-card-list">${page.behaviors.map((behavior, index) => {
      const behaviorPath = collectionIssuePath(`${pagePath}.behaviors`, behavior, index);
      const expanded = state.expandedBehaviorCards.includes(behavior);
      const issueCount = cardIssueCount("behavior", page, pagePath, index);
      const name = behavior.id || `#${index + 1}`;
      const toggleLabel = t(expanded ? "card.collapse_behavior" : "card.expand_behavior", { name });
      return `<section class="editor-card behavior-card${expanded ? " is-expanded" : ""}" data-card-kind="behavior" data-card-index="${index}" data-task-status="behavior:${h(behavior.id)}" data-issue-path="${h(behaviorPath)}">
        <header class="editor-card-header">
          <button class="editor-card-toggle" type="button" data-toggle-behavior-card="${index}" aria-expanded="${expanded}" title="${h(toggleLabel)}" aria-label="${h(toggleLabel)}">
            <span class="editor-card-chevron" aria-hidden="true">&#8250;</span>
            <span class="editor-card-heading"><strong>${h(name)}</strong><span class="editor-card-summary">${behaviorSummary(behavior)}</span></span>
            ${taskChangeBadge("behavior", behavior.id)}${errorBadge(issueCount, "card-error-badge")}
          </button>
          <span class="row-actions">${taskStatusSelect(behavior, "behavior", index)}${orderButtons("behavior", index, page.behaviors.length)}<button class="mini-button" type="button" data-copy-behavior="${index}" title="${h(t("action.copy_behavior_to_pages"))}" aria-label="${h(t("action.copy_behavior_to_pages"))}">&#10697;</button><button class="mini-button danger" type="button" data-delete-behavior="${index}" title="${h(t("action.delete_behavior"))}" aria-label="${h(t("action.delete_behavior"))}">&times;</button></span>
        </header>
        <div class="editor-card-body" ${expanded ? "" : "hidden"}>
          <div class="form-grid">
          ${field(t("field.behavior_id"), `behavior-${index}-id`, behavior.id, `${behaviorPath}.id`)}
          <label><span>${h(t("field.behavior_type"))}</span><select id="behavior-${index}-type" data-issue-path="${h(`${behaviorPath}.type`)}">${behaviorTypes.map((type) => `<option value="${h(type)}" ${type === behavior.type ? "selected" : ""}>${h(t(`behavior.type.${type}`))}</option>`).join("")}</select></label>
          ${field(t("field.behavior_target"), `behavior-${index}-target`, behavior.target, `${behaviorPath}.target`)}
          ${behavior.type === "interaction"
            ? renderInteractionBehaviorFields(behavior, index, page, behaviorPath)
            : `<label><span>${h(t("field.axis"))}</span><select id="behavior-${index}-axis" data-issue-path="${h(`${behaviorPath}.axis`)}"><option value="">${h(t("field.unspecified"))}</option>${behaviorAxes.map((axis) => `<option value="${h(axis)}" ${axis === behavior.axis ? "selected" : ""}>${h(t(`behavior.axis.${axis}`))}</option>`).join("")}</select></label>
              ${field(t("field.fixed_regions"), `behavior-${index}-fixed_regions`, formatListInput(behavior.fixed_regions), `${behaviorPath}.fixed_regions`, "text", "full")}`}
          ${renderBehaviorStates(behavior, index, page.states, behaviorPath)}
          ${field(t("field.condition"), `behavior-${index}-condition`, behavior.condition || "", `${behaviorPath}.condition`, "text", "full")}
          <label class="full"><span>${h(t("field.note"))}</span><textarea id="behavior-${index}-note" rows="2" data-issue-path="${h(`${behaviorPath}.note`)}">${h(behavior.note || "")}</textarea></label>
          </div>
        </div>
      </section>`;
    }).join("")}${renderRemovedTasks(page)}</div>`;

  document.getElementById("add-behavior").addEventListener("click", () => {
    const expanded = reconcileEditorCardExpansion(page.behaviors, state.expandedBehaviorCards, []);
    const id = uniqueId(page.behaviors, "behavior");
    const behavior = createBehavior({ id });
    page.behaviors.push(behavior);
    state.expandedBehaviorCards = [...expanded, behavior];
    dirty(true);
  });
  page.behaviors.forEach((behavior, index) => bindBehavior(behavior, index));
  bindBehaviorParameterEdits();
}

function behaviorSummary(behavior) {
  const parts = [t(`behavior.type.${behavior.type}`), behavior.target || t("field.unspecified")];
  if (behavior.trigger?.event) parts.push(t(`behavior.trigger.${behavior.trigger.event}`));
  parts.push(t("behavior.action_count", { count: behavior.actions?.length || 0 }));
  return parts.map((part) => `<span>${h(part)}</span>`).join('<span aria-hidden="true">&middot;</span>');
}

function implementationStatuses() {
  return state.snapshot.schema.implementation_statuses || ["todo", "in_progress", "done"];
}

function taskStatusSelect(task, kind, index, removed = false) {
  return renderTaskStatusSelect({ task, kind, key: index, statuses: implementationStatuses(), t, escape: h, removed });
}

function taskChangeBadge(kind, id) {
  return renderTaskChangeBadge({ changes: pageChanges(), kind, id, t, escape: h });
}

function pageChanges() {
  const module = selectedModule();
  const page = selectedPage();
  return module && page ? state.snapshot?.changes_by_page?.[`${module.id}.${page.id}`] : null;
}

function renderRemovedTasks(page) {
  return renderTaskUi({ page, changes: pageChanges(), statuses: implementationStatuses(), t, escape: h }).removed;
}

function renderInteractionBehaviorFields(behavior, index, page, behaviorPath) {
  const triggerEvents = state.snapshot.schema.behavior_trigger_events || [];
  const actionTypes = state.snapshot.schema.behavior_action_types || [];
  const runPolicies = state.snapshot.schema.behavior_run_policies || [];
  const trigger = behavior.trigger || {};
  const pageTriggerEvents = triggerEventsForPage(triggerEvents, page.page_role);
  const pageActionTypes = actionTypesForPage(actionTypes, page.page_role);
  const eventSources = page.behaviors.filter((candidate) => (
    candidate.id !== behavior.id && candidate.type === "interaction" && (
      (trigger.event === "timer_finished" && candidate.actions?.some((action) => action.type === "start_countdown")) ||
      (trigger.event === "video_finished" && candidate.actions?.some((action) => action.type === "play_video"))
    )
  ));
  return `
    <label><span>${h(t("field.trigger_event"))}</span><select id="behavior-${index}-trigger-event" data-issue-path="${h(`${behaviorPath}.trigger.event`)}">${pageTriggerEvents.map((event) => `<option value="${h(event)}" ${event === trigger.event ? "selected" : ""}>${h(t(`behavior.trigger.${event}`))}</option>`).join("")}</select></label>
    <label><span>${h(t("field.run_policy"))}</span><select id="behavior-${index}-run-policy" data-issue-path="${h(`${behaviorPath}.run_policy`)}">${runPolicies.map((policy) => `<option value="${h(policy)}" ${policy === behavior.run_policy ? "selected" : ""}>${h(t(`behavior.run_policy.${policy}`))}</option>`).join("")}</select></label>
    ${["timer_finished", "video_finished"].includes(trigger.event) ? `<label><span>${h(t("field.trigger_source"))}</span><select id="behavior-${index}-trigger-source" data-issue-path="${h(`${behaviorPath}.trigger.source`)}"><option value="">${h(t("field.unspecified"))}</option>${eventSources.map((candidate) => `<option value="${h(candidate.id)}" ${candidate.id === trigger.source ? "selected" : ""}>${h(candidate.id)}</option>`).join("")}</select></label>` : ""}
    ${trigger.event === "custom_event" ? field(t("field.semantic_name"), `behavior-${index}-trigger-name`, trigger.name || "", `${behaviorPath}.trigger.name`) : ""}
    ${stateSelect(t("field.state_change"), `behavior-${index}-state-change`, behavior.state_change || "", page.states, `${behaviorPath}.state_change`)}
    <div class="full behavior-actions">
      <div class="section-heading"><h3>${h(t("section.actions"))}</h3><button class="mini-button" type="button" data-add-behavior-action="${index}" title="${h(t("action.add_behavior_action"))}" aria-label="${h(t("action.add_behavior_action"))}">+</button></div>
      <p class="field-hint">${h(t("behavior.action_order_hint"))}</p>
      <div class="behavior-action-list">${(behavior.actions || []).map((action, actionIndex) => renderBehaviorAction(action, index, actionIndex, page, behaviorPath, pageActionTypes)).join("") || `<div class="empty-state">${h(t("behavior.no_actions"))}</div>`}</div>
    </div>`;
}

function renderBehaviorAction(action, behaviorIndex, actionIndex, page, behaviorPath, actionTypes) {
  const actionPath = `${behaviorPath}.actions[${actionIndex}]`;
  const actionId = `behavior-${behaviorIndex}-actions-${actionIndex}`;
  const conditionalNavigation = action.type === "navigate" && Array.isArray(action.branches);
  const visibleNavigationFields = action.type === "navigate" && !conditionalNavigation ? navigationFields(action.style || "push") : [];
  const screenDestinations = indexDestinations(state.draft, { pageRole: "screen" });
  const popupDestinations = indexDestinations(state.draft, { pageRole: "popup" });
  const destinations = action.type === "present_popup" ? popupDestinations : screenDestinations;
  const terminal = ["back", "dismiss"].includes(action.style);
  const canHaveParameters = action.type === "navigate" && visibleNavigationFields.includes("parameters");
  return `<section class="behavior-action-row" data-issue-path="${h(actionPath)}">
    <div class="repeated-heading"><h3>${h(t("field.action"))} ${actionIndex + 1}</h3><span class="row-actions">${actionOrderButtons(behaviorIndex, actionIndex, (selectedPage()?.behaviors[behaviorIndex]?.actions || []).length)}<button class="mini-button danger" type="button" data-delete-behavior-action="${behaviorIndex}:${actionIndex}" title="${h(t("action.delete_behavior_action"))}" aria-label="${h(t("action.delete_behavior_action"))}">&times;</button></span></div>
    <div class="form-grid">
      <label><span>${h(t("field.action"))}</span><select id="${h(`${actionId}-type`)}" data-issue-path="${h(`${actionPath}.type`)}">${actionTypes.map((type) => `<option value="${h(type)}" ${type === action.type ? "selected" : ""}>${h(t(`behavior.action.${type}`))}</option>`).join("")}</select></label>
      ${["emit_event", "custom"].includes(action.type) ? field(t("field.semantic_name"), `${actionId}-name`, action.name || "", `${actionPath}.name`) : ""}
      ${["start_countdown", "stop_countdown", "start_countup", "stop_countup", "play_video", "pause_video", "stop_video"].includes(action.type) ? field(t("field.action_target"), `${actionId}-target`, action.target || "", `${actionPath}.target`) : ""}
      ${action.type === "navigate" ? renderConditionalNavigation(action, behaviorIndex, [actionIndex], actionPath) : ""}
      ${action.type === "navigate" && !conditionalNavigation ? `<label><span>${h(t("field.style"))}</span><select id="${h(`${actionId}-style`)}" data-issue-path="${h(`${actionPath}.style`)}">${state.snapshot.schema.transition_styles.map((style) => `<option value="${h(style)}" ${style === action.style ? "selected" : ""}>${h(style)}</option>`).join("")}</select></label>` : ""}
      ${visibleNavigationFields.includes("destination") || action.type === "present_popup" ? `<label><span>${h(t(terminal ? "field.stack_destination" : "field.destination"))}</span><select id="${h(`${actionId}-destination`)}" data-issue-path="${h(`${actionPath}.destination`)}"><option value="">${h(t(terminal ? "field.stack_destination_unspecified" : "field.select_destination"))}</option>${destinations.map((item) => `<option value="${h(item.id)}" ${item.id === action.destination ? "selected" : ""}>${h(item.title)}</option>`).join("")}</select></label>` : ""}
      ${terminal ? `<p class="field-hint full">${h(t("route.terminal_destination_hint"))}</p>` : ""}
      ${action.type === "present_popup" ? `<p class="field-hint full">${h(t("behavior.popup_parameters_hint"))}</p>` : ""}
      ${visibleNavigationFields.includes("destination_instance") ? `<label class="toggle-row"><input id="${h(`${actionId}-new`)}" type="checkbox" ${action.destination_instance === "new" ? "checked" : ""}><span>${h(t("field.new_instance"))}</span></label>` : ""}
      ${visibleNavigationFields.includes("url") ? field(t("field.external_url"), `${actionId}-url`, action.url || "", `${actionPath}.url`, "url", "full") : ""}
      ${canHaveParameters ? renderBehaviorParameters(action, behaviorIndex, actionIndex, actionPath) : ""}
      ${action.type === "present_popup" ? renderPopupPresentation(action, behaviorIndex, [actionIndex], page, actionPath, actionTypes) : ""}
    </div>
  </section>`;
}

function popupTemplate(destination) {
  for (const module of state.draft.modules || []) {
    const page = (module.pages || []).find((candidate) => `${module.id}.${candidate.id}` === destination);
    if (page?.page_role === "popup") return page;
  }
  return null;
}

function renderPopupPresentation(action, behaviorIndex, address, page, actionPath, actionTypes) {
  const template = popupTemplate(action.destination);
  if (!template?.popup) return "";
  const addressToken = address.join(".");
  const enabledFields = ["title", "subtitle", "content"].filter((fieldName) => template.popup.fields?.[fieldName]);
  return `<div class="full popup-presentation" data-issue-path="${h(actionPath)}">
    <div class="popup-content-fields">${enabledFields.map((fieldName) => `<label><span>${h(t(`field.popup_${fieldName}`))}</span><input data-popup-content-field="${h(`${behaviorIndex}|${addressToken}|${fieldName}`)}" value="${h(action.content?.[fieldName] || "")}" data-issue-path="${h(`${actionPath}.content.${fieldName}`)}"></label>`).join("")}</div>
    <div class="popup-binding-list">${template.popup.buttons.map((slot, buttonIndex) => {
      const binding = (action.buttons || []).find((candidate) => candidate.id === slot.id) || { id: slot.id, text: "", callback: { actions: [] } };
      const callback = binding.callback || { actions: [] };
      const callbackPath = `${actionPath}.buttons[${buttonIndex}].callback`;
      return `<section class="popup-binding" data-issue-path="${h(`${actionPath}.buttons[${buttonIndex}]`)}">
        <div class="repeated-heading"><h3>${h(slot.id)}</h3><span>${h(t("section.popup_callback"))}</span></div>
        <div class="form-grid">
          <label><span>${h(t("field.popup_button_text"))}</span><input data-popup-button-text="${h(`${behaviorIndex}|${addressToken}|${buttonIndex}`)}" value="${h(binding.text || "")}" data-issue-path="${h(`${actionPath}.buttons[${buttonIndex}].text`)}"></label>
          ${stateSelect(t("field.state_change"), `popup-callback-state-${behaviorIndex}-${address.join("-")}-${buttonIndex}`, callback.state_change || "", page.states, `${callbackPath}.state_change`, `data-popup-callback-state="${h(`${behaviorIndex}|${addressToken}|${buttonIndex}`)}"`)}
          <div class="full callback-actions">
            <div class="section-heading"><h3>${h(t("section.actions"))}</h3><button class="mini-button" type="button" data-add-popup-callback-action="${h(`${behaviorIndex}|${addressToken}|${buttonIndex}`)}" title="${h(t("action.add_behavior_action"))}" aria-label="${h(t("action.add_behavior_action"))}">+</button></div>
            <p class="field-hint">${h(t("behavior.popup_callback_hint"))}</p>
            ${(callback.actions || []).map((nestedAction, nestedIndex) => renderNestedAction(
              nestedAction,
              behaviorIndex,
              [...address, buttonIndex, nestedIndex],
              page,
              `${callbackPath}.actions[${nestedIndex}]`,
              actionTypes,
              nestedIndex,
              callback.actions.length
            )).join("") || `<div class="empty-state">${h(t("behavior.no_actions"))}</div>`}
          </div>
        </div>
      </section>`;
    }).join("")}</div>
  </div>`;
}

function renderNestedAction(action, behaviorIndex, address, page, actionPath, actionTypes, index, length) {
  const actionId = `nested-action-${behaviorIndex}-${address.join("-")}`;
  const addressToken = address.join(".");
  const conditionalNavigation = action.type === "navigate" && Array.isArray(action.branches);
  const visibleNavigationFields = action.type === "navigate" && !conditionalNavigation ? navigationFields(action.style || "push") : [];
  const destinations = indexDestinations(state.draft, { pageRole: action.type === "present_popup" ? "popup" : "screen" });
  const terminal = ["back", "dismiss"].includes(action.style);
  const canHaveParameters = action.type === "navigate" && visibleNavigationFields.includes("parameters");
  return `<section class="behavior-action-row nested-action" data-nested-action="${h(`${behaviorIndex}|${addressToken}`)}" data-issue-path="${h(actionPath)}">
    <div class="repeated-heading"><h3>${h(t("field.action"))} ${index + 1}</h3><span class="row-actions">${nestedActionOrderButtons(behaviorIndex, address, index, length)}<button class="mini-button danger" type="button" data-delete-nested-action="${h(`${behaviorIndex}|${addressToken}`)}" title="${h(t("action.delete_behavior_action"))}" aria-label="${h(t("action.delete_behavior_action"))}">&times;</button></span></div>
    <div class="form-grid">
      <label><span>${h(t("field.action"))}</span><select id="${h(`${actionId}-type`)}">${actionTypes.map((type) => `<option value="${h(type)}" ${type === action.type ? "selected" : ""}>${h(t(`behavior.action.${type}`))}</option>`).join("")}</select></label>
      ${["emit_event", "custom"].includes(action.type) ? field(t("field.semantic_name"), `${actionId}-name`, action.name || "", `${actionPath}.name`) : ""}
      ${["start_countdown", "stop_countdown", "start_countup", "stop_countup", "play_video", "pause_video", "stop_video"].includes(action.type) ? field(t("field.action_target"), `${actionId}-target`, action.target || "", `${actionPath}.target`) : ""}
      ${action.type === "navigate" ? renderConditionalNavigation(action, behaviorIndex, address, actionPath) : ""}
      ${action.type === "navigate" && !conditionalNavigation ? `<label><span>${h(t("field.style"))}</span><select id="${h(`${actionId}-style`)}">${state.snapshot.schema.transition_styles.map((style) => `<option value="${h(style)}" ${style === action.style ? "selected" : ""}>${h(style)}</option>`).join("")}</select></label>` : ""}
      ${visibleNavigationFields.includes("destination") || action.type === "present_popup" ? `<label><span>${h(t(terminal ? "field.stack_destination" : "field.destination"))}</span><select id="${h(`${actionId}-destination`)}"><option value="">${h(t(terminal ? "field.stack_destination_unspecified" : "field.select_destination"))}</option>${destinations.map((item) => `<option value="${h(item.id)}" ${item.id === action.destination ? "selected" : ""}>${h(item.title)}</option>`).join("")}</select></label>` : ""}
      ${terminal ? `<p class="field-hint full">${h(t("route.terminal_destination_hint"))}</p>` : ""}
      ${visibleNavigationFields.includes("destination_instance") ? `<label class="toggle-row"><input id="${h(`${actionId}-new`)}" data-nested-action-new="${h(`${behaviorIndex}|${addressToken}`)}" type="checkbox" ${action.destination_instance === "new" ? "checked" : ""}><span>${h(t("field.new_instance"))}</span></label>` : ""}
      ${visibleNavigationFields.includes("url") ? field(t("field.external_url"), `${actionId}-url`, action.url || "", `${actionPath}.url`, "url", "full") : ""}
      ${canHaveParameters ? renderNestedActionParameters(action, behaviorIndex, address, actionPath) : ""}
      ${action.type === "present_popup" ? renderPopupPresentation(action, behaviorIndex, address, page, actionPath, actionTypes) : ""}
    </div>
  </section>`;
}

function renderConditionalNavigation(action, behaviorIndex, address, actionPath) {
  const token = `${behaviorIndex}|${address.join(".")}`;
  const conditional = Array.isArray(action.branches);
  return `<label class="toggle-row full"><input type="checkbox" data-conditional-navigation="${h(token)}" ${conditional ? "checked" : ""}><span>${h(t("field.conditional_navigation"))}</span></label>
    ${conditional ? `<div class="full navigation-branches" data-issue-path="${h(`${actionPath}.branches`)}">
      <div class="section-heading"><h3>${h(t("section.navigation_branches"))}</h3><button class="mini-button" type="button" data-add-navigation-branch="${h(token)}" title="${h(t("action.add_navigation_branch"))}" aria-label="${h(t("action.add_navigation_branch"))}">+</button></div>
      <p class="field-hint">${h(t("behavior.navigation_branches_hint"))}</p>
      ${(action.branches || []).map((branch, branchIndex) => renderNavigationBranch(branch, behaviorIndex, address, branchIndex, `${actionPath}.branches[${branchIndex}]`, action.branches.length)).join("")}
    </div>` : ""}`;
}

function renderNavigationBranch(branch, behaviorIndex, address, branchIndex, branchPath, length) {
  const token = `${behaviorIndex}|${address.join(".")}|${branchIndex}`;
  const fields = navigationFields(branch.style || "push");
  const terminal = ["back", "dismiss"].includes(branch.style);
  const destinations = indexDestinations(state.draft, { pageRole: "screen" });
  return `<section class="navigation-branch" data-issue-path="${h(branchPath)}">
    <div class="repeated-heading"><h3>${h(t("field.navigation_branch", { index: branchIndex + 1 }))}</h3><button class="mini-button danger" type="button" data-delete-navigation-branch="${h(token)}" ${length <= 2 ? "disabled" : ""} title="${h(t("action.delete_navigation_branch"))}" aria-label="${h(t("action.delete_navigation_branch"))}">&times;</button></div>
    <div class="form-grid">
      <label class="full"><span>${h(t("field.condition"))}</span><input data-navigation-branch-condition="${h(token)}" value="${h(branch.condition || "")}" data-issue-path="${h(`${branchPath}.condition`)}"></label>
      <label><span>${h(t("field.style"))}</span><select data-navigation-branch-style="${h(token)}" data-issue-path="${h(`${branchPath}.style`)}">${state.snapshot.schema.transition_styles.map((style) => `<option value="${h(style)}" ${style === branch.style ? "selected" : ""}>${h(style)}</option>`).join("")}</select></label>
      ${fields.includes("destination") ? `<label><span>${h(t(terminal ? "field.stack_destination" : "field.destination"))}</span><select data-navigation-branch-destination="${h(token)}" data-issue-path="${h(`${branchPath}.destination`)}"><option value="">${h(t(terminal ? "field.stack_destination_unspecified" : "field.select_destination"))}</option>${destinations.map((item) => `<option value="${h(item.id)}" ${item.id === branch.destination ? "selected" : ""}>${h(item.title)}</option>`).join("")}</select></label>` : ""}
      ${terminal ? `<p class="field-hint full">${h(t("route.terminal_destination_hint"))}</p>` : ""}
      ${fields.includes("destination_instance") ? `<label class="toggle-row"><input data-navigation-branch-new="${h(token)}" type="checkbox" ${branch.destination_instance === "new" ? "checked" : ""}><span>${h(t("field.new_instance"))}</span></label>` : ""}
      ${fields.includes("url") ? `<label class="full"><span>${h(t("field.external_url"))}</span><input type="url" data-navigation-branch-url="${h(token)}" value="${h(branch.url || "")}" data-issue-path="${h(`${branchPath}.url`)}"></label>` : ""}
      ${fields.includes("parameters") ? renderNavigationBranchParameters(branch, token, branchPath) : ""}
    </div>
  </section>`;
}

function renderNavigationBranchParameters(branch, token, branchPath) {
  const entries = Object.entries(branch.parameters || {});
  return `<div class="full parameters" data-issue-path="${h(`${branchPath}.parameters`)}">
    <div class="section-heading"><h3>${h(t("field.parameters"))}</h3><button class="mini-button" type="button" data-add-navigation-branch-parameter="${h(token)}" title="${h(t("action.add_parameter"))}" aria-label="${h(t("action.add_parameter"))}">+</button></div>
    ${entries.map(([name, expression], parameterIndex) => `<div class="parameter-row" data-issue-path="${h(`${branchPath}.parameters.${name}`)}">
      <label><span>${h(t("field.name"))}</span><input data-navigation-branch-param-name="${h(`${token}|${parameterIndex}`)}" value="${h(name)}"></label>
      <label><span>${h(t("field.expression"))}</span><input data-navigation-branch-param-value="${h(`${token}|${parameterIndex}`)}" value="${h(expression)}"></label>
      <button class="mini-button danger" type="button" data-delete-navigation-branch-parameter="${h(`${token}|${parameterIndex}`)}" title="${h(t("action.delete_parameter"))}" aria-label="${h(t("action.delete_parameter"))}">&times;</button>
    </div>`).join("")}
  </div>`;
}

function renderNestedActionParameters(action, behaviorIndex, address, actionPath) {
  const addressToken = address.join(".");
  const token = `${behaviorIndex}|${addressToken}`;
  const entries = Object.entries(action.parameters || {});
  return `<div class="full parameters" data-issue-path="${h(`${actionPath}.parameters`)}">
    <div class="section-heading"><h3>${h(t("field.parameters"))}</h3><button class="mini-button" type="button" data-add-nested-action-parameter="${h(token)}" title="${h(t("action.add_parameter"))}" aria-label="${h(t("action.add_parameter"))}">+</button></div>
    ${entries.map(([name, expression], parameterIndex) => `<div class="parameter-row" data-issue-path="${h(`${actionPath}.parameters.${name}`)}">
      <label><span>${h(t("field.name"))}</span><input data-nested-action-param-name="${h(`${token}|${parameterIndex}`)}" value="${h(name)}"></label>
      <label><span>${h(t("field.expression"))}</span><input data-nested-action-param-value="${h(`${token}|${parameterIndex}`)}" value="${h(expression)}"></label>
      <button class="mini-button danger" type="button" data-delete-nested-action-parameter="${h(`${token}|${parameterIndex}`)}" title="${h(t("action.delete_parameter"))}" aria-label="${h(t("action.delete_parameter"))}">&times;</button>
    </div>`).join("")}
  </div>`;
}

function renderBehaviorParameters(action, behaviorIndex, actionIndex, actionPath) {
  const entries = Object.entries(action.parameters || {});
  return `<div class="full parameters" data-issue-path="${h(`${actionPath}.parameters`)}">
    <div class="section-heading"><h3>${h(t("field.parameters"))}</h3><button class="mini-button" type="button" data-add-behavior-action-parameter="${behaviorIndex}:${actionIndex}" title="${h(t("action.add_parameter"))}" aria-label="${h(t("action.add_parameter"))}">+</button></div>
    ${entries.map(([name, expression], parameterIndex) => `<div class="parameter-row" data-issue-path="${h(`${actionPath}.parameters.${name}`)}">
      <label><span>${h(t("field.name"))}</span><input data-behavior-action-param-name="${behaviorIndex}:${actionIndex}:${parameterIndex}" value="${h(name)}"></label>
      <label><span>${h(t("field.expression"))}</span><input data-behavior-action-param-value="${behaviorIndex}:${actionIndex}:${parameterIndex}" value="${h(expression)}"></label>
      <button class="mini-button danger" type="button" data-delete-behavior-action-parameter="${behaviorIndex}:${actionIndex}:${parameterIndex}" title="${h(t("action.delete_parameter"))}" aria-label="${h(t("action.delete_parameter"))}">&times;</button>
    </div>`).join("")}
  </div>`;
}

function renderBehaviorStates(behavior, behaviorIndex, states, behaviorPath) {
  return `<fieldset class="full behavior-states" data-issue-path="${h(`${behaviorPath}.states`)}">
    <legend>${h(t("field.applicable_states"))}</legend>
    <div class="checkbox-grid">${states.map((item) => `<label><input type="checkbox" data-behavior-state="${behaviorIndex}" value="${h(item.id)}" ${behavior.states?.includes(item.id) ? "checked" : ""}><span>${h(item.title || item.id)} <small>${h(item.id)}</small></span></label>`).join("")}</div>
  </fieldset>`;
}

function bindBehavior(behavior, index) {
  for (const key of ["id", "target", "condition", "note"]) {
    const element = document.getElementById(`behavior-${index}-${key}`);
    element.addEventListener("input", () => {
      updateTaskContract(behavior, (task) => {
        if (key === "id") {
          const previous = task.id;
          task.id = element.value;
          mutatePageTaskContracts(selectedPage(), () => retargetBehaviorReferences(selectedPage(), previous, task.id));
        } else if (["condition", "note"].includes(key) && !element.value) delete task[key];
        else task[key] = element.value;
      });
      dirty();
    });
    if (key === "id") element.addEventListener("change", () => renderEditor());
  }
  for (const key of ["type", "axis"]) {
    const element = document.getElementById(`behavior-${index}-${key}`);
    if (!element) continue;
    element.addEventListener("change", () => {
      if (key === "type") {
        updateTaskContract(behavior, (task) => changeBehaviorType(task, element.value));
        dirty(true);
        return;
      }
      updateTaskContract(behavior, (task) => {
        if (!element.value) delete task.axis;
        else task[key] = element.value;
      });
      dirty();
    });
  }
  document.getElementById(`behavior-${index}-fixed_regions`)?.addEventListener("input", (event) => {
    const values = parseListInput(event.target.value);
    updateTaskContract(behavior, (task) => {
      if (values.length > 0) task.fixed_regions = values;
      else delete task.fixed_regions;
    });
    dirty();
  });
  document.querySelectorAll(`[data-behavior-state="${index}"]`).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const selected = [...document.querySelectorAll(`[data-behavior-state="${index}"]:checked`)].map((item) => item.value);
      updateTaskContract(behavior, (task) => {
        if (selected.length > 0) task.states = selected;
        else delete task.states;
      });
      dirty();
    });
  });
  if (behavior.type === "interaction") bindInteractionBehavior(behavior, index);
}

function bindInteractionBehavior(behavior, index) {
  bindChange(`behavior-${index}-trigger-event`, (event) => {
    updateTaskContract(behavior, (task) => { task.trigger = { event }; });
    dirty(true);
  });
  bindChange(`behavior-${index}-trigger-source`, (source) => {
    updateTaskContract(behavior, (task) => {
      const changed = task.trigger.source !== source;
      if (source) task.trigger.source = source;
      else delete task.trigger.source;
    });
    dirty();
  });
  bindInput(`behavior-${index}-trigger-name`, (name) => {
    updateTaskContract(behavior, (task) => {
      if (name) task.trigger.name = name;
      else delete task.trigger.name;
    });
    dirty();
  });
  bindChange(`behavior-${index}-run-policy`, (policy) => { updateTaskContract(behavior, (task) => { task.run_policy = policy; }); dirty(); });
  bindChange(`behavior-${index}-state-change`, (stateId) => {
    updateTaskContract(behavior, (task) => {
      if (stateId) task.state_change = stateId;
      else delete task.state_change;
    });
    dirty();
  });
  for (const [actionIndex, action] of (behavior.actions || []).entries()) {
    bindBehaviorAction(behavior, index, action, actionIndex);
  }
}

function bindBehaviorAction(behavior, behaviorIndex, action, actionIndex) {
  const actionId = `behavior-${behaviorIndex}-actions-${actionIndex}`;
  bindChange(`${actionId}-type`, (type) => {
    updateTaskContract(behavior, () => changeActionType(action, type));
    dirty(true);
  });
  bindInput(`${actionId}-name`, (name) => {
    updateTaskContract(behavior, () => { if (name) action.name = name; else delete action.name; });
    dirty();
  });
  bindInput(`${actionId}-target`, (target) => {
    updateTaskContract(behavior, () => { if (target) action.target = target; else delete action.target; });
    dirty();
  });
  bindChange(`${actionId}-style`, (style) => {
    updateTaskContract(behavior, () => {
      const replacement = createAction({ ...action, type: "navigate", style });
      for (const key of Object.keys(action)) delete action[key];
      Object.assign(action, replacement);
    });
    dirty(true);
  });
  bindChange(`${actionId}-destination`, (destination) => {
    if (action.type === "present_popup" && destination) {
      const result = reconcilePopupPresentation(action, popupTemplate(destination), { destination });
      if (result.droppedPaths.length > 0 && !confirm(t("message.confirm_reconcile_popup"))) {
        document.getElementById(`${actionId}-destination`).value = action.destination || "";
        return;
      }
      updateTaskContract(behavior, () => replaceObject(action, result.action));
      dirty(true);
      return;
    }
    updateTaskContract(behavior, () => { if (destination) action.destination = destination; else delete action.destination; });
    dirty();
  });
  bindInput(`${actionId}-url`, (url) => {
    updateTaskContract(behavior, () => { if (url) action.url = url; else delete action.url; });
    dirty();
  });
  document.getElementById(`${actionId}-new`)?.addEventListener("change", (event) => {
    updateTaskContract(behavior, () => { if (event.target.checked) action.destination_instance = "new"; else delete action.destination_instance; });
    dirty();
  });
  bindConditionalNavigationFields(behavior, behaviorIndex);
  bindPopupPresentationFields(behavior, behaviorIndex);
}

function replaceObject(target, replacement) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

function parseActionAddress(value) {
  return String(value || "").split(".").filter(Boolean).map(Number);
}

function actionAtAddress(behavior, address) {
  let action = behavior.actions?.[address[0]];
  for (let index = 1; action && index < address.length; index += 2) {
    action = action.buttons?.[address[index]]?.callback?.actions?.[address[index + 1]];
  }
  return action || null;
}

function reconcileActionBindings(action) {
  const result = reconcilePopupPresentation(action, popupTemplate(action.destination));
  if (result.droppedPaths.length > 0 && !confirm(t("message.confirm_reconcile_popup"))) return false;
  replaceObject(action, result.action);
  return true;
}

function bindPopupPresentationFields(behavior, behaviorIndex) {
  document.querySelectorAll(`[data-popup-content-field^="${behaviorIndex}|"]`).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [, addressValue, fieldName] = input.dataset.popupContentField.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      updateTaskContract(behavior, () => { action.content ||= {}; action.content[fieldName] = input.value; });
      dirty();
    });
  });
  document.querySelectorAll(`[data-popup-button-text^="${behaviorIndex}|"]`).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [, addressValue, buttonValue] = input.dataset.popupButtonText.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      updateTaskContract(behavior, () => {
        if (!reconcileActionBindings(action)) return;
        action.buttons[Number(buttonValue)].text = input.value;
      });
      dirty();
    });
  });
  document.querySelectorAll(`[data-popup-callback-state^="${behaviorIndex}|"]`).forEach((select) => {
    if (select.dataset.bound) return;
    select.dataset.bound = "true";
    select.addEventListener("change", () => {
      const [, addressValue, buttonValue] = select.dataset.popupCallbackState.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      updateTaskContract(behavior, () => {
        if (!reconcileActionBindings(action)) return;
        const callback = action.buttons[Number(buttonValue)].callback;
        if (select.value) callback.state_change = select.value;
        else delete callback.state_change;
      });
      dirty();
    });
  });
  bindNestedActions(behavior, behaviorIndex);
}

function bindNestedActions(behavior, behaviorIndex) {
  document.querySelectorAll(`[data-nested-action^="${behaviorIndex}|"]`).forEach((section) => {
    if (section.dataset.bound) return;
    section.dataset.bound = "true";
    const [, addressValue] = section.dataset.nestedAction.split("|");
    const address = parseActionAddress(addressValue);
    const action = actionAtAddress(behavior, address);
    if (!action) return;
    const actionId = `nested-action-${behaviorIndex}-${address.join("-")}`;
    bindChange(`${actionId}-type`, (type) => {
      updateTaskContract(behavior, () => changeActionType(action, type));
      dirty(true);
    });
    bindInput(`${actionId}-name`, (name) => {
      updateTaskContract(behavior, () => { if (name) action.name = name; else delete action.name; });
      dirty();
    });
    bindInput(`${actionId}-target`, (target) => {
      updateTaskContract(behavior, () => { if (target) action.target = target; else delete action.target; });
      dirty();
    });
    bindChange(`${actionId}-style`, (style) => {
      updateTaskContract(behavior, () => replaceObject(action, createAction({ ...action, type: "navigate", style })));
      dirty(true);
    });
    bindChange(`${actionId}-destination`, (destination) => {
      if (action.type === "present_popup" && destination) {
        const result = reconcilePopupPresentation(action, popupTemplate(destination), { destination });
        if (result.droppedPaths.length > 0 && !confirm(t("message.confirm_reconcile_popup"))) {
          document.getElementById(`${actionId}-destination`).value = action.destination || "";
          return;
        }
        updateTaskContract(behavior, () => replaceObject(action, result.action));
        dirty(true);
      } else {
        updateTaskContract(behavior, () => { if (destination) action.destination = destination; else delete action.destination; });
        dirty();
      }
    });
    bindInput(`${actionId}-url`, (url) => {
      updateTaskContract(behavior, () => { if (url) action.url = url; else delete action.url; });
      dirty();
    });
    document.getElementById(`${actionId}-new`)?.addEventListener("change", (event) => {
      updateTaskContract(behavior, () => { if (event.target.checked) action.destination_instance = "new"; else delete action.destination_instance; });
      dirty();
    });
  });
  bindConditionalNavigationFields(behavior, behaviorIndex);
  bindNestedActionParameterEdits(behavior, behaviorIndex);
}

function bindConditionalNavigationFields(behavior, behaviorIndex) {
  document.querySelectorAll(`[data-conditional-navigation^="${behaviorIndex}|"]`).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("change", () => {
      const [, addressValue] = input.dataset.conditionalNavigation.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      if (!input.checked && action.branches?.length > 1 && !confirm(t("message.confirm_disable_conditional_navigation"))) {
        input.checked = true;
        return;
      }
      updateTaskContract(behavior, () => setConditionalNavigation(action, input.checked));
      dirty(true);
    });
  });

  document.querySelectorAll(`[data-navigation-branch-condition^="${behaviorIndex}|"]`).forEach((input) => {
    bindNavigationBranchInput(input, behavior, "navigationBranchCondition", (branch) => { branch.condition = input.value; });
  });
  document.querySelectorAll(`[data-navigation-branch-destination^="${behaviorIndex}|"]`).forEach((select) => {
    bindNavigationBranchInput(select, behavior, "navigationBranchDestination", (branch) => {
      if (select.value) branch.destination = select.value;
      else delete branch.destination;
    }, "change");
  });
  document.querySelectorAll(`[data-navigation-branch-url^="${behaviorIndex}|"]`).forEach((input) => {
    bindNavigationBranchInput(input, behavior, "navigationBranchUrl", (branch) => {
      if (input.value) branch.url = input.value;
      else delete branch.url;
    });
  });
  document.querySelectorAll(`[data-navigation-branch-style^="${behaviorIndex}|"]`).forEach((select) => {
    bindNavigationBranchInput(select, behavior, "navigationBranchStyle", (branch, action, branchIndex) => {
      action.branches[branchIndex] = createNavigationBranch({ ...branch, style: select.value });
    }, "change", true);
  });
  document.querySelectorAll(`[data-navigation-branch-new^="${behaviorIndex}|"]`).forEach((input) => {
    bindNavigationBranchInput(input, behavior, "navigationBranchNew", (branch) => {
      if (input.checked) branch.destination_instance = "new";
      else delete branch.destination_instance;
    }, "change");
  });
  document.querySelectorAll(`[data-navigation-branch-param-name^="${behaviorIndex}|"]`).forEach((input) => {
    bindNavigationBranchParameterInput(input, behavior, "navigationBranchParamName", (branch, parameterIndex) => {
      const entries = Object.entries(branch.parameters || {});
      branch.parameters = Object.fromEntries(entries.map(([name, value], index) => [index === parameterIndex ? input.value : name, value]));
    });
  });
  document.querySelectorAll(`[data-navigation-branch-param-value^="${behaviorIndex}|"]`).forEach((input) => {
    bindNavigationBranchParameterInput(input, behavior, "navigationBranchParamValue", (branch, parameterIndex) => {
      const name = Object.keys(branch.parameters || {})[parameterIndex];
      if (name !== undefined) branch.parameters[name] = input.value;
    });
  });
}

function bindNavigationBranchInput(input, behavior, datasetKey, mutate, eventName = "input", rerender = false) {
  if (input.dataset.bound) return;
  input.dataset.bound = "true";
  input.addEventListener(eventName, () => {
    const [, addressValue, branchValue] = input.dataset[datasetKey].split("|");
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    const branchIndex = Number(branchValue);
    const branch = action?.branches?.[branchIndex];
    if (!branch) return;
    updateTaskContract(behavior, () => mutate(branch, action, branchIndex));
    dirty(rerender);
  });
}

function bindNavigationBranchParameterInput(input, behavior, datasetKey, mutate) {
  if (input.dataset.bound) return;
  input.dataset.bound = "true";
  input.addEventListener("input", () => {
    const [, addressValue, branchValue, parameterValue] = input.dataset[datasetKey].split("|");
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    const branch = action?.branches?.[Number(branchValue)];
    if (!branch) return;
    updateTaskContract(behavior, () => mutate(branch, Number(parameterValue)));
    dirty();
  });
}

function bindNestedActionParameterEdits(behavior, behaviorIndex) {
  document.querySelectorAll(`[data-nested-action-param-name^="${behaviorIndex}|"]`).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [, addressValue, parameterValue] = input.dataset.nestedActionParamName.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      const parameterIndex = Number(parameterValue);
      const entries = Object.entries(action.parameters || {});
      const replacement = {};
      entries.forEach(([name, value], entryIndex) => { replacement[entryIndex === parameterIndex ? input.value : name] = value; });
      updateTaskContract(behavior, () => { action.parameters = replacement; });
      dirty();
    });
  });
  document.querySelectorAll(`[data-nested-action-param-value^="${behaviorIndex}|"]`).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [, addressValue, parameterValue] = input.dataset.nestedActionParamValue.split("|");
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action) return;
      const parameterName = Object.keys(action.parameters || {})[Number(parameterValue)];
      if (parameterName === undefined) return;
      updateTaskContract(behavior, () => { action.parameters[parameterName] = input.value; });
      dirty();
    });
  });
}

function bindBehaviorParameterEdits() {
  const page = selectedPage();
  document.querySelectorAll("[data-behavior-action-param-name]").forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [behaviorIndex, actionIndex, parameterIndex] = input.dataset.behaviorActionParamName.split(":").map(Number);
      const action = page.behaviors[behaviorIndex].actions[actionIndex];
      const entries = Object.entries(action.parameters || {});
      const replacement = {};
      entries.forEach(([name, value], entryIndex) => { replacement[entryIndex === parameterIndex ? input.value : name] = value; });
      updateTaskContract(page.behaviors[behaviorIndex], () => { action.parameters = replacement; });
      dirty();
    });
  });
  document.querySelectorAll("[data-behavior-action-param-value]").forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
      const [behaviorIndex, actionIndex, parameterIndex] = input.dataset.behaviorActionParamValue.split(":").map(Number);
      const action = page.behaviors[behaviorIndex].actions[actionIndex];
      updateTaskContract(page.behaviors[behaviorIndex], () => {
        action.parameters[Object.keys(action.parameters)[parameterIndex]] = input.value;
      });
      dirty();
    });
  });
}

function renderStatesTab() {
  const module = selectedModule();
  const page = selectedPage();
  const pagePath = `modules.${module.id}.pages.${page.id}`;
  const issueItems = cardItemsOwningIssues("state", page, pagePath);
  state.expandedStateCards = reconcileEditorCardExpansion(page.states, state.expandedStateCards, issueItems);
  elements["editor-content"].innerHTML = `
    <div class="inline-error-anchor" data-issue-path="${h(pagePath)}"></div>
    <div class="editor-heading">
      <h2>${h(t("section.states"))}</h2>
      <button id="add-state" type="button">${h(t("action.add_state"))}</button>
    </div>
    <div class="editor-card-list state-card-grid">${page.states.map((item, index) => {
      const statePath = `${pagePath}.states[${index}]`;
      const expanded = state.expandedStateCards.includes(item);
      const issueCount = cardIssueCount("state", page, pagePath, index);
      const name = item.title || item.id || `#${index + 1}`;
      const toggleLabel = t(expanded ? "card.collapse_state" : "card.expand_state", { name });
      return `<section class="editor-card state-card${expanded ? " is-expanded" : ""}" data-card-kind="state" data-card-index="${index}" data-task-status="state:${h(item.id)}" data-issue-path="${h(statePath)}">
        <header class="editor-card-header">
          <button class="editor-card-toggle" type="button" data-toggle-state-card="${index}" aria-expanded="${expanded}" title="${h(toggleLabel)}" aria-label="${h(toggleLabel)}">
            <span class="editor-card-chevron" aria-hidden="true">&#8250;</span>
            <span class="editor-card-heading"><strong>${h(name)}</strong><span class="editor-card-summary">${stateSummary(item)}</span></span>
            ${taskChangeBadge("state", item.id)}${errorBadge(issueCount, "card-error-badge")}
          </button>
          <span class="row-actions">${taskStatusSelect(item, "state", index)}${orderButtons("state", index, page.states.length)}<button class="mini-button danger" type="button" data-delete-state="${index}" title="${h(t("action.delete_state"))}" aria-label="${h(t("action.delete_state"))}">&times;</button></span>
        </header>
        <div class="editor-card-body" ${expanded ? "" : "hidden"}>
          <div class="form-grid">
            ${field(t("field.state_id"), `state-${index}-id`, item.id, `${statePath}.id`)}
            ${field(t("field.title"), `state-${index}-title`, item.title, `${statePath}.title`)}
            ${field(t("field.figma_url"), `state-${index}-figma_url`, item.figma_url, `${statePath}.figma_url`, "url", "full")}
          </div>
        </div>
      </section>`;
    }).join("")}${renderRemovedTasks(page)}</div>`;

  document.getElementById("add-state").addEventListener("click", () => {
    const expanded = reconcileEditorCardExpansion(page.states, state.expandedStateCards, []);
    const id = uniqueId(page.states, "state");
    const item = createState({ id, title: titleize(id) });
    page.states.push(item);
    state.expandedStateCards = [...expanded, item];
    dirty(true);
  });
  page.states.forEach((item, index) => {
    bindInput(`state-${index}-id`, (value) => {
      const previous = item.id;
      mutatePageTaskContracts(page, () => updateTaskContract(item, (task) => {
        task.id = value;
        retargetStateReferences(page, previous, value);
      }));
      dirty();
    });
    document.getElementById(`state-${index}-id`).addEventListener("change", () => renderEditor());
    for (const key of ["title", "figma_url"]) bindInput(`state-${index}-${key}`, (value) => { updateTaskContract(item, (task) => { task[key] = value; }); dirty(); });
  });
}

function stateSummary(item) {
  return `<span>${h(item.id)}</span><span aria-hidden="true">&middot;</span><span>${h(t(item.figma_url ? "state.figma_linked" : "state.figma_missing"))}</span>`;
}

function stateSelect(label, id, value, states, issuePath, attributes = "") {
  return `<label><span>${h(label)}</span><select id="${h(id)}" data-issue-path="${h(issuePath)}" ${attributes}><option value="">${h(t("field.select_state"))}</option>${states.map((item) => `<option value="${h(item.id)}" ${item.id === value ? "selected" : ""}>${h(item.title || item.id)}</option>`).join("")}</select></label>`;
}

function renderFlowCanvas() {
  const graph = layoutFlowGraph(buildFlowGraph(state.draft));
  const scrollLeft = elements["flow-scroll"].scrollLeft;
  const scrollTop = elements["flow-scroll"].scrollTop;
  elements["flow-canvas-count"].textContent = t("flow.page_count", { count: graph.nodes.length });
  if (graph.nodes.length === 0) {
    elements["flow-canvas"].className = `flow-canvas zoom-${state.flowZoom}`;
    elements["flow-canvas"].innerHTML = `<div class="flow-canvas-empty">${h(t("flow.no_pages"))}</div>`;
    applyFlowZoom();
    return;
  }

  const selectedId = selectedModule() && selectedPage()
    ? `${selectedModule().id}.${selectedPage().id}`
    : null;
  const edgeChannels = flowEdgeChannels(graph.edges);
  const terminalEdgeCount = graph.edges.filter((edge) => edge.terminal).length;
  const columnCount = Math.max(...graph.nodes.map((node) => node.column)) + 1;
  const columns = Array.from({ length: columnCount }, (_, column) => (
    graph.nodes.filter((node) => node.column === column)
  ));

  elements["flow-canvas"].className = `flow-canvas zoom-${state.flowZoom}`;
  elements["flow-canvas"].innerHTML = `
    <svg class="flow-edges" aria-hidden="true"></svg>
    <div class="flow-edge-spacer" aria-hidden="true"><span class="flow-edge-spacer-base"></span>${Array.from({ length: terminalEdgeCount }, () => "<span></span>").join("")}</div>
    <div class="flow-page-lane">${columns.map((columnNodes, column) => `
      <div class="flow-page-column" data-flow-column="${column}">${columnNodes.map((node) => `
        <section class="flow-page-group${node.id === selectedId ? " selected" : ""}" data-flow-group="${h(node.id)}">
        <button class="flow-page-heading" type="button" data-canvas-module="${h(node.moduleId)}" data-canvas-page="${h(node.pageId)}" aria-pressed="${node.id === selectedId}">
          <span class="flow-page-title"><span class="status-dot ${h(node.status)}"></span><strong>${h(node.pageTitle || node.pageId)}</strong>${node.entry ? `<span class="entry-badge">${h(t("flow.entry"))}</span>` : ""}</span>
          <span class="flow-page-meta">${h(node.id)} · ${h(t("flow.state_count", { count: node.states.length }))}</span>
        </button>
        <div class="flow-state-diagram">
          <svg class="flow-state-edges" aria-hidden="true"></svg>
          <div class="flow-state-row">${node.states.length === 0
            ? `<div class="flow-state-empty">${h(t("preview.no_states"))}</div>`
            : node.states.map((item) => renderCanvasState(node, item)).join("")}
          </div>
        </div>
        </section>`).join("")}
      </div>`).join("")}</div>
    ${graph.edges.length === 0 ? `<div class="flow-empty-note">${h(t("flow.no_routes"))}</div>` : ""}`;
  drawFlowEdges(graph, edgeChannels);
  drawStateEdges(graph);
  applyFlowZoom();
  elements["flow-scroll"].scrollLeft = scrollLeft;
  elements["flow-scroll"].scrollTop = scrollTop;
}

function renderCanvasState(node, item) {
  const embedUrl = figmaEmbedUrl(item.figma_url);
  return `<article class="flow-state-preview" data-flow-state="${h(item.id)}">
    <div class="flow-state-heading"><div><strong>${h(item.title || item.id)}</strong><span>${h(item.id)}</span></div>${embedUrl ? `<a href="${h(item.figma_url)}" target="_blank" rel="noreferrer">${h(t("preview.open_figma"))}</a>` : ""}</div>
    ${embedUrl
      ? `<iframe src="${h(embedUrl)}" title="${h(t("preview.iframe_title", { page: node.pageTitle || node.pageId, state: item.title || item.id }))}" loading="lazy" referrerpolicy="no-referrer" allow="fullscreen"></iframe>`
      : `<div class="figma-preview-unavailable">${h(t("preview.unavailable"))}</div>`}
  </article>`;
}

function drawStateEdges(graph) {
  const canvas = elements["flow-canvas"];
  for (const node of graph.nodes) {
    const group = [...canvas.querySelectorAll("[data-flow-group]")].find((item) => item.dataset.flowGroup === node.id);
    const diagram = group?.querySelector(".flow-state-diagram");
    const svg = diagram?.querySelector(".flow-state-edges");
    if (!diagram || !svg) continue;
    const positions = new Map();
    diagram.querySelectorAll("[data-flow-state]").forEach((item) => {
      positions.set(item.dataset.flowState, elementBoxWithin(item, diagram));
    });
    const width = diagram.offsetWidth;
    const height = diagram.offsetHeight;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const markerId = `state-arrow-${slugify(node.id)}`;
    svg.innerHTML = `<defs><marker id="${h(markerId)}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>${node.stateTransitions.map((transition, index) => renderStateEdge(transition, positions, markerId, index)).join("")}`;
  }
}

function renderStateEdge(transition, positions, markerId, index) {
  const source = positions.get(transition.from);
  const target = positions.get(transition.to);
  if (!source || !target) return "";
  const self = transition.from === transition.to;
  const lane = index * 8;
  let path;
  let labelX;
  let labelY;
  if (self) {
    const startX = source.x + source.width / 2 - 32;
    const endX = source.x + source.width / 2 + 32;
    const top = source.y;
    const loopY = Math.max(8, top - 30 - lane);
    path = `M ${startX} ${top} C ${startX} ${loopY}, ${endX} ${loopY}, ${endX} ${top}`;
    labelX = (startX + endX) / 2;
    labelY = loopY - 4;
  } else {
    const startX = source.x + source.width / 2;
    const endX = target.x + target.width / 2;
    const startY = source.y;
    const endY = target.y;
    const archY = Math.max(8, Math.min(startY, endY) - 28 - lane);
    path = `M ${startX} ${startY} C ${startX} ${archY}, ${endX} ${archY}, ${endX} ${endY}`;
    labelX = (startX + endX) / 2;
    labelY = archY - 4;
  }
  const label = [transition.action || transition.id, transition.condition ? `[${transition.condition}]` : null].filter(Boolean).join(" ");
  return `<g class="flow-state-edge"><title>${h(label)}</title><path d="${path}" marker-end="url(#${h(markerId)})"></path><text x="${labelX}" y="${labelY}" text-anchor="middle">${h(label)}</text></g>`;
}

function drawFlowEdges(graph, edgeChannels) {
  const canvas = elements["flow-canvas"];
  const svg = canvas?.querySelector(".flow-edges");
  if (!canvas || !svg) return;
  const positions = new Map();
  canvas.querySelectorAll("[data-flow-group]").forEach((group) => {
    positions.set(group.dataset.flowGroup, elementBoxWithin(group, canvas));
  });
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `<defs><marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker><marker id="flow-return-arrow" class="flow-return-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"></path></marker></defs>${graph.edges.map((edge) => renderFlowEdge(edge, positions, edgeChannels[edge.id])).join("")}`;
}

function elementBoxWithin(element, ancestor) {
  let x = 0;
  let y = 0;
  let current = element;
  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent;
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

function renderFlowEdge(edge, positions, channels) {
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);
  if (!source || (!target && !edge.destinationless)) return "";
  const geometry = flowEdgeGeometry(source, target, {
    ...channels,
    self: edge.self,
    terminal: edge.terminal,
    destinationless: edge.destinationless
  });
  const label = [flowEdgeLabel(edge), edge.actionType].filter(Boolean).join(" · ");
  const marker = edge.terminal ? "flow-return-arrow" : "flow-arrow";
  const edgeClass = edge.kind === "popup" ? "flow-edge-popup" : `flow-edge-${h(edge.style)}`;
  return `<g class="flow-edge ${edgeClass}"><title>${h(label)}</title><path d="${geometry.path}" marker-end="url(#${marker})"></path><text x="${geometry.labelX}" y="${geometry.labelY}" text-anchor="middle">${h(label)}</text></g>`;
}

function applyFlowZoom() {
  const canvas = elements["flow-canvas"];
  if (!canvas) return;
  canvas.className = `flow-canvas zoom-${state.flowZoom}`;
  elements["flow-zoom-reset"].textContent = `${state.flowZoom}%`;
  elements["flow-zoom-out"].disabled = state.flowZoom === 50;
  elements["flow-zoom-in"].disabled = state.flowZoom === 150;
}

function renderFlowFullscreenControl() {
  const button = elements["flow-fullscreen"];
  if (!button) return;
  const labelKey = state.flowFullscreen ? "canvas.exit_fullscreen" : "canvas.enter_fullscreen";
  button.setAttribute("aria-pressed", String(state.flowFullscreen));
  button.setAttribute("aria-label", t(labelKey));
  button.title = t(labelKey);
  button.dataset.i18nTitle = labelKey;
  button.dataset.i18nAriaLabel = labelKey;
}

function setFlowFullscreen(fullscreen) {
  if (state.flowFullscreen === fullscreen) return;
  const scrollLeft = elements["flow-scroll"].scrollLeft;
  const scrollTop = elements["flow-scroll"].scrollTop;
  state.flowFullscreen = fullscreen;
  elements["flow-canvas-panel"].classList.toggle("is-fullscreen", fullscreen);
  document.body.classList.toggle("flow-canvas-fullscreen", fullscreen);
  renderFlowFullscreenControl();
  requestAnimationFrame(() => {
    renderFlowCanvas();
    elements["flow-scroll"].scrollLeft = scrollLeft;
    elements["flow-scroll"].scrollTop = scrollTop;
  });
}

function handleFlowCanvasAction(event) {
  const fullscreenButton = event.target.closest("[data-flow-fullscreen]");
  if (fullscreenButton) {
    setFlowFullscreen(!state.flowFullscreen);
    return;
  }
  const zoomButton = event.target.closest("[data-flow-zoom]");
  if (zoomButton) {
    state.flowZoom = zoomButton.dataset.flowZoom === "reset"
      ? 100
      : stepFlowZoom(state.flowZoom, Number(zoomButton.dataset.flowZoom));
    applyFlowZoom();
    return;
  }
  const pageButton = event.target.closest("[data-canvas-page]");
  if (!pageButton) return;
  state.selectedModuleId = pageButton.dataset.canvasModule;
  state.selectedPageId = pageButton.dataset.canvasPage;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    state.selectedModuleId
  );
  renderOutline();
  renderEditor();
  elements["flow-canvas"].querySelectorAll(".flow-page-group").forEach((group) => {
    const selected = group.dataset.flowGroup === `${state.selectedModuleId}.${state.selectedPageId}`;
    group.classList.toggle("selected", selected);
    group.querySelector(".flow-page-heading")?.setAttribute("aria-pressed", String(selected));
  });
  renderInlineValidation();
}

function renderStatusTab() {
  const page = selectedPage();
  const actions = statusActions(page.status);
  const history = page.acceptance_history || [];
  elements["editor-content"].innerHTML = `
    <div class="editor-heading"><h2>${h(t("section.status"))}</h2><span class="task-pending-badge">${taskPendingGates(page).status}</span></div>
    <div class="status-view">
      <dl class="status-facts">
        ${fact(t("status.status"), t(`status.${page.status}`))}${fact(t("status.attempts"), page.attempts)}${fact(t("status.started"), page.started_at)}${fact(t("status.completed"), page.completed_at)}${fact(t("status.commit"), page.commit)}${fact(t("status.reason"), page.reason)}
      </dl>
      ${history.length > 0 ? `<section class="status-history"><h3>${h(t("status.acceptance_history"))}</h3><ol>${history.map((entry) => `<li><dl class="status-facts">${fact(t("status.commit"), entry.commit)}${fact(t("status.completed"), entry.completed_at)}${fact(t("status.superseded"), entry.superseded_at)}${fact(t("status.amendment_reason"), entry.amendment_reason)}</dl></li>`).join("")}</ol></section>` : ""}
      <div class="status-actions">${actions.map((action) => `<button type="button" data-status-action="${action}" class="${["fail", "block"].includes(action) ? "danger" : ""}">${h(t(`status.action.${action}`))}</button>`).join("") || `<span class="validation-summary">${h(t("status.no_actions"))}</span>`}</div>
    </div>`;
}

function renderValidation() {
  const count = state.issues.length;
  elements["validation-status"].hidden = count === 0;
  elements["issue-count"].textContent = String(count);
  elements["issue-count"].classList.toggle("has-errors", count > 0);
  elements["validation-summary"].textContent = t("validation.issue_count", { count });
}

function renderInlineValidation() {
  syncCurrentEditorCards();
  document.querySelectorAll(".inline-field-errors").forEach((element) => element.remove());
  document.querySelectorAll(".field-error").forEach((element) => {
    element.classList.remove("field-error");
    element.removeAttribute("aria-invalid");
    element.removeAttribute("aria-describedby");
  });
  const targets = [...document.querySelectorAll("[data-issue-path]")];
  const placements = placeIssues(editorDisplayIssues(state.issues), targets.map((element) => element.dataset.issuePath));
  let errorIndex = 0;
  for (const [path, issues] of placements) {
    const target = targets.find((element) => element.dataset.issuePath === path);
    if (!target) continue;
    const errorId = `inline-field-error-${errorIndex++}`;
    const errors = document.createElement("div");
    errors.id = errorId;
    errors.className = "inline-field-errors";
    errors.setAttribute("role", "alert");
    errors.innerHTML = issues.map((issue) => `<p>${h(localizeIssue(issue, state.locale))}</p>`).join("");
    target.classList.add("field-error");
    if (target.matches("input, select, textarea, fieldset")) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", errorId);
    }
    if (target.matches("input, select, textarea")) {
      target.insertAdjacentElement("afterend", errors);
    } else if (target.matches("fieldset")) {
      target.querySelector(":scope > legend")?.insertAdjacentElement("afterend", errors);
    } else {
      const heading = target.querySelector(":scope > .repeated-heading, :scope > .editor-card-header");
      if (heading) heading.insertAdjacentElement("afterend", errors);
      else target.insertAdjacentElement("afterbegin", errors);
    }
  }
}

function editorDisplayIssues(issues) {
  const module = selectedModule();
  const page = selectedPage();
  if (!module || !page) return issues;
  const collectionPath = `modules.${module.id}.pages.${page.id}.behaviors`;
  return issues
    .filter((issue) => issueLocation(issue.path).tab === state.activeTab)
    .map((issue) => ({
      ...issue,
      path: remapCollectionIssuePath(issue.path, collectionPath, page.behaviors)
    }));
}

function bindStaticEvents() {
  elements["language-switch"].addEventListener("click", (event) => {
    const button = event.target.closest("[data-locale]");
    if (button) setLocale(button.dataset.locale);
  });
  elements["reload-button"].addEventListener("click", () => loadSnapshot(true));
  elements["conflict-reload-button"].addEventListener("click", () => loadSnapshot(true));
  elements["validate-button"].addEventListener("click", () => validateDraft());
  elements["save-button"].addEventListener("click", saveDraft);
  elements["preview-button"].addEventListener("click", async () => {
    await validateDraft({ quiet: true });
    elements["yaml-preview"].textContent = state.yamlPreview;
    elements["preview-dialog"].showModal();
  });
  elements["shutdown-button"].addEventListener("click", shutdown);
  elements["add-module-button"].addEventListener("click", () => openAddDialog("module"));
  elements.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    renderEditor();
    renderInlineValidation();
  });
  elements["module-list"].addEventListener("click", handleOutlineAction);
  elements["editor-content"].addEventListener("click", handleEditorAction);
  elements["editor-content"].addEventListener("change", handleTaskStatusChange);
  elements["flow-canvas-panel"].addEventListener("click", handleFlowCanvasAction);
  elements["flow-panel-button"].addEventListener("click", () => setFlowFullscreen(true));
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.flowFullscreen || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    setFlowFullscreen(false);
  });
  elements["delivery-profile-input"].addEventListener("change", () => {
    if (!state.draft) return;
    state.draft.delivery.profile = elements["delivery-profile-input"].value;
    dirty();
  });
  elements["parallel-input"].addEventListener("change", () => {
    if (!state.draft) return;
    state.draft.execution.parallel = elements["parallel-input"].checked;
    dirty();
  });
  elements["max-parallel-input"].addEventListener("input", () => {
    if (!state.draft) return;
    state.draft.execution.max_parallel = Number(elements["max-parallel-input"].value);
    dirty();
  });
  elements["system-tab-bar-controller-input"].addEventListener("change", () => {
    if (!state.draft) return;
    state.draft.system_ui.tab_bar_controller = elements["system-tab-bar-controller-input"].checked;
    dirty();
  });
  elements["system-picker-input"].addEventListener("change", () => {
    if (!state.draft) return;
    state.draft.system_ui.picker = elements["system-picker-input"].checked;
    dirty();
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });
  elements["status-form"].addEventListener("submit", submitStatus);
  elements["add-item-form"].addEventListener("submit", submitAddItem);
  elements["copy-behavior-form"].addEventListener("submit", submitBehaviorCopy);
  elements["copy-behavior-pages"].addEventListener("change", updateBehaviorCopyControls);
  elements["copy-behavior-select-all"].addEventListener("click", () => setAllBehaviorCopyTargets(true));
  elements["copy-behavior-clear"].addEventListener("click", () => setAllBehaviorCopyTargets(false));
  elements["copy-behavior-dialog"].addEventListener("close", () => { state.pendingBehaviorCopy = null; });
  elements["amendment-confirm"].addEventListener("click", confirmAmendment);
  elements["amendment-dialog"].addEventListener("close", () => {
    if (state.pendingAmendment && !state.busy && !state.confirmingAmendment) {
      amendmentSave.cancel();
      state.pendingAmendment = null;
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function handleOutlineAction(event) {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.toggleModule) {
    state.expandedModuleIds = toggleOutlineModule(state.expandedModuleIds, target.dataset.toggleModule, state.selectedModuleId);
    renderOutline();
    return;
  }
  if (target.dataset.selectModule) selectModule(target.dataset.selectModule);
  if (target.dataset.selectPage) {
    state.selectedModuleId = target.dataset.pageModule;
    state.selectedPageId = target.dataset.selectPage;
    state.expandedModuleIds = reconcileOutlineExpansion(
      state.draft.modules.map((item) => item.id),
      state.expandedModuleIds,
      state.selectedModuleId
    );
    render();
  }
  if (target.dataset.addPageToModule) openAddDialog("page", target.dataset.addPageToModule);
  if (target.dataset.duplicateModule) duplicateModule(target.dataset.duplicateModule);
  if (target.dataset.deleteModule) deleteModule(target.dataset.deleteModule);
  if (target.dataset.duplicatePage) duplicatePage(target.dataset.pageModule, target.dataset.duplicatePage);
  if (target.dataset.deletePage) deletePage(target.dataset.pageModule, target.dataset.deletePage);
  if (target.dataset.moveModule) moveItem(state.draft.modules, Number(target.dataset.moveModule), Number(target.dataset.delta));
  if (target.dataset.movePage) {
    const owner = state.draft.modules.find((item) => item.id === target.dataset.pageModule);
    if (owner) moveItem(owner.pages, Number(target.dataset.movePage), Number(target.dataset.delta));
  }
}

function handleEditorAction(event) {
  const target = event.target.closest("button");
  if (!target) return;
  const page = selectedPage();
  if (target.dataset.toggleBehaviorCard !== undefined) {
    const index = Number(target.dataset.toggleBehaviorCard);
    const behavior = page.behaviors[index];
    state.expandedBehaviorCards = toggleEditorCard(state.expandedBehaviorCards, behavior);
    setEditorCardExpanded(target.closest(".editor-card"), state.expandedBehaviorCards.includes(behavior), "behavior", behavior, index);
    return;
  }
  if (target.dataset.toggleStateCard !== undefined) {
    const index = Number(target.dataset.toggleStateCard);
    const item = page.states[index];
    state.expandedStateCards = toggleEditorCard(state.expandedStateCards, item);
    setEditorCardExpanded(target.closest(".editor-card"), state.expandedStateCards.includes(item), "state", item, index);
    return;
  }
  if (target.dataset.copyBehavior !== undefined) {
    openBehaviorCopyDialog(Number(target.dataset.copyBehavior));
    return;
  }
  if (target.dataset.moveBehavior) moveItem(page.behaviors, Number(target.dataset.moveBehavior), Number(target.dataset.delta));
  if (target.dataset.deleteBehavior) { mutatePageTaskContracts(page, () => removeTaskAt(page, "behavior", Number(target.dataset.deleteBehavior))); dirty(true); }
  if (target.dataset.deleteMockDataSource) { removeMockDataSourceAt(state.draft, Number(target.dataset.deleteMockDataSource)); dirty(true); }
  if (target.dataset.deleteDataDependency) { page.data_dependencies.splice(Number(target.dataset.deleteDataDependency), 1); dirty(true); }
  if (target.dataset.addBehaviorAction) {
    const behavior = page.behaviors[Number(target.dataset.addBehaviorAction)];
    updateTaskContract(behavior, (task) => { task.actions ||= []; task.actions.push(createAction()); });
    dirty(true);
  }
  if (target.dataset.addNavigationBranch) {
    const [behaviorValue, addressValue] = target.dataset.addNavigationBranch.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    if (action?.branches) {
      updateTaskContract(behavior, () => action.branches.push(createNavigationBranch()));
      dirty(true);
    }
  }
  if (target.dataset.deleteNavigationBranch) {
    const [behaviorValue, addressValue, branchValue] = target.dataset.deleteNavigationBranch.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    if (action?.branches?.length > 2) {
      updateTaskContract(behavior, () => action.branches.splice(Number(branchValue), 1));
      dirty(true);
    }
  }
  if (target.dataset.addNavigationBranchParameter) {
    const [behaviorValue, addressValue, branchValue] = target.dataset.addNavigationBranchParameter.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const branch = actionAtAddress(behavior, parseActionAddress(addressValue))?.branches?.[Number(branchValue)];
    if (branch) {
      updateTaskContract(behavior, () => { branch.parameters ||= {}; branch.parameters[uniqueParameter(branch.parameters)] = ""; });
      dirty(true);
    }
  }
  if (target.dataset.deleteNavigationBranchParameter) {
    const [behaviorValue, addressValue, branchValue, parameterValue] = target.dataset.deleteNavigationBranchParameter.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const branch = actionAtAddress(behavior, parseActionAddress(addressValue))?.branches?.[Number(branchValue)];
    const parameterName = Object.keys(branch?.parameters || {})[Number(parameterValue)];
    if (branch && parameterName !== undefined) {
      updateTaskContract(behavior, () => { delete branch.parameters[parameterName]; });
      dirty(true);
    }
  }
  if (target.dataset.moveBehaviorAction) {
    const [behaviorIndex, actionIndex] = target.dataset.moveBehaviorAction.split(":").map(Number);
    updateTaskContract(page.behaviors[behaviorIndex], (task) => moveAction(task, actionIndex, Number(target.dataset.delta)));
    dirty(true);
  }
  if (target.dataset.deleteBehaviorAction) {
    const [behaviorIndex, actionIndex] = target.dataset.deleteBehaviorAction.split(":").map(Number);
    updateTaskContract(page.behaviors[behaviorIndex], (task) => removeActionAt(task, actionIndex));
    dirty(true);
  }
  if (target.dataset.addPopupCallbackAction) {
    const [behaviorValue, addressValue, buttonValue] = target.dataset.addPopupCallbackAction.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    updateTaskContract(behavior, () => {
      const action = actionAtAddress(behavior, parseActionAddress(addressValue));
      if (!action || !reconcileActionBindings(action)) return;
      action.buttons[Number(buttonValue)].callback.actions ||= [];
      action.buttons[Number(buttonValue)].callback.actions.push(createAction());
    });
    dirty(true);
  }
  if (target.dataset.moveNestedAction) {
    const [behaviorValue, addressValue] = target.dataset.moveNestedAction.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const address = parseActionAddress(addressValue);
    const parent = actionAtAddress(behavior, address.slice(0, -2));
    const actions = parent?.buttons?.[address.at(-2)]?.callback?.actions;
    updateTaskContract(behavior, () => moveAction({ actions }, address.at(-1), Number(target.dataset.delta)));
    dirty(true);
  }
  if (target.dataset.deleteNestedAction) {
    const [behaviorValue, addressValue] = target.dataset.deleteNestedAction.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const address = parseActionAddress(addressValue);
    const parent = actionAtAddress(behavior, address.slice(0, -2));
    const actions = parent?.buttons?.[address.at(-2)]?.callback?.actions;
    updateTaskContract(behavior, () => removeActionAt({ actions }, address.at(-1)));
    dirty(true);
  }
  if (target.dataset.addNestedActionParameter) {
    const [behaviorValue, addressValue] = target.dataset.addNestedActionParameter.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    if (action) {
      updateTaskContract(behavior, () => { action.parameters ||= {}; action.parameters[uniqueParameter(action.parameters)] = ""; });
      dirty(true);
    }
  }
  if (target.dataset.deleteNestedActionParameter) {
    const [behaviorValue, addressValue, parameterValue] = target.dataset.deleteNestedActionParameter.split("|");
    const behavior = page.behaviors[Number(behaviorValue)];
    const action = actionAtAddress(behavior, parseActionAddress(addressValue));
    const parameterName = Object.keys(action?.parameters || {})[Number(parameterValue)];
    if (action && parameterName !== undefined) {
      updateTaskContract(behavior, () => { delete action.parameters[parameterName]; });
      dirty(true);
    }
  }
  if (target.dataset.addBehaviorActionParameter) {
    const [behaviorIndex, actionIndex] = target.dataset.addBehaviorActionParameter.split(":").map(Number);
    const action = page.behaviors[behaviorIndex].actions[actionIndex];
    updateTaskContract(page.behaviors[behaviorIndex], () => { action.parameters ||= {}; action.parameters[uniqueParameter(action.parameters)] = ""; });
    dirty(true);
  }
  if (target.dataset.deleteBehaviorActionParameter) {
    const [behaviorIndex, actionIndex, parameterIndex] = target.dataset.deleteBehaviorActionParameter.split(":").map(Number);
    const parameters = page.behaviors[behaviorIndex].actions[actionIndex].parameters;
    updateTaskContract(page.behaviors[behaviorIndex], () => { delete parameters[Object.keys(parameters)[parameterIndex]]; });
    dirty(true);
  }
  if (target.id === "add-popup-button") {
    mutatePageTaskContracts(page, () => {
      page.popup.buttons.push({ id: uniqueId(page.popup.buttons, "button") });
    });
    dirty(true);
  }
  if (target.dataset.movePopupButton) {
    mutatePageTaskContracts(page, () => moveItem(page.popup.buttons, Number(target.dataset.movePopupButton), Number(target.dataset.delta)));
    dirty(true);
  }
  if (target.dataset.deletePopupButton) {
    mutatePageTaskContracts(page, () => page.popup.buttons.splice(Number(target.dataset.deletePopupButton), 1));
    dirty(true);
  }
  if (target.dataset.moveState) moveItem(page.states, Number(target.dataset.moveState), Number(target.dataset.delta));
  if (target.dataset.deleteState) { mutatePageTaskContracts(page, () => removeTaskAt(page, "state", Number(target.dataset.deleteState))); dirty(true); }
  if (target.dataset.restoreTask) {
    const [kind, id] = target.dataset.restoreTask.split(":");
    restoreTask(page, kind, id, () => dirty(true));
  }
  if (target.dataset.statusAction) openStatus(target.dataset.statusAction);
  if (target.id === "add-behavior" || target.id === "add-state") return;
  bindBehaviorParameterEdits();
}

function handleTaskStatusChange(event) {
  const select = event.target.closest("[data-task-status-select]");
  if (!select) return;
  const [kind, key] = select.dataset.taskStatusSelect.split(":");
  const page = selectedPage();
  const removed = select.hasAttribute("data-removed-status");
  const task = removed
    ? (page.removed_tasks || []).find((item) => item.kind === kind && item.id === key)
    : kind === "popup" ? page.popup : page[kind === "state" ? "states" : "behaviors"]?.[Number(key)];
  if (!task) return;
  if (removed) setRemovedTaskStatus(page, kind, key, select.value, () => dirty(true));
  else {
    task.implementation_status = select.value;
    dirty(true);
  }
}

function addModule(title) {
  const id = uniqueId(state.draft.modules, slugify(title));
  state.draft.modules.push(createModule({ id, title }));
  state.selectedModuleId = id;
  state.selectedPageId = null;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    id
  );
  dirty(true);
}

function addPage(title, moduleId = state.selectedModuleId) {
  const module = state.draft.modules.find((item) => item.id === moduleId);
  if (!module) return;
  const id = uniqueId(module.pages, slugify(title));
  const page = createPage({ id, title });
  page.states.push(createState({ id: "default", title: "Default" }));
  module.pages.push(page);
  reconcileModuleEntryPage(module);
  state.selectedModuleId = module.id;
  state.selectedPageId = id;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    module.id
  );
  dirty(true);
}

function openAddDialog(kind, moduleId = null) {
  state.addPageModuleId = kind === "page" ? moduleId : null;
  elements["add-item-kind"].value = kind;
  const module = state.draft?.modules.find((item) => item.id === state.addPageModuleId);
  elements["add-item-title"].textContent = kind === "module"
    ? t("action.add_module")
    : t("action.add_page_to_module", { name: module?.title || module?.id || "" });
  elements["add-item-name"].value = "";
  elements["add-item-dialog"].showModal();
  elements["add-item-name"].focus();
}

function submitAddItem(event) {
  event.preventDefault();
  const title = elements["add-item-name"].value.trim();
  if (!title) return;
  if (elements["add-item-kind"].value === "module") addModule(title);
  else addPage(title, state.addPageModuleId);
  elements["add-item-dialog"].close();
  state.addPageModuleId = null;
}

function openBehaviorCopyDialog(index) {
  const sourceModule = selectedModule();
  const sourcePage = selectedPage();
  const sourceBehavior = sourcePage?.behaviors[index];
  if (!sourceModule || !sourcePage || !sourceBehavior) return;

  state.pendingBehaviorCopy = { sourcePage, sourceBehavior };
  elements["copy-behavior-pages"].innerHTML = state.draft.modules.map((module) => {
    const pages = (module.pages || []).filter((page) => page !== sourcePage);
    if (pages.length === 0) return "";
    return `<fieldset class="copy-behavior-module">
      <legend>${h(module.title || module.id)}</legend>
      <div class="copy-behavior-page-list">${pages.map((page) => `<label class="copy-behavior-page">
        <input type="checkbox" data-copy-behavior-target data-copy-behavior-target-module="${h(module.id)}" data-copy-behavior-target-page="${h(page.id)}">
        <span>${h(page.title || page.id)}</span>
      </label>`).join("")}</div>
    </fieldset>`;
  }).join("");
  updateBehaviorCopyControls();
  elements["copy-behavior-dialog"].showModal();
  elements["copy-behavior-pages"].querySelector("[data-copy-behavior-target]")?.focus();
}

function behaviorCopyTargets() {
  return [...elements["copy-behavior-pages"].querySelectorAll("[data-copy-behavior-target]")];
}

function updateBehaviorCopyControls() {
  const targets = behaviorCopyTargets();
  const selectedCount = targets.filter((input) => input.checked).length;
  elements["copy-behavior-confirm"].disabled = selectedCount === 0;
  elements["copy-behavior-select-all"].disabled = targets.length === 0 || selectedCount === targets.length;
  elements["copy-behavior-clear"].disabled = selectedCount === 0;
}

function setAllBehaviorCopyTargets(checked) {
  for (const input of behaviorCopyTargets()) input.checked = checked;
  updateBehaviorCopyControls();
}

function submitBehaviorCopy(event) {
  event.preventDefault();
  const pending = state.pendingBehaviorCopy;
  if (!pending) return;
  const destinations = behaviorCopyTargets()
    .filter((input) => input.checked)
    .map((input) => ({
      moduleId: input.dataset.copyBehaviorTargetModule,
      pageId: input.dataset.copyBehaviorTargetPage
    }));
  const copies = copyBehaviorToPages(state.draft, pending.sourcePage, pending.sourceBehavior, destinations);
  if (copies.length === 0) return;

  elements["copy-behavior-dialog"].close();
  toast(t("message.behavior_copied", { count: copies.length }));
  dirty(true);
}

function duplicateModule(id) {
  const source = state.draft.modules.find((item) => item.id === id);
  const copy = cloneDraft(source);
  const nextId = uniqueId(state.draft.modules, `${source.id}-copy`);
  for (const page of copy.pages) {
    for (const behavior of page.behaviors || []) {
      for (const { action } of walkActions(behavior.actions || [])) {
        if (action.type === "navigate") {
          for (const route of navigationRoutes(action)) {
            if (route.destination?.startsWith(`${source.id}.`)) {
              route.destination = `${nextId}.${route.destination.slice(source.id.length + 1)}`;
            }
          }
        } else if (action.type === "present_popup" && action.destination?.startsWith(`${source.id}.`)) {
          action.destination = `${nextId}.${action.destination.slice(source.id.length + 1)}`;
        }
      }
    }
  }
  copy.id = nextId;
  copy.title = `${source.title} Copy`;
  state.draft.modules.push(copy);
  selectModule(nextId);
  dirty(true);
}

function duplicatePage(moduleId, id) {
  const module = state.draft.modules.find((item) => item.id === moduleId);
  if (!module) return;
  const source = module.pages.find((item) => item.id === id);
  const copy = cloneDraft(source);
  copy.id = uniqueId(module.pages, `${source.id}-copy`);
  copy.title = `${source.title} Copy`;
  copy.status = "todo";
  copy.attempts = 0;
  copy.commit = copy.reason = copy.started_at = copy.completed_at = null;
  copy.acceptance_history = [];
  module.pages.push(copy);
  reconcileModuleEntryPage(module);
  state.selectedModuleId = module.id;
  state.selectedPageId = copy.id;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    module.id
  );
  dirty(true);
}

function deleteModule(id) {
  const module = state.draft.modules.find((item) => item.id === id);
  const targets = new Set(module.pages.map((page) => `${id}.${page.id}`));
  const references = [...targets].flatMap((target) => incomingRoutes(state.draft, target)).filter((route) => route.sourceModuleId !== id);
  if (references.length) return alert(t("message.incoming_module"));
  if (!confirm(t("message.delete_module", { name: module.title }))) return;
  state.draft.modules.splice(state.draft.modules.indexOf(module), 1);
  selectModule(state.draft.modules[0]?.id || null);
  dirty(true);
}

function deletePage(moduleId, id) {
  const module = state.draft.modules.find((item) => item.id === moduleId);
  if (!module) return;
  const references = incomingRoutes(state.draft, `${module.id}.${id}`);
  if (references.length) return alert(t("message.incoming_page"));
  const page = module.pages.find((item) => item.id === id);
  if (!confirm(t("message.delete_page", { name: page.title }))) return;
  module.pages.splice(module.pages.indexOf(page), 1);
  reconcileModuleEntryPage(module);
  state.selectedModuleId = module.id;
  state.selectedPageId = module.pages[0]?.id || null;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    module.id
  );
  dirty(true);
}

function renameModule(module, proposed) {
  const next = slugify(proposed);
  if (state.draft.modules.some((item) => item !== module && item.id === next)) return alert(t("message.module_id_exists"));
  const previous = module.id;
  for (const owner of state.draft.modules) for (const page of owner.pages) for (const behavior of page.behaviors || []) {
    for (const { action } of walkActions(behavior.actions || [])) {
      if (action.type === "navigate") {
        for (const route of navigationRoutes(action)) {
          if (route.destination?.startsWith(`${previous}.`)) {
            route.destination = `${next}.${route.destination.slice(previous.length + 1)}`;
          }
        }
      } else if (action.type === "present_popup" && action.destination?.startsWith(`${previous}.`)) {
        action.destination = `${next}.${action.destination.slice(previous.length + 1)}`;
      }
    }
  }
  module.id = next;
  state.selectedModuleId = next;
  state.expandedModuleIds = state.expandedModuleIds.map((id) => id === previous ? next : id);
  dirty(true);
}

function renamePage(module, page, proposed) {
  const next = slugify(proposed);
  if (module.pages.some((item) => item !== page && item.id === next)) return alert(t("message.page_id_exists"));
  const previous = page.id;
  const previousDestination = `${module.id}.${previous}`;
  const nextDestination = `${module.id}.${next}`;
  retargetPageReferences(state.draft, previousDestination, nextDestination);
  page.id = next;
  if (module.entry_page === previous) module.entry_page = next;
  state.selectedPageId = next;
  dirty(true);
}

function selectModule(id) {
  state.selectedModuleId = id;
  state.selectedPageId = state.draft.modules.find((item) => item.id === id)?.pages[0]?.id || null;
  state.expandedModuleIds = reconcileOutlineExpansion(
    state.draft.modules.map((item) => item.id),
    state.expandedModuleIds,
    id
  );
  render();
}

function moveItem(items, index, delta) {
  const destination = index + delta;
  if (destination < 0 || destination >= items.length) return;
  [items[index], items[destination]] = [items[destination], items[index]];
  dirty(true);
}

function openStatus(action) {
  if (state.dirty) return alert(t("message.save_before_status"));
  elements["status-action"].value = action;
  elements["status-dialog-title"].textContent = t(`status.action.${action}`);
  elements["status-reason"].value = "";
  elements["status-commit"].value = "";
  elements["status-reason-row"].hidden = !["fail", "block", "requeue", "amend"].includes(action);
  elements["status-commit-row"].hidden = action !== "complete";
  elements["status-reason"].required = ["fail", "block", "requeue", "amend"].includes(action);
  elements["status-dialog"].showModal();
}

async function submitStatus(event) {
  event.preventDefault();
  const action = elements["status-action"].value;
  const module = selectedModule();
  const page = selectedPage();
  elements["status-dialog"].close();
  await withBusy(async () => {
    const { response, payload } = await api("/api/status", {
      method: "POST",
      body: {
        action,
        module_id: module.id,
        page_id: page.id,
        expected_revision: state.snapshot.revision,
        reason: elements["status-reason"].value || null,
        commit: elements["status-commit"].value || null
      }
    });
    if (response.status === 409) {
      state.conflict = true;
      renderChrome();
      return toast(t("message.disk_changed_status"));
    }
    if (!response.ok) return toast(localizedServerError(payload.error?.message, "message.status_failed"));
    acceptSnapshot(payload.snapshot);
    render();
    toast(t("message.status_updated", { action: t(`status.action.${action}`) }));
  });
}

async function shutdown() {
  if (state.dirty && !confirm(t("message.confirm_stop"))) return;
  const { response, payload } = await api("/api/shutdown", { method: "POST", body: {} });
  if (!response.ok) return toast(localizedServerError(payload.error?.message, "message.stop_failed"));
  document.body.innerHTML = `<main class="empty-state"><h2>${h(t("message.stopped"))}</h2></main>`;
}

function revealIssue(issue) {
  const location = issueLocation(issue.path);
  const module = location.moduleId
    ? state.draft.modules.find((item) => item.id === location.moduleId)
    : selectedModule();
  if (module) {
    state.selectedModuleId = module.id;
    const page = location.pageId
      ? module.pages.find((item) => item.id === location.pageId)
      : module.pages.find((item) => item.id === state.selectedPageId) || module.pages[0];
    state.selectedPageId = page?.id || null;
    state.expandedModuleIds = reconcileOutlineExpansion(
      state.draft.modules.map((item) => item.id),
      state.expandedModuleIds,
      module.id
    );
  }
  state.activeTab = location.tab;
  renderOutline();
  renderEditor();
  renderInlineValidation();
  requestAnimationFrame(() => {
    const targets = [...document.querySelectorAll("[data-issue-path]")];
    const targetPath = placeIssues(editorDisplayIssues([issue]), targets.map((element) => element.dataset.issuePath)).keys().next().value;
    const target = targets.find((element) => element.dataset.issuePath === targetPath);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = target.matches("input, select, textarea, button")
      ? target
      : target.querySelector("input, select, textarea, button");
    if (focusTarget) focusTarget.focus();
    else {
      target.tabIndex = -1;
      target.focus();
    }
  });
}

function selectedModule() {
  return state.draft?.modules.find((item) => item.id === state.selectedModuleId) || null;
}

function selectedPage() {
  return selectedModule()?.pages.find((item) => item.id === state.selectedPageId) || null;
}

function dirty(rerender = false) {
  clearPendingAmendment({ state, coordinator: amendmentSave, autoSave });
  state.dirty = true;
  autoSave.changed();
  if (state.conflict || state.snapshot?.comment_warning) autoSave.pause();
  if (rerender) render();
  else {
    renderChrome();
    scheduleFlowCanvasRender();
  }
}

let flowRenderTimer;
function scheduleFlowCanvasRender() {
  clearTimeout(flowRenderTimer);
  flowRenderTimer = setTimeout(() => {
    if (state.draft) renderFlowCanvas();
  }, 180);
}

async function withBusy(operation) {
  if (state.busy) return;
  state.busy = true;
  renderChrome();
  try {
    await operation();
  } catch (error) {
    toast(error.message || t("message.operation_failed"));
  } finally {
    state.busy = false;
    renderChrome();
    elements.app.setAttribute("aria-busy", "false");
  }
}

function bindInput(id, update) {
  document.getElementById(id)?.addEventListener("input", (event) => update(event.target.value));
}

function bindChange(id, update) {
  document.getElementById(id)?.addEventListener("change", (event) => update(event.target.value));
}

function field(label, id, value, issuePath, type = "text", className = "") {
  return `<label class="${className}"><span>${h(label)}</span><input id="${h(id)}" type="${h(type)}" value="${h(value ?? "")}" data-issue-path="${h(issuePath)}"></label>`;
}

function fact(label, value) {
  return `<div class="status-fact"><dt>${h(label)}</dt><dd>${h(value ?? "-")}</dd></div>`;
}

function orderButtons(kind, index, length, moduleId = null) {
  const item = t(`item.${kind}`);
  const moveUp = t("action.move_up", { item });
  const moveDown = t("action.move_down", { item });
  const owner = kind === "page" && moduleId ? ` data-page-module="${h(moduleId)}"` : "";
  return `<button class="mini-button" type="button" data-move-${kind}="${index}" data-delta="-1"${owner} ${index === 0 ? "disabled" : ""} title="${h(moveUp)}" aria-label="${h(moveUp)}">&uarr;</button><button class="mini-button" type="button" data-move-${kind}="${index}" data-delta="1"${owner} ${index === length - 1 ? "disabled" : ""} title="${h(moveDown)}" aria-label="${h(moveDown)}">&darr;</button>`;
}

function actionOrderButtons(behaviorIndex, actionIndex, length) {
  const item = t("item.action");
  const moveUp = t("action.move_up", { item });
  const moveDown = t("action.move_down", { item });
  const value = `${behaviorIndex}:${actionIndex}`;
  return `<button class="mini-button" type="button" data-move-behavior-action="${value}" data-delta="-1" ${actionIndex === 0 ? "disabled" : ""} title="${h(moveUp)}" aria-label="${h(moveUp)}">&uarr;</button><button class="mini-button" type="button" data-move-behavior-action="${value}" data-delta="1" ${actionIndex === length - 1 ? "disabled" : ""} title="${h(moveDown)}" aria-label="${h(moveDown)}">&darr;</button>`;
}

function nestedActionOrderButtons(behaviorIndex, address, actionIndex, length) {
  const item = t("item.action");
  const value = `${behaviorIndex}|${address.join(".")}`;
  const up = t("action.move_up", { item });
  const down = t("action.move_down", { item });
  return `<button class="mini-button" type="button" data-move-nested-action="${h(value)}" data-delta="-1" ${actionIndex === 0 ? "disabled" : ""} title="${h(up)}" aria-label="${h(up)}">&uarr;</button><button class="mini-button" type="button" data-move-nested-action="${h(value)}" data-delta="1" ${actionIndex === length - 1 ? "disabled" : ""} title="${h(down)}" aria-label="${h(down)}">&darr;</button>`;
}

function uniqueId(items, base) {
  const used = new Set(items.map((item) => item.id));
  let candidate = slugify(base);
  let suffix = 2;
  while (used.has(candidate)) candidate = `${slugify(base)}-${suffix++}`;
  return candidate;
}

function uniqueParameter(parameters) {
  let candidate = "parameter";
  let suffix = 2;
  while (Object.hasOwn(parameters, candidate)) candidate = `parameter${suffix++}`;
  return candidate;
}

function titleize(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readStoredLocale() {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLocale(locale) {
  state.locale = resolveLocale(locale);
  i18n = createI18n(state.locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
  } catch {
    // The editor remains usable when storage is unavailable.
  }
  applyStaticTranslations();
  if (state.draft) render();
  const statusAction = elements["status-action"].value;
  if (statusAction) elements["status-dialog-title"].textContent = t(`status.action.${statusAction}`);
  const itemKind = elements["add-item-kind"].value;
  if (itemKind === "module") elements["add-item-title"].textContent = t("action.add_module");
  if (itemKind === "page") {
    const module = state.draft?.modules.find((item) => item.id === state.addPageModuleId);
    elements["add-item-title"].textContent = t("action.add_page_to_module", { name: module?.title || module?.id || "" });
  }
}

function applyStaticTranslations() {
  document.documentElement.lang = state.locale;
  document.title = t("document.title");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  elements["language-switch"]?.querySelectorAll("[data-locale]").forEach((button) => {
    button.setAttribute("aria-pressed", String(resolveLocale(button.dataset.locale) === state.locale));
  });
  renderFlowFullscreenControl();
}

function localizedServerError(message, fallbackKey) {
  const fallback = t(fallbackKey);
  if (!message || message === fallback || state.locale === "en") return message || fallback;
  return `${fallback}\n${message}`;
}

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3600);
}

function fatal(message) {
  elements["editor-content"].innerHTML = `<div class="empty-state">${h(message)}</div>`;
  elements.app.setAttribute("aria-busy", "false");
}
