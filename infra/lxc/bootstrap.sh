#!/usr/bin/env bash
# bootstrap.sh — AgenticOS LXC provisioner
# Run on the Proxmox host (root@192.168.42.41) or from Mac via:
#   ssh root@192.168.42.41 'bash -s' < infra/lxc/bootstrap.sh
#
# Safe to re-run: every mutating step is guarded by an idempotency check.
# Does NOT start the service — the Bun entry point lands via S014 rsync.
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Configuration — change these before running if needed
# ---------------------------------------------------------------------------
LXC_IP="192.168.42.45"       # First confirmed-free IP from .44-.48 range
                               # .44 = Xiaomi wireless client (alive)
                               # .45 = free (stale ARP from deleted CT 105)
LXC_GW="192.168.42.1"
LXC_NETMASK="24"
LXC_BRIDGE="vmbr0"           # Secure VLAN bridge (same as CT 102/103)
LXC_HOSTNAME="agenticos"
LXC_RAM="512"                 # MB — hard cap per story constraints
LXC_SWAP="0"
LXC_CPUS="1"
LXC_DISK="2"                  # GB on pve/data thin pool
LXC_STORAGE="local-lvm"
LXC_OSTEMPLATE="local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
LXC_ID_MIN=110
LXC_ID_MAX=130
BUN_VERSION="1.2.13"          # Pinned — do not float to latest in production
SERVICE_USER="agenticos"
OPT_DIR="/opt/agenticos"
SYSTEMD_UNIT_SRC="$(dirname "$0")/../systemd/agenticos-api.service"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log_info()  { echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO:  $*"; }
log_warn()  { echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARN:  $*" >&2; }
log_error() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; }

# ---------------------------------------------------------------------------
# Step 0: Verify we are on the Proxmox host
# ---------------------------------------------------------------------------
if ! command -v pct &>/dev/null; then
  log_error "pct not found. This script must run on the Proxmox host (root@192.168.42.41)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: Verify LXC_IP is actually free
# ---------------------------------------------------------------------------
log_info "Probing $LXC_IP before claiming it..."
if ping -c 1 -W 2 "$LXC_IP" &>/dev/null; then
  log_error "$LXC_IP is alive on the network. Choose a different IP."
  exit 1
fi
if ip neigh show "$LXC_IP" 2>/dev/null | grep -qE 'REACHABLE|STALE|DELAY'; then
  log_warn "$LXC_IP has a stale ARP entry but ping failed — treating as free."
fi
log_info "$LXC_IP is free."

# ---------------------------------------------------------------------------
# Step 2: Find the first unused CT ID in the 110-130 range
# ---------------------------------------------------------------------------
LXC_ID=""
for candidate in $(seq "$LXC_ID_MIN" "$LXC_ID_MAX"); do
  if ! pct status "$candidate" &>/dev/null; then
    LXC_ID="$candidate"
    break
  fi
done

if [[ -z "$LXC_ID" ]]; then
  log_error "No free CT ID found in range $LXC_ID_MIN-$LXC_ID_MAX."
  exit 1
fi
log_info "Chosen CT ID: $LXC_ID"

# ---------------------------------------------------------------------------
# Step 3: Verify OS template is available (or download it)
# ---------------------------------------------------------------------------
if ! pveam list local 2>/dev/null | grep -q "debian-12-standard"; then
  log_info "Debian 12 template not found locally — downloading..."
  pveam update
  pveam download local debian-12-standard_12.7-1_amd64.tar.zst
fi

# ---------------------------------------------------------------------------
# Step 4: Create the LXC (idempotent: skip if already exists)
# ---------------------------------------------------------------------------
if pct status "$LXC_ID" &>/dev/null; then
  log_info "CT $LXC_ID already exists — skipping create."
else
  log_info "Creating unprivileged Debian 12 LXC (CT $LXC_ID)..."
  pct create "$LXC_ID" "$LXC_OSTEMPLATE" \
    --hostname "$LXC_HOSTNAME" \
    --memory "$LXC_RAM" \
    --swap "$LXC_SWAP" \
    --cores "$LXC_CPUS" \
    --rootfs "${LXC_STORAGE}:${LXC_DISK}" \
    --net0 "name=eth0,bridge=${LXC_BRIDGE},gw=${LXC_GW},ip=${LXC_IP}/${LXC_NETMASK},type=veth" \
    --nameserver "192.168.42.1" \
    --unprivileged 1 \
    --onboot 1
  log_info "CT $LXC_ID created."
fi

# ---------------------------------------------------------------------------
# Step 5: Start the LXC
# ---------------------------------------------------------------------------
CT_STATUS="$(pct status "$LXC_ID" | awk '{print $2}')"
if [[ "$CT_STATUS" != "running" ]]; then
  log_info "Starting CT $LXC_ID..."
  pct start "$LXC_ID"
  sleep 5   # give the container time to boot
else
  log_info "CT $LXC_ID is already running."
fi

# ---------------------------------------------------------------------------
# Step 6: Wait for network inside CT
# ---------------------------------------------------------------------------
log_info "Waiting for network in CT $LXC_ID..."
RETRIES=10
for i in $(seq 1 "$RETRIES"); do
  if pct exec "$LXC_ID" -- ping -c 1 -W 2 8.8.8.8 &>/dev/null; then
    log_info "Network is up."
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    log_error "Network not available in CT $LXC_ID after $RETRIES retries."
    exit 1
  fi
  sleep 3
done

# ---------------------------------------------------------------------------
# Step 7: Install prerequisites inside the LXC
# ---------------------------------------------------------------------------
log_info "Installing prerequisites (curl, unzip, ca-certificates)..."
pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  apt-get update -qq
  apt-get install -y -qq curl unzip ca-certificates
"

# ---------------------------------------------------------------------------
# Step 8: Install Bun (pinned version) inside the LXC
# ---------------------------------------------------------------------------
log_info "Installing Bun ${BUN_VERSION} inside CT $LXC_ID..."
pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  if command -v bun &>/dev/null && bun --version | grep -q '${BUN_VERSION}'; then
    echo 'Bun ${BUN_VERSION} already installed — skipping.'
    exit 0
  fi
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local BUN_VERSION='${BUN_VERSION}' bash
  # Ensure bun is on PATH for all users
  if [[ ! -f /usr/local/bin/bun ]]; then
    ln -sf /usr/local/bin/bun /usr/local/bin/bun
  fi
  bun --version
"

# ---------------------------------------------------------------------------
# Step 9: Create service user
# ---------------------------------------------------------------------------
log_info "Ensuring service user '$SERVICE_USER' exists..."
pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  if id '${SERVICE_USER}' &>/dev/null; then
    echo 'User ${SERVICE_USER} already exists — skipping.'
  else
    useradd --system --no-create-home --shell /usr/sbin/nologin '${SERVICE_USER}'
    echo 'User ${SERVICE_USER} created.'
  fi
"

# ---------------------------------------------------------------------------
# Step 10: Create /opt/agenticos directory tree
# ---------------------------------------------------------------------------
log_info "Creating $OPT_DIR directory tree..."
pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  mkdir -p '${OPT_DIR}/api'
  mkdir -p '${OPT_DIR}/data/snapshots'
  chown -R '${SERVICE_USER}:${SERVICE_USER}' '${OPT_DIR}'
  chmod -R 750 '${OPT_DIR}'
  echo 'Directory tree OK.'
"

# ---------------------------------------------------------------------------
# Step 11: Create stub EnvironmentFile
# ---------------------------------------------------------------------------
log_info "Creating stub /etc/agenticos.env..."
pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  if [[ ! -f /etc/agenticos.env ]]; then
    cat > /etc/agenticos.env <<'ENVEOF'
# AgenticOS environment — populated during deployment
# Never commit secrets to git. This file is outside the repo.
NODE_ENV=production
PORT=3000
ENVEOF
    chmod 600 /etc/agenticos.env
    echo '/etc/agenticos.env created.'
  else
    echo '/etc/agenticos.env already exists — skipping.'
  fi
"

# ---------------------------------------------------------------------------
# Step 12: Install systemd unit
# ---------------------------------------------------------------------------
log_info "Installing systemd unit into CT $LXC_ID..."

# Read the service file content from the repo (relative to this script)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
UNIT_PATH="${SCRIPT_DIR}/../systemd/agenticos-api.service"

if [[ ! -f "$UNIT_PATH" ]]; then
  log_error "Systemd unit not found at $UNIT_PATH"
  exit 1
fi

# Push the unit file into the CT
pct push "$LXC_ID" "$UNIT_PATH" /etc/systemd/system/agenticos-api.service

pct exec "$LXC_ID" -- bash -c "
  set -euo pipefail
  systemctl daemon-reload
  if systemctl is-enabled agenticos-api &>/dev/null; then
    echo 'Unit already enabled — skipping.'
  else
    systemctl enable agenticos-api
    echo 'Unit enabled.'
  fi
  # NOTE: Do NOT start the service here.
  # The Bun entry point (/opt/agenticos/api/server.ts) is deployed via
  # S014 rsync. Starting before it lands causes restart loops.
  # After S014 completes, run: systemctl start agenticos-api
"

# ---------------------------------------------------------------------------
# Step 13: Post-install summary
# ---------------------------------------------------------------------------
log_info "==========================================="
log_info "Bootstrap complete."
log_info "  CT ID  : $LXC_ID"
log_info "  IP     : $LXC_IP"
log_info "  RAM    : ${LXC_RAM} MB (hard cap)"
log_info "  Disk   : ${LXC_DISK} GB on $LXC_STORAGE"
log_info "==========================================="
log_info "NEXT STEPS:"
log_info "  1. Complete S014 (rsync data/snapshots/ + api/ to LXC)"
log_info "  2. Apply cloudflared ingress rule (see infra/cloudflare/access-policy.md)"
log_info "  3. Apply Cloudflare Access policies in dashboard"
log_info "  4. Then: pct exec $LXC_ID -- systemctl start agenticos-api"
log_info "  5. Verify: curl -sf https://agenticos.sethsendom.com/ | grep -i AGENTICOS"
