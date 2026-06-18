# Deploying the MCP Server to SAP BTP Cloud Foundry

This deploys the **Streamable HTTP** MCP server (`src/http.ts`) — the remote,
multi-tenant transport that any AI / IDE / agent can connect to. The stdio
entry point (`src/index.ts`) stays for local single-tenant use; it is **not**
what runs on CF.

> Target (from `cf target`): org `49386377trial`, space `dev`,
> API `https://api.cf.us10-001.hana.ondemand.com`.

## Architecture once deployed

```
AI / IDE / agent ──HTTPS /mcp (Bearer)──► CF app: sap-cpi-monitoring-mcp ──OAuth2/HTTPS──► each client's SAP CPI
                                                  │
                                                  └── SAP HANA Cloud (saved connections)
```

- **Multi-tenant:** each MCP session calls `connect_cpi` (or `use_connection`)
  to choose which CPI tenant it targets. Credentials are validated, then used
  only for that session.
- **Persistence:** saved connections live in **SAP HANA Cloud**, not on the CF
  filesystem (which is ephemeral and per-instance).
- **Auth:** the `/mcp` route requires `Authorization: Bearer <MCP_AUTH_TOKEN>`.

---

## Step 0 — Log in (token expired)

```powershell
cf login --sso
# follow the browser, paste the one-time passcode
cf target   # confirm org 49386377trial / space dev
```

## Step 1 — Provision SAP HANA Cloud storage

You said you already have a HANA Cloud instance in this trial. We need a way for
the app to reach it. Two common options:

**Option A — bind the existing HANA Cloud instance (hdi-shared / schema):**
```powershell
cf services                      # find your existing hana / hana-cloud instance name
cf service <your-hana-instance>  # confirm it's the one
```
We'll bind it in `manifest.yml` (`services: [ <name> ]`) so credentials arrive
via `VCAP_SERVICES`.

**Option B — create an HDI container bound to your HANA Cloud:**
```powershell
cf marketplace -e hana            # see available plans (e.g. hdi-shared, schema)
cf create-service hana hdi-shared cpi-hana
cf service cpi-hana               # wait until 'create succeeded'
```

> Tell me which instance/plan you have and I'll finish the HANA store code
> (`connectionsStore.hana.ts`) and the `services:` binding to match it.

## Step 2 — Set the auth secret

```powershell
# any long random string; AI clients must send it as the bearer token
cf set-env sap-cpi-monitoring-mcp MCP_AUTH_TOKEN "<a-long-random-secret>"
```
(You can also set this after the first push, then `cf restage`.)

## Step 3 — Build and push

```powershell
cd mcp-server
npm install
npm run build          # compiles TypeScript to dist/ (pushed as-is)
cf push                # uses manifest.yml in this folder
```

The buildpack installs production dependencies and runs `node dist/http.js`.
CF health-checks `GET /health`.

## Step 4 — Get the route and test

```powershell
cf app sap-cpi-monitoring-mcp     # note the 'routes' URL, e.g.
                                  # sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com
```

Health check:
```powershell
curl https://<route>/health
```

MCP initialize (should return a session id):
```powershell
curl -i -X POST https://<route>/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "Authorization: Bearer <MCP_AUTH_TOKEN>" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

---

## Step 5 — Connect an AI to it

**Claude Code:**
```bash
claude mcp add --transport http sap-cpi https://<route>/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

**Claude Desktop (paid plans):** Settings → Connectors → Add custom connector →
URL `https://<route>/mcp`. (Bearer-header support varies; if the client can't
attach a static header, we add an OAuth layer — see "Next steps".)

**ChatGPT:** Developer mode / connectors → add the URL. ChatGPT requires OAuth
2.1 on the server; that's a follow-up (see "Next steps").

Then, in chat:
1. *"List my saved CPI connections"* → `list_connections`
2. *"Connect to my CPI"* and provide the four service-key values → `connect_cpi`
3. *"Show failed messages in the last 24h"* → `get_failed_messages`

---

## Usage flow (multi-tenant)

| Tool | Purpose |
|------|---------|
| `connect_cpi` | Provide service-key values; validates, activates, and saves the connection |
| `use_connection` | Activate a previously-saved connection by id |
| `list_connections` | List saved connections (id, name, apiBaseUrl — never secrets) |
| `current_connection` | Show which connection the session is using |
| `check_cpi_metadata` … `get_cpi_health_summary` | Monitoring tools, scoped to the active connection |

---

## Next steps / hardening (post-MVP)

- **Encrypt secrets at rest** in HANA (the service key is sensitive).
- **Per-owner isolation:** scope saved connections to the authenticated caller
  so one client can't `use_connection` another client's id.
- **OAuth 2.1** authorization on `/mcp` for clients that require it (ChatGPT,
  some Claude Desktop setups) instead of a shared bearer token.
- **Autoscaling:** with HANA-backed storage, `instances` can be > 1 safely.
