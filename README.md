# In-App Swift Figma

[English](README.md) | [简体中文](README.zh-CN.md)

`in-app-swift-figma` is a Codex skill for turning Figma designs into SwiftUI or UIKit screens inside an existing iOS application. It preserves the app's architecture, navigation, lifecycle, state ownership, assets, fonts, localization, and build conventions instead of generating an isolated demo.

Use it for in-app screens and components. It intentionally excludes GeneralOB onboarding flows and web targets.

## What it provides

- SwiftUI-first implementation hosted by the app's existing UIKit routing boundary.
- Explicit support for `View` and `UIViewController` page ownership.
- A local bilingual configuration editor for modules, pages, Figma states, interactions, popups, shared mock data, and delivery status.
- Deterministic page and item lifecycle commands for implementation, review, amendments, and acceptance.
- Strict visual verification across every supplied design state.
- Optional worktree-based parallel delivery for explicitly requested, independent pages or modules.

## Requirements

- macOS with Xcode and an existing iOS project (`.xcodeproj` or workspace-backed project).
- Codex with local skill support.
- Git, Ruby, and Node.js available on `PATH`.
- Access to the Figma files and node-specific design URLs used by the task.
- A clean understanding of the target app's build scheme and simulator destination.

The local editor binds only to `127.0.0.1`. The shipped app never reads `InAppFigma.yaml`.

## Installation

### Global installation

Install once for all Codex projects:

```bash
mkdir -p ~/.codex/skills
git clone git@github.com:PetterWong-L/in-app-swift-figma.git \
  ~/.codex/skills/in-app-swift-figma
```

HTTPS is also supported:

```bash
git clone https://github.com/PetterWong-L/in-app-swift-figma.git \
  ~/.codex/skills/in-app-swift-figma
```

If GitHub requests credentials, authenticate the selected Git transport and confirm that your account has repository access. SSH is recommended for regular updates.

### Project-local installation

Use this when a team wants the same skill version inside one repository:

```bash
mkdir -p /path/to/project/.codex/skills
git clone git@github.com:PetterWong-L/in-app-swift-figma.git \
  /path/to/project/.codex/skills/in-app-swift-figma
```

Project-local installation takes precedence for the generated editor launcher when the project contains `.codex/skills/in-app-swift-figma/scripts/task_config.rb`.

### Install a fixed version

After cloning, pin the installation to a release tag:

```bash
git -C ~/.codex/skills/in-app-swift-figma fetch --tags
git -C ~/.codex/skills/in-app-swift-figma switch --detach 1.0.0
```

Return to the latest `main` branch with:

```bash
git -C ~/.codex/skills/in-app-swift-figma switch main
git -C ~/.codex/skills/in-app-swift-figma pull --ff-only
```

### Update an existing installation

```bash
git -C ~/.codex/skills/in-app-swift-figma pull --ff-only
git -C ~/.codex/skills/in-app-swift-figma fetch --tags
```

Start a new Codex task after installation or update so the skill catalog is refreshed.

## Quick start

Set a convenient path for the examples below:

```bash
export IN_APP_FIGMA_SKILL_ROOT="$HOME/.codex/skills/in-app-swift-figma"
cd /path/to/your-ios-project
```

Ask Codex for the feature directly. Mention the skill if you want to force selection:

```text
Use $in-app-swift-figma to implement the account details screen from these
Figma states in the existing iOS app. Preserve the current UIKit navigation,
use the app's localization and design tokens, and run the strict acceptance flow.

Default: https://www.figma.com/design/...?...node-id=1-1
Loading: https://www.figma.com/design/...?...node-id=1-2
Error:   https://www.figma.com/design/...?...node-id=1-3
```

For one simple page, the skill can work directly from the prompt. For a multi-page feature, reusable popup, shared mock data flow, or resumable task, initialize the configuration first.

## Detailed tutorial

### 1. Initialize project configuration

Run this from anywhere and pass the iOS repository root:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" init \
  --project-root /path/to/your-ios-project
```

Initialization creates exactly two development-only files:

```text
<project-root>/InAppFigma/
├── InAppFigma.yaml
└── OpenInAppFigma.command
```

The command refuses unsafe placement, checks discovered Xcode project files, and never overwrites either existing file. Keep both files outside all Xcode targets, synchronized source roots, Copy Bundle Resources phases, and project-generator resource lists.

### 2. Open the local editor

Double-click `InAppFigma/OpenInAppFigma.command` in Finder, or start it from the terminal:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" serve \
  --project-root /path/to/your-ios-project
```

Useful server options:

```bash
# Print the session URL without opening a browser.
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" serve \
  --project-root /path/to/your-ios-project --no-open

# Explicitly request any free local port.
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" serve \
  --project-root /path/to/your-ios-project --port 0
```

The editor starts in Chinese. Use the `中文 | English` toolbar control to change its UI language. It auto-saves valid changes after a short debounce and protects against revision conflicts.

### 3. Choose the delivery profile

Set `delivery.profile` in the editor:

| Profile | Use it for | Stops when |
| --- | --- | --- |
| `strict` | End-to-end implementation and acceptance | Every required state, interaction, asset, build, and visual check passes |
| `implementation` | Implementation plus focused engineering checks | Code is ready for a later review; the page remains `in_progress` |
| `review` | Review and acceptance of existing work | Existing implementation is verified and accepted |

`strict` is the default. A profile narrows workflow stages; it does not change runtime app behavior.

### 4. Describe modules and pages

In the editor outline:

1. Add a module and choose its entry screen.
2. Add each user-facing page once. Multiple Figma URLs for the same screen are states, not separate pages.
3. Set `page_role` to `screen` or reusable `popup`.
4. Set `page_type`:
   - `view` creates `{Title}View.swift`; the existing router presents a system `UIHostingController`.
   - `view_controller` creates `{Title}View.swift` and `{Title}ViewController.swift`; the controller embeds the SwiftUI view in a child `UIHostingController`.
5. Add node-specific Figma URLs for default, loading, selected, empty, error, retry, or other visual states.

The configured page title deterministically produces Swift type and file names. For example, `account security` becomes `AccountSecurityView.swift` and, when required, `AccountSecurityViewController.swift`.

### 5. Configure shared development data

Define a root mock source once, then reference it from every consuming page:

```yaml
mock_data_sources:
  - id: account-session
    swift_type: AccountSession
    fixture: standard
```

Pages declare `read_only` or `read_write` access through `data_dependencies`. The implementation creates one deterministic fixture owner at the app's existing composition boundary and injects that same instance into every consumer. Navigation passes identifiers such as `itemID`, not copied model graphs.

The YAML describes development contracts only. Fixture values belong in Swift preview, development, or test code, and production data later replaces the provider without rewriting the page UI.

### 6. Configure behaviors and interactions

Use semantic targets such as `submit_button`, `results_list`, or `video_player`. Supported layout behaviors include scrolling, fixed regions, keyboard avoidance, pull-to-refresh, and pagination.

An interaction owns the complete result of one event:

```yaml
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
```

The implementation applies `state_change` first, then executes `actions[]` in declaration order. Actions cover navigation, popup presentation/dismissal, countdowns, video control, emitted events, and custom behavior.

For navigation:

- Use `push`, `sheet`, or `full_screen` with a real screen destination.
- Use `back` or `dismiss` only for an existing page instance that will be revealed.
- Use `external` with a URL.
- Add `destination_instance: new` when navigating to a new instance of the same page type.

Reusable popups are separate `page_role: popup` templates. Every caller supplies its content, button text, and callback. A button dismisses its concrete popup before it changes caller state or performs callback actions.

### 7. Validate and inspect work

```bash
export IN_APP_FIGMA_CONFIG="/path/to/your-ios-project/InAppFigma/InAppFigma.yaml"

ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" validate \
  --config "$IN_APP_FIGMA_CONFIG"

ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" list --eligible \
  --config "$IN_APP_FIGMA_CONFIG"
```

Validation checks schema version, references, destinations, state and behavior contracts, popup bindings, and lifecycle consistency. The editor places errors beside the owning field and exposes a normalized YAML preview.

### 8. Implement one page

The normal lifecycle is:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" claim account details \
  --config "$IN_APP_FIGMA_CONFIG"

ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" changes account details \
  --config "$IN_APP_FIGMA_CONFIG"
```

`claim` moves an eligible page to `in_progress`. `changes` prints only unfinished or changed state, behavior, popup structure, and removal tasks. Implement that bounded scope while preserving existing `done` work.

During implementation, the skill will:

- Inspect nearby screens before selecting files, architecture, routing, or dependencies.
- Keep full-page content in SwiftUI unless the project has a concrete UIKit-only constraint.
- Configure top-level navigation through the existing `UINavigationController` and `navigationItem` instead of drawing a duplicate SwiftUI bar.
- Reuse project-native localization, typography, colors, components, assets, state ownership, and dependency injection.
- Implement all supplied states in one state-driven page owner.
- Avoid broad `GeometryReader`, `UIScreen` measurements, absolute device checks, and fixed coordinates as default layout tools.

### 9. Verify and complete

Under `strict`, acceptance requires more than a successful build:

- Inspect or export every design asset and record reused, added, or no-assets evidence.
- Render every supplied state at the Figma reference size and relevant minimum/maximum supported sizes.
- Exercise the interactions that reach each state.
- Compare screenshots using an overlay or another coordinate-based method.
- Verify navigation, back gestures, safe areas, scrolling, keyboard behavior, localization, accessibility, routes, shared data, target membership, focused tests, and the selected scheme build.
- Resolve visible `P0` through `P2` findings and record any accepted `P3` residual.

After every current and removed item task is marked `done`, complete the page:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" complete account details \
  --commit <git-commit> --config "$IN_APP_FIGMA_CONFIG"
```

