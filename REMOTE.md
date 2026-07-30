# REMOTE.md — remote GCP test VM

Companion to `HANDOFF.md`. Covers a separate, throwaway effort: running the Fusion/Foreman
dashboard and engine on a remote GCP VM instead of a local machine, reachable from a Mac
via Chrome. This is a testing exercise, not the target production deployment described in
`FOREMAN.md`.

## What this is

A GCE VM running the dashboard/engine using the VM's own CPU/disk, accessed remotely by
forwarding the dashboard's port over SSH to `localhost` and opening it in Chrome.

## Infrastructure (Terraform)

Config lives **outside this repo**, at `~/projects/foreman/infra/gcp-test-vm/` — consistent
with `FOREMAN.md`'s convention that planning/infra lives in `~/projects/foreman/`, not in
the `my-fusion` checkout itself.

- `main.tf` / `variables.tf` / `outputs.tf` — resource definitions
- `terraform.tfvars` — the knobs to edit for changes (machine size, zone, disk, source IPs)
- `startup.sh` — boot-time OS setup (git, build tools, Postgres) baked into the VM image
- State is local (`terraform.tfstate` in that directory, gitignored)

To change anything (resize, move region, widen disk, update allowed source IP), edit
`terraform.tfvars` then:

```bash
cd ~/projects/foreman/infra/gcp-test-vm
terraform plan -out=tfplan
terraform apply tfplan
```

**GCP does not support renaming an instance in place.** Changing `instance_name` forces a
destroy-and-recreate of the VM (confirmed 2026-07-30, when the instance was renamed from
`fusion-dashboard-test` to `execution-test` this way) — anything installed on the VM's disk
is lost and the setup steps below must be re-run.

## Current VM

| | |
|---|---|
| Project | `calo-staging` (see note below) |
| Instance | `execution-test` |
| Zone | `us-central1-a` |
| Machine type | `e2-standard-4` (4 vCPU, 16 GB RAM) |
| Boot disk | 50 GB, `pd-balanced` |
| OS | Debian 12 |
| Network | `fusion-test-vpc` / `fusion-test-subnet` (`10.10.0.0/24`) — isolated, not `default` or `bionit-vpc` |
| Service account | `fusion-test-vm@calo-staging.iam.gserviceaccount.com` — **zero project IAM roles** |

## Cost (on-demand, `us-central1`, as of 2026-07-30)

