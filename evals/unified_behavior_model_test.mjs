import assert from "node:assert/strict";
import test from "node:test";

import {
  actionTypesForPage,
  buildFlowGraph,
  createAction,
  createBehavior,
  createPage,
  createPopupPresentation,
  createPopupStructure,
  reconcilePopupPresentation,
  createState,
  incomingRoutes,
  indexDestinations,
  removeStateAt,
  retargetPageReferences,
  retargetStateReferences,
  triggerEventsForPage
} from "../scripts/editor/model.mjs";

test("schema v6 editor choices remove legacy popup result contracts", () => {
  assert.deepEqual(
    triggerEventsForPage(["tap", "popup_result"], "popup"),
    ["tap"]
  );
  assert.deepEqual(
    triggerEventsForPage(["tap", "popup_result"], "screen"),
    ["tap"]
  );
  assert.deepEqual(
    actionTypesForPage(["navigate", "return_popup_result"], "screen"),
    ["navigate"]
  );
  assert.deepEqual(
    actionTypesForPage(["navigate", "return_popup_result"], "popup"),
    ["navigate"]
  );
});

test("popup factories create template structure and typed caller bindings", () => {
  assert.deepEqual(createPopupStructure(), {
    implementation_status: "todo",
    fields: { title: true, subtitle: false, content: true },
    buttons: [{ id: "primary" }]
  });
  const popup = createPage({
    id: "confirmation",
    title: "Confirmation",
    page_role: "popup",
    popup: {
      implementation_status: "done",
      fields: { title: true, subtitle: true, content: false },
      buttons: [{ id: "cancel" }, { id: "confirm" }]
    }
  });
  assert.deepEqual(createPopupPresentation(popup, { destination: "common.confirmation" }), {
    type: "present_popup",
    destination: "common.confirmation",
    content: { title: "", subtitle: "" },
    buttons: [
      { id: "cancel", text: "", callback: { actions: [] } },
      { id: "confirm", text: "", callback: { actions: [] } }
    ]
  });
});

test("popup presentation reconciliation preserves matching bindings and reports dropped paths", () => {
  const action = {
    type: "present_popup",
    destination: "common.old",
    content: { title: "saved_title", subtitle: "old_subtitle" },
    buttons: [
      { id: "cancel", text: "cancel_text", callback: { actions: [{ type: "dismiss_popup" }] } },
      { id: "old", text: "old_text", callback: { state_change: "editing" } }
    ]
  };
  const template = createPage({
    page_role: "popup",
    popup: {
      implementation_status: "todo",
      fields: { title: true, subtitle: false, content: true },
      buttons: [{ id: "cancel" }, { id: "confirm" }]
    }
  });

  const result = reconcilePopupPresentation(action, template, { destination: "common.new" });

  assert.deepEqual(result.action, {
    type: "present_popup",
    destination: "common.new",
    content: { title: "saved_title", content: "" },
    buttons: [
      { id: "cancel", text: "cancel_text", callback: { actions: [{ type: "dismiss_popup" }] } },
      { id: "confirm", text: "", callback: { actions: [] } }
    ]
  });
  assert.deepEqual(result.droppedPaths, ["content.subtitle", "buttons.old"]);
  assert.equal(action.destination, "common.old");
});

