# Task Configuration

Read this reference for explicit skill initialization, an existing `InAppFigma.yaml`, or a long task with at least two pages/modules.

## Initialization

Initialization creates a dedicated `<project-root>/InAppFigma/` tool directory containing:

- `InAppFigma.yaml`: module, page, visual state, behavior, and progress configuration.
- `OpenInAppFigma.command`: a Finder-launchable entrypoint for the local editor.

The two files are an inseparable pair and the only tool artifacts placed in this directory. Initialization rejects `--config` paths outside `<project-root>/InAppFigma/InAppFigma.yaml` because the launcher resolves the YAML from its own directory and the project root from its parent.

Neither file is runtime application data. They must stay outside every Xcode target, Target Membership selection, Copy Bundle Resources phase, synchronized app-source root, and project-generation resource list. Their packaging status is independent of page lifecycle and item implementation statuses.

On explicit initialization or the first long task, create missing files with:

```bash
ruby <skill-root>/scripts/task_config.rb init --project-root <project-root>
```

Initialization checks every discovered `.xcodeproj/project.pbxproj` before writing anything. It refuses when either development filename is referenced by Xcode, when a filesystem-synchronized root covers the `InAppFigma/` directory, or when no Xcode project is available to establish safety. It never changes `.pbxproj`, target membership, or build phases. Initialization also never overwrites either existing file, so rerunning it can add a missing file without replacing local edits.

The generated YAML contains a commented module -> page -> state example, unified page behaviors, repeated Page A instances followed by Page B, page types, status rules, and navigation styles. Populate the real modules, pages, page types, state-specific Figma URLs, and behaviors, then run `validate` before design or Swift work.

`delivery.profile` selects the page-delivery stages defined in [page-delivery-profiles.md](page-delivery-profiles.md). It stores only the stable profile id; implementation rules, review checklists, and completion gates remain in that reference rather than in YAML or editor code. New and legacy configurations default to `strict`.

Root `system_ui` records explicit user-approved system-component choices for visual verification. `system_ui.tab_bar_controller` and `system_ui.picker` are booleans and default to `false`. A `true` value is not a blanket waiver: acceptance must first prove that the rendered region is owned by the corresponding system component, then apply the scoped gate rules in [page-delivery-profiles.md](page-delivery-profiles.md).

## Local Browser Editor

After initialization, double-click `<project-root>/InAppFigma/OpenInAppFigma.command` in Finder. It uses its own directory for the YAML, resolves the project root from the parent directory, starts the loopback editor, and opens the browser. It first looks for the project-local skill script at `.codex/skills/in-app-swift-figma/scripts/task_config.rb`; if unavailable, it uses the skill installation that created the launcher.

For terminal use, the equivalent commands are:

```bash
ruby <skill-root>/scripts/task_config.rb init --project-root <project-root>
ruby <skill-root>/scripts/task_config.rb serve --project-root <project-root>
```

The `serve` command prints a session URL and opens it in the default browser on macOS. It binds only to `127.0.0.1`, uses a random in-memory token, and edits only `<project-root>/InAppFigma/InAppFigma.yaml`. The editor loads no remote resources except Figma previews in the flow canvas; its content security policy permits frames only from `https://www.figma.com`. Use `--no-open` to print the URL without opening a browser, or `--port 0` to explicitly request an unused port.

The editor opens in Chinese by default. Use the `中文 | English` control in the toolbar to change the interface language; the browser remembers the selection for later sessions. The language applies to labels, dialogs, validation summaries, status names, tooltips, and accessibility text. It never translates YAML field names, enum values, Figma URLs, conditions, parameters, or user-entered content, and switching languages does not modify the draft or create an unsaved change.

In the editor:

