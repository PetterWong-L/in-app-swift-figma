import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFlowGraph,
  canonicalPageId,
  changeActionType,
  changeBehaviorType,
  cloneDraft,
  collectionIssuePath,
  copyBehaviorToPages,
  createAutoSaveCoordinator,
  createAction,
  createBehavior,
  createDataDependency,
  createModule,
  createMockDataSource,
  createPage,
  createState,
  entryPageCandidates,
  pageChangeFor,
  pageChangesFor,
  figmaEmbedUrl,
  incomingRoutes,
  indexDestinations,
  issueLocation,
  placeIssues,
  issuesByPath,
  layoutFlowGraph,
  flowEdgeChannels,
  flowEdgeGeometry,
  flowEdgeLabel,
  formatListInput,
  parseListInput,
  removeBehaviorAt,
  removeTaskAt,
  removeActionAt,
  removeMockDataSourceAt,
  removeStateAt,
  restoreRemovedTask,
  retargetBehaviorReferences,
  retargetMockDataSourceReferences,
  retargetStateReferences,
  reconcileModuleEntryPage,
  moveAction,
  mutatePageTaskContracts,
  navigationFields,
  slugify,
  stepFlowZoom,
  statusActions,
  swiftPageArtifacts,
  taskChangeFor,
  taskCounts,
  updateTaskContract
} from "../scripts/editor/model.mjs";

test("copying a behavior to pages deep clones it with target-local ids", () => {
  const sourceBehavior = {
    id: "submit",
    type: "interaction",
    target: "submit-button",
    implementation_status: "done",
    trigger: { event: "tap" },
    actions: [{ type: "navigate", style: "push", destination: "account.details", parameters: { item: "selected.id" } }],
    run_policy: "every_time"
  };
  const sourcePage = { id: "home", behaviors: [sourceBehavior] };
  const firstTarget = {
    id: "details",
    behaviors: [{ id: "submit-copy", type: "scroll", target: "content", implementation_status: "done" }]
  };
  const secondTarget = { id: "history", behaviors: [] };
  const config = {
    modules: [
      { id: "account", pages: [sourcePage, firstTarget] },
      { id: "activity", pages: [secondTarget] }
    ]
  };

  const copies = copyBehaviorToPages(config, sourcePage, sourceBehavior, [
    { moduleId: "account", pageId: "home" },
    { moduleId: "account", pageId: "details" },
    { moduleId: "activity", pageId: "history" },
    { moduleId: "activity", pageId: "history" },
    { moduleId: "missing", pageId: "unknown" }
  ]);

  assert.deepEqual(copies.map(({ moduleId, pageId, behavior }) => ({ moduleId, pageId, id: behavior.id })), [
    { moduleId: "account", pageId: "details", id: "submit-copy-2" },
    { moduleId: "activity", pageId: "history", id: "submit-copy" }
  ]);
  assert.equal(firstTarget.behaviors[1].implementation_status, "todo");
  assert.equal(secondTarget.behaviors[0].implementation_status, "todo");
  assert.deepEqual(firstTarget.behaviors[1].actions, sourceBehavior.actions);
  assert.notEqual(firstTarget.behaviors[1], sourceBehavior);
  assert.notEqual(firstTarget.behaviors[1].actions, sourceBehavior.actions);
  firstTarget.behaviors[1].actions[0].parameters.item = "changed.id";
  assert.equal(sourceBehavior.actions[0].parameters.item, "selected.id");
  assert.equal(secondTarget.behaviors.length, 1);
  assert.equal(sourceBehavior.implementation_status, "done");
});

test("auto-save debounces edits and saves only the latest version", async () => {
  const timers = controlledTimers();
  const versions = [];
  const autoSave = createAutoSaveCoordinator({
    delay: 800,
    save: async (version) => { versions.push(version); return "saved"; },
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear
  });

  autoSave.changed();
  autoSave.changed();

  assert.deepEqual(timers.delays(), [800]);
  await timers.runNext();
  assert.deepEqual(versions, [2]);
  assert.equal(autoSave.version, 2);
});

test("auto-save follows an in-flight save with the newer edit version", async () => {
  const timers = controlledTimers();
  const firstSave = deferred();
  const versions = [];
  const autoSave = createAutoSaveCoordinator({
    save: async (version) => {
      versions.push(version);
      if (version === 1) return firstSave.promise;
      return "saved";
    },
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear
  });

  autoSave.changed();
  const saving = timers.runNext();
  autoSave.changed();
  assert.equal(timers.size, 0);

  firstSave.resolve("saved");
  await saving;
  assert.equal(timers.size, 1);
  await timers.runNext();
  assert.deepEqual(versions, [1, 2]);
});

