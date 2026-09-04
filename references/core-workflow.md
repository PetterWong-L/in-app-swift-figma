# Core Workflow

Read this reference for every task.

## Preflight

Before reading design details or editing Swift:

1. Resolve the repository root, application source directory, workspace or project, primary scheme, app target, and project-generation source of truth.
2. For initialization or a long task, ensure `InAppFigma/InAppFigma.yaml` and `InAppFigma/OpenInAppFigma.command` exist together through [task-configuration.md](task-configuration.md), then validate the YAML. If either already exists, do not overwrite it.
3. Resolve `delivery.profile` and read [page-delivery-profiles.md](page-delivery-profiles.md). When configuration is absent, use `strict`. Do not silently broaden or reduce the stages required by the selected profile.
4. Inspect nearby screens and components with the same presentation or interaction pattern. Identify their hosting controllers or base classes, routing, lifecycle, state ownership, dependency injection, and file placement.
5. Inspect existing production and development data boundaries: repositories, services, stores, coordinators, environment values, preview fixtures, and test fixtures. When production data is unavailable, identify which configured shared mock source drives each supplied state and which owner must outlive navigation between its consuming pages.
6. Identify the local UI stack: SwiftUI support and deployment target, existing `UIHostingController` usage, UIKit navigation conventions, layout/token helpers, fonts, colors, themes, localization, asset catalogs, reusable components, accessibility support, and supported devices.
7. Inspect `git status --short` and the relevant diff. Preserve unrelated user work.
8. For a configured page, run `task_config.rb changes <module> <page> --config <config>`. Build implementation scope from non-`done` state, behavior, and removal tasks plus their `added`, `modified`, `removed`, or `unchanged` evidence; do not reopen unchanged `done` tasks.
9. When the configured page is still `done`, run `amend` with a concrete reason before editing Swift. A completed-page configuration edit saved in the browser uses its atomic amendment confirmation instead. Do not use `requeue` or silently reset status.

Do not assume a new feature folder, ViewModel, coordinator, protocol, or dependency is needed. Add one only when the repository already uses that boundary or the requested behavior genuinely requires it.

## Design Evidence

Read every supplied Figma link, screenshot, and specification before editing. For multi-page or amendment work, capture and reuse this evidence through [execution-efficiency.md](execution-efficiency.md). Gather:

- frame and safe-area dimensions
- constraints and responsive behavior
- copy, typography, color, opacity, stroke, radius, shadow, and spacing
- assets and rendering modes
- variants, loading, disabled, selected, empty, error, and retry states
- navigation, gestures, keyboard behavior, and transitions

When several links describe one screen or component, model them as states or variants of one existing UI owner unless the product flow clearly requires separate destinations. When inspect metadata conflicts with the rendered design, use the screenshot for visual composition, use metadata as supporting measurements, and report the discrepancy.

If the target node, screen, or component is ambiguous, obtain the node-specific URL or a precise target before implementation. User-provided requirements override conflicting generic guidance.

## Implementation Map

Before editing, identify:

- the existing owner to extend or the minimal new screen/component to add
- the configured page type, exact title-derived Swift files, and existing project location where they belong
- the SwiftUI root view and its system `UIHostingController`; for `view_controller`, the required UIKit container and child-hosting boundary
- the system navigation bar title, display mode, actions, appearance, and back behavior
- the navigation entry and exit behavior
- all unfinished design-state, behavior, popup structure, and removal tasks reported by `changes`: apply each optional same-page `state_change` first, then its ordered actions; popup presentation targets reusable popup templates and navigation targets screen pages; each popup button closes its concrete popup first, then runs its caller-owned state change and ordered callback actions
- each configured data dependency, its deterministic fixture, access mode, runtime owner lifetime, and later production replacement boundary
- reusable project components and exact new assets
- source-list or target-membership changes
- the device sizes, locales, and interactions used for acceptance

Keep the mapping proportional to the feature. Avoid unrelated refactors and speculative data-layer work.

When several pages reference one mock data source, create its fixture once and compose one shared owner instance at the existing flow/module/application boundary. `read_only` pages observe it; `read_write` pages may mutate it through established project APIs. Navigation passes only destination-specific inputs such as `itemID`; the destination resolves that item from the same owner. Do not use `InAppFigma.yaml` as a runtime fixture file.

### Example

Three Figma links for default, loading, and failure payment states normally map to one SwiftUI payment view with one state model and one `UIHostingController`. A page titled `payment` with `page_type: view` maps to `PaymentView.swift`. With `page_type: view_controller`, it maps to `PaymentView.swift` plus `PaymentViewController.swift`; the controller contains the SwiftUI view through a child host. Do not create one controller per visual state or a second navigation framework.

## Workflow

1. Establish project fit; initialize/validate long-task configuration when applicable.
2. Claim a new configured page, or confirm/amend a completed one, then inspect `changes` and build a bounded packet for unfinished item tasks only.
3. Complete the asset intake gate, then map states to a SwiftUI root view, hosting controller, and UIKit navigation.
4. Implement the reported state, behavior, popup structure, and removal tasks. For each popup button callback, dismiss that concrete popup before applying the caller state change and ordered actions. Widen scope only for a concrete shared-code dependency.
5. Self-check the page before its first full review; review amendments by delta unless an upgrade condition applies.
6. Run focused checks, integrate accepted work, then run broad project/build verification at the appropriate boundary.
7. Mark each item task `done` after its required checks, then complete, fail, or block the page; report evidence, accepted residuals, and limits.