test("each popup presentation occurrence has its own callback flow instance", () => {
  const template = createPage({
    id: "confirmation",
    title: "Confirmation",
    page_role: "popup",
    popup: {
      fields: { title: false, subtitle: false, content: false },
      buttons: [{ id: "confirm" }, { id: "more" }, { id: "cancel" }]
    }
  });
  template.states.push(createState({ id: "default", title: "Default" }));
  const warning = createPage({
    id: "warning",
    title: "Warning",
    page_role: "popup",
    popup: { fields: { title: false, subtitle: false, content: false }, buttons: [] }
  });
  const unused = createPage({ id: "unused", title: "Unused", page_role: "popup" });
  const result = createPage({ id: "result", title: "Result" });
  const home = createPage({ id: "home", title: "Home" });
  home.behaviors.push(createBehavior({
    id: "open",
    type: "interaction",
    target: "delete_button",
    trigger: { event: "tap" },
    actions: [{
      type: "present_popup",
      destination: "common.confirmation",
      content: {},
      buttons: [
        { id: "confirm", text: "confirm_text", callback: { actions: [{ type: "navigate", style: "push", destination: "app.result" }] } },
        { id: "more", text: "more_text", callback: { actions: [{ type: "present_popup", destination: "common.warning", content: {}, buttons: [] }] } },
        { id: "cancel", text: "cancel_text", callback: { actions: [{ type: "dismiss_popup" }] } }
      ]
    }]
  }));
  const settings = createPage({ id: "settings", title: "Settings" });
  settings.states.push(createState({ id: "saved", title: "Saved" }));
  settings.behaviors.push(createBehavior({
    id: "open",
    type: "interaction",
    target: "reset_button",
    trigger: { event: "tap" },
    actions: [{
      type: "present_popup",
      destination: "common.confirmation",
      content: {},
      buttons: [
        { id: "confirm", text: "confirm_text", callback: { state_change: "saved" } },
        { id: "more", text: "more_text", callback: { actions: [{ type: "emit_event", name: "more" }] } },
        { id: "cancel", text: "cancel_text", callback: { actions: [{ type: "dismiss_popup" }] } }
      ]
    }]
  }));

  const graph = buildFlowGraph({ modules: [
    { id: "app", title: "App", entry_page: "home", pages: [home, settings, result] },
    { id: "common", title: "Common", entry_page: null, pages: [template, warning, unused] }
  ] });
  const instanceIds = graph.nodes.filter((node) => node.pageRole === "popup-instance").map((node) => node.id);

  assert.deepEqual(instanceIds, [
    "popup-instance:app.home:open:actions[0]",
    "popup-instance:app.home:open:actions[0].buttons[1].callback.actions[0]",
    "popup-instance:app.settings:open:actions[0]"
  ]);
  assert.equal(graph.nodes.find((node) => node.id === instanceIds[0]).states.length, 1);
  assert.equal(graph.nodes.find((node) => node.templateId === "common.unused").unreferenced, true);
  assert(graph.edges.some((edge) => edge.source === instanceIds[0] && edge.target === "app.result" && edge.action === "confirm"));
  assert(graph.edges.some((edge) => edge.source === instanceIds[0] && edge.target === instanceIds[1] && edge.action === "more"));
  assert(graph.edges.some((edge) => edge.source === instanceIds[0] && edge.target === null && edge.action === "cancel"));
  assert(graph.edges.some((edge) => edge.source === instanceIds[2] && edge.target === "app.settings" && edge.action === "confirm"));
});

test("page factory assigns screen role and preserves popup seeds", () => {
  assert.equal(createPage({ id: "confirmation", page_role: "popup" }).page_role, "popup");
  assert.equal(createPage({ id: "player" }).page_role, "screen");
});

test("interaction factory stores state changes and isolated ordered actions", () => {
  const seed = {
    id: "submit",
    type: "interaction",
    target: "submit_button",
    state_change: "submitting",
    actions: [
      { type: "emit_event", name: "submitted" },
      { type: "present_popup", destination: "common.confirmation" }
    ]
  };
  const behavior = createBehavior(seed);

  assert.equal(behavior.state_change, "submitting");
  assert.deepEqual(behavior.actions, seed.actions);
  assert.equal("action" in behavior, false);
  behavior.actions[0].name = "changed";
  assert.equal(seed.actions[0].name, "submitted");
});

test("removing a state removes state-only behaviors", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "default", title: "Default" }),
    createState({ id: "dialog", title: "Dialog" })
  );
  page.behaviors.push(createBehavior({
    id: "show-dialog",
    type: "interaction",
    target: "help_button",
    trigger: { event: "tap" },
    state_change: "dialog",
    states: ["default"],
    run_policy: "every_time"
  }));

  retargetStateReferences(page, "dialog", "help-dialog");
  page.states[1].id = "help-dialog";
  assert.equal(page.behaviors[0].state_change, "help-dialog");

  removeStateAt(page, 1);
  assert.equal(page.behaviors.length, 0);
});