test("auto-save remains paused after a conflict until explicitly resumed", async () => {
  const timers = controlledTimers();
  let outcome = "pause";
  const versions = [];
  const autoSave = createAutoSaveCoordinator({
    save: async (version) => { versions.push(version); return outcome; },
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear
  });

  autoSave.changed();
  await timers.runNext();
  assert.equal(autoSave.paused, true);

  autoSave.changed();
  assert.equal(timers.size, 0);
  outcome = "saved";
  autoSave.resume();
  await timers.runNext();
  assert.deepEqual(versions, [1, 2]);
});

test("slugify creates schema-safe identifiers", () => {
  assert.equal(slugify("Account Security"), "account-security");
  assert.equal(slugify("  Éxample / Page_A  "), "example-page-a");
  assert.equal(slugify("---"), "item");
});

test("page factory includes lifecycle and unified behavior defaults", () => {
  assert.deepEqual(createPage({ id: "page-a", title: "Page A" }), {
    id: "page-a",
    title: "Page A",
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
    states: []
  });
});

test("module entry page candidates include only screen pages", () => {
  const screen = createPage({ id: "home", title: "Home" });
  const popup = createPage({ id: "confirmation", title: "Confirmation", page_role: "popup" });

  assert.deepEqual(entryPageCandidates({ pages: [screen, popup] }), [screen]);
});

test("module entry page follows page role changes", () => {
  const first = createPage({ id: "home", title: "Home" });
  const second = createPage({ id: "details", title: "Details" });
  const popup = createPage({ id: "confirmation", title: "Confirmation", page_role: "popup" });
  const module = createModule({ entry_page: "home", pages: [first, second, popup] });

  module.pages[0].page_role = "popup";
  reconcileModuleEntryPage(module);
  assert.equal(module.entry_page, "details");

  module.pages[1].page_role = "popup";
  reconcileModuleEntryPage(module);
  assert.equal(module.entry_page, null);

  module.pages[2].page_role = "screen";
  reconcileModuleEntryPage(module);
  assert.equal(module.entry_page, "confirmation");
});

test("task factories start as pending implementation work", () => {
  assert.equal(createState().implementation_status, "todo");
  assert.equal(createBehavior().implementation_status, "todo");
});

test("editing a done task reopens only that task", () => {
  const page = createPage({ states: [createState({ id: "default", implementation_status: "done" })] });
  updateTaskContract(page.states[0], (item) => { item.title = "Updated"; });
  assert.equal(page.states[0].implementation_status, "todo");
});

test("editing a done task reopens it despite a simultaneous status change", () => {
  const state = createState({ id: "default", implementation_status: "done" });
  updateTaskContract(state, (item) => {
    item.title = "Updated";
    item.implementation_status = "in_progress";
  });
  assert.equal(state.implementation_status, "todo");

  const secondState = createState({ id: "second", implementation_status: "done" });
  updateTaskContract(secondState, (item) => {
    item.title = "Updated again";
    item.implementation_status = "done";
  });
  assert.equal(secondState.implementation_status, "todo");
});

test("task status changes do not reopen or mutate the task contract", () => {
  const state = createState({ id: "default", implementation_status: "done" });
  updateTaskContract(state, (item) => { item.implementation_status = "in_progress"; });
  assert.equal(state.implementation_status, "in_progress");
  updateTaskContract(state, (item) => { item.implementation_status = "done"; });
  assert.equal(state.implementation_status, "done");
});

test("removing and restoring an accepted behavior maintains removal work", () => {
  const page = completedPageFixture();
  removeTaskAt(page, "behavior", 0);
  assert.deepEqual(page.removed_tasks, [{ kind: "behavior", id: "open-details", implementation_status: "todo" }]);
  restoreRemovedTask(page, "behavior", "open-details");
  assert.equal(page.removed_tasks.length, 0);
  assert.deepEqual(page.behaviors[0], {
    id: "open-details",
    type: "interaction",
    target: "details_button",
    trigger: { event: "tap" },
    actions: [],
    run_policy: "once_per_instance",
    implementation_status: "todo"
  });
});

