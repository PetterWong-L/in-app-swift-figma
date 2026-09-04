import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_LOCALE,
  createI18n,
  localizeIssue,
  resolveLocale
} from "../scripts/editor/i18n.mjs";

test("new editor sessions default to Chinese", () => {
  assert.equal(DEFAULT_LOCALE, "zh-CN");
  assert.equal(resolveLocale(null), "zh-CN");
  assert.equal(resolveLocale("unsupported"), "zh-CN");
  assert.equal(createI18n().t("toolbar.save"), "保存");
});

test("English can be selected and common values are localized", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(english.t("toolbar.save"), "Save");
  assert.equal(chinese.t("status.in_progress"), "进行中");
  assert.equal(english.t("status.in_progress"), "In progress");
  assert.equal(chinese.t("status.action.amend"), "增量修订");
  assert.equal(english.t("status.action.amend"), "Amend");
  assert.equal(chinese.t("status.acceptance_history"), "历史验收基线");
  assert.equal(english.t("status.acceptance_history"), "Acceptance history");
  assert.equal(chinese.t("canvas.title"), "页面流程画布");
  assert.equal(english.t("canvas.zoom_in"), "Zoom in");
  assert.equal(chinese.t("chrome.saving"), "自动保存中");
  assert.equal(english.t("chrome.manual_save_required"), "Manual save required");
});

test("nested outline controls describe their module in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(chinese.t("outline.expand_module", { name: "账户" }), "展开模块：账户");
  assert.equal(chinese.t("outline.collapse_module", { name: "账户" }), "收起模块：账户");
  assert.equal(chinese.t("action.add_page_to_module", { name: "账户" }), "在账户中新增页面");
  assert.equal(english.t("outline.expand_module", { name: "Account" }), "Expand module: Account");
  assert.equal(english.t("outline.collapse_module", { name: "Account" }), "Collapse module: Account");
  assert.equal(english.t("action.add_page_to_module", { name: "Account" }), "Add page to Account");
});

test("compact behavior and state cards expose localized summaries", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(chinese.t("card.expand_behavior", { name: "submit" }), "展开行为：submit");
  assert.equal(chinese.t("card.collapse_state", { name: "加载中" }), "收起状态：加载中");
  assert.equal(chinese.t("behavior.action_count", { count: 2 }), "2 个动作");
  assert.equal(chinese.t("state.figma_linked"), "已关联 Figma");
  assert.equal(english.t("card.collapse_behavior", { name: "submit" }), "Collapse behavior: submit");
  assert.equal(english.t("card.expand_state", { name: "Loading" }), "Expand state: Loading");
  assert.equal(english.t("behavior.action_count", { count: 2 }), "2 actions");
  assert.equal(english.t("state.figma_missing"), "Figma missing");
});

test("behavior copy dialog is localized in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(chinese.t("action.copy_behavior_to_pages"), "复制行为到其他页面");
  assert.equal(chinese.t("dialog.copy_behavior"), "复制行为到其他页面");
  assert.equal(chinese.t("dialog.select_all"), "全选");
  assert.equal(chinese.t("dialog.clear_selection"), "清空");
  assert.equal(chinese.t("dialog.copy"), "复制");
  assert.equal(english.t("action.copy_behavior_to_pages"), "Copy behavior to other pages");
  assert.equal(english.t("dialog.copy_behavior"), "Copy behavior to other pages");
  assert.equal(english.t("dialog.select_all"), "Select all");
  assert.equal(english.t("dialog.clear_selection"), "Clear");
  assert.equal(english.t("dialog.copy"), "Copy");
});

test("page delivery profiles are selectable and localized", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");
  const html = readFileSync(new URL("../scripts/editor/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");

  assert.equal(chinese.t("outline.delivery_profile"), "页面交付配置档");
  assert.equal(english.t("outline.delivery_profile"), "Page delivery profile");
  assert.match(chinese.t("delivery.profile.strict"), /完整实现、审核与门禁/);
  assert.match(english.t("delivery.profile.review"), /Review and acceptance/);
  assert.match(html, /id="delivery-profile-input"/);
  assert.match(app, /state\.snapshot\.schema\.delivery_profiles/);
  assert.match(app, /state\.draft\.delivery\.profile = elements\["delivery-profile-input"\]\.value/);
});

test("system UI visual-verification exceptions are editable and localized", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");
  const html = readFileSync(new URL("../scripts/editor/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");

  assert.equal(chinese.t("outline.system_ui"), "系统 UI 门禁例外");
  assert.equal(english.t("system_ui.tab_bar_controller"), "System tab bar controller");
  assert.equal(chinese.t("system_ui.picker"), "系统选择器");
  assert.match(html, /id="system-tab-bar-controller-input"/);
  assert.match(html, /id="system-picker-input"/);
  assert.match(app, /state\.draft\.system_ui\.tab_bar_controller = elements\["system-tab-bar-controller-input"\]\.checked/);
  assert.match(app, /state\.draft\.system_ui\.picker = elements\["system-picker-input"\]\.checked/);
});

