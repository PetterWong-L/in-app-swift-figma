# Parallel Execution

Read this reference only when both conditions are true:

1. The task contains at least two independent pages or modules.
2. The user explicitly requests parallel execution.

Multiple Figma links for states or variants of one screen remain one implementation unit. Units are independent only when they can be implemented without editing the same files, changing shared ownership, or waiting for another unit's output.

Pages that reference the same `read_write` mock data source are dependent by default because fixture ownership, composition, and cross-page behavior must remain coherent. Keep that shared data boundary parent-owned or implement the pages serially unless the dependency interface and edited files are already stable and disjoint.

If either condition is false, work serially in the current workspace. Do not create per-unit worktrees or automatic commits.

Also read [execution-efficiency.md](execution-efficiency.md). Its bounded context, evidence reuse, review scope, stalled-work recovery, and retry budget rules apply to every dispatched unit.

## Prepare

Before dispatch:

1. Build an ordered unit manifest and one bounded context packet per unit containing its states, owned paths, navigation boundary, dependencies, base commit, compact evidence manifest, and acceptance checks.
2. When `InAppFigma.yaml` exists, derive the manifest in config order, honor `max_parallel`, and claim every selected page before dispatch. The parent alone edits status.
3. Assign shared routing, project metadata, localization catalogs, shared components, and other overlapping files to the parent. Workers must not edit parent-owned files.
4. Inspect the current branch, worktree state, and `git status`. If a unit depends on uncommitted user changes, do not commit, stash, copy, or discard them without permission; keep that work serial until every worktree has an approved base.
5. **REQUIRED SUB-SKILL:** Use `superpowers:using-git-worktrees` for worktree detection, safe directory selection, creation, and baseline verification. Prefer native worktree support when available.

If the unit boundaries cannot be made independent, stop parallel dispatch and use the serial workflow.

## Per-Unit Contract

Each worker owns exactly:

- one page or module
- one isolated worktree and branch created from the same approved base
- the unit's implementation, local assets, focused tests, and allowed metadata
- one commit containing only that unit's owned files

The worker receives only its bounded packet and must not inherit the full task history unless the parent records a dependency. It inspects its diff before committing and returns the commit hash, changed files, design states, asset evidence, focused verification, and shared-file needs. It must not modify another unit, parent-owned files, or unrelated user changes.

## Parent Contract

The parent owns `InAppFigma.yaml`, the manifest, shared-file changes, ordered integration, conflict resolution, cross-unit checks, and the final scheme build.

Integrate accepted unit commits in manifest order. Apply a full first review and delta amendment reviews using the efficiency reference. After integration and page acceptance, mark that page `done` with its commit. Mark retryable failures `failed` and missing external input `blocked`. A conflict means the ownership plan was incomplete: resolve it in the parent rather than allowing workers to edit each other's work.

Keep a failed unit's worktree and branch intact for diagnosis. After two consecutive waits without meaningful progress, inspect status and diff and follow the stalled-work recovery rule. Report blockers and do not mark the whole task complete until every required unit is integrated or explicitly excluded by the user.

## Completion Report

In addition to normal UI evidence, report each unit's config status, attempts, worktree/branch, commit, integration status, shared-file handling, accepted residuals, and final build result.
