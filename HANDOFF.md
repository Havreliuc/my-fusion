# Handoff — my-fusion / Foreman

Updated 2026-07-29 (second session). Read `FOREMAN.md` for constraints; this file is state and next actions. `CLAUDE.md` imports AGENTS.md + FOREMAN.md + this file, so every agent session loads it.

## What this is

**Foreman**: a kanban board where AI agents pick up tickets, implement them in isolated worktrees, review each other, and merge. One human operator supervises.

## Current state — WORKING

- **Version: stable v0.73.0** (was 0.74.0-beta.5; the beta had a regression that broke boot). `main` is a single `init` commit of the 0.73.0 tree plus local fix commits. No upstream remote, no tags — fully decoupled.
- **Database**: local Homebrew PostgreSQL 18, database **`fusion073`**, via `DATABASE_URL` in the repo-root `.env` (gitignored; loaded by our `.env` loader in `scripts/dev-with-memory.mjs`). The older `fusion` database belongs to the abandoned beta checkout.
- **Node 22.22.2** pinned in `.nvmrc` (machine default stays Node 20). Launch: `nvm use && pnpm dev dashboard`, then the printed `Open:` URL.
- **Provider (INTERIM — violates FOREMAN's Vertex constraint)**: `defaultProvider: google` (AI Studio key), model `gemini-3.6-flash`. Vertex rejects API keys outright (401, needs OAuth/ADC). Still the top open item.
- **Sandbox project** `pipeline-sandbox` at `/Users/eduard/projects/pipeline-sandbox` (own GitHub repo) — used to validate the pipeline, not real work.

### Proven end to end

Three tickets went from spec to merged code with passing tests in the sandbox: `KB-001` (URL parser), `KB-003` (validator module), `KB-004` (test fixes). `node --test` green. Real worktrees, real squash merges to `main`.

## Local fixes (all committed, all with regression tests)

| Commit | Defect |
|---|---|
| `dd754e34e` | approve-plan/reject-plan passed `status: undefined`; `null` is the clear sentinel, so approved cards kept `awaiting-approval` and never dispatched. Also adds the `.env` loader. |
| `0bb3c6c45` | mission tasks got branch `main/f-<id>`; git cannot nest a ref under the existing `main` file (directory/file conflict), so no branch and no worktree could ever be created. Now `main-f-<id>`. |
| `4793c4e6c` | `createTask` wrote no `task_workflow_selection` row when given `enabledWorkflowSteps` without a `workflowId` (the mission shape) — and a fresh project has no default workflow. Task had no resolvable workflow, graph never seeded a work item, card sat in Todo silently. |
| `fe5c23cea` | the pre-release Plan Review hold was unsatisfiable when plan-review is disabled for the task, or when the operator approved manually (review never runs). Both now satisfy it. |
| `505272520` | `runHoldReleaseSweep` never consulted `isTaskBlockedOnApproval`, so `require-all` cards were released out of Planning ~1 poll after parking. Since approve-plan requires the card to still be in `triage`, approval always failed with "Task must be in 'triage' column" and no approval fingerprint was ever recorded. |

Also: `.gitattributes` is LFS-free (upstream's LFS budget is exhausted; LFS-filtered checkouts broke every task worktree), and `AGENTS.md`'s port-4040 rule now permits agents to kill processes on 4040.

## Open issue — pre-release Plan Review deadlock (NOT yet fixed)

`fe5c23cea` made the pre-release Plan Review hold satisfiable for two shapes (review disabled; operator-approved). A **third** shape still deadlocks: plan-review **enabled**, no approval fingerprint, no review result. The gate waits for a plan-review result, but the pre-release review only runs once the card is dispatched — which the gate is blocking. Nothing breaks the cycle except an operator pressing **Promote** (observed on KB-005: sat in Todo ~5 min, moved only on Promote; the `passed` result in `workflow_step_results` was written *after* the promote, not before).

Fix direction: make the pre-release Plan Review actually execute for a card resting in the hold column (so the result can exist), rather than widening the gate further — the gate has now been widened twice and each widening weakens the review it exists to enforce. Relevant code: `isUnplannedForExecution` and `runHoldReleaseSweep` in `packages/engine/src/hold-release.ts`; the runner side is the graph's pre-release node traversal.

## Open issue — mission validator loop (NOT yet fixed)

Mission `M-MS60X8XN-0003-0NTD` has 3 features stuck at `in-progress` whose tasks (KB-003/4/5) are all `done`, so its **8 remaining `defined` features never become tickets** and the board goes idle.

Mechanism: a feature is marked `done` only by `handleValidationPass` in `packages/engine/src/mission-execution-loop.ts`. There are 12 rows in `project.mission_validator_runs`, latest `failed` / `blocked` — the validator keeps judging the same feature incomplete and spawns another fix ticket each time, producing `Fix:` → `Fix: Fix:` → `Fix: Fix: Fix:` titles. This is a runaway loop: it consumes tokens indefinitely on one feature.

Next investigation: why validation fails (acceptance criteria the validator cannot verify?), and whether the mission needs a fix-lineage depth cap. Watch for a third `Fix:` prefix and stop the engine if it appears.

## Operating rules learned the hard way

- On a card showing **AWAITING APPROVAL**, the only correct control is **Approve Plan**. **Promote** and **Move to Todo** move the card *without* recording approval, and once moved it cannot be approved (the route requires the `triage` column).
- Never drag a card an agent is actively working on — it destroys the worktree the agent is in.
- Agents only see the registered project's directory. A ticket about another codebase makes the executor fabricate work against the wrong repo (this happened; it merged fabricated changes). Every codebase gets its own registered project.
- Per-project settings (plan approval mode, default workflow) must be re-applied on each new project. **A project with no default workflow cannot dispatch anything** — set it first.
- `pnpm dev` runs a supervising wrapper plus a child; killing only the wrapper leaves the child serving port 4040.

## Next actions, in order

1. **The credit check** (unchanged, highest priority): make Vertex work via ADC (`gcloud auth application-default login`), switch `defaultProvider` back to `google-vertex`, verify spend lands in GCP billing.
2. **Fix the mission validator loop** (above) — required before missions can run unattended.
3. **Register the real target repo** (Lovable app export) as its own project; re-apply plan approval + default workflow there.
4. **Configure the roster** — roles onto lanes with per-lane models.
5. **Remote access** — Tailscale + `tailscale serve`; verify on a phone.

## Don't

- Don't add a login system, user table, or multi-tenancy.
- Don't configure Claude, OpenAI, or any separately-billed provider.
- Don't run tickets for a codebase that isn't the registered project.
- Don't re-add the upstream remote or `filter=lfs` lines.
- Don't expose the dashboard beyond the tailnet.
