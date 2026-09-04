import assert from "node:assert/strict";
import test from "node:test";

import * as model from "../scripts/editor/model.mjs";

test("editor cards initially expand only the first item", () => {
  const first = { id: "first" };
  const second = { id: "second" };

  assert.deepEqual(model.reconcileEditorCardExpansion?.([first, second], null, []), [first]);
});

test("editor cards preserve manual collapse while removing stale items", () => {
  const first = { id: "first" };
  const second = { id: "second" };
  const removed = { id: "removed" };

  assert.deepEqual(model.reconcileEditorCardExpansion?.([first, second], [], []), []);
  assert.deepEqual(model.reconcileEditorCardExpansion?.([first, second], [removed, second], []), [second]);
});

test("editor cards always expand items that own validation issues", () => {
  const first = { id: "first" };
  const second = { id: "second" };

  assert.deepEqual(model.reconcileEditorCardExpansion?.([first, second], [], [second]), [second]);
});

test("editor cards toggle independently", () => {
  const first = { id: "first" };
  const second = { id: "second" };

  assert.deepEqual(model.toggleEditorCard?.([first], second), [first, second]);
  assert.deepEqual(model.toggleEditorCard?.([first, second], first), [second]);
});

test("editor cards rebind expansion to refreshed snapshot items by id", () => {
  const previous = [{ id: "first" }, { id: "second" }];
  const refreshed = [{ id: "first" }, { id: "second" }];

  assert.deepEqual(model.rebindEditorCardExpansion?.(refreshed, [previous[1]]), [refreshed[1]]);
  assert.equal(model.rebindEditorCardExpansion?.(refreshed, null), null);
});

test("validation paths belong only to their owning card", () => {
  assert.equal(model.issueBelongsToPath?.("modules.shop.pages.home.behaviors.submit.target", "modules.shop.pages.home.behaviors.submit"), true);
  assert.equal(model.issueBelongsToPath?.("modules.shop.pages.home.states[1].figma_url", "modules.shop.pages.home.states[1]"), true);
  assert.equal(model.issueBelongsToPath?.("modules.shop.pages.home.behaviors.submit-copy.target", "modules.shop.pages.home.behaviors.submit"), false);
  assert.equal(model.issueBelongsToPath?.("modules.shop.pages.home.states[10].figma_url", "modules.shop.pages.home.states[1]"), false);
});

test("indexed validation paths map to stable behavior card paths", () => {
  const collectionPath = "modules.shop.pages.home.behaviors";
  const items = [{ id: "submit" }, { id: "load-more" }, { id: "Invalid ID" }];

  assert.equal(
    model.remapCollectionIssuePath?.(`${collectionPath}[1].trigger.event`, collectionPath, items),
    `${collectionPath}.load-more.trigger.event`
  );
  assert.equal(
    model.remapCollectionIssuePath?.(`${collectionPath}[2].target`, collectionPath, items),
    `${collectionPath}[2].target`
  );
  assert.equal(
    model.remapCollectionIssuePath?.("modules.shop.pages.home.title", collectionPath, items),
    "modules.shop.pages.home.title"
  );
});

test("accepted task edits reopen while a direct status selection does not", () => {
  const task = { id: "loading", implementation_status: "done", title: "Loading" };

  model.updateTaskContract?.(task, (item) => { item.title = "Loading skeleton"; });
  assert.equal(task.implementation_status, "todo");

  task.implementation_status = "done";
  task.implementation_status = "in_progress";
  assert.equal(task.implementation_status, "in_progress");
});