test("removing an unaccepted task preserves reference cleanup without a removal", () => {
  const page = createPage({
    states: [createState({ id: "loading" })],
    behaviors: [createBehavior({ id: "show-loading", type: "interaction", state_change: "loading" })]
  });
  removeTaskAt(page, "state", 0);
  assert.deepEqual(page.states, []);
  assert.deepEqual(page.behaviors, []);
  assert.deepEqual(page.removed_tasks, []);
});

test("task counts include active and removed work that is not done", () => {
  const page = createPage({
    states: [createState({ id: "default", implementation_status: "done" })],
    behaviors: [createBehavior({ id: "open", implementation_status: "in_progress" })],
    removed_tasks: [
      { kind: "state", id: "loading", implementation_status: "todo" },
      { kind: "behavior", id: "retired", implementation_status: "done" }
    ]
  });
  assert.deepEqual(taskCounts(page), { total: 4, pending: 2 });
});

test("page-wide task mutations reopen linked done consumers", () => {
  const page = completedPageFixture();
  page.behaviors.push(createBehavior({
    id: "listener", type: "interaction", states: ["default"], state_change: "default", implementation_status: "done"
  }));
  page.accepted_baseline.behaviors.push(structuredClone(page.behaviors[1]));

  mutatePageTaskContracts(page, () => retargetStateReferences(page, "default", "ready"));

  assert.equal(page.behaviors[1].implementation_status, "todo");
  assert.equal(page.states[0].implementation_status, "done");
});

test("page-wide task removals record cascading accepted work once", () => {
  const page = completedPageFixture();
  page.behaviors[0].state_change = "default";
  page.behaviors[0].actions = [];
  page.accepted_baseline.behaviors[0] = structuredClone(page.behaviors[0]);

  mutatePageTaskContracts(page, () => removeTaskAt(page, "state", 0));

  assert.deepEqual(page.removed_tasks, [
    { kind: "state", id: "default", implementation_status: "todo" },
    { kind: "behavior", id: "open-details", implementation_status: "todo" }
  ]);
  assert.deepEqual(taskCounts(page), { total: 2, pending: 2 });
});

test("page diff helpers use the canonical module page key", () => {
  const changesByPage = {
    "account.settings": {
      page: "account.settings",
      states: [{ kind: "state", id: "loading", change: "modified" }],
      behaviors: []
    }
  };
  assert.equal(canonicalPageId("account", "settings"), "account.settings");
  const changes = pageChangesFor(changesByPage, "account", "settings");
  assert.equal(pageChangeFor({ changes_by_page: changesByPage }, "account", "settings"), changes);
  assert.deepEqual(taskChangeFor(changes, "state", "loading"), { kind: "state", id: "loading", change: "modified" });
  assert.equal(taskChangeFor(changes, "behavior", "open"), null);
});

test("completed pages expose only the incremental amendment action", () => {
  assert.deepEqual(statusActions("done"), ["amend"]);
  assert.deepEqual(statusActions("in_progress"), ["complete", "fail", "block", "requeue"]);
  assert.deepEqual(statusActions("todo"), ["claim"]);
});

test("mock data factories create isolated shared source contracts", () => {
  assert.deepEqual(createMockDataSource(), {
    id: "new-data-source",
    swift_type: "DataModel",
    fixture: "standard"
  });
  assert.deepEqual(createDataDependency(), {
    source: "",
    access: "read_only"
  });

  const first = createPage({ data_dependencies: [{ source: "today-session", access: "read_write" }] });
  const second = createPage({ data_dependencies: [{ source: "today-session", access: "read_only" }] });
  first.data_dependencies[0].source = "changed";
  assert.equal(second.data_dependencies[0].source, "today-session");
});

test("mock data source references follow rename and are removed with their source", () => {
  const config = {
    mock_data_sources: [createMockDataSource({ id: "today-session", swift_type: "TodaySession" })],
    modules: [{ pages: [
      createPage({ data_dependencies: [{ source: "today-session", access: "read_write" }] }),
      createPage({ data_dependencies: [{ source: "today-session", access: "read_only" }] })
    ] }]
  };

  config.mock_data_sources[0].id = "shared-session";
  retargetMockDataSourceReferences(config, "today-session", "shared-session");
  assert.deepEqual(config.modules[0].pages.map((page) => page.data_dependencies[0].source), [
    "shared-session", "shared-session"
  ]);

  removeMockDataSourceAt(config, 0);
  assert.deepEqual(config.modules[0].pages.map((page) => page.data_dependencies), [[], []]);
});

