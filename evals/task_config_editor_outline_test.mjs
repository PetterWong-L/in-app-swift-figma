import assert from "node:assert/strict";
import test from "node:test";

import * as model from "../scripts/editor/model.mjs";

test("outline expansion keeps only existing modules and always includes the selection", () => {
  assert.deepEqual(
    model.reconcileOutlineExpansion?.(["account", "settings"], [], "settings"),
    ["settings"]
  );
  assert.deepEqual(
    model.reconcileOutlineExpansion?.(["account", "settings"], ["removed", "account"], "settings"),
    ["account", "settings"]
  );
  assert.deepEqual(
    model.reconcileOutlineExpansion?.(["account", "settings"], [], null),
    ["account"]
  );
});

test("outline modules toggle independently without collapsing the current selection", () => {
  assert.deepEqual(
    model.toggleOutlineModule?.(["account"], "settings", "account"),
    ["account", "settings"]
  );
  assert.deepEqual(
    model.toggleOutlineModule?.(["account", "settings"], "settings", "account"),
    ["account"]
  );
  assert.deepEqual(
    model.toggleOutlineModule?.(["account"], "account", "account"),
    ["account"]
  );
});

test("outline rows place each expanded module's pages directly beneath it", () => {
  const modules = [
    { id: "account", pages: [{ id: "login" }, { id: "profile" }] },
    { id: "settings", pages: [{ id: "privacy" }] }
  ];

  assert.deepEqual(
    model.buildOutlineRows?.(modules, ["account"], "account", "profile"),
    [
      { kind: "module", moduleId: "account", level: 1, expanded: true, selected: true },
      { kind: "page", moduleId: "account", pageId: "login", level: 2, selected: false },
      { kind: "page", moduleId: "account", pageId: "profile", level: 2, selected: true },
      { kind: "module", moduleId: "settings", level: 1, expanded: false, selected: false }
    ]
  );
});
