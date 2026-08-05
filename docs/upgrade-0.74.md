# Upgrade ledger — 0.73.0 → 0.74.0

Created 2026-08-05. Working document for rebasing this fork's local delta onto upstream
`v0.74.0`. Companion to `HANDOFF.md` (which records *why* each local fix exists); this file
records *what happens to each one* under the new base. Delete or archive once the upgrade
lands.

## How to use this

Every local commit gets a row in the ledger with a **verdict** decided against the stock
0.74 source, not against the changelog. Work top to bottom; tick the Status column as each
is replayed. The six commits needing a decision have a detail section below the table.

## Base facts (verified 2026-08-05)

| Fact | Value |
|---|---|
| `init` commit | `28a43053f` |
| `init` tree hash | `58c36bd90f7a9976d4c9e91b27f660fdb95df9e7` |
| upstream `v0.73.0` tree hash | `58c36bd90f7a9976d4c9e91b27f660fdb95df9e7` — **identical** |
| Local commits `init..main` | 16 |
| Local diff | 39 files, +1555 / −62 |
| Upstream `v0.73.0..v0.74.0` | 975 commits |
| Local-only DB migrations | none (local `0000`–`0035` are all upstream's) |
| New migrations in 0.74 | 7 (`0036`–`0042`) |

`init` carries **zero** local content — every customization lives in the 16 commits. That
makes a plain `git rebase --onto upstream-v0.74.0 28a43053f <branch>` lossless; no graft or
tree surgery is needed.

Upstream tags were fetched as local refs without adding a remote, preserving `FOREMAN.md`'s
decoupling rule:

```bash
GIT_LFS_SKIP_SMUDGE=1 git -c filter.lfs.required=false fetch --no-tags \
  https://github.com/Runfusion/Fusion.git \
  refs/tags/v0.73.0:refs/tags/upstream-v0.73.0 \
  refs/tags/v0.74.0:refs/tags/upstream-v0.74.0
```

`GIT_LFS_SKIP_SMUDGE=1` is mandatory on every checkout/fetch touching upstream refs —
upstream's `.gitattributes` still carries `filter=lfs` lines whose objects are unfetchable
(see `.gitattributes` in this repo for the full explanation).

## The ledger

Verdicts: **KEEP** = replay as-is · **DROP** = upstream fixed it better, discard ours ·
**SPLIT** = commit bundles a KEEP half and a DROP half · **CARRY** = fork-local, no upstream
counterpart possible.

| # | Commit | Concern | Cherry-pick onto 0.74 | Verdict | Replayed as |
|---|---|---|---|---|---|
| 1 | `dd754e34e` | `.env` loader + approve/reject-plan `status` sentinel + LFS strip + FOREMAN docs | clean | **KEEP** | ✅ `281144b04` |
| 2 | `0bb3c6c45` | sibling per-task branch names | clean | **KEEP** | ✅ `23f811942` |
| 3 | `e0b077c1d` | createTask workflow selection **+** `.nvmrc` pin **+** AGENTS.md port-4040 override | conflict: `task-creation.ts` | **SPLIT** | ✅ `1ccc5435d` (fork halves only) |
| 4 | `4793c4e6c` | changeset for #3 | clean | **DROP** (follows #3) | ⊘ skipped |
| 5 | `fe5c23cea` | pre-release Plan Review hold satisfiable | conflict: test only | **DROP** | ⊘ skipped |
| 6 | `505272520` | hold-release sweep honors plan approval | conflict: `hold-release.ts` | **DROP** | ⊘ skipped |
| 7 | `9f3084a5c` | docs (HANDOFF) | clean | **CARRY** | ✅ `9085ac4d7` |
| 8 | `e16cccb65` | docs (HANDOFF) | clean | **CARRY** | ✅ `5bca51952` |
| 9 | `179f5fa6d` | mission lineage terminalization **+** triage deadlock | conflict: `triage.ts` only | **SPLIT** | ✅ `14b906ef2` (lineage only) |
| 10 | `8a2257bef` | root supersession **+** validator assertionId prompt | conflict: `mission-execution-loop.ts` only | **SPLIT** | ✅ `27adae28a` (supersession only) |
| 11 | `0a321d03f` | Plan Review provider-failure retry budget | conflict: `executor.ts` | **DROP** | ⊘ skipped |
| 12 | `c28593df6` | docs (HANDOFF) | clean | **CARRY** | ✅ `0464a30cf` |
| 13 | `05f5160ee` | Gemini 3.x pricing + mission-interview parse + REMOTE.md | clean | **KEEP** | ✅ `ea9e41fda` |
| 14 | `6234d2f43` | AI config + model-pricing tests | clean | **KEEP** | ✅ `4b924356d` |
| 15 | `35c3969f3` | systemd dashboard supervision | clean | **CARRY** | ✅ `33fa43fec` |
| 16 | `76bc3ed47` | `GEMINI_API_KEY` dedupe in dev runner | clean | **KEEP** | ✅ `d16a4f174` |

Net: **6 KEEP · 4 DROP · 3 SPLIT · 4 CARRY** → 16 local commits replayed as **12** on top of
`v0.74.0`, on branch `upgrade/0.74`.

## Replay result — verified 2026-08-05

| Check | Result |
|---|---|
| `pnpm install` | clean (pnpm 10.33.0, Node 22.22.2 via `.nvmrc`) |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm build` | clean |
| `pnpm test:gate` | **751 passed** (161 + 506 + 13 + 71), 0 failed |
| `pnpm smoke:boot` | PASS (`fn --help`, `GET /api/health` 200, clean shutdown) |
| `branch-assignment` + `model-pricing` | 43 passed |
| `branch-selection` + `mission-interview-parse-response` | 13 passed |
| `mission-autopilot` | 71 passed |
| `mission-store.pg` | 42 passed |

Spot-checks on the replayed tree:

- `register-task-workflow-routes.ts` — both the approve-plan and reject-plan `updateTask`
  calls now pass `status: null`. The two remaining `status: undefined` occurrences are the
  FNXC comment and the `res.json({ ...updated, status: undefined })` response spread, which
  intentionally strips the key from the payload and was never the bug.
- `branch-assignment.ts` — `` `${base}-${segment}` `` at both sites.
- `task-creation.ts` — byte-identical to upstream `v0.74.0` (our superseded half fully removed).
- `.gitattributes` — no `filter=lfs` rules survive; the only match is the prose warning.
- `.nvmrc` — present at `22.22.2` (absent from upstream entirely).
- `.changeset/` — only `approve-plan-clears-status.md` and `sibling-per-task-branches.md`
  remain; the three changesets describing dropped fixes went with their commits.

The pg gate runs against its own embedded Postgres — no `DATABASE_URL` in the environment and
no `.env` in the worktree, so `fusion073` was never reachable from the test run.

Every conflict falls exactly on a file where upstream fixed the same bug. Nothing conflicts
by accident.

## Detail — the six that need a decision

### #3 `e0b077c1d` — SPLIT

| Half | Files | Verdict |
|---|---|---|
| Node 22.22.2 pin; AGENTS.md port-4040 fork override | `.nvmrc`, `AGENTS.md` | **KEEP** — fork-local, `.nvmrc` does not exist upstream at all |
| createTask workflow selection | `task-creation.ts`, `create-task-workflow-selection.test.ts` | **DROP** — conflicts |

*Ours*: `createTask` only wrote a `task_workflow_selection` row for some input shapes, so
mission/slice creates (which pass `enabledWorkflowSteps` with no `workflowId`) against a
project with no default workflow produced a task with no resolvable workflow — card rested
in Todo with no error and no dispatch.

*0.74*: [`task-creation.ts`](../packages/core/src/task-store/task-creation.ts) now resolves
`(await store.getDefaultWorkflowId()) ?? DEFAULT_WORKFLOW_ID` at the creation seam, plus
`10df734` fixed the adjacent quick-add-Start shape that stranded cards the same way.

⚠️ This commit bundles two unrelated concerns. Dropping it wholesale would silently lose the
`.nvmrc` Node pin that `FOREMAN.md` depends on (`nvm use` is documented as sufficient) — it
is absent from upstream `v0.74.0`. Split it. #4 (`4793c4e6c`) is only the changeset for the
dropped half and goes with it.

*Action*: re-verify by creating a mission task on a project with no default workflow and
confirming it dispatches.

### #5 `fe5c23cea` — pre-release Plan Review hold → DROP

*Ours*: `isUnplannedForExecution`'s hold could only be satisfied by a passed plan-review step
result or a durable capacity continuation — unreachable when the plan-review group is
disabled or the plan was approved manually. Card was releasable only by Promote.

*0.74*: `99c9f14` rewrote the gate for plan-in-place workflows — it now applies **only** when
the plan-review node's column equals the card's column *and* the group is enabled for the
task, which is a strictly better formulation of the same guard.

⚠️ Our `hold-release.ts` hunk merges *cleanly* here — only the test conflicts. Do not read
that as "still needed". Applying it would layer a second, weaker escape hatch on top of
upstream's guard. Drop the whole commit.

### #6 `505272520` — hold-release sweep honors plan approval → DROP

*Ours*: `runHoldReleaseSweep` never consulted `isTaskBlockedOnApproval`, so a card parked at
`awaiting-approval` was released a poll later, after which Approve Plan failed with
"Task must be in 'triage' column".

*0.74*: `fbe7eb5` wires `isTaskBlockedOnApproval` into **all** planning-lane advance surfaces
— `issueRelease` and its in-transaction `moveTaskIf` predicate, both plan-review continuation
seeders, and the drain classifier — not just the sweep. Confirmed present at
`hold-release.ts:718` and `:803` in stock 0.74. Strict superset of ours.

### #9 `179f5fa6d` — SPLIT

| Half | Files | Verdict |
|---|---|---|
| Mission lineage terminalization (`terminalizeOpenLineageChain`, `isFeatureSettledForAdvancement`) | `async-mission-store.ts`, `mission-autopilot.ts` + tests | **KEEP** — merges clean; `terminalizeOpenLineageChain` is absent from 0.74 |
| Plan Review deadlock 3rd shape (`recoverApprovedTask` fires `onSpecifyComplete`) | `triage.ts` | **DROP** — conflicts |

*Why the triage half goes*: 0.74 reworked this exact seam. `onSpecifyComplete` now carries a
three-state `PlanningHandoffReport` (`8288e4a`), `recoverApprovedTask` returns
`outcome !== "withheld"` instead of unconditional `true` (`2934ccc`), and its intake-column
gate was widened (`2771408`). Firing the callback unconditionally — our fix — is precisely
what upstream now gates deliberately. Replaying it would re-arm plan-review continuations for
tasks still awaiting approval, reintroducing the bug `8288e4a` closed.

*Action*: `git cherry-pick -n 179f5fa6d`, then `git checkout --ours packages/engine/src/triage.ts`
and drop the `triage.test.ts` hunk that covers it, keeping everything else.

### #10 `8a2257bef` — SPLIT

| Half | Files | Verdict |
|---|---|---|
| Root supersession in `reconcileSupersededGeneratedFixFeatures` | `async-mission-store.ts` + pg test | **KEEP** — merges clean, no upstream equivalent |
| Validator prompt shows `assertionId` | `mission-execution-loop.ts` + test | **DROP** — conflicts |

*Why the prompt half goes*: `1aa1516` — "Validator prompts now provide assertion IDs and
recover exact-count legacy responses safely" — is the same fix plus a legacy-response
recovery path ours lacks. `3b63351` additionally bounds candidate JSON parsing to 256 KiB /
eight attempts.

The root-supersession half is the one HANDOFF describes as found live on 2026-07-30 (a
lineage ROOT could never be superseded because it has no ancestor of its own). That is still
absent upstream and still blocks mission advancement — keep it.

### #11 `0a321d03f` — Plan Review retry budget → DROP

*Ours*: gave Plan Review provider failures a dedicated `MAX_PLAN_REVIEW_PROVIDER_FAILURE_RETRIES = 6`
with linear backoff, because two mission tasks queuing Plan Review moments apart both ran the
reviewer from the shared repo root and the second exhausted the shared 2-attempt budget in
~2 seconds.

*0.74*: `e6b2da6` fixes the **cause** — `TaskExecutor.sessionRegistryPath` now task-scopes the
`activeSessionRegistry` key for any session rooted at `rootDir`, not just in workspace mode.
The bare-root key was what made the second task throw `ActiveSessionPathHeldByForeignTaskError`,
surfacing as a provider failure. With that fixed there is no sibling to wait out, and 0.74
still has `MAX_TRANSIENT_GRAPH_RESUME_RETRIES = 2` for its original narrow purpose.

Ours treated the symptom. Drop it — and drop the residual "raise the budget further" item
from `HANDOFF.md`'s next-actions list.

## Replay procedure

Worktree already exists at `../my-fusion-worktrees/upgrade-0.74` on branch `upgrade/0.74`,
based at `upstream-v0.74.0`. Per `AGENTS.md`, the primary checkout stays on `main` throughout.

```bash
cd /Users/eduard/projects/my-fusion-worktrees/upgrade-0.74
export GIT_LFS_SKIP_SMUDGE=1
git reset --hard upstream-v0.74.0
```

Then replay in ledger order, skipping DROP rows and hand-resolving the two SPLITs:

```bash
git cherry-pick -x dd754e34e 0bb3c6c45          # KEEP  #1 #2
                                                 # skip  #3 #4 #5 #6
git cherry-pick -x 9f3084a5c e16cccb65          # CARRY #7 #8
git cherry-pick -n 179f5fa6d                    # SPLIT #9  — then drop the triage.ts half
git cherry-pick -n 8a2257bef                    # SPLIT #10 — then drop mission-execution-loop.ts
                                                 # skip  #11
git cherry-pick -x c28593df6 05f5160ee 6234d2f43 35c3969f3 76bc3ed47   # #12–#16
```

The docs commits (#7 #8 #12) rewrite `HANDOFF.md` wholesale and will need a content pass
afterwards anyway — the resolved-bug sections they describe are now upstream's, not ours.

## Post-replay checklist

- [x] **Back up the database** — done 2026-08-05: `~/projects/claude/downloads/fusion073-pre-0.74.sql`, 121 MB, 136 tables. Note the Homebrew default `pg_dump` is 14.17 against an 18.4 server and aborts on version mismatch; use `/opt/homebrew/Cellar/postgresql@18/18.4/bin/pg_dump`.
- [ ] Decide DB strategy: migrate `fusion073` in place, or restore the dump into a fresh `fusion074` so 0.73 stays bootable. **Nothing has migrated yet** — the upgrade worktree has no `.env`, so it has never connected to the live database.
- [ ] 7 new forward-only migrations (`0036`–`0042`) — includes `0037_drop_global_concurrency` and `0038_mission_task_prefix`.
- [ ] **Breaking**: machine-wide concurrency cap removed; capacity is now two per-project numbers.
- [ ] **Breaking**: spawned child agents count against Max Concurrent Tasks (`maxSpawnedAgentsPerParent` / `maxSpawnedAgentsGlobal` deleted).
- [ ] Verify `.gitattributes` LFS strip survived #1 and upstream's `filter=lfs` lines did not return.
- [ ] `nvm use && pnpm install && pnpm build && pnpm test:gate && pnpm smoke:boot`.
- [ ] Re-verify the 6 KEEP fixes behave — especially sibling branch naming and approve-plan, the two confirmed still-broken in stock 0.74.
- [ ] Re-check `~/.fusion/settings.json` against 0.74's settings schema.
- [ ] Update the VM (`REMOTE.md` → `execution-test`): same rebase, same migrations, re-run `./deploy/systemd/install.sh`.
- [ ] Decide whether to re-flatten history — the rebase brings upstream's 975 commits in, partly undoing the decoupling flatten. Pushing either result to `Havreliuc/my-fusion` is a force-push over published history.
- [ ] Rewrite `HANDOFF.md` — five of its "Resolved" sections are now upstream's fixes, and its Local-fixes table is stale (it lists `0a321d03f` as uncommitted; it is committed, and is being dropped).

## Rollback

Nothing above touches `main`. To abandon:

```bash
git worktree remove --force ../my-fusion-worktrees/upgrade-0.74
git branch -D upgrade/0.74
git tag -d upstream-v0.73.0 upstream-v0.74.0
```
