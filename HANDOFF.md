# Handoff — my-fusion / Foreman

Updated 2026-07-29 after the first full bring-up session. Read `FOREMAN.md` first for the constraints; this file is state and next actions.

## What we're building

**Foreman**: a kanban board where AI agents with distinct roles pick up tickets, implement them in a real git repo, open PRs, and review each other. One human operator (the repo owner) supervises from the board, including from a phone.

The intended loop: a requirements document goes into a project → a planning agent decomposes it into dependency-ordered tickets → tickets get claimed by an implementer agent → it works in an isolated worktree → a reviewer agent approves or requests changes → on merge, dependent tickets unblock and the cycle continues.

## Decisions already made — do not relitigate

| Decision | Why |
|---|---|
| **Adopt Fusion, don't build** | It already does per-task worktrees (`fusion/{task-id}`), the merge/PR lifecycle, configurable lanes, and a local dashboard. Building that from scratch was ~2 months. |
| **Gemini on Vertex, never Claude/OpenAI APIs** | A GCP credit funds this. See FOREMAN.md hard constraints. **Currently violated as an interim state — see Open item 1.** |
| **Decouple from upstream (2026-07-29)** | Operator chose a fully independent copy: upstream remote removed, upstream branches/tags deleted from the GitHub repo, history flattened to a single `init` commit. |
| **No user accounts** | One operator. Remote access is Tailscale, not auth. |

## Current state (verified working)

- **Repo**: `main` = single `init` commit + local fixes, pushed to `github.com/Havreliuc/my-fusion` (only remote). Git LFS removed; media are pointer stubs (see FOREMAN.md).
- **Environment**: Node 22.22.2 via `.nvmrc` (machine default stays Node 20). pnpm via corepack. `git-lfs` binary installed via Homebrew (the global git config requires it).
- **Database**: local Homebrew PostgreSQL 18, database `fusion`, wired via `DATABASE_URL=postgresql://localhost:5432/fusion` in the repo-root `.env` (gitignored; loaded by `scripts/dev-with-memory.mjs` — our addition; shell env wins over `.env`). Embedded-postgres clusters exist under `~/.fusion/embedded-postgres/` but are only used when `DATABASE_URL` is unset or test mode is on.
- **Launch**: `pnpm dev dashboard` → click the printed `Open: http://localhost:4040/?token=…` URL. Global test mode is **off** (it was accidentally enabled during onboarding — it forces mock AI and a separate test database; the toggle hides in Settings → Merge).
- **Local fixes carried in the flattened init commit** (all FNXC-commented):
  1. `CentralCore.init()` layer-less PostgreSQL bootstrap restored — an upstream regression (2026-07-26 cleanup) had stubbed it to dead code, breaking CLI onboarding, `fn init` registration, and dashboard launch.
  2. `markLocalNodeOffline()` SQLite-mode guard + regression test (was warn-spamming every CLI close).
  3. `.env` loader in the dev runner.
  4. LFS-free `.gitattributes`.
- **Validated end to end** (before the board was reset): planning decomposed a milestone into 9 dependency-wired tickets, executor ran in per-task worktrees, committed, and squash-merged to `main`. The pipeline works.
- **Provider (INTERIM — violates the Vertex constraint)**: `defaultProvider: google` (AI Studio / `generativelanguage.googleapis.com`) with a pasted `AIzaSy…` key; model `gemini-3.6-flash`. The `google-vertex` provider rejected the API key outright (401 — Vertex accepts only OAuth/ADC). This bills outside the GCP credit and is exactly FOREMAN's "stop and report" condition — recorded here as the top open item, not worked around silently.
- **Guardrails on**:
  - **Global engine pause is currently ON** — nothing runs until footer → Start AI Engine.
  - Agent clarification enabled (global): planners may pause with a question instead of assuming.
  - Plan approval "require-all" (**per-project**, set on my-fusion): every spec needs manual approval before execution.
  - Default workflow `WF-001` "Coding with Gates" (**per-project**): includes a blocking Preflight Evidence Check (`gateMode: "gate"`) that fails any task referencing codebases/files/systems that don't demonstrably exist in the repo.

## Lesson learned (cost us one fabricated merge)

Agents only see the registered project's directory. A ticket about another codebase ("the Lovable application") run inside this project made the executor fabricate plausible work against Fusion's own repo — and merge it. Every codebase gets its own registered Fusion project; per-project guardrails (plan approval, default workflow) must be re-applied on each new project.

## Next actions, in order

1. **The credit check (unchanged, highest priority).** Make Vertex work properly: `gcloud auth application-default login` (ADC) on the funded GCP project, configure Fusion's Vertex path with it, switch `defaultProvider` back to `google-vertex`, run one trivial task, and verify spend lands in GCP billing. Until then the AI-Studio key is an unfunded interim.
2. **Register the real target repo.** Export the Lovable app to GitHub, clone it locally, `fn project add <name> <path>`, switch the dashboard to it, set plan approval require-all + WF-001 (duplicate or export/import from the Workflows view) there.
3. **Configure the roster** — map roles onto lanes (Planning/Executor/Validator/Merger) with per-lane models.
4. **Remote access** — Tailscale + `tailscale serve`; verify the board on a phone.

## Open questions

- ~~Are there budget/token guardrails?~~ **Partially answered:** a global pause exists (used tonight, works), token usage/cost is tracked per task and model. Per-task token caps and budget-halt still to be configured/verified — see settings reference "token budget precedence".
- ~~Do ticket dependencies exist with automatic unblocking?~~ **Yes — verified.** Tickets carry `blockedBy` edges and requeue behind their blockers.
- ~~Can Planning decompose a requirements document into ordered tickets?~~ **Yes — verified** (one milestone → 9 dependency-wired tickets, unprompted).
- **Does Fusion's Vertex path support ADC?** Still the blocking unknown (Next action 1). The API-key path is confirmed *not* Vertex.
- **How to express "more agents of some types"** (two backend devs, one frontend)? Unresolved.
- **Can the mobile PWA reach a fully-local instance over a tailnet?** Unresolved.

## Don't

- Don't add a login system, user table, or multi-tenancy.
- Don't configure Claude, OpenAI, or any separately-billed provider, even temporarily to "test something."
- Don't run tickets for a codebase that isn't the registered project — that's how the fabricated-merge incident happened.
- Don't refactor or reformat upstream code. See `FOREMAN.md`.
- Don't expose the dashboard beyond the tailnet.
- Don't re-add the upstream remote or `filter=lfs` lines.