1. Choose the **Page delivery profile** under Execution: `strict` for end-to-end implementation and acceptance, `implementation` to stop after implementation and focused checks, or `review` to review and accept existing work. Under **System UI gate exceptions**, enable only components that the user explicitly requires to use system rendering.
2. Use the two-level outline to expand a module and edit its ordered child pages. Add pages from the owning module row so the destination is explicit. The selected page's module remains expanded; other modules can be expanded or collapsed independently. Collapse state is browser-only UI state and is never written to YAML. Choose a `screen` entry page when the module contains screen pages. A popup-only shared module has no entry page and stores `entry_page: null`. On the Page tab, choose `View` or `ViewController`, choose `screen` or reusable `popup`, and confirm the title-derived Swift filenames shown by the editor.
3. For each page, add every visual state and its node-specific Figma URL. States are compact, independently collapsible cards with an editable `todo | in_progress | done` implementation status. Wide editors show two columns and narrow editors show one. States are design references for their owning page, including loading, playing, or completion appearances. Put reusable popup appearance on a `popup` page rather than duplicate source-page states.
4. In the Behaviors tab, add layout behaviors or `interaction` behaviors. Each behavior has the same independent implementation status. Behaviors are compact, independently collapsible cards whose headers summarize id, type, target, trigger, action count, and validation count. Use a behavior card's copy control to select one or more other pages across modules; each target receives a deep copy with a target-local unique id and `todo` implementation status. Page-local state and source references are preserved for explicit correction through target-page validation rather than silently discarded. Ordered actions render as divided rows inside the behavior body rather than nested cards. An interaction combines its trigger target, event, applicable states, optional condition, optional `state_change`, ordered `actions[]`, and run policy in one place. It applies the state change first, then effects in declaration order. The first behavior or state opens initially; newly added items and items containing validation errors open automatically. Other expansion choices stay only in browser memory and are never written to YAML.
5. For `navigate`, configure one route or enable **Navigate to different pages by condition** and configure two or more branches. Every branch has its own non-empty unique condition plus style, destination or URL, new-instance policy, and parameters. `navigate` destinations are screen pages. `present_popup` selects a popup template, supplies an expression for every enabled text field and every button label, and defines a caller-owned callback for every button. A callback may first change caller state and then run ordered actions, including navigation or another popup. Clicking a button always closes its concrete popup before the callback runs. A self destination with **Always create new instance** represents repeated page instances. For `back` or `dismiss`, an optional destination documents the existing screen page revealed afterward.
6. Use the right-side flow canvas to inspect the automatically layered page graph while editing long behavior or state lists. It derives state-level edges from `state_change`, one labeled screen flow edge per destination-bearing navigation branch, and one distinct node for every `present_popup` occurrence. Popup instance ids use `popup-instance:<caller-page>:<behavior-id>:<action-path>` so two callers or nested presentations never share a canvas. Each button callback draws its own edge to a screen, nested popup, caller return, or destinationless close-only terminal. Unused templates remain visible as unreferenced template nodes. `back` and `dismiss` navigation edges with a destination use distinct return channels above the page graph. Zoom, pan, full-screen, lazy Figma preview, and page-selection controls remain available. On narrow windows, open the canvas from its editor-tab control; it uses the full viewport instead of moving below the form.
7. Use task change badges to distinguish `added`, `modified`, and `removed` contracts. A task manually reopened without a contract change remains `unchanged` and is identified by its non-`done` implementation status. Removed accepted tasks appear in a flat section, retain an editable status, and can be restored from `accepted_baseline`.
8. Select **Validate** and resolve each message directly beside its invalid field or nearest owning page, behavior, action, state, popup structure, or data block. A collapsed behavior or state containing an issue opens before the message is focused. Module, page, tab, and card badges show where other issues remain without exposing schema paths as the primary UI; only issues for the active tab render in its form. **YAML Preview** shows the normalized schema v7 document without editing it. Opening schema v1-v6 migrates it in memory; the next successful save writes schema v7. Ambiguous legacy popup mappings remain visible as migration issues and block saving until resolved.
9. Draft edits save automatically after 800 milliseconds without further input. Saving does not replace the active form or interrupt its focus, and edits made while a save is in flight are queued for the next save. Validation failures remain unsaved until the next edit; revision conflicts pause auto-save and show the existing reload workflow. If YAML body comments require normalization, auto-save pauses until **Save** is selected once and the warning is acknowledged.
10. Saving a changed completed page returns `409 amendment_required`. The editor lists the affected task ids and performs one atomic retry with `confirm_amendments: true` only after confirmation. Cancel leaves disk unchanged and auto-save paused until another edit or reload. Confirmation preserves the disk-owned baseline, archives page acceptance, and reopens only affected tasks.
11. Use the Status tab to claim, complete, fail, block, requeue, or amend the selected page through the same Ruby lifecycle rules as the CLI. `Amend` is available only for a completed page and requires a concrete reason. Completion remains unavailable until all current and removed tasks are `done`.
12. Select **Stop** to end the local server. Closing or stopping the editor does not change page status.

