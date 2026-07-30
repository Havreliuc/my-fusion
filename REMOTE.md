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
runs in the foreground of an SSH session and dies on disconnect), a GitHub credential (only
needed once agents push branches / open PRs against a real target repo — `my-fusion` itself
is public), and Vertex/Gemini AI wiring (`testMode: true` is the recommended way to exercise
the dashboard/engine without any AI credentials at all).

## Known caveats / open items

- IAP access blocked on missing `setIamPolicy` permission (see Access, above).
- Direct-access firewall rule depends on a dynamic residential IP that will eventually change.
- No systemd unit yet — the dashboard process dies when the SSH session closes.
- No GitHub token or Vertex AI credentials configured on this VM yet.
- This is a test/throwaway setup on a live company project, not the personal-credit-funded
  deployment `FOREMAN.md` describes as the long-term target.
