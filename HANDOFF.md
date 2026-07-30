# Handoff — my-fusion / Foreman

Updated 2026-07-30 (third session). Read `FOREMAN.md` for constraints; this file is state and next actions. `CLAUDE.md` imports AGENTS.md + FOREMAN.md + this file, so every agent session loads it.

## What this is

**Foreman**: a kanban board where AI agents pick up tickets, implement them in isolated worktrees, review each other, and merge. One human operator supervises.

## Current state — WORKING, mission pipeline now proven end-to-end

- **Version: stable v0.73.0**. `main` is a single `init` commit of the 0.73.0 tree plus local fix commits. No upstream remote, no tags — fully decoupled.
- **Database**: local Homebrew PostgreSQL 18, database **`fusion073`**, via `DATABASE_URL` in the repo-root `.env` (gitignored; loaded by our `.env` loader in `scripts/dev-with-memory.mjs`).
- **Node 22.22.2** pinned in `.nvmrc` (machine default stays Node 20). Launch: `nvm use && pnpm dev dashboard`, then the printed `Open:` URL.
- **Provider (INTERIM — violates FOREMAN's Vertex constraint)**: `defaultProvider: google` (AI Studio key), model `gemini-3.6-flash`. Vertex rejects API keys outright (401, needs OAuth/ADC). Still the top open item.
- **Sandbox project** `pipeline-sandbox` at `/Users/eduard/projects/pipeline-sandbox` (`proj_73697c56ec8a4f0e` in the central registry) — used to validate the pipeline, not real work.

### Proven end to end (2026-07-30)

Mission `M-MS7775AX-000P-7XN3` ("Build standalone `wordcount` CLI tool", autopilot on, no manual plan approval) ran through triage → Plan Review (AI, zero human clicks) → execution → validation → **genuine pass** → slice supersession → next-slice activation, across multiple milestones, entirely unattended. As of this writing it has completed 3 of 5 slices (Core Counter Module, Unit Test Suite, CLI Argument Parsing & File Reader) and is actively working the 4th (Output Formatter). This is the first time this Foreman instance has gotten a mission feature to a genuine "done" and advanced past it — the three fixes below are why.

Earlier (2026-07-29) three tickets (KB-001/003/004, non-mission) went from spec to merged code the same way.

## Local fixes (all committed unless noted, all with regression tests)

| Commit | Defect |
|---|---|
| `dd754e34e` | approve-plan/reject-plan passed `status: undefined`; cards kept `awaiting-approval` and never dispatched. Also adds the `.env` loader. |
| `0bb3c6c45` | mission tasks got branch `main/f-<id>` (git cannot nest a ref under the existing `main` file). Now `main-f-<id>`. |
| `4793c4e6c` | `createTask` wrote no `task_workflow_selection` row for the mission task shape — no resolvable workflow, card sat in Todo silently. |
| `fe5c23cea` | pre-release Plan Review hold was unsatisfiable when plan-review is disabled or the operator approved manually. |
| `505272520` | `runHoldReleaseSweep` never consulted `isTaskBlockedOnApproval`, so `require-all` cards were released out of Planning before approval was ever recorded. |
| `179f5fa6d` | **Pre-release Plan Review deadlock, third shape (see below — now fully resolved).** Also bundles the mission-lineage-blocked-status fix (`terminalizeOpenLineageChain`). |
| `8a2257bef` | **Root-supersession gap** in `reconcileSupersededGeneratedFixFeatures` — see below. |
| *(uncommitted)* | **Plan Review provider-failure retry budget too thin** — see below. `packages/engine/src/executor.ts` + `packages/engine/src/__tests__/executor-plan-review-provider-failure-retry.test.ts`. Run `git status` before continuing; commit these (or ask the operator to) before treating this list as closed. |

## Resolved — pre-release Plan Review deadlock (was open, now closed)

The prior write-up described three deadlocking shapes for the pre-release Plan Review hold; two were fixed in `fe5c23cea`. The third — plan-review **enabled**, no approval fingerprint, no review result — is now also fixed.

**Root cause**: `TriageProcessor.recoverApprovedTask` (self-healing's un-stick path for a task that crashed mid-planning) finalized tasks into `todo` exactly like the live `specifyTask` path, but never fired `onSpecifyComplete` — the callback that seeds the durable "planning" continuation the runtime drains to actually *run* Plan Review for a card in the hold column. A card recovered by self-healing could land in `todo` with Plan Review enabled and no continuation ever created for it, so the gate waited forever for a review result nothing would ever produce. Only escape was **Promote**, which bypasses the review instead of satisfying it.

**Fix**: `packages/engine/src/triage.ts` — `recoverApprovedTask` now fires `onSpecifyComplete` after finalizing, exactly like `specifyTask` does. Safe unconditionally: the callback re-reads the live task and no-ops unless the card's column actually matches the Plan Review node's column.

Confirmed live: KB-016 through the current mission's tasks all flowed `todo` → `in-progress` with zero manual Promote clicks.

## Resolved — mission validator loop (was open, now closed)

Root cause was three compounding bugs, not one:

1. **`createGeneratedFixFeature` (async-mission-store.ts)**: on retry-budget exhaustion (or a durable operator-stop), only the ROOT feature's `loopState` was updated — every feature row in the fix lineage, including the leaf that just failed, stayed `status:"in-progress"` forever. Fixed by `terminalizeOpenLineageChain` (commit `179f5fa6d`): the whole open lineage chain now terminalizes to `status:"blocked"`.
2. **`MissionAutopilot`'s slice-advancement gates** (`handleTaskCompletion`, `recoverStaleMission`, `recoverMissions`) required every feature to be `status:"done"` — a durably-blocked feature could never satisfy that, silently wedging the whole mission forever with no error surfaced. Fixed via a shared `isFeatureSettledForAdvancement` predicate (`done` OR `blocked`) — deliberately *not* applied to "mission complete" labeling, which correctly stays strict (commit `179f5fa6d`).
3. **`reconcileSupersededGeneratedFixFeatures` root-supersession gap** (found live, 2026-07-30): when a *later* generated fix genuinely passes, this function walked UP from a candidate checking its own ancestors, but gated on `!feature.generatedFromFeatureId` — a lineage ROOT always fails that guard (it has no ancestor of its own), so a root that had exhausted its budget before a later generation went on to pass was never superseded and stayed `status:"in-progress"` forever, still blocking the (now-fixed) advancement gate above it. Fixed (commit `8a2257bef`): walk starts from every feature that itself passed and marks every ancestor, root included.

Separately: the assertion-omission bug that was causing *every* mission validation to fail regardless of code correctness (see below) meant the validator loop almost never got a chance to exercise a genuine pass at all before today — so shape 3 above was undiscovered until a mission actually ran cleanly enough to hit it.

## Resolved — mission validator "Validator omitted linked assertion result" (new find, 2026-07-30)

Every validation run's AI judge summary said "all assertions passed," yet the structured result always recorded `assertionId` as omitted and failed anyway — 100% reproducible, on every feature, across two different missions.

**Root cause**: `buildValidationPrompt` (`packages/engine/src/mission-execution-loop.ts`) listed assertions to the model as `1. **title**: text` — it never showed the model the assertion's actual `CA-XXXX` id, yet the response schema demanded the model echo that exact id back as `"assertionId"`. The model had no way to know it. `extractAssertionResults`'s strict `authoritativeIds.has(assertionId)` check silently dropped anything that didn't match, and the fallback marked it failed every time.

**Fix** (commit `8a2257bef`): the assertion list now shows each entry's real `assertionId` explicitly, with instructions to copy it verbatim. Confirmed live: `F-MS77DDKS-001R-9C0U` ("Fix: Core count(content)") passed on its first real attempt once the fix was actually running.

## Resolved — Plan Review provider-failure retry budget too thin (new find, 2026-07-30; fix uncommitted)

When two mission-dispatched tasks queue Plan Review moments apart and neither has a worktree yet, both fall back to running the reviewer from the shared repo root — one shared session-registry path. The second genuinely has to wait for the first task's real AI session to finish and release that path. The shared `MAX_TRANSIENT_GRAPH_RESUME_RETRIES` budget (2 attempts, 1 second apart — tuned for fast engine-internal pause/resume races, not for waiting out a sibling's AI session) exhausted in about 2 seconds. Once exhausted, `graphResumeRetryCount` never resets short of the whole graph completing, so the task sat "queued" forever — and the dashboard's manual Retry button doesn't even accept that status as retryable (`register-task-workflow-routes.ts` `/tasks/:id/retry` gate requires `status: "failed"`/`"stuck-killed"`/a few other shapes). Observed live: KB-021 held 20+ minutes behind KB-020's already-finished session, invisible to every recovery path.

**Fix** (uncommitted — `packages/engine/src/executor.ts`): Plan Review's provider-failure hold gets its own, larger, dedicated budget (`MAX_PLAN_REVIEW_PROVIDER_FAILURE_RETRIES = 6`, linear backoff `5s × attempt` up to 30s ≈ 105s total) instead of sharing the tiny engine-internal one. Regression tests in `executor-plan-review-provider-failure-retry.test.ts`.

**Not yet done** (residual gap, lower priority since the above makes it rare): if the raised budget *still* exhausts, the task is still stuck with no automatic recovery *if it still carries a `branch` value* — `recoverInProgressLimbo` (the self-healing sweep that fixes this shape) explicitly skips any task with a non-empty `branch`, by design (branch = presumed real in-flight work). It runs periodically already (batch 2 of the maintenance sweep, not startup-only as first assumed while debugging live), so once a task's `branch`/`worktree` are cleared it self-heals within one sweep cycle — no restart needed. Today's live incident required a restart only because I intervened impatiently rather than waiting for the next sweep. If this recurs: clear the task's stale `branch` (verify with `git rev-parse --verify <branch>` first — it's almost certainly never real) and let the periodic sweep pick it up; no restart required. Consider extending the dashboard's manual Retry route to accept this exact stuck shape directly (in-progress, `graphResumeRetryCount` at the Plan Review ceiling, no live session) as a proper operator escape hatch — not done today.

