# Handoff — my-fusion / Foreman

Updated 2026-08-05 (fourth session). Read `FOREMAN.md` for constraints; this file is state and next actions. `CLAUDE.md` imports AGENTS.md + FOREMAN.md + this file, so every agent session loads it.

## What this is

**Foreman**: a kanban board where AI agents pick up tickets, implement them in isolated worktrees, review each other, and merge. One human operator supervises.

## Current state — upgraded to 0.74.0

- **Version: stable v0.74.0** (2026-08-05). `main` is a single `init` commit of the stock v0.74.0 tree plus 13 fork commits — the same flattened, decoupled shape as before, re-based on 0.74. 14 commits total. No upstream remote, no upstream history.
- **Database**: local Homebrew PostgreSQL 18, database **`fusion073`** (name kept, now on 0.74's schema), via `DATABASE_URL` in the repo-root `.env` (gitignored; loaded by our `.env` loader in `scripts/dev-with-memory.mjs`). Migrated in place to schema baseline **`0042`** on 2026-08-05; pre-upgrade dump at `~/projects/claude/downloads/fusion073-pre-0.74.sql` (121 MB, 136 tables → 143 after).
- **Node 22.22.2** pinned in `.nvmrc` (machine default stays Node 20). Launch: `nvm use && pnpm dev dashboard`, then the printed `Open:` URL.
- **Provider (INTERIM — violates FOREMAN's Vertex constraint)**: `defaultProvider: google` (AI Studio key). Vertex rejects API keys outright (401, needs OAuth/ADC). Still the top open item. Note the model that actually ran on 2026-08-05 was **`gemini-3.5-flash`**, not the `gemini-3.6-flash` this file previously recorded — check the resolved lane models before assuming.
- **Sandbox project** `pipeline-sandbox` at `/Users/eduard/projects/pipeline-sandbox` (`proj_73697c56ec8a4f0e` in the central registry) — used to validate the pipeline, not real work. **Left `active` (unpaused) as of 2026-08-05**; it will run as soon as an engine boots.
- **`my-fusion` is now a registered project** (`proj_f61c742e544a4db2`, created 2026-08-05) — created accidentally, because `fn serve` **auto-registers the cwd project by default**. It is set to `status='paused'` so no runtime starts for it. Either remove it (`fn project remove my-fusion`) or leave it paused, but never let it run: agents would operate on the Foreman repo itself. **Always pass `--no-auto-register` when running `fn serve`/`fn daemon` from inside this checkout.**

### 0.74 verified end to end (2026-08-05)

Task **KB-025** ("Add an MIT LICENSE file…") ran the full pipeline on 0.74 against the migrated database, in `pipeline-sandbox`:

`created → planning (real Gemini session) → awaiting-approval → Approve Plan → stranded-hold reconciliation re-seeds Plan Review → Plan Review APPROVE → scheduler dispatch → in-progress → execution → in-review → Code Review APPROVE → squash-merge → done`

Landed as `94db672` on the sandbox's `main`: `LICENSE` + `test/license.test.js`, 40 insertions, diff exactly matching the declared `## File Scope`. Both pre-merge gates recorded `passed`/`APPROVE`. Cost ≈ **1.54M tokens** (500k input + 16k output + 1.03M cached) for one trivial task.

Two fork fixes were confirmed *in production*, not just by unit test:
- **approve-plan clears the status sentinel** — after Approve Plan, `status` went to NULL and the card dispatched. On stock 0.74 it would still read `awaiting-approval` and never move.
- **dropping our `onSpecifyComplete` patch was correct** — the log shows `Specification finished without a handoff (parked) — no plan review armed`, then `Stranded hold continuation … self-healing reconciliation will re-seed Plan Review`, and it did. Upstream's `evaluateStrandedHoldContinuation` covers the case our patch used to force.

Not exercised by this run: the sibling-branch fix (a standalone task uses `deriveAutoTaskBranchName` → `fusion/kb-025`; the `${base}-${segment}` path needs a **mission with a shared branch group**), and the mission lineage/supersession fixes.

### Proven end to end on 0.73.0 (2026-07-30, historical)

Mission `M-MS7775AX-000P-7XN3` ("Build standalone `wordcount` CLI tool", autopilot on, no manual plan approval) ran through triage → Plan Review (AI, zero human clicks) → execution → validation → **genuine pass** → slice supersession → next-slice activation, across multiple milestones, entirely unattended — 3 of 5 slices complete, working the 4th. First time this Foreman instance got a mission feature to a genuine "done" and advanced past it.

Earlier (2026-07-29) three tickets (KB-001/003/004, non-mission) went from spec to merged code the same way.

## The 0.73.0 → 0.74.0 upgrade (2026-08-05)

Full working ledger, including per-fix evidence and the exact replay commands, is in `docs/upgrade-0.74.md`. Summary:

Upstream 0.74.0 is 975 commits ahead of 0.73.0 and **independently fixed five of the nine local bugs this fork was carrying** — in every case at a deeper root cause than our patch. Those five were dropped rather than ported; carrying them forward would have fought upstream's own rewrite of the same functions. 16 local commits became 12.

**History shape**: the replay was first done on top of upstream's real `v0.74.0` history (13139 commits) so git could 3-way-merge each fork commit against the correct base, then flattened back to a single `init` commit holding the stock 0.74.0 tree. The flatten is byte-identical to the un-flattened result — it only drops upstream's commit objects, which is what keeps `origin` pushable. Do the same on the next upgrade: **rebase against real upstream history, then re-flatten before pushing.**

**Safety refs**: pre-upgrade `main` at tag `pre-0.74-main` (`76bc3ed478`); the un-flattened 0.74 replay at tag `main-upstream-history-0.74`; upstream tags as local refs `upstream-v0.73.0` / `upstream-v0.74.0` — fetched one-shot by URL, **no remote was added**, so FOREMAN's decoupling rule still holds.

Verified green on the replayed tree: lint, typecheck, build, `pnpm test:gate` (751 passed), `pnpm smoke:boot`, plus the targeted suites for every kept fix.

### Two breaking changes from 0.74 to watch for

1. The **machine-wide concurrency cap is gone** — capacity is now two numbers per project.
2. **Spawned child agents count against Max Concurrent Tasks** (`maxSpawnedAgentsPerParent` / `maxSpawnedAgentsGlobal` deleted). Previously children were counted by neither capacity gate despite each getting its own worktree.

## Local fixes still carried (12 commits, all with regression tests)

| Commit | Defect |
|---|---|
| `0f1912da19` | approve-plan/reject-plan passed `status: undefined`; cards kept `awaiting-approval` and never dispatched. **Still broken in stock 0.74** (verified). Also adds the `.env` loader. |
| `15f3f9f4b1` | mission tasks got branch `main/f-<id>` (git cannot nest a ref under the existing `main` file). Now `main-f-<id>`. **Still broken in stock 0.74** (verified — `derivePerTaskBranchName` still returns `${base}/${segment}`). |
| `6eca1bbb33` | `.nvmrc` Node 22.22.2 pin (absent from upstream entirely) + the AGENTS.md port-4040 fork override. |
| `d0853cfbea` | mission fix-lineage rows stayed `in-progress` forever on retry-budget exhaustion, and autopilot's slice-advancement gates required every feature `done`, which a blocked feature can never satisfy. `terminalizeOpenLineageChain` + `isFeatureSettledForAdvancement`. |
| `1c2b3e925f` | root-supersession gap in `reconcileSupersededGeneratedFixFeatures` — a lineage ROOT could never be superseded, so an exhausted root blocked advancement forever. |
| `9a37a2f6f5` | Gemini 3.x model pricing (catalog predated the family entirely) + mission-interview accepts an unwrapped completion payload. |
| `1fa7cb0caf` | AI config + model-pricing tests. |
| `4cb012b764` | systemd dashboard supervision for the VM (`deploy/systemd/`). |
| `e2902fd009` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` duplicate-warning suppression in the dev runner. |
| `ded3415ba0` `05c1e28aad` `e22a49ee02` | docs (this file's history). |

## Now owned by upstream — do not re-fix these here

These were fork-local fixes on 0.73.0. On 0.74 they are upstream's, implemented better. If one of these symptoms reappears, **debug upstream's implementation — do not restore the old fork patch**.

| Symptom | Upstream 0.74 owner |
|---|---|
| Cards parking in Todo when Plan Review is disabled or the plan was approved manually | `99c9f14` — `isUnplannedForExecution`'s pre-release gate now applies only when the plan-review node's column equals the card's column **and** the group is enabled. Part of the plan-in-place workflow rewrite. |
| `require-all` cards released out of Planning before approval was recorded | `fbe7eb5` — `isTaskBlockedOnApproval` is now consulted by *all* planning-lane advance surfaces (`issueRelease` + its in-txn `moveTaskIf` predicate, both plan-review continuation seeders, the drain classifier), not just the hold-release sweep. |
| Pre-release Plan Review deadlock, third shape (self-healing-recovered card never seeds a continuation) | `8288e4a` + `2934ccc` + `2771408` — `onSpecifyComplete` now carries a three-state `PlanningHandoffReport` and arms the continuation only on `outcome === "released"`; `recoverApprovedTask` returns `outcome !== "withheld"`. **Our fix fired the callback unconditionally, which is exactly what upstream now deliberately gates.** |
| Mission validator "Validator omitted linked assertion result" — every validation failing regardless of code correctness | `1aa1516` — validator prompts now provide assertion IDs, plus a legacy exact-count response recovery path ours lacked. `3b63351` additionally bounds candidate JSON parsing to 256 KiB / eight attempts. |
| Plan Review provider-failure retry budget exhausting in ~2s when two tasks queue Plan Review together | `e6b2da6` — **fixes the cause**: `TaskExecutor.sessionRegistryPath` now task-scopes the `activeSessionRegistry` key for any session rooted at `rootDir`. The bare-root key was what made the second task throw `ActiveSessionPathHeldByForeignTaskError`. Our fix widened the budget; there is no longer a sibling to wait out. |
| Tasks created with no resolvable workflow (mission/slice shape, project with no default workflow) | 0.74's `task-creation.ts` resolves `getDefaultWorkflowId() ?? DEFAULT_WORKFLOW_ID` at the creation seam; `10df734` fixed the adjacent quick-add-Start shape. |

## Resolved — orphaned `local-<hash>` project data causing a false task-ID-integrity alarm (2026-07-29)

See `/Users/eduard/.claude/projects/-Users-eduard-projects-my-fusion/memory/foreman-orphaned-local-project-cleanup.md` for the full writeup (not duplicated here). Short version: `pipeline-sandbox` was opened once before being registered in the central project registry, ran under a deterministic fallback id (`local-<sha256(rootDir)>`), and created 3 tasks there before the real registration the next day created a parallel, unrelated KB-series. The stale allocator row for that orphaned id (`next_sequence=1`, stale relative to its own 3 tasks) tripped the integrity check. Confirmed via `\d project.tasks` that the real primary key is composite `(project_id, id)` — no actual collision risk, just confusing leftover state. Deleted (operator-approved) the 3 orphaned task rows and the 1 stale allocator row. The *detector's* cross-project global scan design (a comment in `packages/core/src/task-store/async-allocator.ts` claims `tasks.id` is a global PK, which is incorrect against the actual schema) is a known, deliberately-deferred follow-up — not touched. **Line numbers in that memory refer to 0.73.0; re-locate the comment on 0.74 before acting.**

## Cost trap (2026-08-05) — `--paused` does not stop durable agent heartbeats

**`fn dashboard --paused` / `fn serve --paused` pauses task automation but NOT durable-agent heartbeats.** Measured on a paused boot: five agents (CEO on `greet-cli`, `send-sms-generated`, `tetris`, plus `iOS Developer` and `Dev-01`) ran 7 timer-driven heartbeats in 3m22s — ~457k input + 12.7k output + 1.86M cache-read tokens, roughly **$1 in three minutes, ≈$19/hour to sit idle**. During the 8-minute KB-025 run the heartbeats cost about as much as the task itself.

This sits badly against FOREMAN's "guardrails go in code, not prompts" constraint: the pause switch does not stop spend. Before any long engine session, either delete the idle agents or pause the projects that own them (`UPDATE central.projects SET status='paused' WHERE …`).

**`--project <name>` does not scope the engine.** `fn serve --project pipeline-sandbox` still logged `Starting engines for 5 registered project(s)` and created a runtime per project. The flag picks a *primary* project only; there is no single-project engine mode. Pausing the other projects is the only lever.

Related: a project with `status='paused'` in `central.projects` makes `fn serve --project <that project>` exit 1 with `Error: Project <id> is paused`.

## Operating rule (2026-07-30) — engine lockfile / multiple stray dev-server instances

`pnpm dev dashboard` uses a 3-level process chain (`pnpm dev dashboard` → `node scripts/dev-with-memory.mjs dashboard` → the actual tsx-loaded dashboard binary) **and** a per-project `.fusion/engine.lock` that refuses to start a second engine for the same project on the machine. Restarting "the dashboard" repeatedly can fail to pick up code changes, because:

1. There can be more than one full `pnpm dev dashboard` chain alive at once, started from different terminals at different times, only one of which is actually bound to port 4040 at any given moment (they don't all try to bind — check `.fusion/engine.lock`'s holder, not just `lsof -iTCP:4040`).
2. A restart of "the" dashboard (killing the chain bound to port 4040) can still leave an **older, unrelated chain** alive elsewhere, silently holding the engine lock — the *new* dashboard process boots fine and serves the UI, but logs `Refusing to start engine for <project>: Another engine is already running` and never actually runs the project's engine at all. The dashboard UI shows "Project engine is not connected... Starting..." for this exact reason.
3. Symptom in practice: code fixes appear to have no effect, because the actual engine doing the work is a process from hours earlier, never touched by any restart.

**When "restarting" doesn't seem to take effect**: `ps aux | grep dashboard` for *every* matching process tree (not just the one on port 4040), check each one's `lstart`, and kill every stale tree before starting fresh. Cross-check `cat <project>/.fusion/engine.lock*` isn't held by a PID that's already dead.

## Operating rules learned the hard way (carried forward)

- On a card showing **AWAITING APPROVAL**, the only correct control is **Approve Plan**. **Promote** and **Move to Todo** move the card *without* recording approval, and once moved it cannot be approved (the route requires the intake column).
- Never drag a card an agent is actively working on — it destroys the worktree the agent is in.
- Agents only see the registered project's directory. Every codebase gets its own registered project.
- Per-project settings (plan approval mode, default workflow) must be re-applied on each new project. **A project with no default workflow cannot dispatch anything** — set it first. (0.74 now falls back to the built-in default workflow at creation, but setting it explicitly is still correct.)
- `planApprovalMode` defaults to `"auto-approve-all"` for new projects (`packages/core/src/settings-schema.ts`) — Plan Review (already AI-driven) is the only gate unless you explicitly set `"require-all"`.

## Next actions, in order

1. **The credit check** (highest priority): make Vertex work via ADC (`gcloud auth application-default login`), switch `defaultProvider` back to `google-vertex`, verify spend lands in GCP billing.
2. **Stop the idle heartbeat burn** — see the cost trap above. Decide which of the five durable agents on `greet-cli`/`send-sms-generated`/`tetris` should still exist; delete or pause the rest. At ~$19/hour of idle spend this outranks most feature work.
3. **Resolve the accidental `my-fusion` project registration** — currently paused; remove it unless you want a Foreman-on-Foreman board.
4. **Run a mission end to end on 0.74.** KB-025 covered the single-task path; the mission path (shared branch groups, validator loop, lineage supersession) is where four of the carried fork fixes live and none of them were exercised. Also still unverified: the two 0.74 breaking changes (per-project capacity numbers; spawned agents counted against Max Concurrent Tasks).
5. **Upgrade the VM** (`REMOTE.md` → `execution-test`): same rebase, same migrations, then re-run `./deploy/systemd/install.sh`. Still on 0.73.
6. **Configure the roster** — roles onto lanes with per-lane models.
7. **Remote access** — Tailscale + `tailscale serve`; verify on a phone.
8. *(Optional, low priority)* Fix `async-allocator.ts`'s cross-project global-scan design tension (see the orphaned-project section above) — deliberately deferred, not urgent.

Done 2026-08-05: pushed to `Havreliuc/my-fusion` (force-push over the old flattened history; `origin/main` = local `main`, and the pre-upgrade history is preserved on the remote as tag `pre-0.74-main`).

## Don't

- Don't add a login system, user table, or multi-tenancy.
- Don't configure Claude, OpenAI, or any separately-billed provider.
- Don't run tickets for a codebase that isn't the registered project.
- Don't add an upstream `remote` or re-add `filter=lfs` lines. (Upstream *tags* exist as local refs `upstream-v0.73.0` / `upstream-v0.74.0` from the 0.74 upgrade — that is deliberate and is not a remote.)
- Don't restore a fork patch listed in "Now owned by upstream" — debug upstream's implementation instead.
- Don't expose the dashboard beyond the tailnet.
- Don't assume "the dashboard isn't running" just because port 4040 doesn't answer, or that a restart "took" just because a new PID appears on port 4040 — check for stray sibling process trees and the engine lockfile holder first.
