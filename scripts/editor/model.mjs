export function cloneDraft(config) {
  return structuredClone(config);
}

export function reconcileOutlineExpansion(moduleIds, expandedIds, selectedModuleId) {
  const available = new Set(moduleIds);
  const expanded = expandedIds.filter((id) => available.has(id));
  const selected = available.has(selectedModuleId) ? selectedModuleId : moduleIds[0];
  if (selected && !expanded.includes(selected)) expanded.push(selected);
  return expanded;
}

export function toggleOutlineModule(expandedIds, moduleId, selectedModuleId) {
  if (moduleId === selectedModuleId) return [...expandedIds];
  if (expandedIds.includes(moduleId)) return expandedIds.filter((id) => id !== moduleId);
  return [...expandedIds, moduleId];
}

export function buildOutlineRows(modules, expandedIds, selectedModuleId, selectedPageId) {
  const expanded = new Set(expandedIds);
  return modules.flatMap((module) => {
    const moduleExpanded = expanded.has(module.id);
    const rows = [{
      kind: "module",
      moduleId: module.id,
      level: 1,
      expanded: moduleExpanded,
      selected: module.id === selectedModuleId
    }];
    if (!moduleExpanded) return rows;
    return rows.concat((module.pages || []).map((page) => ({
      kind: "page",
      moduleId: module.id,
      pageId: page.id,
      level: 2,
      selected: module.id === selectedModuleId && page.id === selectedPageId
    })));
  });
}

export function reconcileEditorCardExpansion(items, expandedItems, issueItems = []) {
  const available = new Set(items);
  const expanded = (expandedItems === null ? items.slice(0, 1) : expandedItems)
    .filter((item) => available.has(item));
  for (const item of issueItems) {
    if (available.has(item) && !expanded.includes(item)) expanded.push(item);
  }
  return expanded;
}

export function rebindEditorCardExpansion(items, expandedItems) {
  if (expandedItems === null) return null;
  const expandedIds = new Set(expandedItems.map((item) => item.id));
  return items.filter((item) => expandedIds.has(item.id));
}

export function toggleEditorCard(expandedItems, item) {
  if (expandedItems.includes(item)) return expandedItems.filter((candidate) => candidate !== item);
  return [...expandedItems, item];
}

export function issueBelongsToPath(issuePath, ownerPath) {
  return issuePath === ownerPath || issuePath.startsWith(`${ownerPath}.`) || issuePath.startsWith(`${ownerPath}[`);
}