- **Compute**: `e2-standard-4` ≈ **$0.134/hr** ≈ **$98/month** if left running continuously. Billed per-second while running, $0 while stopped. ([economize.cloud](https://www.economize.cloud/resources/gcp/pricing/compute-engine/e2-standard-4/))
- **Disk**: 50 GB `pd-balanced` ≈ $0.10/GiB-month ≈ **$5/month** — persists (and keeps billing) even while the VM is stopped, until the disk itself is deleted (`terraform destroy`).
- **External IP**: ephemeral, free while attached to a running instance.
- **Network egress**: usage-based, typically a few cents to low single dollars for dev/test traffic (git clone, `apt`, `pnpm install`).

**To cut cost between sessions**, stop the VM (keeps the disk, drops compute cost to $0):

```bash
gcloud compute instances stop execution-test --zone=us-central1-a --project=calo-staging
```

Start it again with `gcloud compute instances start ...`, or fully tear down everything
(VM + network + firewall rules + service account) with `terraform destroy` from the infra
directory.

## Why `calo-staging` and the isolation choices

`calo-staging` is a **live company GCP project** — it already runs `bionit-bastion`,
`bionit-comm-vm`, and a `bionit-vpc`, not a personal/credit-funded sandbox. This was a
deliberate choice made mid-session (the alternative, a personal `havreliuc@gmail.com`
project, was flagged first but the user chose to stay on `calo-staging`). Because of that,
this setup deliberately does **not** touch or rely on any existing project resources:

- A dedicated VPC (`fusion-test-vpc`) and subnet, separate from `default` and `bionit-vpc`.
- A dedicated service account with **no project IAM roles at all** — the project's default
  Compute Engine service account holds `roles/editor` project-wide, which would let any
  agent-executed shell command on this VM (that's the entire point of the Fusion executor —
  it runs LLM-directed commands) reach the metadata server and mint a token with edit access
  to the whole project, including the `bionit-*` resources. The dedicated SA closes that off.
- Firewall rules scoped by `target_tags`, never `0.0.0.0/0`.

## Access

**IAP tunneling (`--tunnel-through-iap`) does not currently work.** `havreliuc@calosense.com`
has `roles/editor` on `calo-staging`, which does **not** include `setIamPolicy` — granting
`roles/iap.tunnelResourceAccessor` requires a project Owner or IAM-admin, and none was
available in this session. `main.tf` has the binding ready (`google_compute_instance_iam_member.iap_tunnel_users`,
gated by `grant_iap_access` in `terraform.tfvars`, currently `false`); flip it to `true` and
have someone with `setIamPolicy` run `terraform apply` to enable IAP instead of the fallback
below.

**Current access path**: direct SSH, restricted by firewall to specific source IPs
(`direct_access_source_ranges` in `terraform.tfvars`). This works entirely within
`roles/editor` — no IAM binding needed.

- ⚠️ The current allowed IP (`188.26.80.55/32`, as of 2026-07-30) is a **dynamic residential
  IP**. If it changes, SSH access breaks until `direct_access_source_ranges` is updated and
  re-applied.

```bash
# SSH in
gcloud compute ssh execution-test --zone=us-central1-a --project=calo-staging

# Forward the dashboard port over SSH (the app binds 127.0.0.1 only, per FOREMAN.md's
# "never 0.0.0.0" rule — it is never reachable on the VM's external interface directly)
gcloud compute ssh execution-test --zone=us-central1-a --project=calo-staging -- -L 4040:127.0.0.1:4040 -N
```

Then open `http://localhost:4040` in Chrome.

For editing code on the VM from a local-feeling editor, use VS Code Remote-SSH rather than
syncing/mounting folders (network-mounting a local folder into the VM was considered and
rejected — Fusion's engine creates a git worktree per task and runs `pnpm install`/builds/
tests inside it, which is reliably 10-50x slower over a network mount, and mounts can drop
mid-task). Add to `~/.ssh/config`:

```
Host execution-test
    HostName execution-test
    User <your-OS-Login-username>
    ProxyCommand gcloud compute start-iap-tunnel execution-test %p --listen-on-stdin --zone=us-central1-a --project=calo-staging
    ProxyUseFdpass no
```

Note: that `ProxyCommand` uses IAP, so it won't work until IAP access is granted (see
above). Until then, Remote-SSH can connect using the VM's external IP directly instead,
since the direct-access firewall rule already permits it from the allowed source IP.

## Setup steps (manual, run once per VM — re-run after any destroy/recreate)

Postgres, git, and build tools are installed automatically by `startup.sh` on first boot.
Everything else is done by hand over SSH so no credentials ever sit in VM metadata:

```bash
# Node 22.22.2 (matches .nvmrc) + pnpm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 22.22.2
nvm use 22.22.2
corepack enable

# Postgres role + database (Postgres itself is already running)
sudo -u postgres psql -c "CREATE ROLE fusion WITH LOGIN PASSWORD '<pick a password>' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE fusion OWNER fusion;"

# Clone (public repo, no credential needed) and configure
git clone https://github.com/Havreliuc/my-fusion.git ~/my-fusion
cat > ~/my-fusion/.env <<'EOF'
DATABASE_URL=postgresql://fusion:<same password>@localhost:5432/fusion
EOF

cd ~/my-fusion
pnpm install
pnpm build
pnpm --filter @runfusion/fusion exec fn serve --port 4040 --host 127.0.0.1
```

The actual Postgres password used on the current `execution-test` VM is **not recorded
here** — it lives only in `~/my-fusion/.env` on the VM itself (gitignored, localhost-only
Postgres, never committed), per `FOREMAN.md`'s secrets policy.

Not yet done, out of scope for this pass: a persistent systemd unit (the app currently only
runs in the foreground of an SSH session and dies on disconnect).

**AI is now configured for real** (updated 2026-07-30, supersedes the `testMode: true`
guidance above): `~/.fusion/settings.json` on the VM has `defaultProvider: "google"`,
`testMode: false`, and a real Google AI Studio key was added via the dashboard's **Secrets**
view (not recorded here — never put in this file, per `FOREMAN.md`'s secrets policy).
`defaultModelId` was `gemini-2.0-flash`, which Google has since fully deprecated (real API
404: *"models/gemini-2.0-flash is no longer available"*) — fixed to `gemini-2.5-flash` via
direct edit of `~/.fusion/settings.json` on the VM. **The running dashboard process may still
have the old value cached in memory** — confirm by checking whether it was restarted after
that edit; if not, restart it (find the `node packages/cli/bin.mjs dashboard` PID, kill it,
relaunch the same command) before assuming the model fix is live.

GitHub is set up: `gh` is authenticated on the VM as a dedicated bot account
(`havreliuc-cloud`, not the operator's personal GitHub identity — deliberately, to avoid
exposing personal credentials on this VM). Verify with `gh auth status`.

## Active investigation — `KB-002` failing on the `first` project (opened 2026-07-30)

**For another Claude instance picking this up**: this is an open, unresolved investigation.
Everything below is what's been established so far and where the trail goes cold — pick up
from "Where to look next," don't just re-derive the same dead end.

**What's on screen**: the dashboard UI (via the SSH tunnel, see Access above) shows a task
`KB-002`, title *"Resolve pnpm approve-builds issue by interactively approving esbuild build
scripts"*, status **FAILED**, "Workflow graph terminated with failure at node
`steps#0:step...`", 0/6 steps complete, under a project the UI shows as `first`. This looks
like a real infrastructure issue (pnpm's build-script approval gate blocking `esbuild`, a
package with a native postinstall step) surfaced autonomously during some other task's
`pnpm install` — a different class of problem from the Gemini model/parsing issues
documented above, not related to those fixes.

**Project registry state, confirmed via direct query** (same pattern used throughout this
doc — SSH in, `PGPASSWORD='<vm-postgres-password>' psql -U fusion -h localhost -d fusion -c
"<query>"`):

- `central.projects` currently has **exactly one row**: `proj_c2468217be884f09`, name
  `first`, path `/home/havreliuc_calosense_com/first`.
- The **original `my-fusion` project (`proj_c63af413acfc4fad`) is gone** from this table —
  confirmed present earlier in this same session, confirmed absent on the most recent check.
  No `archive.projects` table exists (checked) — this isn't a soft-delete, the row is just
  not there. This mirrors an identical drop-out seen on the **local** machine for `my-fusion`
  and `ai-work` (both still have valid `.fusion/project.json` markers on disk, neither is in
  the local `central.projects` table either) — likely the same underlying bug, not a
  coincidence, but the actual cause hasn't been found on either machine.
- `proj_c2468217be884f09` is the **same ID** that appeared as an unexplained "phantom"
  project reference twice earlier in this session (once via a stale browser URL showing VM
  content, once as a real 500-error-causing reference on the local instance) — at both of
  those points it did not exist in either machine's `central.projects`. The working theory:
  a project-creation flow reserves/exposes the ID client-side (URL, in-memory state) before
  the row is actually persisted, so it's visible as a "phantom" before it's visible as real —
  but this is inferred, not confirmed by reading the actual registration code path.

**Dead end so far**: `SELECT id, title, status, error FROM project.tasks WHERE project_id =
'proj_c2468217be884f09'` returns **zero rows**, despite `KB-002` being visibly rendered in
the UI under that project right now. Same zero-row result filtering by `id LIKE '%KB-002%'`
or title.

**Where to look next** (not yet tried):
- Query `project.tasks` with no `WHERE` filter at all and inspect every row's actual
  `project_id` value — the UI might be associating the task with `first` while the row is
  actually still scoped to the vanished `proj_c63af413acfc4fad`, or some other id.
- Check `project.workflow_run_step_instances` and `project.workflow_steps` (both exist per
  earlier schema listing) — the failure is workflow-graph-shaped ("terminated at node
  `steps#0:step...`"), so the actual error detail likely lives in one of these, not in
  `project.tasks.error`.
- Check `central.task_claims` (exists per earlier schema listing) for anything referencing
  this task.
- Check whether the dashboard process's own stdout/stderr (the terminal running
  `node packages/cli/bin.mjs dashboard`) has the real error logged — the DB may simply not
  be where this particular failure detail is recorded.
- Confirm current `central.projects` state fresh before trusting anything above — this is a
  live, actively-changing system and rows have already been observed appearing/disappearing
  within this same session.

## Known caveats / open items

- IAP access blocked on missing `setIamPolicy` permission (see Access, above).
- Direct-access firewall rule depends on a dynamic residential IP that will eventually change.
- No systemd unit yet — the dashboard process dies when the SSH session closes.
- No GitHub token or Vertex AI credentials configured on this VM yet.
- This is a test/throwaway setup on a live company project, not the personal-credit-funded
  deployment `FOREMAN.md` describes as the long-term target.