test("removing a state retains mixed-effect behaviors without state change", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "default", title: "Default" }),
    createState({ id: "loading", title: "Loading" })
  );
  page.behaviors.push(createBehavior({
    id: "submit",
    type: "interaction",
    target: "submit_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    state_change: "loading",
    actions: [{ type: "emit_event", name: "submitted" }],
    run_policy: "every_time",
    condition: "form_is_valid"
  }));

  removeStateAt(page, 1);

  assert.deepEqual(page.behaviors, [{
    id: "submit",
    type: "interaction",
    target: "submit_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    actions: [{ type: "emit_event", name: "submitted" }],
    run_policy: "every_time",
    condition: "form_is_valid"
  }]);
});

test("removing a state never widens an explicitly scoped mixed-effect behavior", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "default", title: "Default" }),
    createState({ id: "loading", title: "Loading" })
  );
  page.behaviors.push(
    createBehavior({
      id: "loading-only",
      type: "interaction",
      target: "submit_button",
      trigger: { event: "tap" },
      states: ["loading"],
      state_change: "loading",
      actions: [{ type: "emit_event", name: "submitted" }],
      run_policy: "every_time"
    }),
    createBehavior({
      id: "partially-scoped",
      type: "interaction",
      target: "retry_button",
      trigger: { event: "tap" },
      states: ["default", "loading"],
      state_change: "loading",
      actions: [{ type: "emit_event", name: "retried" }],
      run_policy: "every_time"
    })
  );

  removeStateAt(page, 1);

  assert.deepEqual(page.behaviors, [{
    id: "partially-scoped",
    type: "interaction",
    target: "retry_button",
    implementation_status: "todo",
    trigger: { event: "tap" },
    actions: [{ type: "emit_event", name: "retried" }],
    run_policy: "every_time",
    states: ["default"]
  }]);
});

test("popup and navigation destinations retarget and protect deletion across actions", () => {
  const config = fixture();

  retargetPageReferences(config, "common.confirmation", "common.confirmation-popup");
  const submit = config.modules[0].pages[0].behaviors[0];
  assert.equal(submit.actions[1].destination, "common.confirmation-popup");
  assert.deepEqual(incomingRoutes(config, "common.confirmation-popup"), [{
    sourceModuleId: "account",
    sourcePageId: "checkout",
    transitionId: "submit"
  }]);
});

test("timer and video completion source discovery scans every action", () => {
  const page = createPage({ id: "player" });
  page.behaviors.push(createBehavior({
    id: "start-media",
    type: "interaction",
    actions: [
      { type: "emit_event", name: "prepared" },
      { type: "start_countdown", target: "countdown", parameters: { duration_seconds: "30" } },
      { type: "play_video", target: "video" }
    ]
  }));

  const timerSources = page.behaviors.filter((behavior) => behavior.actions?.some((action) => action.type === "start_countdown"));
  const videoSources = page.behaviors.filter((behavior) => behavior.actions?.some((action) => action.type === "play_video"));
  assert.deepEqual(timerSources.map((behavior) => behavior.id), ["start-media"]);
  assert.deepEqual(videoSources.map((behavior) => behavior.id), ["start-media"]);
});

test("flow graph derives state, navigation, and action-indexed popup edges from behaviors", () => {
  const graph = buildFlowGraph(fixture());

  assert.deepEqual(graph.nodes[0].stateTransitions, [{
    id: "submit:editing",
    from: "editing",
    to: "submitting",
    action: "tap submit_button",
    condition: null
  }]);
  assert.deepEqual(graph.edges.filter((edge) => edge.source === "account.checkout").map((edge) => ({
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    actionIndex: edge.actionIndex
  })), [
    { kind: "popup", source: "account.checkout", target: "popup-instance:account.checkout:submit:actions[1]", actionIndex: 1 },
    { kind: "navigation", source: "account.checkout", target: "account.receipt", actionIndex: 0 }
  ]);
});

