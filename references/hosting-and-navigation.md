# Hosting And Navigation

Read this reference for every full in-app page.

## Default Strategy

Every configured page keeps its content in a SwiftUI `View` and uses the system `UIHostingController<Content>`. `page_type` determines whether that host is the routed controller or a child of an explicitly named UIKit container:

| `page_type` | Required artifacts | Hosting boundary |
|---|---|---|
| `view` | `{Base}View.swift` with `{Base}View: View` | Existing router, coordinator, or factory presents `UIHostingController<{Base}View>`; do not add a page-specific controller file. |
| `view_controller` | `{Base}View.swift` and `{Base}ViewController.swift` | `{Base}ViewController: UIViewController` embeds a child `UIHostingController<{Base}View>`. |

Derive `{Base}` from the configured page title, not its id: `today` becomes `Today`; `account security` becomes `AccountSecurity`. Match the repository's directories and target-membership mechanism, but keep these exact filenames and type names. If an existing file has the same name and compatible owner, extend it. If it conflicts, stop and reconcile instead of adding a suffix or alternate name.

`view` remains the default and preserves the SwiftUI-first strategy. Use an existing project hosting subclass or factory when it already supplies required behavior. Do not refer to a nonexistent system type named `UIHostingViewController` and do not introduce a new wrapper only to rename `UIHostingController`.

`view_controller` is an explicit UIKit ownership requirement, not permission to replace the designed content with UIKit. The UIKit controller owns containment, top-level navigation chrome, and required lifecycle integration; `UIHostingController` renders the SwiftUI content as its child.

When a page declares shared data dependencies, compose them before creating the routed owner. A `view` page receives the shared owner when its `UIHostingController` is built. A `view_controller` page receives it through the project's established initializer or factory, passes the same instance into `{Title}View`, and then embeds that view with its child `UIHostingController`. Neither owner creates a page-local copy of shared mock state.

Outside an explicit `page_type: view_controller`, use UIKit for page content only when an observable constraint applies:

- the user explicitly requires UIKit
- an existing screen must retain a non-hosting base-controller contract or lifecycle behavior
- a required UIKit-only component or interaction cannot be safely bridged
- the deployment target lacks a required SwiftUI capability and the project has no compatible pattern

Record the constraint when taking the UIKit fallback. Familiarity, an existing generic UIKit template, or pixel positioning is not a fallback reason.

For component-only work, prefer a SwiftUI `View`. Embed it through the project's existing bridge, a child `UIHostingController`, or `UIHostingConfiguration` when appropriate; do not create a standalone controller for a component with no route.

## System Navigation Bar

For `view`, the routed hosting controller owns top-level page chrome. For `view_controller`, the configured UIKit container owns it:

- set the title, `largeTitleDisplayMode`, back behavior, and leading/trailing actions through `navigationItem`
- Treat a configured `back` or `dismiss` destination as the existing page expected to be revealed, not as permission to instantiate or push that page. Verify the current navigation stack or presentation owner matches the declaration.
- customize standard, compact, and scroll-edge states with `UINavigationBarAppearance`, following the project's existing appearance and deployment-target conventions
- prefer the system back button and preserve interactive pop gestures
- keep navigation actions in the controller or existing router; pass content actions through explicit closures or the project's established state boundary
- apply per-page appearance without leaking style changes into unrelated screens

Do not place a `NavigationStack` around the SwiftUI root merely to recreate the enclosing UIKit navigation bar, and do not draw a fake top bar with `HStack`. A nested `NavigationStack` is valid only for a self-contained SwiftUI subflow that does not produce a second visible navigation bar.

System navigation is not an automatic fidelity exception. Accept its OS-version-dependent rendering only when the user explicitly designates that exact navigation component as an exception. Existing system ownership or platform convention alone is insufficient.

If the supplied design cannot be represented by the current owner and the user has not designated an exception, surface the ownership conflict instead of silently accepting system drift or switching to custom SwiftUI chrome. When the user explicitly approves custom page chrome, record that decision and verify back gestures, safe areas, scrolling, transitions, status-bar behavior, and modal z-order. An exception designated for a Tab Bar, sheet, alert, or another system component never transfers to the navigation bar.

## Example

```swift
import SwiftUI
import UIKit

struct TodayModel {
    let title: String
}

struct TodayView: View {
    let model: TodayModel

    var body: some View {
        Text(model.title)
    }
}

final class TodayViewController: UIViewController {
    private let hostingController: UIHostingController<TodayView>

    init(model: TodayModel) {
        hostingController = UIHostingController(rootView: TodayView(model: model))
        super.init(nibName: nil, bundle: nil)
    }

    @MainActor required dynamic init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        hostingController.didMove(toParent: self)

        navigationItem.title = String(localized: "Today")
        navigationItem.largeTitleDisplayMode = .never
    }
}
```

This example is the `page_type: view_controller` shape and belongs in `TodayView.swift` plus `TodayViewController.swift`. For `page_type: view`, keep `TodayView` and let the existing routing boundary construct the system hosting controller directly. Adapt localization, appearance, routing, model ownership, and directory placement to the project without changing the configured artifact names.