The browser keeps the revision loaded with the draft. If another process changes the YAML, save or status returns `409`; auto-save pauses so the disk version can be reloaded or reconciled before retrying. A browser save preserves the leading instructional comments. YAML comments inside the data body cannot round-trip and require explicit acknowledgement before normalization.

The editor cannot start Codex tasks, create worktrees, make commits, or modify app source and Xcode metadata. CLI remains preferred for automation, scripted validation, and non-interactive lifecycle updates.

## Schema

- The current document version is `schema_version: 7`. Migration gives every item on an existing `done` page status `done` and creates its initial `accepted_baseline`; items on other legacy pages start `todo`. Migrating schema v5 converts deterministic popup result flows into typed presentation callbacks while preserving ambiguous fragments for manual resolution; schema v6 then upgrades without rewriting existing actions.
- Root `delivery.profile` is one of `strict`, `implementation`, or `review`. Missing values normalize to `strict`; the editor exposes the same values as **Page delivery profile**. The field selects instructions but never becomes runtime app data.
- Root `system_ui` contains boolean `tab_bar_controller` and `picker` flags. Missing fields normalize to `false`, which preserves strict visual comparison. Unknown component keys and non-boolean values are rejected.
- `system_ui.tab_bar_controller: true` permits OS-version visual drift only inside a proven system `UITabBarController`/`UITabBar` boundary. `system_ui.picker: true` applies the same rule to a proven system picker boundary. The flags never authorize replacing a system component with a custom imitation.
- Root `mock_data_sources[]` defines development-only data contracts that may be shared by pages in any module. Missing values in legacy schema v1 files normalize to an empty array.
- Each mock source requires a unique lowercase `id`, a valid `swift_type`, and a non-empty deterministic `fixture` name. The fixture values live in Swift development code; do not put sample JSON or runtime data in this YAML.
- Pages own `data_dependencies[]`; missing values normalize to an empty array. Each dependency references one configured source and declares `access: read_only` or `access: read_write`. A page cannot reference the same source twice.
- All pages referencing one source receive the same runtime owner instance through the project's existing dependency boundary. Do not construct page-local copies of shared mutable mock state.
- `read_only` means the page observes the source. `read_write` means the page may mutate it through the established owner API; it does not authorize persistence or backend behavior that the project does not have.
- A `navigate` action's `parameters` carries only destination input such as `itemID`, filters, or a selection key. The destination resolves shared models from its injected source; do not pass or clone the entire shared model through routing.
- Replace mock data later by swapping the provider/repository implementation at composition. Keep the page dependency interface and UI intact. The shipped app never parses `InAppFigma.yaml`.
- `modules[].entry_page` references a `screen` page id in that module. It is required when the module contains at least one screen page and must be `null` for a popup-only or empty module.
- `pages[]` own `page_type`, `page_role`, `status`, `attempts`, evidence fields, `acceptance_history[]`, tool-owned `accepted_baseline` and `removed_tasks[]`, `data_dependencies[]`, `states[]`, and `behaviors[]`. Schema v4 rejects separate `state_transitions` and `navigation` sections and singular `behavior.action`.
- `acceptance_history[]` is an append-only record generated by `amend`. Each entry preserves the superseded acceptance's nullable `commit` and `completed_at`, plus `superseded_at` and a non-empty `amendment_reason`. Missing values in legacy schema v1 files normalize to an empty array. Nullable baseline fields preserve compatibility with legacy completed pages. Do not edit or clear the history to restart work.
- Every state, behavior, and popup structure requires `implementation_status: todo | in_progress | done`. New work starts `todo`; users may change the value in YAML or the browser. Contract edits reopen only the affected accepted task. `implementation_status` is not part of contract equality, so changing status alone never creates a design/configuration modification.
- `accepted_baseline` is `null` before first completion. On completion, the tool stores canonical `states[]`, `behaviors[]`, and optional `popup` contracts without `implementation_status`; this baseline is authoritative for later diffs and restoration and must not be edited by the browser draft or workers.
- `removed_tasks[]` contains only `{kind, id, implementation_status}` for accepted items missing from current collections. Membership and identity are tool-owned; users may edit only `implementation_status`. The old contract remains in `accepted_baseline`. Restoring the item removes its removal record; successful page completion clears all removal records.
- Diff values are exactly `added`, `modified`, `removed`, and `unchanged`. Stable id changes are one removal plus one addition. `changed_fields` narrows modified work. `unchanged` is emitted only when a user manually reopens an unchanged task; its non-`done` status, not another diff type, expresses that intent.
- `page_type` supports `view` and `view_controller`. Missing values in legacy schema v1 files normalize to `view`.
- The page `title` is the Swift artifact base. Split whitespace and punctuation into words, uppercase each word's first character, preserve the rest, and require the result to begin with a letter. For example, `today` becomes `Today` and `account security` becomes `AccountSecurity`.
- `view` requires `{Base}View.swift` containing `{Base}View: View` and no page-specific UIKit controller. `view_controller` requires both `{Base}View.swift` and `{Base}ViewController.swift`; the controller is a `UIViewController` containing the SwiftUI view through a child `UIHostingController<{Base}View>`.
- The artifact names are deterministic. Follow the repository for directories and target membership, but do not silently rename a configured artifact. Extend a matching existing file or block on an incompatible collision.
- A page's source id is implied by nesting. Destinations use `module.page`.
- `push`, `sheet`, and `full_screen` require a real destination.
- `back` and `dismiss` never create a destination, but may declare an optional `destination` identifying the existing page instance revealed after the pop or dismissal. Omit it when the current navigation stack or presentation relationship determines the result dynamically. They never use `url`, `destination_instance`, or `parameters`.
- A declared `back` or `dismiss` destination must reference a page in this configuration. If implementation must create that page or it is not already in the navigation stack or presentation relationship, use `push`, `sheet`, or `full_screen` instead. A multi-level stack operation is not an ordinary `back` action.
- `external` requires `url`.
- Several Figma links under `states[]` are variants of one page, not separate tasks.
- `behaviors[]` describes page interaction and layout behavior that a static Figma frame does not show. It defaults to an empty array when omitted.
- Every behavior requires `id`, `type`, and a non-empty semantic `target`. Supported types are `scroll`, `scroll_lock`, `sticky`, `fixed`, `keyboard_avoidance`, `pull_to_refresh`, `pagination`, and `interaction`.
- `axis` is optional and supports `vertical`, `horizontal`, or `both`. `fixed_regions` is an optional list of unique non-empty semantic region names.
- `states` optionally limits a behavior to unique state ids in the same page; omit it to apply the behavior to all page states. `condition` and `note` are optional non-empty strings.
- An `interaction` behavior requires `trigger`, `run_policy`, and either an optional same-page `state_change` or at least one item in `actions[]`. Trigger events are `tap`, `page_appear`, `page_disappear`, `state_enter`, `state_exit`, `timer_finished`, `video_finished`, and `custom_event`; run policies are `once_per_instance` and `every_time`.
- For `tap`, behavior `target` names the clicked button or region. For lifecycle and completion events, it names the semantic event owner. `timer_finished` and `video_finished` require `trigger.source` to reference the behavior that started the countdown or playback. `custom_event` requires `trigger.name`.
- `state_change` references a state on the interaction's source page. It runs before all `actions[]`, whose declaration order is the execution order. Action types are `navigate`, `present_popup`, `dismiss_popup`, `start_countdown`, `stop_countdown`, `start_countup`, `stop_countup`, `play_video`, `pause_video`, `stop_video`, `emit_event`, and `custom`. Countdown, count-up, and video actions require `actions[].target`. Event and custom actions require `name`.
- A popup has `page_role: popup` and owns its reusable appearance plus a required `popup` structure. `popup.fields` contains required booleans for `title`, `subtitle`, and `content`; `popup.buttons` is an ordered list of unique stable button ids and may be empty. A screen must not define `popup`.
- `present_popup` must reference a popup destination. Its `content` mapping contains exactly the enabled template fields. Its ordered `buttons` bindings must exactly match the template ids; each binding has a non-empty `text` expression and a `callback` with an optional caller `state_change` plus ordered `actions`. Clicking a button closes the concrete popup first, then applies the caller state change and callback actions. A nested `present_popup` carries its own complete bindings.
- `dismiss_popup` has no destination. A `navigate` action either defines one route directly or a `branches` array with at least two routes; it must not mix those forms. Every branch requires a non-empty unique `condition`. `push`, `sheet`, and `full_screen` routes must reference screen destinations, and an optional `back` or `dismiss` destination must also be a screen page. An action list permits at most one presentation-changing action (`navigate`, `present_popup`, or `dismiss_popup`), and it must be the final item. The same rule is applied recursively to popup button callbacks.
- Action `parameters` is an action-specific mapping from valid parameter names to non-empty runtime expressions. Navigation parameters carry destination input; popup presentations use typed `content` and `buttons` instead. It guides implementation and is not parsed by the shipped app.
- Do not infer a legacy popup-like state as a popup page. Convert it manually when its behavior and reusable appearance are clear.
- A page id represents a page type. Do not add separate page entries for runtime instances such as `a1`, `a2`, and `a3`.
- A `navigate` action back to its own page id represents another instance and requires `destination_instance: new`.
- Behavior and navigation-branch `condition` values are non-empty implementation expressions. Use mutually exclusive conditions. Prefer `navigate.branches` when one event chooses among destinations; use separate behavior conditions when the event also changes other actions or state.
- `destination_instance`, when present on `push`, `sheet`, or `full_screen`, currently supports only `new`. Do not use it on `back`, `dismiss`, or `external`.
- `navigate` route parameters carry destination input as non-empty runtime expressions for destination-creating routes. In conditional navigation, parameters belong to the individual branch.
- `present_popup.content` carries exactly one non-empty runtime expression per enabled template field.
- `present_popup.buttons` carries exactly one ordered binding per template button. Each popup button callback belongs to the caller and must define a caller state change, one or more actions, or both.
- Countdown and count-up actions require only a semantic `target`. The implementation resolves duration, initial value, formatting, and update cadence from the design plus the app's existing timer owner. Legacy optional countdown `parameters` remain readable for compatibility but the editor does not create or require them.

