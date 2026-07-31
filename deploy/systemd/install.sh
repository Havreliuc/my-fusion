#!/usr/bin/env bash
# FNXC:RemoteDeploy 2026-07-30-22:10:
# Idempotent installer for the fusion-dashboard systemd --user unit. Run this
# once per VM (or after `git pull` if the unit file changed) from anywhere —
# it locates the repo root relative to itself. See REMOTE.md's Setup steps.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$UNIT_DIR"
ln -sf "$REPO_DIR/deploy/systemd/fusion-dashboard.service" "$UNIT_DIR/fusion-dashboard.service"

systemctl --user daemon-reload
systemctl --user enable --now fusion-dashboard.service

# Without lingering, user units stop the moment the last session for this
# user logs out — the exact "dies on SSH disconnect" problem this exists to
# fix. Requires privilege; if this fails, ask an operator with sudo to run
# `sudo loginctl enable-linger "$USER"` once.
if command -v loginctl >/dev/null 2>&1; then
  sudo loginctl enable-linger "$USER" || \
    echo "warning: could not enable-linger for $USER — the service will still stop on full logout until an operator runs: sudo loginctl enable-linger $USER" >&2
fi

echo "Installed. Check status with: systemctl --user status fusion-dashboard.service"
echo "Follow logs with:            journalctl --user -u fusion-dashboard.service -f"
