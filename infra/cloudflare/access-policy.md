# Cloudflare Access Policy — agenticos.sethsendom.com

## Context

CT 103 (`cloudflared`, 192.168.42.43) runs cloudflared 2026.2.0 in **remotely-managed tunnel mode**
(token-based: `cloudflared tunnel run --token <TOKEN>`). There is **no local `config.yml`** — all
ingress routing rules are managed in the Cloudflare Zero Trust dashboard, not on disk.

This means adding `agenticos.sethsendom.com` ingress is a **dashboard-only manual step** (no
`config.yml` diff to apply via SSH). The tunnel ID is embedded in the token:
`71d3f3a4-c69e-431a-93cc-819760bc3252`.

---

## Step 1: Add the DNS CNAME record

In the Cloudflare DNS dashboard for `sethsendom.com`:

| Type | Name | Target | Proxied |
|------|------|--------|---------|
| CNAME | `agenticos` | `<tunnel-id>.cfargotunnel.com` | Yes (orange cloud) |

The tunnel ID: `71d3f3a4-c69e-431a-93cc-819760bc3252`
So target = `71d3f3a4-c69e-431a-93cc-819760bc3252.cfargotunnel.com`

---

## Step 2: Add the Public Hostname route in Zero Trust dashboard

**Path:** Zero Trust → Networks → Tunnels → click the running tunnel → **Public Hostname** tab → **Add a public hostname**

Fill in:

| Field | Value |
|-------|-------|
| Subdomain | `agenticos` |
| Domain | `sethsendom.com` |
| Path | (leave blank — routes everything) |
| Service Type | `HTTP` |
| URL | `http://192.168.42.45:3000` |

Click **Save hostname**.

### Before / After for reference

**Before** (existing hostnames on this tunnel — verify in dashboard):
```
frigate.sethsendom.com  →  http://192.168.42.34:5000   (or 8971, check live)
homeassistant.sethsendom.com  →  http://192.168.42.49:8123
```

**After** (new entry added):
```
frigate.sethsendom.com          →  http://192.168.42.34:5000
homeassistant.sethsendom.com    →  http://192.168.42.49:8123
agenticos.sethsendom.com        →  http://192.168.42.45:3000   ← NEW
```

The catch-all 404 (if any) stays last automatically — the dashboard manages ordering.

---

## Step 3: Cloudflare Access — Public bypass policy

**Path:** Zero Trust → Access → Applications → **Add an application** → Self-hosted

Create one application for the public routes:

| Field | Value |
|-------|-------|
| Application name | `AgenticOS Public` |
| Session duration | 24 hours (or whatever default) |
| Application domain | `agenticos.sethsendom.com` |
| Path | `/` |

Under **Policies** → **Add a policy**:

| Field | Value |
|-------|-------|
| Policy name | `Public bypass` |
| Action | **Bypass** |
| Include rule | Everyone |

Add a second path entry for `/how-it-was-built` and `/api/public.json` or use a wildcard approach:
- Either add the same Bypass policy to paths `/how-it-was-built` and `/api/public.json`
- Or set the entire application to Bypass and create a second (separate) application for `/ops*`

**Recommended approach:** Create **two** Access applications on the same hostname:

**Application 1 — Public (Bypass)**
- Hostname: `agenticos.sethsendom.com`
- Path: (blank = entire domain)
- Policy action: **Bypass** → Include: Everyone

**Application 2 — Ops (Protected)** — takes precedence for `/ops*` because more-specific paths win

---

## Step 4: Cloudflare Access — Protected policy for /ops

**Path:** Zero Trust → Access → Applications → **Add an application** → Self-hosted

| Field | Value |
|-------|-------|
| Application name | `AgenticOS Ops` |
| Session duration | 24 hours |
| Application domain | `agenticos.sethsendom.com` |
| Path | `/ops` |

Add a second entry for `/api/ops.json` (same application, additional path, or duplicate application).

Under **Policies** → **Add a policy**:

| Field | Value |
|-------|-------|
| Policy name | `Google SSO — Marcin only` |
| Action | **Allow** |
| Include rule type | **Emails** |
| Include rule value | `kokott.marcin@gmail.com` |
| Identity providers | Google (must be configured in Zero Trust → Settings → Authentication) |

**MANUAL STEP — exact fields to fill in the dashboard:**

1. Navigate to **Zero Trust → Settings → Authentication**
2. Confirm Google OAuth is listed as an identity provider. If not, add it:
   - Click **Add new** → **Google**
   - Provide Google OAuth client ID + secret (from Google Cloud Console)
   - Authorized redirect URI: `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`
3. Back in the Ops application policy:
   - Rule type: **Include**
   - Selector: **Emails**
   - Value: `kokott.marcin@gmail.com`
4. Save the application.

After saving, `curl -s -o /dev/null -w "%{http_code}" https://agenticos.sethsendom.com/ops`
should return `302` (redirect to Cloudflare Access login page) from any unauthenticated client.

---

## Step 5: Verify tunnel is routing after dashboard changes

The token-based tunnel picks up new hostname routes automatically — no cloudflared restart needed.
However, if you want to confirm the tunnel connector is healthy:

```bash
# From the Proxmox host, exec into CT 103
ssh root@192.168.42.41 'pct exec 103 -- systemctl status cloudflared'

# Tail logs to confirm no errors after adding the new hostname
ssh root@192.168.42.41 'pct exec 103 -- journalctl -u cloudflared -n 50 --no-pager'
```

If the connector shows reconnect loops, restart it:
```bash
ssh root@192.168.42.41 'pct exec 103 -- systemctl restart cloudflared'
```

---

## MANUAL STEPS CHECKLIST

- [ ] Add CNAME `agenticos` → `71d3f3a4-c69e-431a-93cc-819760bc3252.cfargotunnel.com` in Cloudflare DNS
- [ ] Add Public Hostname in Zero Trust tunnel: `agenticos.sethsendom.com` → `http://192.168.42.45:3000`
- [ ] Create Access Application "AgenticOS Public" with Bypass policy (Everyone)
- [ ] Create Access Application "AgenticOS Ops" for path `/ops` with Allow policy (emails: kokott.marcin@gmail.com, Google SSO)
- [ ] Add `/api/ops.json` to the Ops application (additional path or duplicate entry)
- [ ] Confirm Google identity provider is configured in Zero Trust → Settings → Authentication
- [ ] After S014 rsync + service start: run verification curls (see deploy-runbook.md Section 3)
