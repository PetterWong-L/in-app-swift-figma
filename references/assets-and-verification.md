# Assets And Verification

Read this reference for asset work and before accepting any implementation.

## Asset Intake Gate

Before writing layout that depends on a design asset, inspect every asset to be exported or reused and record a compact, temporary manifest containing its Figma node id, raw-leaf or composed-wrapper role, local key, format, dimensions, alpha presence, digest, baked visible text, and required crop/overlay/gradient treatment. If the page has no design assets, record that and continue.

Stop before layout implementation when distinct nodes unexpectedly produce identical bytes, a raster is fully transparent or visually blank, a transparent SVG contains an unintended full-canvas background, or a raw leaf omits wrapper composition required by the rendered design. Resolve or explicitly block the asset instead of discovering it after page review. Keep the manifest outside the app target and apply [execution-efficiency.md](execution-efficiency.md) when deciding whether evidence must be fetched again.

## Assets

Inspect the project's existing asset catalogs, namespaces, naming, rendering modes, and lookup conventions before exporting.

- Reuse an existing asset only when its visual content and semantic meaning match the design.
- If a same-named asset differs, do not overwrite it. Add a scoped, descriptive name that cannot change another screen.
- Export a format and scale supported by both the design source and project. Preserve transparency, vector behavior, cap insets, and original rendering where required.
- Design-specific icons and illustrations are required assets. Do not replace them with SF Symbols, generated drawings, emoji, or generic system artwork unless the design does so or the user explicitly approves a substitute.
- Verify asset catalog JSON, target membership, generated-project inputs, and runtime lookup names. Inspect rendered output for blank, tinted, stretched, or incorrectly cropped assets.

## Acceptance

Verify every applicable layer:

- **Source:** the implementation follows the SwiftUI-first hosting strategy or records a valid UIKit fallback; naming, lifecycle, localization, dependencies, and state ownership match nearby architecture; configured mock sources are deterministic, shared by reference, and replaceable at the existing production data boundary; no unrelated files changed.
- **Project:** new Swift and asset files belong to the correct target or generator source list; lookups resolve; the selected scheme still builds.
- **Visual:** render every supplied state at the design device size and relevant supported sizes. Compare screenshots or overlays for hierarchy, system navigation-bar standard/scroll-edge states, safe areas, typography, spacing, color, opacity, radius, shadow, image treatment, scrolling, fixed actions, long localization, and blank assets. For each enabled `system_ui` flag, first verify the source/runtime system owner, record the component bounds, and ignore only OS-owned pixels inside that component boundary. Continue comparing app-controlled content, tint, ordering, selection, visibility, interaction, accessibility, and all surrounding pixels.
- **Interaction:** exercise system back and interactive-pop behavior, navigation actions, gestures, keyboard behavior, buttons, selection, loading, disabled, empty, failure, retry, accessibility behavior, and cross-page mock mutations shown or required.
- **Regression:** check shared components and reused assets in affected existing screens when the change can alter them.

Run focused tests or static checks first, then the appropriate workspace or project scheme build. Use the repository's established simulator destination and build conventions; do not invent a different validation pipeline.

## Completion Report

Report:

- changed files and target/project metadata
- `UIHostingController + SwiftUI` usage or the concrete reason for a UIKit fallback
- system navigation-bar configuration and back-gesture evidence
- design states implemented
- reused and added assets/components
- devices, locales, interactions, tests, and build command verified
- screenshot-comparison evidence and recorded design discrepancies
- enabled `system_ui` exceptions, their system-ownership evidence, and the exact excluded screenshot bounds
- blockers or validation that could not be performed
- `InAppFigma.yaml` validation and final page status when the task is configured

Do not say `pixel-perfect`, complete, passing, or verified without the corresponding current evidence.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Using a close SF Symbol to meet a deadline | Export the actual artwork or obtain explicit substitution approval. |
| Overwriting a same-named catalog asset | Compare content, then reuse exactly or add a scoped name. |
| Checking only the default state | Render and exercise every supplied variant and transition. |
| Reporting visual fidelity from code inspection | Capture an actual render and compare it with the design. |