test("page artifacts derive deterministic Swift files from title and page type", () => {
  assert.deepEqual(swiftPageArtifacts({ title: "today", page_type: "view" }), {
    baseName: "Today",
    view: { typeName: "TodayView", fileName: "TodayView.swift" },
    viewController: null
  });

  assert.deepEqual(swiftPageArtifacts({ title: "today", page_type: "view_controller" }), {
    baseName: "Today",
    view: { typeName: "TodayView", fileName: "TodayView.swift" },
    viewController: {
      typeName: "TodayViewController",
      fileName: "TodayViewController.swift"
    }
  });
});

test("page artifacts reject titles that cannot form a Swift type name", () => {
  assert.equal(swiftPageArtifacts({ title: "123", page_type: "view" }), null);
  assert.equal(swiftPageArtifacts({ title: "今日", page_type: "view" }).view.fileName, "今日View.swift");
});

test("behavior factory models a page interaction without shared optional values", () => {
  assert.deepEqual(createBehavior(), {
    id: "new-behavior",
    type: "scroll",
    target: "",
    implementation_status: "todo",
    axis: "vertical"
  });
  assert.deepEqual(createBehavior({
    id: "main-scroll",
    type: "scroll",
    target: "main_content",
    implementation_status: "todo",
    axis: "vertical",
    fixed_regions: ["navigation_bar", "bottom_action"],
    states: ["default"],
    condition: "content_exceeds_viewport",
    note: "Keep the primary action visible."
  }), {
    id: "main-scroll",
    type: "scroll",
    target: "main_content",
    implementation_status: "todo",
    axis: "vertical",
    fixed_regions: ["navigation_bar", "bottom_action"],
    states: ["default"],
    condition: "content_exceeds_viewport",
    note: "Keep the primary action visible."
  });

  const first = createBehavior({ fixed_regions: ["header"] });
  const second = createBehavior({ fixed_regions: ["footer"] });
  first.fixed_regions.push("toolbar");
  assert.deepEqual(second.fixed_regions, ["footer"]);
});

test("interaction behavior factory creates an isolated action list without placeholders", () => {
  const actions = [{ type: "start_countdown", target: "countdown_label", parameters: { duration_seconds: "30" } }];
  const behavior = createBehavior({ id: "countdown", type: "interaction", target: "countdown_label", actions });

  assert.deepEqual(behavior, {
    id: "countdown",
    type: "interaction",
    target: "countdown_label",
    implementation_status: "todo",
    trigger: { event: "page_appear" },
    actions,
    run_policy: "once_per_instance"
  });
  behavior.actions[0].parameters.duration_seconds = "60";
  assert.equal(actions[0].parameters.duration_seconds, "30");
  assert.equal("action" in behavior, false);
});

test("changing behavior type adds and removes interaction-only fields", () => {
  const behavior = createBehavior({ id: "main-scroll", type: "scroll", target: "content" });

  changeBehaviorType(behavior, "interaction");
  assert.deepEqual(behavior, {
    id: "main-scroll",
    type: "interaction",
    target: "content",
    implementation_status: "todo",
    trigger: { event: "page_appear" },
    actions: [],
    run_policy: "once_per_instance"
  });

  changeBehaviorType(behavior, "scroll");
  assert.deepEqual(behavior, {
    id: "main-scroll",
    type: "scroll",
    target: "content",
    implementation_status: "todo",
    axis: "vertical"
  });
});

test("action helpers apply type defaults and preserve ordered entries", () => {
  assert.deepEqual(createAction({ type: "navigate" }), {
    type: "navigate",
    style: "push",
    destination: "",
    parameters: {}
  });
  assert.deepEqual(createAction({ type: "present_popup" }), {
    type: "present_popup",
    destination: ""
  });
  assert.deepEqual(createAction({ type: "dismiss_popup" }), { type: "dismiss_popup" });

  const behavior = createBehavior({
    id: "submit",
    type: "interaction",
    actions: [
      createAction({ type: "emit_event", name: "submitted" }),
      createAction({ type: "navigate", destination: "account.receipt" }),
      createAction({ type: "present_popup", destination: "common.confirmation" })
    ]
  });
  changeActionType(behavior.actions[0], "start_countdown");
  assert.deepEqual(behavior.actions[0], { type: "start_countdown", parameters: {} });
  moveAction(behavior, 2, -1);
  assert.deepEqual(behavior.actions.map((action) => action.type), ["start_countdown", "present_popup", "navigate"]);
  removeActionAt(behavior, 1);
  assert.deepEqual(behavior.actions.map((action) => action.type), ["start_countdown", "navigate"]);
});