export function remapCollectionIssuePath(issuePath, collectionPath, items) {
  const prefix = `${collectionPath}[`;
  if (!issuePath.startsWith(prefix)) return issuePath;
  const closingBracket = issuePath.indexOf("]", prefix.length);
  if (closingBracket === -1) return issuePath;
  const indexText = issuePath.slice(prefix.length, closingBracket);
  if (!/^\d+$/.test(indexText)) return issuePath;
  const index = Number(indexText);
  if (!items[index]) return issuePath;
  const ownerPath = collectionIssuePath(collectionPath, items[index], index);
  return `${ownerPath}${issuePath.slice(closingBracket + 1)}`;
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

export function swiftTypeBase(title) {
  const tokens = String(title ?? "").match(/[\p{L}\p{N}]+/gu) || [];
  const baseName = tokens.map((token) => {
    const [first, ...rest] = Array.from(token);
    return `${first.toUpperCase()}${rest.join("")}`;
  }).join("");
  return /^\p{L}/u.test(baseName) ? baseName : null;
}

export function swiftPageArtifacts(page) {
  const baseName = swiftTypeBase(page?.title);
  const pageType = page?.page_type || "view";
  if (!baseName || !["view", "view_controller"].includes(pageType)) return null;

  return {
    baseName,
    view: { typeName: `${baseName}View`, fileName: `${baseName}View.swift` },
    viewController: pageType === "view_controller"
      ? { typeName: `${baseName}ViewController`, fileName: `${baseName}ViewController.swift` }
      : null
  };
}

export function createModule(seed = {}) {
  const title = seed.title || "New module";
  return {
    id: seed.id || slugify(title),
    title,
    entry_page: seed.entry_page ?? null,
    pages: structuredClone(seed.pages || [])
  };
}

export function entryPageCandidates(module) {
  return (module?.pages || []).filter((page) => (page.page_role || "screen") === "screen");
}

export function reconcileModuleEntryPage(module) {
  const candidates = entryPageCandidates(module);
  if (!candidates.some((page) => page.id === module.entry_page)) {
    module.entry_page = candidates[0]?.id || null;
  }
  return module.entry_page;
}

export function createMockDataSource(seed = {}) {
  return {
    id: seed.id || "new-data-source",
    swift_type: seed.swift_type || "DataModel",
    fixture: seed.fixture || "standard"
  };
}

export function createDataDependency(seed = {}) {
  return {
    source: seed.source || "",
    access: seed.access || "read_only"
  };
}

export function createPage(seed = {}) {
  const title = seed.title || "New page";
  const page = {
    id: seed.id || slugify(title),
    title,
    page_type: seed.page_type || "view",
    page_role: seed.page_role || "screen",
    status: seed.status || "todo",
    attempts: seed.attempts ?? 0,
    commit: seed.commit ?? null,
    reason: seed.reason ?? null,
    started_at: seed.started_at ?? null,
    completed_at: seed.completed_at ?? null,
    acceptance_history: structuredClone(seed.acceptance_history || []),
    accepted_baseline: seed.accepted_baseline ? structuredClone(seed.accepted_baseline) : null,
    removed_tasks: structuredClone(seed.removed_tasks || []),
    data_dependencies: structuredClone(seed.data_dependencies || []),
    behaviors: structuredClone(seed.behaviors || []),
    states: structuredClone(seed.states || [])
  };
  if (page.page_role === "popup") page.popup = createPopupStructure(seed.popup);
  return page;
}

export function createPopupStructure(seed = {}) {
  return {
    implementation_status: seed?.implementation_status || "todo",
    fields: {
      title: seed?.fields?.title ?? true,
      subtitle: seed?.fields?.subtitle ?? false,
      content: seed?.fields?.content ?? true
    },
    buttons: structuredClone(seed?.buttons || [{ id: "primary" }])
  };
}

export function createPopupPresentation(template, seed = {}) {
  const enabledFields = ["title", "subtitle", "content"].filter((field) => template?.popup?.fields?.[field] === true);
  const previousButtons = new Map((seed.buttons || []).map((button) => [button.id, button]));
  return {
    type: "present_popup",
    destination: seed.destination || "",
    content: Object.fromEntries(enabledFields.map((field) => [field, seed.content?.[field] || ""])),
    buttons: (template?.popup?.buttons || []).map(({ id }) => {
      const previous = previousButtons.get(id);
      return previous
        ? structuredClone(previous)
        : { id, text: "", callback: { actions: [] } };
    })
  };
}

export function reconcilePopupPresentation(action, template, { destination = action?.destination || "" } = {}) {
  const enabledFields = new Set(["title", "subtitle", "content"].filter((field) => template?.popup?.fields?.[field] === true));
  const buttonIds = new Set((template?.popup?.buttons || []).map((button) => button.id));
  const droppedPaths = [
    ...Object.keys(action?.content || {}).filter((field) => !enabledFields.has(field)).map((field) => `content.${field}`),
    ...(action?.buttons || []).filter((button) => !buttonIds.has(button.id)).map((button) => `buttons.${button.id}`)
  ];
  return {
    action: createPopupPresentation(template, { ...action, destination }),
    droppedPaths
  };
}

export function retargetMockDataSourceReferences(config, previousId, nextId) {
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      for (const dependency of page.data_dependencies || []) {
        if (dependency.source === previousId) dependency.source = nextId;
      }
    }
  }
}

export function removeMockDataSourceAt(config, index) {
  const [removed] = config.mock_data_sources.splice(index, 1);
  if (!removed) return;
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      page.data_dependencies = (page.data_dependencies || []).filter((dependency) => dependency.source !== removed.id);
    }
  }
}

export function createBehavior(seed = {}) {
  const behavior = {
    id: seed.id || "new-behavior",
    type: seed.type || "scroll",
    target: seed.target || "",
    implementation_status: seed.implementation_status || "todo"
  };
  if (behavior.type === "interaction") {
    const trigger = seed.trigger || {};
    behavior.trigger = {
      event: trigger.event || "page_appear"
    };
    if (trigger.source) behavior.trigger.source = trigger.source;
    if (trigger.name) behavior.trigger.name = trigger.name;
    behavior.actions = structuredClone(seed.actions || []);
    if (seed.state_change) behavior.state_change = seed.state_change;
    behavior.run_policy = seed.run_policy || "once_per_instance";
  } else if (seed.axis || behavior.type === "scroll") {
    behavior.axis = seed.axis || "vertical";
  }
  for (const key of ["states"]) {
    if (Array.isArray(seed[key]) && seed[key].length > 0) behavior[key] = structuredClone(seed[key]);
  }
  if (behavior.type !== "interaction" && Array.isArray(seed.fixed_regions) && seed.fixed_regions.length > 0) {
    behavior.fixed_regions = structuredClone(seed.fixed_regions);
  }
  for (const key of ["condition", "note"]) {
    if (seed[key]) behavior[key] = seed[key];
  }
  return behavior;
}

export function copyBehaviorToPages(config, sourcePage, sourceBehavior, destinations) {
  if (!sourcePage || !sourceBehavior || !Array.isArray(destinations)) return [];
  const copied = [];
  const visited = new Set();

  for (const destination of destinations) {
    const module = (config?.modules || []).find((item) => item.id === destination?.moduleId);
    const page = (module?.pages || []).find((item) => item.id === destination?.pageId);
    if (!page || page === sourcePage || visited.has(page)) continue;
    visited.add(page);

    page.behaviors ||= [];
    const base = slugify(`${sourceBehavior.id || "behavior"}-copy`);
    const used = new Set(page.behaviors.map((item) => item.id));
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;

    const behavior = structuredClone(sourceBehavior);
    behavior.id = id;
    behavior.implementation_status = "todo";
    page.behaviors.push(behavior);
    copied.push({ moduleId: module.id, pageId: page.id, behavior });
  }

  return copied;
}

