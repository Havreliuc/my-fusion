#!/usr/bin/env bash
# FNXC:RemoteDeploy 2026-07-30-22:10:
# The VM dashboard process previously died on SSH disconnect and, when
# manually relaunched over a non-interactive `gcloud compute ssh --command`,
# inherited a minimal PATH that omitted nvm's node/pnpm — verification steps
# survived because they export PATH themselves, but merge-time dependency
# sync (bare `pnpm ...`) failed with "pnpm: not found". This wrapper sources
# nvm and activates the repo's pinned .nvmrc version before exec'ing the
# dashboard, so every child process the engine spawns inherits a correct
# PATH. Used as the systemd unit's ExecStart (see fusion-dashboard.service)
# instead of hardcoding a node version's absolute path.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use

exec node packages/cli/bin.mjs dashboard \
  --port "${FUSION_DASHBOARD_PORT:-4040}" \
  --host "${FUSION_DASHBOARD_HOST:-127.0.0.1}"