Declare a shared mock source once and reference it from every consuming page:

```yaml
mock_data_sources:
  - id: today-session
    swift_type: TodaySession
    fixture: standard
modules:
  - id: today
    title: Today
    entry_page: today
    pages:
      - id: today
        title: today
        page_type: view_controller
        data_dependencies:
          - source: today-session
            access: read_write
        # ... lifecycle, states, and behaviors
      - id: today-detail
        title: today detail
        page_type: view
        data_dependencies:
          - source: today-session
            access: read_only
        # ... lifecycle, states, and behaviors
```

Compose one project-native store/service/repository owner initialized from the `standard` fixture, inject it into `TodayViewController` and `TodayView`, and pass only an `itemID` when navigating to Today Detail. `TodayViewController` still embeds `TodayView` with a child `UIHostingController`; it does not own a separate mock copy.

Keep every result of a page event in the same `behaviors[]` list:

```yaml
states:
  - id: default
    title: Player
    figma_url: https://www.figma.com/design/FILE/Player?node-id=1-1
  - id: loading
    title: Loading
    figma_url: https://www.figma.com/design/FILE/Player?node-id=1-2
behaviors:
  - id: submit
    type: interaction
    target: submit_button
    states: [default]
    trigger: { event: tap }
    state_change: loading
    actions:
      - type: emit_event
        name: submission_started
    run_policy: every_time
  - id: start-workout-countdown
    type: interaction
    target: start_button
    trigger: { event: tap }
    actions:
      - type: start_countdown
        target: countdown_label
      - type: start_countup
        target: elapsed_time_label
    run_policy: every_time
  - id: play-workout-video
    type: interaction
    target: play_button
    trigger: { event: tap }
    actions: [{ type: play_video, target: workout_video }]
    run_policy: every_time
  - id: open-details
    type: interaction
    target: details_button
    trigger: { event: tap }
    actions:
      - type: navigate
        branches:
          - condition: session.is_member
            style: push
            destination: account.details
            parameters: { itemID: selected_item_id }
          - condition: "!session.is_member"
            style: full_screen
            destination: auth.sign-in
            parameters: {}
    run_policy: every_time
```