test("interaction source references follow behavior rename and deletion", () => {
  const page = createPage();
  page.behaviors.push(
    createBehavior({ id: "countdown", type: "interaction", target: "label" }),
    createBehavior({
      id: "finish",
      type: "interaction",
      target: "page",
      trigger: { event: "timer_finished", source: "countdown" },
      actions: [{ type: "emit_event", name: "finished" }]
    })
  );

  page.behaviors[0].id = "workout-countdown";
  retargetBehaviorReferences(page, "countdown", "workout-countdown");
  assert.equal(page.behaviors[1].trigger.source, "workout-countdown");

  removeBehaviorAt(page, 0);
  assert.equal(page.behaviors[0].trigger.source, undefined);
});

test("behavior list inputs normalize comma and line separated regions", () => {
  assert.deepEqual(parseListInput("navigation_bar, bottom_action\nplayer_controls"), [
    "navigation_bar", "bottom_action", "player_controls"
  ]);
  assert.equal(formatListInput(["navigation_bar", "bottom_action"]), "navigation_bar, bottom_action");
});

test("interaction behavior stores state changes outside ordered actions", () => {
  assert.deepEqual(createBehavior({
    id: "show-exit-confirmation",
    type: "interaction",
    target: "back_button",
    implementation_status: "todo",
    states: ["default"],
    trigger: { event: "tap" },
    state_change: "exit-confirmation",
    run_policy: "every_time",
    condition: "workout_in_progress"
  }), {
    id: "show-exit-confirmation",
    type: "interaction",
    target: "back_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    actions: [],
    state_change: "exit-confirmation",
    run_policy: "every_time",
    states: ["default"],
    condition: "workout_in_progress"
  });
});

test("state action and behavior scopes follow state renames", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "default", title: "Default" }),
    createState({ id: "exit-confirmation", title: "Exit confirmation" })
  );
  page.behaviors.push(
    createBehavior({ id: "show", type: "interaction", target: "back_button", states: ["default"], trigger: { event: "tap" }, state_change: "exit-confirmation" }),
    createBehavior({ id: "hide", type: "interaction", target: "continue_button", states: ["exit-confirmation"], trigger: { event: "tap" }, state_change: "default" }),
    createBehavior({ id: "lock-alert", type: "scroll_lock", target: "page_content", states: ["exit-confirmation"] })
  );

  retargetStateReferences(page, "exit-confirmation", "exit-alert");

  assert.equal(page.behaviors[0].state_change, "exit-alert");
  assert.deepEqual(page.behaviors[1].states, ["exit-alert"]);
  assert.deepEqual(page.behaviors[2].states, ["exit-alert"]);
});

test("removing a state removes or retargets affected behaviors", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "default", title: "Default" }),
    createState({ id: "alert", title: "Alert" }),
    createState({ id: "loading", title: "Loading" })
  );
  page.behaviors.push(
    createBehavior({ id: "show-alert", type: "interaction", target: "back_button", states: ["default"], trigger: { event: "tap" }, state_change: "alert" }),
    createBehavior({ id: "load", type: "interaction", target: "retry_button", states: ["default"], trigger: { event: "tap" }, state_change: "loading" }),
    createBehavior({ id: "alert-only", type: "scroll_lock", target: "page_content", states: ["alert"] }),
    createBehavior({ id: "shared", type: "fixed", target: "toolbar", states: ["default", "alert"] }),
    createBehavior({ id: "global", type: "scroll", target: "main_content" })
  );

  removeStateAt(page, 1);

  assert.deepEqual(page.states.map((item) => item.id), ["default", "loading"]);
  assert.deepEqual(page.behaviors.map((item) => item.id), ["load", "shared", "global"]);
  assert.deepEqual(page.behaviors[1].states, ["default"]);
});