export function createAction(seed = {}) {
  const type = seed.type || "start_countdown";
  const action = { type };

  if (["start_countdown", "stop_countdown", "start_countup", "stop_countup", "play_video", "pause_video", "stop_video"].includes(type)) {
    if (seed.target) action.target = seed.target;
    if (seed.parameters) action.parameters = structuredClone(seed.parameters);
    return action;
  }

  if (type === "navigate") {
    if (Array.isArray(seed.branches)) {
      action.branches = seed.branches.map((branch) => createNavigationBranch(branch));
    } else {
      Object.assign(action, navigationRouteFields(seed));
    }
    return action;
  }

  if (type === "present_popup") {
    action.destination = seed.destination || "";
    if (seed.content) action.content = structuredClone(seed.content);
    if (seed.buttons) action.buttons = structuredClone(seed.buttons);
    return action;
  }

  if (["emit_event", "custom"].includes(type) && seed.name) action.name = seed.name;
  return action;
}

export function createNavigationBranch(seed = {}) {
  return {
    condition: seed.condition || "",
    ...navigationRouteFields(seed)
  };
}

export function navigationRoutes(action) {
  return Array.isArray(action?.branches) ? action.branches : action ? [action] : [];
}

export function setConditionalNavigation(action, enabled) {
  if (!action || action.type !== "navigate") return action;
  if (enabled && !Array.isArray(action.branches)) {
    const first = createNavigationBranch(action);
    replaceObjectFields(action, {
      type: "navigate",
      branches: [first, createNavigationBranch()]
    });
  } else if (!enabled && Array.isArray(action.branches)) {
    const first = action.branches[0] || createNavigationBranch();
    replaceObjectFields(action, { type: "navigate", ...navigationRouteFields(first) });
  }
  return action;
}

function navigationRouteFields(seed = {}) {
  const style = seed.style || "push";
  const route = { style };
  if (["push", "sheet", "full_screen"].includes(style)) {
    route.destination = seed.destination || "";
    route.parameters = structuredClone(seed.parameters || {});
    if (seed.destination_instance) route.destination_instance = seed.destination_instance;
  } else if (["back", "dismiss"].includes(style)) {
    if (seed.destination) route.destination = seed.destination;
  } else if (style === "external" && seed.url) {
    route.url = seed.url;
  }
  return route;
}

function replaceObjectFields(target, replacement) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

export function changeActionType(action, type) {
  const replacement = createAction({ type });
  for (const key of Object.keys(action)) delete action[key];
  Object.assign(action, replacement);
  return action;
}

export function removeActionAt(behavior, index) {
  if (!Array.isArray(behavior.actions)) return null;
  const [removed] = behavior.actions.splice(index, 1);
  return removed || null;
}

export function moveAction(behavior, index, delta) {
  if (!Array.isArray(behavior.actions)) return false;
  const destination = index + delta;
  if (index < 0 || index >= behavior.actions.length || destination < 0 || destination >= behavior.actions.length) return false;
  const [action] = behavior.actions.splice(index, 1);
  behavior.actions.splice(destination, 0, action);
  return true;
}

export function changeBehaviorType(behavior, type) {
  const replacement = createBehavior({ ...behavior, type });
  for (const key of Object.keys(behavior)) delete behavior[key];
  Object.assign(behavior, replacement);
  return behavior;
}

export function retargetBehaviorReferences(page, previousId, nextId) {
  for (const behavior of page.behaviors || []) {
    if (behavior.trigger?.source === previousId) behavior.trigger.source = nextId;
  }
}

export function removeBehaviorAt(page, index) {
  const [removed] = page.behaviors.splice(index, 1);
  if (!removed) return;
  for (const behavior of page.behaviors) {
    if (behavior.trigger?.source === removed.id) delete behavior.trigger.source;
  }
}

export function updateTaskContract(item, mutate) {
  if (!item || typeof item !== "object") throw new TypeError("item must be an object");
  if (typeof mutate !== "function") throw new TypeError("mutate must be a function");
  const beforeStatus = item.implementation_status;
  const before = taskContract(item);
  mutate(item);
  if (beforeStatus === "done" && !contractsEqual(before, taskContract(item))) {
    item.implementation_status = "todo";
  }
  return item;
}

export function mutatePageTaskContracts(page, mutate) {
  if (!page || typeof page !== "object") throw new TypeError("page must be an object");
  if (typeof mutate !== "function") throw new TypeError("mutate must be a function");
  const before = new Map();
  for (const kind of ["state", "behavior"]) {
    for (const item of page[taskCollection(kind)] || []) {
      before.set(item, { status: item.implementation_status, contract: taskContract(item) });
    }
  }
  const popupBefore = page.popup
    ? { status: page.popup.implementation_status, contract: taskContract(page.popup) }
    : null;

  mutate(page);

  for (const kind of ["state", "behavior"]) {
    for (const item of page[taskCollection(kind)] || []) {
      const previous = before.get(item);
      if (previous?.status === "done" && !contractsEqual(previous.contract, taskContract(item))) {
        item.implementation_status = "todo";
      }
    }
  }
  if (popupBefore?.status === "done" && page.popup && !contractsEqual(popupBefore.contract, taskContract(page.popup))) {
    page.popup.implementation_status = "todo";
  }
  reconcileRemovedTasks(page);
  return page;
}