For serial work without an automatic commit, omit `--commit` when appropriate.

Use explicit failure states when work cannot complete:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" fail account details \
  --reason "focused build failed" --config "$IN_APP_FIGMA_CONFIG"

ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" block account details \
  --reason "missing node-specific Figma URL" --config "$IN_APP_FIGMA_CONFIG"
```

### 10. Amend an accepted page

Never manually reset a `done` page. Reopen it with a concrete reason:

```bash
ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" amend account details \
  --reason "Figma updates the error-state layout" \
  --config "$IN_APP_FIGMA_CONFIG"

ruby "$IN_APP_FIGMA_SKILL_ROOT/scripts/task_config.rb" changes account details \
  --config "$IN_APP_FIGMA_CONFIG"
```

The amendment archives prior acceptance metadata, preserves the accepted baseline, and reopens only affected tasks. A browser edit to a completed page follows the same flow after explicit confirmation.

### 11. Run independent pages in parallel

Parallel delivery is opt-in. Request it explicitly in your prompt or set:

```yaml
execution:
  parallel: true
  max_parallel: 3
```

Use it only for at least two independent pages or modules with disjoint files and stable shared boundaries. The workflow creates one worktree and commit per unit, keeps shared routing/configuration parent-owned, integrates units in document order, and performs the final broad build after integration.

Pages sharing mutable `read_write` mock data or overlapping project metadata are dependent by default and should remain serial.

## Prompt recipes

### Implement one page

```text
Use $in-app-swift-figma to implement the configured profile.details page.
Read its unfinished task changes first, preserve the existing navigation and shared
ProfileStore, then run all checks required by the selected delivery profile.
```

### Resume a multi-page feature

```text
Resume the InAppFigma task in this iOS repository. Validate the configuration,
list eligible pages in document order, and continue the unfinished units without
reopening completed work. Keep the execution mode defined by the YAML.
```

### Review existing work

```text
Use $in-app-swift-figma to review and accept the already implemented checkout
pages with delivery.profile=review. Exercise every supplied state and interaction,
compare current renders with Figma, and do not edit source unless I approve fixes.
```

### Amend a completed screen

```text
The accepted player screen no longer matches its updated Figma error state.
Use $in-app-swift-figma, amend the page with that reason, implement only the
reported delta, and perform the required focused review before accepting it again.
```

## Troubleshooting

### The skill is not selected

Start a new Codex task and mention `$in-app-swift-figma` explicitly. Confirm that the folder name is `in-app-swift-figma` and that `SKILL.md` exists directly inside it.

### Initialization is rejected

Run the command from the actual iOS repository and pass the repository root containing the Xcode project. Remove any `InAppFigma.yaml` or `OpenInAppFigma.command` reference from Xcode target membership before retrying. Initialization will not overwrite existing files.

### The editor does not open

Run `serve --no-open`, open the printed local URL manually, and confirm Ruby and Node.js are available. The server listens only on loopback and may use a random port.

### Saving reports a revision conflict

Another process changed `InAppFigma.yaml`. Reload or reconcile the disk version before saving again; auto-save intentionally pauses to prevent overwriting newer work.

### A completed page cannot be edited

Use `amend` with a concrete reason or confirm the editor's amendment dialog. `claim` and `requeue` intentionally reject `done` pages.

### Visual acceptance is blocked

Check for missing node-specific links, blank or incorrectly cropped assets, unavailable states, unsupported simulator destinations, and unproven system UI ownership. A successful build alone cannot complete a `strict` page.

## Repository layout

```text
in-app-swift-figma/
├── SKILL.md                  # Skill entry point and reference router
├── assets/                   # Initial task configuration template
├── evals/                    # Ruby and Node regression tests
├── references/               # Detailed workflow and implementation contracts
└── scripts/                  # Configuration CLI and local editor
```

## Development checks

Run the included regression suites from the repository root:

```bash
ruby -Ievals -e 'Dir["evals/*_test.rb"].sort.each { |file| load file }'
node --test evals/*.mjs
```

Some Node tests open a temporary loopback listener and therefore require local networking permission.