## Resolved — orphaned `local-<hash>` project data causing a false task-ID-integrity alarm (2026-07-29)

See `/Users/eduard/.claude/projects/-Users-eduard-projects-my-fusion/memory/foreman-orphaned-local-project-cleanup.md` for the full writeup (not duplicated here). Short version: `pipeline-sandbox` was opened once before being registered in the central project registry, ran under a deterministic fallback id (`local-<sha256(rootDir)>`), and created 3 tasks there before the real registration the next day created a parallel, unrelated KB-series. The stale allocator row for that orphaned id (`next_sequence=1`, stale relative to its own 3 tasks) tripped the integrity check. Confirmed via `\d project.tasks` that the real primary key is composite `(project_id, id)` — no actual collision risk, just confusing leftover state. Deleted (operator-approved) the 3 orphaned task rows and the 1 stale allocator row. The *detector's* cross-project global scan design (a comment in `packages/core/src/task-store/async-allocator.ts:112-124` claims `tasks.id` is a global PK, which is incorrect against the actual schema) is a known, deliberately-deferred follow-up — not touched.

## New operating rule learned the hard way (2026-07-30) — engine lockfile / multiple stray dev-server instances

`pnpm dev dashboard` uses a 3-level process chain (`pnpm dev dashboard` → `node scripts/dev-with-memory.mjs dashboard` → the actual tsx-loaded dashboard binary) **and** a per-project `.fusion/engine.lock` that refuses to start a second engine for the same project on the machine. Today, restarting "the dashboard" repeatedly did *not* pick up code changes, because:

1. There can be more than one full `pnpm dev dashboard` chain alive at once, started from different terminals at different times, only one of which is actually bound to port 4040 at any given moment (they don't all try to bind — check `.fusion/engine.lock`'s holder, not just `lsof -iTCP:4040`).
2. A restart of "the" dashboard (killing the chain bound to port 4040) can still leave an **older, unrelated chain** alive elsewhere, silently holding the engine lock — the *new* dashboard process boots fine and serves the UI, but logs `Refusing to start engine for <project>: Another engine is already running` and never actually runs the project's engine at all. The dashboard UI shows "Project engine is not connected... Starting..." for this exact reason.
3. Symptom in practice: code fixes appear to have no effect, because the actual engine doing the work is a process from hours earlier, never touched by any restart.

**When "restarting" doesn't seem to take effect**: `ps aux | grep dashboard` for *every* matching process tree (not just the one on port 4040), check each one's `lstart`, and kill every stale tree before starting fresh. Cross-check `cat <project>/.fusion/engine.lock*` isn't held by a PID that's already dead.

## Operating rules learned the hard way (carried forward)

- On a card showing **AWAITING APPROVAL**, the only correct control is **Approve Plan**. **Promote** and **Move to Todo** move the card *without* recording approval, and once moved it cannot be approved (the route requires the `triage` column).
- Never drag a card an agent is actively working on — it destroys the worktree the agent is in.
- Agents only see the registered project's directory. Every codebase gets its own registered project.
- Per-project settings (plan approval mode, default workflow) must be re-applied on each new project. **A project with no default workflow cannot dispatch anything** — set it first.
- `planApprovalMode` defaults to `"auto-approve-all"` for new projects (`packages/core/src/settings-schema.ts:428`) — Plan Review (already AI-driven) is the only gate unless you explicitly set `"require-all"`.

## Next actions, in order

1. **The credit check** (unchanged, highest priority): make Vertex work via ADC (`gcloud auth application-default login`), switch `defaultProvider` back to `google-vertex`, verify spend lands in GCP billing.
2. **Commit the pending retry-budget fix** (`packages/engine/src/executor.ts` + its test) — see the Local fixes table above.
3. **Let the `wordcount` mission finish** (2 slices remaining as of writing) as final confirmation, then decide whether to register the real target repo (Lovable app export) as its own project.
4. **Configure the roster** — roles onto lanes with per-lane models.
5. **Remote access** — Tailscale + `tailscale serve`; verify on a phone.
6. *(Optional, low priority)* Fix `async-allocator.ts`'s cross-project global-scan design tension (see the orphaned-project section above) — deliberately deferred, not urgent.
7. *(Optional, low priority)* Extend the dashboard's manual Retry route to accept a task stuck behind an exhausted Plan Review provider-failure budget directly, instead of relying on the periodic `recoverInProgressLimbo` sweep or a manual branch-clear.

## Don't

- Don't add a login system, user table, or multi-tenancy.
- Don't configure Claude, OpenAI, or any separately-billed provider.
- Don't run tickets for a codebase that isn't the registered project.
- Don't re-add the upstream remote or `filter=lfs` lines.
- Don't expose the dashboard beyond the tailnet.
- Don't assume "the dashboard isn't running" just because port 4040 doesn't answer, or that a restart "took" just because a new PID appears on port 4040 — check for stray sibling process trees and the engine lockfile holder first (see the new operating rule above).