function reconcileRemovedTasks(page) {
  const active = new Set(["state", "behavior"].flatMap((kind) =>
    (page[taskCollection(kind)] || []).map((item) => `${kind}:${item.id}`)
  ));
  if (page.popup) active.add("popup:structure");
  const records = new Map();
  for (const task of page.removed_tasks || []) {
    if (!active.has(`${task.kind}:${task.id}`)) records.set(`${task.kind}:${task.id}`, task);
  }
  for (const kind of ["state", "behavior"]) {
    for (const accepted of page.accepted_baseline?.[taskCollection(kind)] || []) {
      const key = `${kind}:${accepted.id}`;
      if (!active.has(key) && !records.has(key)) {
        records.set(key, { kind, id: accepted.id, implementation_status: "todo" });
      }
    }
  }
  if (page.accepted_baseline?.popup && !page.popup && !records.has("popup:structure")) {
    records.set("popup:structure", { kind: "popup", id: "structure", implementation_status: "todo" });
  }
  page.removed_tasks = [...records.values()];
}

export function removeTaskAt(page, kind, index) {
  const collection = taskCollection(kind);
  const item = page?.[collection]?.[index];
  if (!item) return null;

  if (kind === "state") removeStateAt(page, index);
  else removeBehaviorAt(page, index);

  if (acceptedTask(page, kind, item.id)) {
    page.removed_tasks ||= [];
    page.removed_tasks = page.removed_tasks.filter((task) => task.kind !== kind || task.id !== item.id);
    page.removed_tasks.push({ kind, id: item.id, implementation_status: "todo" });
  }
  return item;
}

export function restoreRemovedTask(page, kind, id) {
  const collection = taskCollection(kind);
  const removalIndex = (page?.removed_tasks || []).findIndex((task) => task.kind === kind && task.id === id);
  if (removalIndex === -1) return null;
  const removal = page.removed_tasks[removalIndex];
  const baseline = acceptedTask(page, kind, id);
  if (!baseline) return null;

  const restored = { ...structuredClone(baseline), implementation_status: removal.implementation_status || "todo" };
  if (kind === "popup") {
    page.popup = restored;
    page.removed_tasks.splice(removalIndex, 1);
    return restored;
  }
  page[collection] ||= [];
  page[collection].push(restored);
  page.removed_tasks.splice(removalIndex, 1);
  return restored;
}

export function taskCounts(page) {
  const tasks = [
    ...(page?.states || []),
    ...(page?.behaviors || []),
    ...(page?.popup ? [page.popup] : []),
    ...(page?.removed_tasks || [])
  ];
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.implementation_status !== "done").length
  };
}

export function canonicalPageId(moduleId, pageId) {
  return `${moduleId}.${pageId}`;
}

export function pageChangesFor(changesByPage, moduleId, pageId) {
  return changesByPage?.[canonicalPageId(moduleId, pageId)] || null;
}

export function pageChangeFor(snapshot, moduleId, pageId) {
  return pageChangesFor(snapshot?.changes_by_page, moduleId, pageId);
}

export function taskChangeFor(pageChanges, kind, id) {
  const collection = taskCollection(kind);
  return (pageChanges?.[collection] || []).find((task) => task.id === id) || null;
}