Model a reusable popup as a structure-only template, then bind every concrete presentation on its caller:

```yaml
# On the calling screen
- id: request-delete-confirmation
  type: interaction
  target: delete_button
  trigger: { event: tap }
  actions:
    - type: present_popup
      destination: common.confirmation-popup
      content:
        title: delete_title
        content: delete_confirmation_message
      buttons:
        - id: cancel
          text: cancel_text
          callback:
            actions:
              - type: dismiss_popup
        - id: confirm
          text: confirm_text
          callback:
            state_change: deleting
            actions:
              - type: navigate
                style: push
                destination: account.delete-result
  run_policy: every_time

# On common.confirmation-popup
page_role: popup
popup:
  implementation_status: todo
  fields:
    title: true
    subtitle: false
    content: true
  buttons:
    - id: cancel
    - id: confirm
```

The popup declares reusable slots only. The caller supplies display text and decides whether each click changes caller state, navigates, or presents another popup. The implementation closes the current popup before executing that callback.

For repeated page instances, use two behaviors with the same tap target and mutually exclusive `condition` values. Put `destination_instance: new` inside the self-navigation item in `actions[]`. For `back` or `dismiss`, an optional destination names the existing page revealed afterward; it never creates or pushes that page.

Implement `once_per_instance` with state owned by that page instance; do not accidentally restart it after a temporary cover or sheet. Implement `every_time` for each matching occurrence. Timers and playback subscriptions must follow the existing owner lifecycle and stop when that owner is released; add explicit stop behaviors when disappearance must cancel work.