test("factories do not reuse nested mutable values", () => {
  const firstModule = createModule({ id: "one", title: "One" });
  const secondModule = createModule({ id: "two", title: "Two" });
  firstModule.pages.push(createPage({ id: "page", title: "Page" }));
  assert.equal(secondModule.pages.length, 0);

  const first = createBehavior({ id: "route", type: "interaction", actions: [{ type: "navigate", style: "push", parameters: {} }] });
  const second = createBehavior({ id: "route-2", type: "interaction", actions: [{ type: "navigate", style: "push", parameters: {} }] });
  first.actions[0].parameters.item = "next";
  assert.deepEqual(second.actions[0].parameters, {});

  assert.deepEqual(createState({ id: "loading", title: "Loading" }), {
    id: "loading",
    title: "Loading",
    figma_url: "",
    implementation_status: "todo"
  });
});

test("navigation action fields follow style contracts", () => {
  assert.deepEqual(navigationFields("push"), ["destination", "destination_instance", "parameters"]);
  assert.deepEqual(navigationFields("full_screen"), ["destination", "destination_instance", "parameters"]);
  assert.deepEqual(navigationFields("back"), ["destination"]);
  assert.deepEqual(navigationFields("dismiss"), ["destination"]);
  assert.deepEqual(navigationFields("external"), ["url"]);
  assert.throws(() => navigationFields("replace"), /Unknown route style/);
});

test("terminal navigation action preserves an optional existing destination", () => {
  assert.deepEqual(createBehavior({
    id: "close",
    type: "interaction",
    target: "close_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    actions: [{ type: "navigate", style: "back", destination: "account.page-a" }],
    run_policy: "every_time"
  }), {
    id: "close",
    type: "interaction",
    target: "close_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    actions: [{ type: "navigate", style: "back", destination: "account.page-a" }],
    run_policy: "every_time"
  });
});

test("cloneDraft isolates edits", () => {
  const source = configFixture();
  const draft = cloneDraft(source);
  draft.modules[0].pages[0].title = "Changed";
  assert.equal(source.modules[0].pages[0].title, "Page A");
});

test("destination index and incoming routes include self-instance routes", () => {
  const config = configFixture();
  const destinations = indexDestinations(config);
  assert.deepEqual(destinations.map((item) => item.id), ["account.page-a", "account.page-b"]);

  const incoming = incomingRoutes(config, "account.page-a");
  assert.deepEqual(incoming, [{
    sourceModuleId: "account",
    sourcePageId: "page-a",
    transitionId: "next-a"
  }]);
});

test("issues are grouped without sharing arrays", () => {
  const grouped = issuesByPath([
    { path: "modules.account.title", code: "required", message: "Required" },
    { path: "modules.account.title", code: "invalid", message: "Invalid" },
    { path: "modules.account.pages.page-a.title", code: "required", message: "Required" }
  ]);

  assert.equal(grouped.get("modules.account.title").length, 2);
  assert.equal(grouped.get("modules.account.pages.page-a.title").length, 1);
  grouped.get("modules.account.title").push({});
  assert.equal(grouped.get("modules.account.pages.page-a.title").length, 1);
});

test("validation issues are placed at the exact field or nearest owning section", () => {
  const pagePath = "modules.account.pages.page-a";
  const actionPath = `${pagePath}.behaviors.submit.actions[0]`;
  const placements = placeIssues([
    { path: `${actionPath}.destination`, code: "required", message: "Destination is required" },
    { path: `${actionPath}.parameters.itemID`, code: "required", message: "Value is required" },
    { path: `${pagePath}.states.missing.figma_url`, code: "required", message: "Figma URL is required" }
  ], [
    pagePath,
    `${pagePath}.behaviors.submit`,
    actionPath,
    `${actionPath}.destination`
  ]);

  assert.deepEqual(placements.get(`${actionPath}.destination`).map((issue) => issue.code), ["required"]);
  assert.deepEqual(placements.get(actionPath).map((issue) => issue.message), ["Value is required"]);
  assert.deepEqual(placements.get(pagePath).map((issue) => issue.message), ["Figma URL is required"]);
});

test("editor collection paths use indexes when an item id is invalid", () => {
  assert.equal(
    collectionIssuePath("modules.account.pages.page-a.behaviors", { id: "submit" }, 0),
    "modules.account.pages.page-a.behaviors.submit"
  );
  assert.equal(
    collectionIssuePath("modules.account.pages.page-a.behaviors", { id: "Submit!" }, 0),
    "modules.account.pages.page-a.behaviors[0]"
  );
});