export function parseListInput(value) {
  return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export function formatListInput(items) {
  return (items || []).join(", ");
}

export function createState(seed = {}) {
  const title = seed.title || "Default";
  return {
    id: seed.id || slugify(title),
    title,
    figma_url: seed.figma_url || "",
    implementation_status: seed.implementation_status || "todo"
  };
}

function taskCollection(kind) {
  if (kind === "state") return "states";
  if (kind === "behavior") return "behaviors";
  if (kind === "popup") return "popup";
  throw new Error(`Unknown task kind: ${kind}`);
}

function acceptedTask(page, kind, id) {
  if (kind === "popup") return id === "structure" ? page?.accepted_baseline?.popup || null : null;
  const collection = taskCollection(kind);
  return page?.accepted_baseline?.[collection]?.find((task) => task.id === id) || null;
}

function taskContract(item) {
  const contract = structuredClone(item);
  delete contract.implementation_status;
  return contract;
}

function contractsEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function retargetStateReferences(page, previousId, nextId) {
  for (const behavior of page.behaviors || []) {
    if (Array.isArray(behavior.states)) {
      behavior.states = behavior.states.map((stateId) => stateId === previousId ? nextId : stateId);
    }
    if (behavior.state_change === previousId) behavior.state_change = nextId;
  }
}

export function removeStateAt(page, index) {
  const [removed] = page.states.splice(index, 1);
  if (!removed) return;
  page.behaviors = (page.behaviors || []).filter((behavior) => {
    const hadExplicitScope = Array.isArray(behavior.states);
    const removedStateChange = behavior.state_change === removed.id;
    if (removedStateChange) {
      delete behavior.state_change;
      if (!Array.isArray(behavior.actions) || behavior.actions.length === 0) return false;
    }
    if (!hadExplicitScope) return true;
    behavior.states = behavior.states.filter((stateId) => stateId !== removed.id);
    return behavior.states.length > 0;
  });
}

export function navigationFields(style) {
  if (["push", "sheet", "full_screen"].includes(style)) {
    return ["destination", "destination_instance", "parameters"];
  }
  if (["back", "dismiss"].includes(style)) return ["destination"];
  if (style === "external") return ["url"];
  throw new Error(`Unknown route style: ${style}`);
}

export function statusActions(status) {
  if (["todo", "failed"].includes(status)) return ["claim"];
  if (status === "in_progress") return ["complete", "fail", "block", "requeue"];
  if (status === "blocked") return ["requeue"];
  if (status === "done") return ["amend"];
  return [];
}

export function indexDestinations(config, { pageRole } = {}) {
  const destinations = [];
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      const resolvedPageRole = page.page_role || "screen";
      if (pageRole && resolvedPageRole !== pageRole) continue;
      destinations.push({
        id: `${module.id}.${page.id}`,
        moduleId: module.id,
        pageId: page.id,
        pageRole: resolvedPageRole,
        title: `${module.title} / ${page.title}`
      });
    }
  }
  return destinations;
}

export function triggerEventsForPage(events, pageRole) {
  return (events || []).filter((event) => event !== "popup_result");
}

export function actionTypesForPage(types, pageRole) {
  return (types || []).filter((type) => type !== "return_popup_result");
}

export function incomingRoutes(config, canonicalPageId) {
  const incoming = [];
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      for (const behavior of page.behaviors || []) {
        for (const { action } of walkActions(behavior.actions || [])) {
          const reachesDestination = action.type === "navigate"
            ? navigationRoutes(action).some((route) => route.destination === canonicalPageId)
            : action.type === "present_popup" && action.destination === canonicalPageId;
          if (!reachesDestination) continue;
          incoming.push({
            sourceModuleId: module.id,
            sourcePageId: page.id,
            transitionId: behavior.id
          });
        }
      }
    }
  }
  return incoming;
}

export function retargetPageReferences(config, previousId, nextId) {
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      for (const behavior of page.behaviors || []) {
        for (const { action } of walkActions(behavior.actions || [])) {
          if (action.type === "navigate") {
            for (const route of navigationRoutes(action)) {
              if (route.destination === previousId) route.destination = nextId;
            }
          } else if (action.type === "present_popup" && action.destination === previousId) {
            action.destination = nextId;
          }
        }
      }
    }
  }
}

export function walkActions(actions, prefix = "actions") {
  const entries = [];
  for (const [index, action] of (actions || []).entries()) {
    const path = `${prefix}[${index}]`;
    entries.push({ action, path });
    if (action?.type !== "present_popup") continue;
    for (const [buttonIndex, button] of (action.buttons || []).entries()) {
      entries.push(...walkActions(
        button?.callback?.actions || [],
        `${path}.buttons[${buttonIndex}].callback.actions`
      ));
    }
  }
  return entries;
}

export function issuesByPath(issues) {
  const grouped = new Map();
  for (const issue of issues || []) {
    const group = grouped.get(issue.path) || [];
    group.push(structuredClone(issue));
    grouped.set(issue.path, group);
  }
  return grouped;
}

export function collectionIssuePath(collectionPath, item, index) {
  const id = item?.id;
  return typeof id === "string" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)
    ? `${collectionPath}.${id}`
    : `${collectionPath}[${index}]`;
}