Keep target and region names semantic rather than tied to Figma node ids or Swift type names. Behaviors are implementation guidance, not runtime configuration. The schema v1-v4 migrations are compatibility bridges, not permission to keep authoring separate transition sections or singular action fields.

## Page Lifecycle

Use the script for status changes so YAML is validated, leading comments are retained, and writes are atomic:

```bash
ruby <skill-root>/scripts/task_config.rb validate --config <project-root>/InAppFigma/InAppFigma.yaml
ruby <skill-root>/scripts/task_config.rb list --eligible --config <config>
ruby <skill-root>/scripts/task_config.rb claim <module> <page> --config <config>
ruby <skill-root>/scripts/task_config.rb changes <module> <page> --config <config>
ruby <skill-root>/scripts/task_config.rb complete <module> <page> --commit <hash> --config <config>
ruby <skill-root>/scripts/task_config.rb fail <module> <page> --reason <text> --config <config>
ruby <skill-root>/scripts/task_config.rb block <module> <page> --reason <text> --config <config>
ruby <skill-root>/scripts/task_config.rb requeue <module> <page> --reason <text> --config <config>
ruby <skill-root>/scripts/task_config.rb amend <module> <page> --reason <text> --config <config>
```

Select eligible pages in document order. `claim` changes `todo` or `failed` to `in_progress` and increments attempts. A second claim is rejected. `done`, `blocked`, and `in_progress` are never eligible.