test("validation issue locations identify their module, page, and editor tab", () => {
  assert.deepEqual(
    issueLocation("modules.account.pages.page-a.behaviors.submit.actions[0].destination"),
    { moduleId: "account", pageId: "page-a", tab: "behaviors" }
  );
  assert.deepEqual(
    issueLocation("modules.account.pages.page-a.states.loading.figma_url"),
    { moduleId: "account", pageId: "page-a", tab: "states" }
  );
  assert.deepEqual(
    issueLocation("modules.account.pages.page-a.title"),
    { moduleId: "account", pageId: "page-a", tab: "page" }
  );
  assert.deepEqual(issueLocation("mock_data_sources.shared.fixture"), {
    moduleId: null,
    pageId: null,
    tab: "data"
  });
  assert.equal(issueLocation("mock_data_sources[0].fixture").tab, "data");
  assert.equal(issueLocation("modules.account.pages.page-a.data_dependencies[0].source").tab, "data");
  assert.equal(issueLocation("modules.account.pages.page-a.states[0].figma_url").tab, "states");
});

test("flow graph keeps page metadata and only destination routes", () => {
  const config = configFixture();
  const pageA = config.modules[0].pages[0];
  const pageB = config.modules[0].pages[1];
  pageA.behaviors.push(createBehavior({
    id: "show-loading",
    type: "interaction",
    target: "retry_button",
    states: ["default"],
    trigger: { event: "tap" },
    state_change: "default",
    run_policy: "every_time"
  }));
  pageA.behaviors.push(createBehavior({
    id: "to-b",
    type: "interaction",
    target: "finish_button",
    trigger: { event: "tap" },
    actions: [{ type: "navigate", style: "full_screen", destination: "account.page-b" }],
    run_policy: "every_time"
  }));
  pageB.behaviors.push(createBehavior({
    id: "close",
    type: "interaction",
    target: "close_button",
    trigger: { event: "tap" },
    actions: [{ type: "navigate", style: "back", destination: "account.page-a" }],
    run_policy: "every_time"
  }));

  const graph = buildFlowGraph(config);

  assert.deepEqual(graph.nodes.map((node) => ({
    id: node.id,
    moduleId: node.moduleId,
    pageId: node.pageId,
    entry: node.entry,
    stateCount: node.states.length,
    stateTransitionCount: node.stateTransitions.length
  })), [
    { id: "account.page-a", moduleId: "account", pageId: "page-a", entry: true, stateCount: 1, stateTransitionCount: 1 },
    { id: "account.page-b", moduleId: "account", pageId: "page-b", entry: false, stateCount: 1, stateTransitionCount: 0 }
  ]);
  assert.deepEqual(graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    action: edge.action,
    style: edge.style,
    self: edge.self,
    kind: edge.kind,
    actionIndex: edge.actionIndex
  })), [
    {
      id: "account.page-a:next-a:0",
      source: "account.page-a",
      target: "account.page-a",
      action: "tap continue_button",
      style: "push",
      self: true,
      kind: "navigation",
      actionIndex: 0
    },
    {
      id: "account.page-a:to-b:0",
      source: "account.page-a",
      target: "account.page-b",
      action: "tap finish_button",
      style: "full_screen",
      self: false,
      kind: "navigation",
      actionIndex: 0
    },
    {
      id: "account.page-b:close:0",
      source: "account.page-b",
      target: "account.page-a",
      action: "tap close_button",
      style: "back",
      self: false,
      kind: "navigation",
      actionIndex: 0
    }
  ]);
});

test("flow layout places branches in separate rows and keeps their shared source upstream", () => {
  const config = configFixture();
  const pageA = config.modules[0].pages[0];
  const pageC = createPage({ id: "page-c", title: "Page C" });
  pageC.states.push(createState({ id: "default", title: "Default", figma_url: "https://figma.com/c" }));
  config.modules[0].pages.push(pageC);
  pageA.behaviors.push(
    createBehavior({ id: "to-b", type: "interaction", target: "continue_button", condition: "show_b", trigger: { event: "tap" }, actions: [{ type: "navigate", style: "push", destination: "account.page-b" }], run_policy: "every_time" }),
    createBehavior({ id: "to-c", type: "interaction", target: "continue_button", condition: "show_c", trigger: { event: "tap" }, actions: [{ type: "navigate", style: "push", destination: "account.page-c" }], run_policy: "every_time" })
  );

  const layout = layoutFlowGraph(buildFlowGraph(config));
  const positions = Object.fromEntries(layout.nodes.map((node) => [node.id, [node.column, node.row]]));

  assert.deepEqual(positions["account.page-a"], [0, 0]);
  assert.equal(positions["account.page-b"][0], 1);
  assert.equal(positions["account.page-c"][0], 1);
  assert.notEqual(positions["account.page-b"][1], positions["account.page-c"][1]);

  const channels = flowEdgeChannels(layout.edges);
  assert.notEqual(channels["account.page-a:to-b:0"].sourceLane, channels["account.page-a:to-c:0"].sourceLane);
});