export function placeIssues(issues, availablePaths) {
  const paths = [...new Set(availablePaths || [])].sort((left, right) => right.length - left.length);
  const placements = new Map();
  for (const issue of issues || []) {
    const target = paths.find((path) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`));
    if (!target) continue;
    const group = placements.get(target) || [];
    group.push(structuredClone(issue));
    placements.set(target, group);
  }
  return placements;
}

export function issueLocation(path) {
  const value = String(path || "");
  const match = value.match(/^modules\.([^.]+)(?:\.pages\.([^.]+))?/);
  const tab = value.startsWith("mock_data_sources.") || value.startsWith("mock_data_sources[") || value.includes(".data_dependencies.") || value.includes(".data_dependencies[")
    ? "data"
    : value.includes(".behaviors.")
      ? "behaviors"
      : value.includes(".states.") || value.includes(".states[")
        ? "states"
        : "page";
  return {
    moduleId: match?.[1] || null,
    pageId: match?.[2] || null,
    tab
  };
}

export function createAutoSaveCoordinator({
  delay = 800,
  save,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}) {
  if (typeof save !== "function") throw new TypeError("save must be a function");
  let timer = null;
  let version = 0;
  let saving = false;
  let paused = false;

  function cancelTimer() {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function schedule() {
    if (paused || saving) return;
    cancelTimer();
    timer = setTimeoutFn(run, delay);
  }

  async function run() {
    timer = null;
    if (paused || saving) return;
    const savingVersion = version;
    saving = true;
    let outcome;
    try {
      outcome = await save(savingVersion);
    } finally {
      saving = false;
    }
    if (outcome === "pause") paused = true;
    if (!paused && (outcome === "defer" || version > savingVersion)) schedule();
  }

  return {
    changed() {
      version += 1;
      schedule();
      return version;
    },
    flush() {
      cancelTimer();
      return run();
    },
    pause() {
      paused = true;
      cancelTimer();
    },
    resume({ schedulePending = true } = {}) {
      paused = false;
      if (schedulePending && version > 0) schedule();
    },
    reset() {
      cancelTimer();
      version = 0;
      paused = false;
    },
    get paused() {
      return paused;
    },
    get saving() {
      return saving;
    },
    get version() {
      return version;
    }
  };
}

export function buildFlowGraph(config) {
  const nodes = [];
  const pages = new Map();
  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      const canonicalId = `${module.id}.${page.id}`;
      pages.set(canonicalId, { module, page });
      if ((page.page_role || "screen") !== "screen") continue;
      nodes.push({
        id: canonicalId,
        moduleId: module.id,
        moduleTitle: module.title,
        pageId: page.id,
        pageTitle: page.title,
        status: page.status,
        entry: module.entry_page === page.id,
        pageRole: page.page_role || "screen",
        states: structuredClone(page.states || []),
        stateTransitions: (page.behaviors || []).flatMap((behavior) => {
          if (!behavior.state_change) return [];
          const sourceStates = Array.isArray(behavior.states)
            ? behavior.states
            : (page.states || []).map((state) => state.id);
          return sourceStates.map((from) => ({
            id: `${behavior.id}:${from}`,
            from,
            to: behavior.state_change,
            action: behaviorTriggerLabel(behavior),
            condition: behavior.condition || null
          }));
        })
      });
    }
  }

  const screenNodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const referencedTemplates = new Set();

  function addEdge({ id, source, target, transitionId, actionIndex, actionType, action, condition, style, kind = "popup", terminal = false, destinationless = false }) {
    edges.push({
      id,
      kind,
      source,
      target,
      transitionId,
      actionIndex,
      ...(actionType ? { actionType } : {}),
      action,
      ...(style ? { style } : {}),
      condition: condition || null,
      self: source === target,
      terminal,
      ...(destinationless ? { destinationless: true } : {})
    });
  }

  function addPopupInstance({ action, callerId, behavior, actionPath, incomingSource, incomingLabel }) {
    const template = pages.get(action.destination);
    if (!template || (template.page.page_role || "screen") !== "popup") return null;
    referencedTemplates.add(action.destination);
    const instanceId = `popup-instance:${callerId}:${behavior.id}:${actionPath}`;
    nodes.push({
      id: instanceId,
      moduleId: template.module.id,
      moduleTitle: template.module.title,
      pageId: template.page.id,
      pageTitle: template.page.title,
      status: template.page.status,
      entry: false,
      pageRole: "popup-instance",
      templateId: action.destination,
      callerId,
      actionPath,
      states: structuredClone(template.page.states || []),
      stateTransitions: []
    });
    addEdge({
      id: `${incomingSource}:${behavior.id}:${actionPath}`,
      source: incomingSource,
      target: instanceId,
      transitionId: behavior.id,
      actionIndex: Number(actionPath.match(/\[(\d+)\]$/)?.[1] || 0),
      actionType: "present_popup",
      action: incomingLabel,
      condition: behavior.condition
    });

    for (const [buttonIndex, button] of (action.buttons || []).entries()) {
      const callback = button.callback || {};
      const callbackActions = callback.actions || [];
      const presentationIndex = callbackActions.findIndex((candidate) => ["navigate", "present_popup", "dismiss_popup"].includes(candidate?.type));
      const presentation = presentationIndex === -1 ? null : callbackActions[presentationIndex];
      const callbackPath = `${actionPath}.buttons[${buttonIndex}].callback.actions[${presentationIndex === -1 ? 0 : presentationIndex}]`;
      if (presentation?.type === "navigate") {
        for (const [branchIndex, route] of navigationRoutes(presentation).entries()) {
          if (!route.destination || !screenNodeIds.has(route.destination)) continue;
          addEdge({
            id: `${instanceId}:${button.id}:${presentationIndex}:${branchIndex}`,
            source: instanceId,
            target: route.destination,
            transitionId: button.id,
            actionIndex: presentationIndex,
            actionType: "navigate",
            action: button.id,
            style: route.style,
            condition: route.condition,
            kind: "navigation",
            terminal: ["back", "dismiss"].includes(route.style)
          });
        }
      } else if (presentation?.type === "present_popup") {
        addPopupInstance({
          action: presentation,
          callerId,
          behavior,
          actionPath: callbackPath,
          incomingSource: instanceId,
          incomingLabel: button.id
        });
      } else {
        const closeOnly = !callback.state_change && callbackActions.length === 1 && callbackActions[0]?.type === "dismiss_popup";
        addEdge({
          id: `${instanceId}:${button.id}:${closeOnly ? "terminal" : "return"}`,
          source: instanceId,
          target: closeOnly ? null : callerId,
          transitionId: button.id,
          actionIndex: presentationIndex,
          actionType: closeOnly ? "dismiss_popup" : "callback",
          action: button.id,
          terminal: closeOnly,
          destinationless: closeOnly
        });
      }
    }
    return instanceId;
  }

  for (const module of config.modules || []) {
    for (const page of module.pages || []) {
      if ((page.page_role || "screen") !== "screen") continue;
      const source = `${module.id}.${page.id}`;
      for (const behavior of page.behaviors || []) {
        for (const [actionIndex, action] of (behavior.actions || []).entries()) {
          if (action.type === "present_popup") {
            addPopupInstance({
              action,
              callerId: source,
              behavior,
              actionPath: `actions[${actionIndex}]`,
              incomingSource: source,
              incomingLabel: behaviorTriggerLabel(behavior)
            });
            continue;
          }
          if (action.type === "dismiss_popup") {
            addEdge({
              id: `${source}:${behavior.id}:${actionIndex}`,
              source,
              target: null,
              transitionId: behavior.id,
              actionIndex,
              actionType: action.type,
              action: behaviorTriggerLabel(behavior),
              condition: behavior.condition,
              terminal: true,
              destinationless: true
            });
            continue;
          }
          if (action.type !== "navigate") continue;
          for (const [branchIndex, route] of navigationRoutes(action).entries()) {
            if (!route.destination || !screenNodeIds.has(route.destination)) continue;
            addEdge({
              id: `${source}:${behavior.id}:${actionIndex}${Array.isArray(action.branches) ? `:${branchIndex}` : ""}`,
              kind: "navigation",
              source,
              target: route.destination,
              transitionId: behavior.id,
              actionIndex,
              action: behaviorTriggerLabel(behavior),
              style: route.style,
              condition: route.condition || behavior.condition,
              terminal: ["back", "dismiss"].includes(route.style)
            });
          }
        }
      }
    }
  }

  for (const [canonicalId, { module, page }] of pages) {
    if ((page.page_role || "screen") !== "popup" || referencedTemplates.has(canonicalId)) continue;
    nodes.push({
      id: `popup-template:${canonicalId}`,
      moduleId: module.id,
      moduleTitle: module.title,
      pageId: page.id,
      pageTitle: page.title,
      status: page.status,
      entry: false,
      pageRole: "popup-template",
      templateId: canonicalId,
      unreferenced: true,
      states: structuredClone(page.states || []),
      stateTransitions: []
    });
  }
  return { nodes, edges };
}

function behaviorTriggerLabel(behavior) {
  const event = behavior.trigger?.event || "event";
  if (event === "custom_event") return behavior.trigger?.name || event;
  return behavior.target ? `${event} ${behavior.target}` : event;
}

export function layoutFlowGraph(graph) {
  const nodes = (graph.nodes || []).map((node) => ({ ...node }));
  const edges = (graph.edges || []).map((edge) => ({
    ...edge,
    terminal: edge.terminal ?? ["back", "dismiss"].includes(edge.style)
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const forwardInDegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (edge.terminal || edge.self || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const targets = adjacency.get(edge.source);
    if (!targets.includes(edge.target)) {
      targets.push(edge.target);
      forwardInDegree.set(edge.target, forwardInDegree.get(edge.target) + 1);
    }
  }

  const columns = new Map();
  const enqueueRoot = (rootId) => {
    if (columns.has(rootId)) return;
    columns.set(rootId, 0);
    const queue = [rootId];
    for (let index = 0; index < queue.length; index += 1) {
      const sourceId = queue[index];
      const nextColumn = columns.get(sourceId) + 1;
      for (const targetId of adjacency.get(sourceId) || []) {
        if (columns.has(targetId)) continue;
        columns.set(targetId, nextColumn);
        queue.push(targetId);
      }
    }
  };

  for (const node of nodes) {
    if (node.entry) enqueueRoot(node.id);
  }
  for (const node of nodes) {
    if (forwardInDegree.get(node.id) === 0) enqueueRoot(node.id);
  }
  for (const node of nodes) enqueueRoot(node.id);

  const rowsByColumn = new Map();
  for (const node of nodes) {
    const column = columns.get(node.id) || 0;
    const row = rowsByColumn.get(column) || 0;
    node.column = column;
    node.row = row;
    rowsByColumn.set(column, row + 1);
  }
  return { nodes, edges };
}

export function flowEdgeChannels(edges) {
  const channels = Object.fromEntries((edges || []).map((edge) => [edge.id, {
    sourceLane: 0,
    targetLane: 0,
    pairLane: 0,
    outerLane: 0
  }]));
  assignCenteredLanes(edges, (edge) => edge.source, channels, "sourceLane");
  assignCenteredLanes(edges, (edge) => edge.target, channels, "targetLane");
  assignCenteredLanes(edges, (edge) => `${edge.source}->${edge.target}`, channels, "pairLane");
  (edges || []).filter((edge) => edge.terminal).forEach((edge, index) => {
    channels[edge.id].outerLane = index;
  });
  return channels;
}

function assignCenteredLanes(edges, keyFor, channels, field) {
  const groups = new Map();
  for (const edge of edges || []) {
    const key = keyFor(edge);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  for (const group of groups.values()) {
    group.forEach((edge, index) => {
      channels[edge.id][field] = index - (group.length - 1) / 2;
    });
  }
}

export function flowEdgeGeometry(source, target, {
  self = false,
  terminal = false,
  destinationless = false,
  pairLane = 0,
  sourceLane = 0,
  targetLane = 0,
  outerLane = 0
} = {}) {
  if (destinationless) {
    const startX = source.x + source.width / 2 + sourceLane * 16;
    const startY = source.y;
    const routeY = Math.max(12, startY - 42 - outerLane * 20);
    const endX = startX + 44;
    return {
      path: `M ${startX} ${startY} C ${startX} ${routeY}, ${endX} ${routeY}, ${endX} ${routeY}`,
      labelX: (startX + endX) / 2,
      labelY: routeY - 6
    };
  }

  if (terminal) {
    const startX = source.x + source.width / 2 + sourceLane * 16;
    const endX = target.x + target.width / 2 + targetLane * 16;
    const routeY = 12 + outerLane * 20;
    return {
      path: `M ${startX} ${source.y} C ${startX} ${routeY}, ${endX} ${routeY}, ${endX} ${target.y}`,
      labelX: (startX + endX) / 2,
      labelY: routeY - 6
    };
  }

  if (self) {
    const startX = source.x + source.width / 2 - 36 + pairLane * 12;
    const endX = source.x + source.width / 2 + 36 + pairLane * 12;
    const anchorY = source.y;
    const loopY = Math.max(12, anchorY - 42 - Math.abs(pairLane) * 16);
    return {
      path: `M ${startX} ${anchorY} C ${startX} ${loopY}, ${endX} ${loopY}, ${endX} ${anchorY}`,
      labelX: (startX + endX) / 2,
      labelY: loopY - 6
    };
  }

  const sourceCenterX = source.x + source.width / 2;
  const targetCenterX = target.x + target.width / 2;
  const dx = targetCenterX - sourceCenterX;
  if (Math.abs(dx) < 1) {
    const sourceCenterY = source.y + source.height / 2;
    const targetCenterY = target.y + target.height / 2;
    const direction = Math.sign(targetCenterY - sourceCenterY) || 1;
    const startX = source.x + source.width;
    const endX = target.x + target.width;
    const startY = sourceCenterY + sourceLane * 14;
    const endY = targetCenterY + targetLane * 14;
    const outerX = Math.max(startX, endX) + 62 + Math.abs(pairLane) * 20;
    return {
      path: `M ${startX} ${startY} C ${outerX} ${startY}, ${outerX} ${endY}, ${endX} ${endY}`,
      labelX: outerX,
      labelY: (startY + endY) / 2 - direction * 8
    };
  }

  const direction = Math.sign(dx);
  const startX = direction > 0 ? source.x + source.width : source.x;
  const endX = direction > 0 ? target.x : target.x + target.width;
  const startY = source.y + 28 + sourceLane * 14;
  const endY = target.y + 28 + targetLane * 14;
  const control = Math.max(62, Math.abs(endX - startX) * 0.42) + Math.abs(pairLane) * 20;
  return {
    path: `M ${startX} ${startY} C ${startX + direction * control} ${startY}, ${endX - direction * control} ${endY}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: (startY + endY) / 2 - 9 - pairLane * 12
  };
}

export function flowEdgeLabel(edge) {
  const action = edge.action || edge.transitionId;
  const guardedAction = edge.condition ? `${action} [${edge.condition}]` : action;
  return [guardedAction, edge.style].filter(Boolean).join(" · ");
}

export function figmaEmbedUrl(value) {
  try {
    const source = new URL(value);
    if (source.protocol !== "https:") return null;
    if (!["figma.com", "www.figma.com"].includes(source.hostname)) return null;
    if (source.username || source.password) return null;
    const embed = new URL("https://www.figma.com/embed");
    embed.searchParams.set("embed_host", "in-app-swift-figma");
    embed.searchParams.set("url", source.href);
    return embed.href;
  } catch {
    return null;
  }
}

const FLOW_ZOOM_LEVELS = [50, 75, 100, 125, 150];

export function stepFlowZoom(current, direction) {
  const value = Number(current);
  if (direction < 0) {
    return [...FLOW_ZOOM_LEVELS].reverse().find((level) => level < value) || FLOW_ZOOM_LEVELS[0];
  }
  if (direction > 0) {
    return FLOW_ZOOM_LEVELS.find((level) => level > value) || FLOW_ZOOM_LEVELS.at(-1);
  }
  return FLOW_ZOOM_LEVELS.reduce((closest, level) => (
    Math.abs(level - value) < Math.abs(closest - value) ? level : closest
  ), 100);
}
