# Execution Efficiency

Read this reference for tasks with at least two pages/modules, worker dispatch, review or amendment work, or a proposed repeat of Figma, asset, test, or build operations. Preserve acceptance quality while avoiding repeated context and evidence work.

## Bounded Context Packet

For each page, the parent maintains one bounded packet containing:

- its `InAppFigma.yaml` module/page block, `changes` output, shared mock source definitions, page data dependencies, and unfinished item tasks
- applicable user instructions and only the references selected by `SKILL.md`
- Figma node URLs plus a compact evidence manifest, not raw prior tool transcripts
- owned paths, parent/shared boundaries, dependencies, base commit, and review diff
- focused acceptance checks and known blockers or accepted residuals

Pass this packet to a worker or reviewer. Do not fork the full long-task history unless the page depends on it. When an independent reviewer is used, start it with a fresh packet or reset its scope to this page; do not accumulate unrelated page reviews in one growing context.

## Evidence Reuse

Capture each page/state's design metadata, screenshot, and asset evidence once. Reuse valid local evidence when the Figma node, URL, known design version, and affected implementation area are unchanged. Re-fetch only when the design changed, evidence is missing/corrupt, an amendment changes the asset source or relevant composition, or current acceptance cannot be supported by existing evidence.

Keep compact evidence manifests in temporary or ignored development storage, outside the app target. Summarize large tool output into the page packet instead of replaying it. Never claim a visual check from stale or absent evidence.

## Pre-Review Self-Check

Before the first handoff, the implementer checks every supplied state against real state/data behavior rather than screenshot sample values. Confirm system navigation and safe areas, asset crop/overlay/z-order, loading and selection defaults, scrolling/fixed actions, and the longest relevant localization. Run focused source/project checks and attach the resulting render or limitation to the page packet. Fix observable discrepancies before requesting review.

## Review Scope

The first review of a page is full: all supplied states, navigation and interaction, data-driven behavior, assets, source/project integration, and acceptance evidence.

An amendment review defaults to unfinished item tasks, their `changed_fields`, the old-to-new commit or working-tree delta, directly affected layout/assets/state, and focused static or visual checks. Preserve unchanged `done` tasks without re-review. Upgrade to a full review only when the amendment changes page or state mapping, primary layout structure, navigation/interaction ownership, asset source, or shared boundaries.

Run broad project/build verification once after accepted integration, not after every small amendment unless the change can affect that layer.

Pages consuming the same mutable mock source are not independent by default. Keep the shared fixture, provider/store composition, and cross-page flow parent-owned; dispatch pages separately only after their file ownership and dependency interface are stable and non-overlapping.

## Amendment Lifecycle

Before changing a configured page whose status is `done`, preserve the current working-tree state and run:

```bash
ruby <skill-root>/scripts/task_config.rb amend <module> <page> --reason <concrete-change-reason> --config <config>
```

CLI `amend` and the browser's confirmed atomic amendment are the only paths from `done -> in_progress`. They increment `attempts`, archive the previous accepted `commit` and completion time in `acceptance_history`, preserve `accepted_baseline`, and clear only current page acceptance fields. The browser confirmation also reopens only affected item tasks. Do not use `requeue`, manually reset status, or create a duplicate page entry for a revision.

Run `task_config.rb changes <module> <page> --config <config>` after amendment. Build the packet from its unfinished item tasks, the tool-owned baseline, archived commit when present, and previous acceptance evidence. For `added`, add the matching UI or behavior; for `modified`, start with `changed_fields`; for `removed`, remove the old baseline implementation and references; for `unchanged` with a non-`done` status, perform the requested recheck without widening to the page. A missing archived commit is valid for serial work. Complete the page only after every current and removed task is `done` and the required review passes.

## Finding Gate

- `P0` and `P1` always block acceptance.
- `P2` blocks when visible or functional in a supplied design state.
- `P3` is recorded as an accepted residual by default. It blocks only when the user requires pixel-level fidelity or it causes clipping, overlap, repeated-geometry drift, or inconsistent states.

Record every accepted residual and its evidence in the completion report. A residual means the page cannot be described as pixel-perfect.

## Stalled Work

For dispatched work, do not keep waiting without inspecting progress. After two consecutive waits with no meaningful message:

1. inspect worker status and its worktree diff;
2. if no files changed, interrupt and resume with a focused page packet;
3. if partial files exist, preserve them and identify the exact unfinished work before resuming;
4. if the blocker needs external input, mark the page `blocked` instead of polling.

## Retry Budget

Do not repeat an identical Figma fetch, asset export, test, or build after an external/environmental failure unless its inputs, environment, credentials, network state, or relevant files changed. Record the first failure and continue independent static checks. Retry only with concrete evidence that the blocking condition changed or when the user explicitly requests it.