`changes` prints deterministic YAML grouped into `states`, `behaviors`, and `popup`. Each emitted item includes `kind`, stable `id`, `implementation_status`, `change`, and `changed_fields`. Popup structure uses the stable task id `structure`. It reports only unfinished work or contract differences: `added` creates implementation, `modified` starts from the listed fields, `removed` deletes the accepted implementation and stale references, and `unchanged` with a non-`done` status requests a focused recheck. A rename is a removal plus an addition.

After interruption, inspect the recorded worktree, branch, commit, and changed files before using `requeue`; never assume `in_progress` is abandoned. Mark `complete` only after its implementation is integrated and its source/project/visual/interaction checks pass. Use `fail` for a retryable implementation failure and `block` for unresolved external input.

Use `amend` only for a `done` page that has a new design or implementation change. It performs `done -> in_progress`, increments `attempts`, archives previous acceptance metadata in `acceptance_history`, preserves `accepted_baseline`, and requires a reason. Run it before editing Swift when configuration has not already entered amendment through a confirmed browser save. `requeue` remains recovery for interrupted, failed, or blocked work and intentionally rejects `done`; `claim` also continues to reject `done`. After amendment acceptance, mark every current and removed item task `done`, then use `complete` to establish the new baseline, clear removals, and record the current commit and completion time.

## Ownership And Parallelism

The parent alone initializes, validates, claims, and updates the configuration, including item statuses. Workers receive only the unfinished state, behavior, popup structure, and removal tasks plus required shared context, but never edit `InAppFigma.yaml`.

`execution.parallel: true` is an explicit parallel request. Apply `max_parallel` only to pages already proven independent; shared routing and project metadata remain parent-owned. Record the page commit on `complete` when the parallel workflow creates one. Serial work may complete without a commit.

## Schema v6 Migration

Opening a schema v6 document migrates it to schema v7 in memory without rewriting existing actions. Schema v7 adds count-up timer actions, makes countdown parameters optional, and adds conditional navigation branches. Existing single-route navigation and countdown parameters remain valid.

## Schema v5 Migration

Opening a schema v5 document first migrates it to schema v6 and then schema v7 in memory. A popup's legacy `return_popup_result` behaviors become ordered template button ids when each result maps uniquely. Matching caller `popup_result` behaviors are folded into the corresponding `present_popup.buttons[].callback`; exact legacy `title`, `subtitle`, and `content` parameters become typed content, `message` maps to `content`, and only `<result>_text` maps to a button label.

The migration never guesses when several targets share a result, a continuation cannot be tied to one presentation, a required text value is missing, or unknown parameters remain. It preserves those fragments in `migration_compatibility`, surfaces an editor issue, and blocks validation/save until the author resolves the mapping. Reopening the migrated draft is idempotent and does not duplicate buttons or callbacks. Accepted state and behavior baselines are migrated independently from current contracts so pre-existing amendments and removals remain visible.
