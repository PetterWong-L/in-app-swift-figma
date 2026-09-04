# Page Delivery Profiles

Read this reference before implementing, reviewing, amending, or accepting an in-app page. The selected profile controls which page-delivery stages apply; configuration mechanics and editor behavior remain in [task-configuration.md](task-configuration.md).

## Profile Router

### `strict`

Use for end-to-end delivery. Apply **Page Implementation**, **Project Conventions**, **Review**, and **Completion Gate**. This is the default when `InAppFigma.yaml` or `delivery.profile` is absent.

Read [hosting-and-navigation.md](hosting-and-navigation.md) for every full page, [ui-implementation.md](ui-implementation.md) for every screen/component/interaction, and [assets-and-verification.md](assets-and-verification.md) when assets change and before acceptance.

### `implementation`

Use when configured work should stop after implementation and focused engineering checks. Apply **Page Implementation** and **Project Conventions**. Complete asset intake for assets the implementation depends on and run relevant build/tests, but do not perform the formal visual review, invoke the completion lifecycle action, or describe the page as accepted. Keep a configured page `in_progress` for a later `review` or `strict` pass.

Read [hosting-and-navigation.md](hosting-and-navigation.md) for every full page, [ui-implementation.md](ui-implementation.md) for every screen/component/interaction, and the intake sections of [assets-and-verification.md](assets-and-verification.md) when assets change.

### `review`

Use for review and acceptance of an existing implementation. Apply **Review** and **Completion Gate**. Read [assets-and-verification.md](assets-and-verification.md) in full and inspect applicable implementation rules before judging the code. Do not infer permission to change app source from this profile alone; when fixes are in scope, apply **Page Implementation** and **Project Conventions** to those edits.

## Page Implementation

- Preserve existing navigation, lifecycle, localization, state management, target membership, project-generation conventions, and dependency injection.
- Prefer a SwiftUI root hosted by system `UIHostingController` for a full page. Use UIKit-rendered content only when an observable project or feature constraint requires it.
- Treat `page_type` and title-derived Swift artifacts as a contract. `view` owns `{Title}View.swift`; `view_controller` owns that view plus `{Title}ViewController.swift`, with a child system hosting controller.
- Keep top-level navigation in the existing `UINavigationController`. Configure the system bar from the routed owner instead of building a duplicate SwiftUI bar.
- Pass destination input such as an id through navigation parameters. Resolve shared models from one injected runtime owner rather than copying models or mutable fixtures between pages.
- Export design-specific artwork. Do not substitute generic artwork unless the design uses it or the user explicitly accepts the substitution.
- Build a compact state evidence matrix before layout edits: reference frame, safe areas, primary bounds, spacing, radius, typography, colors, opacity, z-order, image crop, and state-specific data.
- Identify the owner of top chrome and safe-area behavior. If it cannot reproduce the design and no explicit system-component exception applies, surface the ownership decision rather than silently accepting drift or replacing it.
- Derive layout constants from design relationships or established project tokens. Keep every visible Figma state driven by explicit state and deterministic data.
- Compare the first render with its reference before polishing. Correct primary geometry, safe areas, image treatment, and z-order before typography and minor styling.

### SwiftUI Geometry Discipline

- Do not use `GeometryReader`, `UIScreen` bounds, device checks, or a global metrics object as the default page layout mechanism.
- Prefer intrinsic sizing, `frame`, padding, `safeAreaInset`, overlays, backgrounds, `aspectRatio`, `containerRelativeFrame`, `ViewThatFits`, or a custom `Layout` when the relationship is reusable.
- Build progress fills at their final track size with `scaleEffect(x:anchor:)` or `trim`; do not measure a track merely to multiply its width by progress.
- Express image treatment through the design aspect ratio, crop frame, alignment, and clipping. Extend only intentional backgrounds or media beyond safe areas.
- Use `GeometryReader` only for a local component that genuinely needs runtime parent geometry and has no semantic layout equivalent. Document that dependency in code or review evidence.

## Project Conventions

- Inspect nearby screens with the same presentation and interaction patterns before selecting files or abstractions.
- Reuse project-native components, tokens, fonts, colors, routing, stores/services, accessibility patterns, and localization mechanisms.
- Define one deterministic fixture per shared mock source and inject one owner through the existing composition boundary. Production data replaces that provider without rewriting page UI.
- Add a new feature folder, ViewModel, coordinator, protocol, or data layer only when the repository already uses that boundary or the requested behavior requires it.
- Keep source-list and target-membership changes minimal and follow the repository's source of truth. Never add the orchestration YAML or launcher to the app target.
- Treat an explicit user-designated system component as the only boundary where OS-controlled visual drift is accepted. Continue verifying all app-controlled labels, icons, tint, ordering, routing, selection, accessibility, visibility, and surrounding safe-area behavior.
- Treat a `system_ui` flag as active only after collecting system ownership evidence from the runtime owner and source type. A similarly shaped custom SwiftUI or UIKit control does not qualify.

## Review

- Read every supplied Figma state and exercise the interaction that reaches it; previews or initializer-only states are not sufficient evidence.
- Complete the asset intake gate and record reused/exported assets or an explicit no-assets result. Missing crops, wrapper compositions, or design-specific icons block dependent review.
- Render every supplied state at the reference size and at the smallest and largest relevant supported sizes.
- Compare current screenshots against references with an overlay or another coordinate-based method. Record hierarchy, safe areas, navigation chrome, spacing, radius, typography, color, opacity, image crop, scrolling, fixed actions, and modal coverage.
- Search changed SwiftUI files for `GeometryReader`, `UIScreen` bounds, and proxy-size arithmetic. Justify each remaining use and reject convenience measurement for fixed design values, progress, safe areas, image crops, sheets, or root positioning.
- Verify source integration, route reachability, interaction behavior, lifecycle cleanup, localization, accessibility, assets, relevant tests, and the applicable build.
- Strict Figma fidelity remains the default. Limit accepted OS-version drift to exact component boundaries explicitly designated by the user; never extend one designation to another component.
- When `system_ui.<component>` is `true` and system ownership evidence is present, exclude only the OS-owned rendering inside that component's bounds from visual-difference findings. Compare every app-controlled value and every pixel outside the bounds normally.

## Completion Gate

A configured page may become `done` only when the current run records:

- an asset manifest or explicit no-assets result;
- one render for every supplied state and the interactions used to reach it;
- coordinate-based comparison findings at the required device sizes;
- source, routing, behavior, build, and relevant test results;
- resolution of every visible `P0` through `P2` finding, with any accepted `P3` residual recorded.
- for every enabled `system_ui` flag, source/runtime evidence identifying the system owner plus screenshot evidence identifying the exact excluded bounds.

Build success, YAML validation, route reachability, and inspection of only the default state are necessary but insufficient. Complete pages individually; never batch-mark pages `done` because the project builds or the flow launches. Never claim pixel-perfect fidelity without current render comparisons for every relevant state.

## Amendment And Drift Recovery

- Reproduce reported drift before editing a `done` page, then use `amend` with the concrete reason and preserve the old render as a baseline when available.
- Use focused delta review only when primary layout, navigation ownership, assets, and state mapping remain unchanged; otherwise review the full page.
- Repeated spacing, safe-area, system-chrome, asset-substitution, or missing-state failures indicate process drift. Update the relevant check or skill instruction before accepting the amendment.
- If required evidence cannot be produced, state the precise limitation and keep the page non-done.