test("terminal return edges use a distinct outer route from forward edges", () => {
  const source = { x: 40, y: 80, width: 280, height: 360 };
  const target = { x: 440, y: 80, width: 280, height: 360 };
  const forward = flowEdgeGeometry(source, target, { terminal: false, pairLane: 0 });
  const returning = flowEdgeGeometry(target, source, { terminal: true, outerLane: 0 });

  assert.notEqual(returning.path, forward.path);
  assert.match(returning.path, /^M .* 80 C .* 12,/);
});

test("page edge labels expose branch conditions", () => {
  assert.equal(
    flowEdgeLabel({ action: "tap_continue", transitionId: "continue", style: "push", condition: "show_details" }),
    "tap_continue [show_details] · push"
  );
});

test("Figma embeds accept only official HTTPS design links", () => {
  assert.equal(
    figmaEmbedUrl("https://figma.com/design/abc/Page?node-id=1-2"),
    "https://www.figma.com/embed?embed_host=in-app-swift-figma&url=https%3A%2F%2Ffigma.com%2Fdesign%2Fabc%2FPage%3Fnode-id%3D1-2"
  );
  assert.equal(figmaEmbedUrl("http://www.figma.com/design/abc/Page"), null);
  assert.equal(figmaEmbedUrl("https://www.figma.com.example/design/abc/Page"), null);
  assert.equal(figmaEmbedUrl("not a url"), null);
});

test("flow zoom steps through supported levels and clamps at its limits", () => {
  assert.equal(stepFlowZoom(100, -1), 75);
  assert.equal(stepFlowZoom(100, 1), 125);
  assert.equal(stepFlowZoom(50, -1), 50);
  assert.equal(stepFlowZoom(150, 1), 150);
  assert.equal(stepFlowZoom(82, 1), 100);
});

function configFixture() {
  const pageA = createPage({ id: "page-a", title: "Page A" });
  pageA.states.push(createState({ id: "default", title: "Default", figma_url: "https://figma.com/a" }));
  pageA.behaviors.push(createBehavior({
    id: "next-a",
    type: "interaction",
    target: "continue_button",
    trigger: { event: "tap" },
    condition: "has_next",
    actions: [{
      type: "navigate",
      style: "push",
      destination: "account.page-a",
      destination_instance: "new"
    }],
    run_policy: "every_time"
  }));
  const pageB = createPage({ id: "page-b", title: "Page B" });
  pageB.states.push(createState({ id: "default", title: "Default", figma_url: "https://figma.com/b" }));
  const module = createModule({ id: "account", title: "Account" });
  module.entry_page = "page-a";
  module.pages.push(pageA, pageB);
  return { schema_version: 3, execution: { parallel: false, max_parallel: 2 }, modules: [module] };
}

function completedPageFixture() {
  const behavior = {
    id: "open-details",
    type: "interaction",
    target: "details_button",
    trigger: { event: "tap" },
    actions: [],
    run_policy: "once_per_instance"
  };
  return createPage({
    id: "details",
    states: [createState({ id: "default", implementation_status: "done" })],
    behaviors: [createBehavior({ ...behavior, implementation_status: "done" })],
    accepted_baseline: {
      states: [{ id: "default", title: "Default", figma_url: "" }],
      behaviors: [behavior]
    }
  });
}

function controlledTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    set(callback, delay) {
      const id = nextId++;
      callbacks.set(id, { callback, delay });
      return id;
    },
    clear(id) {
      callbacks.delete(id);
    },
    delays() {
      return [...callbacks.values()].map((item) => item.delay);
    },
    async runNext() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "expected a pending timer");
      const [id, item] = entry;
      callbacks.delete(id);
      await item.callback();
    },
    get size() {
      return callbacks.size;
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