test("unscoped state changes derive an edge from every page state", () => {
  const page = createPage({ id: "player", title: "Player" });
  page.states.push(
    createState({ id: "idle", title: "Idle" }),
    createState({ id: "playing", title: "Playing" }),
    createState({ id: "finished", title: "Finished" })
  );
  page.behaviors.push(createBehavior({
    id: "finish",
    type: "interaction",
    target: "finish_button",
    trigger: { event: "tap" },
    state_change: "finished",
    run_policy: "every_time"
  }));

  const graph = buildFlowGraph({
    modules: [{ id: "workout", title: "Workout", entry_page: "player", pages: [page] }]
  });

  assert.deepEqual(graph.nodes[0].stateTransitions.map(({ from, to }) => ({ from, to })), [
    { from: "idle", to: "finished" },
    { from: "playing", to: "finished" },
    { from: "finished", to: "finished" }
  ]);
});

test("a close-only popup button callback is a destinationless terminal flow action", () => {
  const popup = createPage({
    id: "confirmation",
    title: "Confirmation",
    page_role: "popup",
    popup: {
      fields: { title: false, subtitle: false, content: false },
      buttons: [{ id: "close" }]
    }
  });
  popup.states.push(createState({ id: "default", title: "Default" }));
  const caller = createPage({ id: "home", title: "Home" });
  caller.behaviors.push(createBehavior({
    id: "open",
    type: "interaction",
    target: "open_button",
    trigger: { event: "tap" },
    actions: [{
      type: "present_popup",
      destination: "common.confirmation",
      content: {},
      buttons: [{ id: "close", text: "close_text", callback: { actions: [{ type: "dismiss_popup" }] } }]
    }],
    run_policy: "every_time"
  }));

  const graph = buildFlowGraph({
    modules: [
      { id: "app", title: "App", entry_page: "home", pages: [caller] },
      { id: "common", title: "Common", entry_page: null, pages: [popup] }
    ]
  });

  const instanceId = "popup-instance:app.home:open:actions[0]";
  assert(graph.nodes.some((node) => node.id === instanceId));
  assert.deepEqual(graph.edges.find((edge) => edge.source === instanceId), {
    id: `${instanceId}:close:terminal`,
    kind: "popup",
    source: instanceId,
    target: null,
    transitionId: "close",
    actionIndex: 0,
    actionType: "dismiss_popup",
    action: "close",
    condition: null,
    self: false,
    terminal: true,
    destinationless: true
  });
});

test("destination index filters screen and popup roles", () => {
  const config = fixture();

  assert.deepEqual(
    indexDestinations(config, { pageRole: "screen" }).map((item) => item.id),
    ["account.checkout", "account.receipt"]
  );
  assert.deepEqual(
    indexDestinations(config, { pageRole: "popup" }).map((item) => item.id),
    ["common.confirmation"]
  );
});

function fixture() {
  const checkout = createPage({ id: "checkout", title: "Checkout" });
  checkout.states.push(
    createState({ id: "editing", title: "Editing" }),
    createState({ id: "submitting", title: "Submitting" })
  );
  checkout.behaviors.push(
    createBehavior({
      id: "submit",
      type: "interaction",
      target: "submit_button",
      trigger: { event: "tap" },
      states: ["editing"],
      state_change: "submitting",
      actions: [
        { type: "emit_event", name: "submitted" },
        {
          type: "present_popup",
          destination: "common.confirmation",
          content: {},
          buttons: [{ id: "primary", text: "confirm_text", callback: { actions: [{ type: "dismiss_popup" }] } }]
        }
      ],
      run_policy: "every_time"
    }),
    createBehavior({
      id: "view-receipt",
      type: "interaction",
      target: "receipt_button",
      trigger: { event: "tap" },
      actions: [{ type: "navigate", style: "push", destination: "account.receipt", parameters: {} }],
      run_policy: "every_time"
    })
  );
  const receipt = createPage({ id: "receipt", title: "Receipt" });
  const confirmation = createPage({
    id: "confirmation",
    title: "Confirmation",
    page_role: "popup",
    popup: {
      fields: { title: false, subtitle: false, content: false },
      buttons: [{ id: "primary" }]
    }
  });
  return {
    modules: [
      { id: "account", title: "Account", entry_page: "checkout", pages: [checkout, receipt] },
      { id: "common", title: "Common", entry_page: null, pages: [confirmation] }
    ]
  };
}
