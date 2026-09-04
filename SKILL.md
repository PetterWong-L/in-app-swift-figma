---
name: in-app-swift-figma
description: Use when Figma designs must become in-app SwiftUI or UIKit screens in an existing iOS app, when completed screens need design or implementation amendments, or when InAppFigma.yaml must be configured or resumed. Exclude GeneralOB onboarding and web targets.
metadata:
  author: Yao Team
---

# In-App Swift Figma

Implement inside the existing app architecture while preserving its navigation, routing, lifecycle, state, assets, fonts, and localization.

## Reference Router

1. Always read [core-workflow.md](references/core-workflow.md).
2. Read [task-configuration.md](references/task-configuration.md) when initializing the skill, opening the local configuration editor, visualizing page flow or Figma previews, when `InAppFigma.yaml` exists, or when a long task contains at least two pages/modules.
3. Before page implementation, review, amendment, or acceptance, read [page-delivery-profiles.md](references/page-delivery-profiles.md). Use `delivery.profile` from `InAppFigma.yaml`; when configuration is absent, use `strict`.
4. Read only the implementation references required by the selected delivery profile and task shape, as routed by `page-delivery-profiles.md`.
5. Read [execution-efficiency.md](references/execution-efficiency.md) for multiple pages/modules, worker dispatch, reviews/amendments, or repeated Figma/build work.
6. Read [parallel-execution.md](references/parallel-execution.md) only for at least two independent units plus an explicit parallel request. `execution.parallel: true` is explicit.

## Cross-Mode Invariants

- Inspect the project and nearby UI before choosing files, base classes, dependencies, state patterns, or ownership boundaries.
- Treat multiple design links as states or variants of the same UI owner when they describe one user-facing screen or component.
- Treat `behaviors[]` as the single source of truth for page events. Keep state changes, popup presentation with caller-owned button callbacks, navigation, countdowns, and video control in the triggering behavior.
- Treat root `mock_data_sources[]` as shared development contracts and page `data_dependencies[]` as references. Keep fixture values in Swift development code; the shipped app never parses `InAppFigma.yaml`.
- Treat root `system_ui` booleans as explicit, narrow visual-gate exceptions. Require source/runtime proof of system ownership and ignore only OS-owned pixels inside the enabled component boundary; all app-controlled content, behavior, accessibility, and surrounding layout remain in scope.
- The parent owns `InAppFigma.yaml` and every page/item status. Before Swift work, run `ruby <skill-root>/scripts/task_config.rb changes <module> <page> --config <config>`. Implement only current or removed state, behavior, and popup structure tasks whose `implementation_status` is not `done`; use `added`, `modified`, `removed`, or `unchanged` evidence to bound the change and preserve unchanged `done` work. Workers never edit configuration or statuses.
- Reopen a configured `done` page only through CLI `amend` with a concrete reason or the browser's atomic amendment confirmation. Preserve its tool-owned `accepted_baseline`.
- Keep `InAppFigma.yaml` and `OpenInAppFigma.command` together as the only tool artifacts in the project-root `InAppFigma/` directory, outside every Xcode target and Resources Build Phase.
- Create per-unit worktrees and commits only through the conditional parallel workflow. Otherwise work serially in the current workspace without automatic commits.
- Never stage, overwrite, reformat, or revert unrelated user changes.

## Execution Mode

| Task shape | Explicit parallel request | Mode |
|---|---:|---|
| One page or module | Either | Current workspace, serial, no automatic commit |
| Multiple units with overlapping files or sequential dependencies | Either | Current workspace, serial, no automatic per-unit worktree |
| Multiple independent pages or modules | No | Current workspace, serial, no automatic commit |
| Multiple independent pages or modules | Yes, directly or by config | One isolated worktree and one commit per unit; parent integrates and verifies |