test("translations interpolate values and expose missing keys", () => {
  const i18n = createI18n("zh-CN");

  assert.equal(i18n.t("validation.issue_count", { count: 3 }), "3 个问题需要处理。");
  assert.equal(i18n.t("missing.translation"), "missing.translation");
});

test("unified interaction labels are available in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("behavior.trigger.tap"), "Tap (tap)");
  assert.equal(english.t("behavior.action.navigate"), "Navigate (navigate)");
  assert.equal(english.t("behavior.action.present_popup"), "Present popup (present_popup)");
  assert.equal(chinese.t("behavior.trigger.tap"), "点击（tap）");
  assert.equal(chinese.t("behavior.action.present_popup"), "展示弹窗（present_popup）");
});

test("popup template and presentation callback configuration is localized in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("section.popup_structure"), "Popup structure");
  assert.equal(english.t("field.popup_button_text"), "Button text expression");
  assert.equal(english.t("section.popup_callback"), "Button callback");
  assert.match(english.t("behavior.popup_callback_hint"), /caller/);
  assert.equal(chinese.t("section.popup_structure"), "弹窗结构");
  assert.equal(chinese.t("field.popup_button_text"), "按钮文本表达式");
  assert.equal(chinese.t("section.popup_callback"), "按钮回调");
  assert.match(chinese.t("behavior.popup_callback_hint"), /调用页面/);
  assert.equal(english.t("behavior.trigger.popup_result"), "behavior.trigger.popup_result");
  assert.equal(chinese.t("behavior.action.return_popup_result"), "behavior.action.return_popup_result");
});

test("behavior editor exposes caller-owned popup presentation controls", () => {
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");
  const model = readFileSync(new URL("../scripts/editor/model.mjs", import.meta.url), "utf8");

  assert.match(app, /triggerEventsForPage\(triggerEvents, page\.page_role\)/);
  assert.match(app, /createPopupStructure/);
  assert.match(app, /reconcilePopupPresentation/);
  assert.match(app, /data-popup-content-field/);
  assert.match(app, /data-popup-button-text/);
  assert.match(app, /data-add-popup-callback-action/);
  assert.match(app, /actionTypesForPage\(actionTypes, page\.page_role\)/);
  assert.doesNotMatch(model, /export function popupPresentationBehaviors/);
  assert.doesNotMatch(model, /export function popupResultsForTrigger/);
});

test("popup callback actions expose complete navigation and parameter controls", () => {
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");

  assert.match(app, /data-nested-action-new/);
  assert.match(app, /data-add-nested-action-parameter/);
  assert.match(app, /data-nested-action-param-name/);
  assert.match(app, /data-nested-action-param-value/);
  assert.match(app, /data-delete-nested-action-parameter/);
});

test("v3 page roles and ordered interaction actions are localized in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("field.page_role"), "Page role");
  assert.equal(english.t("page_role.screen"), "Screen");
  assert.equal(english.t("page_role.popup"), "Popup");
  assert.equal(english.t("field.state_change"), "State change (runs first)");
  assert.equal(english.t("section.actions"), "Ordered actions");
  assert.equal(english.t("action.add_behavior_action"), "Add action");
  assert.equal(english.t("behavior.action.present_popup"), "Present popup (present_popup)");
  assert.equal(english.t("behavior.action.dismiss_popup"), "Dismiss popup (dismiss_popup)");

  assert.equal(chinese.t("field.page_role"), "页面角色");
  assert.equal(chinese.t("page_role.screen"), "页面");
  assert.equal(chinese.t("page_role.popup"), "弹窗");
  assert.equal(chinese.t("field.state_change"), "状态变更（优先执行）");
  assert.equal(chinese.t("section.actions"), "有序动作");
  assert.equal(chinese.t("action.add_behavior_action"), "添加动作");
  assert.equal(chinese.t("behavior.action.present_popup"), "展示弹窗（present_popup）");
  assert.equal(chinese.t("behavior.action.dismiss_popup"), "关闭弹窗（dismiss_popup）");
});

test("behavior editor uses ordered action rows instead of a singular action form", () => {
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(app, /behavior-\$\{index\}-action-(?:type|name|state|target|style|destination|url|new)/);
  assert.match(app, /data-add-behavior-action/);
  assert.match(app, /data-delete-behavior-action/);
  assert.match(app, /data-move-behavior-action/);
  assert.match(app, /const actionPath = `\$\{behaviorPath\}\.actions\[\$\{actionIndex\}\]`/);
  assert.match(app, /indexDestinations\(state\.draft, \{ pageRole: "screen" \}\)/);
  assert.match(app, /indexDestinations\(state\.draft, \{ pageRole: "popup" \}\)/);
  assert.match(app, /flow-edge-popup/);
});

