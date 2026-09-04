# UI Implementation

Read this reference for every screen, component, or interaction implementation.

## Project Contract

- Prefer a focused SwiftUI `View` for page content. Use the configured title-derived type and filename contract, while matching nearby hosting, lifecycle, routing, dependency injection, state ownership, directory placement, and target membership.
- Import only modules required by the target.
- Localize visible strings with the project's mechanism.
- Reuse matching components. Create a local component only for a real difference; share it only after demonstrated reuse.
- Do not invent backend behavior, persistence, navigation, or abstractions to fill an unspecified design gap.
- When a page declares `data_dependencies`, receive them through the project's existing initializer, environment, store, service, coordinator, or factory boundary. Do not instantiate a second copy of a shared mutable mock inside the page or its hosting controller.
- Keep each named fixture deterministic and sufficient to render every configured state. Prefer the project's established mock/preview/test fixture conventions; add the smallest provider or repository seam only when production replacement genuinely requires it.

## Layout

Treat the Figma frame as design evidence, not as a fixed coordinate canvas.

- Prefer semantic SwiftUI containers and controls: `List`, `Form`, `ScrollView`, stacks, grids, safe-area insets, `Button`, `Toggle`, and `ProgressView`. Reuse project components and tokens first.
- Express relationships through SwiftUI layout rather than absolute coordinates, broad `GeometryReader` usage, or compensating offsets.
- Allow text to wrap and use semantic or project fonts that support the project's text-size behavior. Verify the longest supported localization.
- Make tall content scroll. Use `safeAreaInset(edge: .bottom)` for a fixed bottom action so content remains unobscured.
- Preserve intentional stacking: titles, overlays, menus, loading views, and controls must remain in the correct z-order.
- Treat Figma radius values such as `99` or `999` as a capsule or half the rendered height when that matches the screenshot, not automatically as literal points.
- Do not assign arbitrary fixed dimensions to reusable controls when state, localization, or device changes would shift surrounding layout. For a justified UIKit fallback, follow the project's Auto Layout or SnapKit conventions.

## States And Interaction

- Implement every supplied state and the configured behaviors that move between them: default, loading, disabled, selected, empty, error, retry, or other design variants.
- Drive visual differences from the existing state model using project observation and binding conventions. Do not duplicate a screen for each Figma link.
- Exercise shared mock data as a real flow: mutate it from each `read_write` page and verify every other consuming page observes the same owner. A `read_only` page must not expose mutation solely to satisfy the mock.
- Preserve relevant input and selection across loading or retry when required.
- Prevent duplicate actions while a non-reentrant operation is in flight.
- Match enabled, disabled, highlighted, selected, loading, and error appearance as applicable.
- When `InAppFigma.yaml` defines an `interaction` behavior, connect its semantic target and trigger to the existing page or state lifecycle. Apply its optional same-page `state_change` first, then execute `actions[]` in declaration order. Respect `run_policy`; keep countdown, count-up, playback, and subscription state in the established owner and release it with that owner. `present_popup` presents its reusable `page_role: popup` destination with the concrete content and button bindings declared by that action; `navigate` uses the existing UIKit routing owner and a `page_role: screen` destination. For `navigate.branches`, evaluate the declared mutually exclusive conditions at event time and route through the first matching branch without moving routing ownership into the view. Do not recreate popup appearance as source-page state.
- Implement each configured popup button through the host application's existing callback, delegate, closure, coordinator, or routing convention. Supply the concrete presentation's title, subtitle, content, and button labels from its typed bindings. Dismiss that popup first and wait for dismissal completion before applying the configured caller state change and ordered callback actions. The shared popup template must not import caller-specific destinations, navigate on the caller's behalf, or require a new global event bus.
- Verify touch targets, accessibility, focus or keyboard behavior, and gesture conflicts.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Starting from a generic feature-folder or MVVM template | Inspect nearby ownership and follow the repository's actual structure. |
| Recreating one controller per visual state | Use one owner with explicit state-driven rendering. |
| Nesting `NavigationStack` under the app's UIKit navigation bar | Let the hosting controller own top-level navigation chrome. |
| Pinning a 390 pt design with absolute coordinates | Preserve SwiftUI layout relationships and verify supported screen sizes. |
| Letting a fixed bottom action cover long content | Use a safe-area inset and verify scrolling content remains visible. |
| Adding dark mode, persistence, or navigation not requested or established | Implement only evidenced product behavior and project conventions. |
| Making a shared popup navigate to a caller-specific page | Return a semantic result, dismiss, and let the calling screen own the continuation. |