test("popup flow rendering supports destinationless dismissals without inline styles", () => {
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../scripts/editor/styles.css", import.meta.url), "utf8");
  const server = readFileSync(new URL("../scripts/task_config_server.mjs", import.meta.url), "utf8");

  assert.match(server, /style-src 'self'/);
  assert.match(app, /edge\.destinationless/);
  assert.match(app, /edge\.actionType/);
  assert.doesNotMatch(app, /style="stroke: #8a3d71; stroke-dasharray: 5 4"/);
  assert.match(styles, /\.flow-edge-popup path\s*\{[^}]*stroke: #8a3d71;[^}]*stroke-dasharray: 5 4;[^}]*\}/s);
});

test("navigation style changes seed the action factory with existing compatible fields", () => {
  const app = readFileSync(new URL("../scripts/editor/app.mjs", import.meta.url), "utf8");

  assert.match(app, /createAction\(\{ \.\.\.action, type: "navigate", style \}\)/);
});

test("behavior editor explains the supported range in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("tabs.behaviors"), "Behaviors");
  assert.match(english.t("behavior.range_hint"), /interaction/);
  assert.equal(english.t("behavior.trigger.timer_finished"), "Timer finished (timer_finished)");
  assert.equal(chinese.t("tabs.behaviors"), "页面行为");
  assert.match(chinese.t("behavior.scope_hint"), /留空表示全部状态/);
  assert.match(chinese.t("behavior.custom_hint"), /切换页面状态/);
});

test("page type and generated Swift file labels are available in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("field.page_type"), "Page type");
  assert.equal(english.t("page_type.view_controller"), "ViewController");
  assert.equal(chinese.t("field.page_type"), "页面类型");
  assert.equal(chinese.t("page_type.view"), "View");
  assert.match(chinese.t("page.generated_files"), /Swift/);
});

test("shared mock data editor labels are available in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("tabs.data"), "Data");
  assert.equal(english.t("field.mock_data_sources"), "Shared mock data sources");
  assert.equal(english.t("data.access.read_write"), "Read and write (read_write)");
  assert.equal(chinese.t("tabs.data"), "数据");
  assert.equal(chinese.t("field.data_dependencies"), "页面数据依赖");
  assert.match(chinese.t("data.runtime_hint"), /运行时/);
});

test("editor exposes a data tab for shared mock contracts", () => {
  const html = readFileSync(new URL("../scripts/editor/index.html", import.meta.url), "utf8");

  assert.match(html, /data-tab="data"/);
  assert.match(html, /data-i18n="tabs\.data"/);
});

test("terminal route destination guidance is available in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.match(english.t("route.terminal_destination_hint"), /existing page instance/);
  assert.match(chinese.t("route.terminal_destination_hint"), /已有页面实例/);
  assert.equal(chinese.t("field.stack_destination"), "返回目标页面（可选）");
});

test("flow canvas full-screen controls are localized in both languages", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(chinese.t("canvas.enter_fullscreen"), "全屏显示画布");
  assert.equal(chinese.t("canvas.exit_fullscreen"), "退出全屏画布");
  assert.equal(english.t("canvas.enter_fullscreen"), "Show canvas full screen");
  assert.equal(english.t("canvas.exit_fullscreen"), "Exit full-screen canvas");
});

test("flow canvas exposes an accessible full-screen toggle", () => {
  const html = readFileSync(new URL("../scripts/editor/index.html", import.meta.url), "utf8");

  assert.match(html, /id="flow-fullscreen"/);
  assert.match(html, /data-flow-fullscreen/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /data-i18n-title="canvas\.enter_fullscreen"/);
  assert.match(html, /data-i18n-aria-label="canvas\.enter_fullscreen"/);
});

test("inline validation issues omit schema paths in both languages", () => {
  const issue = {
    path: "modules.account.title",
    code: "required",
    message: "modules[0].title is required"
  };

  assert.equal(
    localizeIssue(issue, "zh-CN"),
    "此字段为必填项。"
  );
  assert.equal(localizeIssue(issue, "en"), "This field is required.");
});

test("task change and amendment confirmation labels are localized", () => {
  const english = createI18n("en");
  const chinese = createI18n("zh-CN");

  assert.equal(english.t("task.status"), "Implementation status");
  assert.equal(chinese.t("task.change.modified"), "已修改");
  assert.equal(chinese.t("task.change.added"), "已新增");
  assert.equal(english.t("task.change.added"), "Added");
  assert.equal(english.t("task.restore"), "Restore task");
  assert.equal(chinese.t("amendment.confirm"), "确认修订并保存");
});
