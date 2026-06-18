# Client Setup — SAP CPI Monitoring MCP Server

This guide is for **each client** who wants to use the SAP CPI Monitoring MCP
server from their own AI host (Claude Desktop / Claude Code). You run the server
**locally on your own machine** with **your own** SAP credentials.

> 🔒 **Your credentials never leave your machine.** They live only in your local
> config file below. Nothing is sent to the server's author or any shared host.

---

## What you need

1. **Node.js 18+** installed (`node --version` to check).
2. **An SAP BTP service key** from a *Process Integration Runtime* instance
   created with the **`api`** plan (not `integration-flow`). The key gives you
   four values:

   | Service-key field | Used as env var |
   |-------------------|-----------------|
   | `url`             | `CPI_API_BASE_URL` (Tenant Management Node, **no `-rt`**) |
   | `tokenurl`        | `CPI_TOKEN_URL` |
   | `clientid`        | `CPI_CLIENT_ID` |
   | `clientsecret`    | `CPI_CLIENT_SECRET` |

   > ⚠️ Use the **`api`**-plan key. An `integration-flow`-plan key points at the
   > `...-rt.cfapps...` runtime host and is rejected (401) by the monitoring API.

---

## Option 1 — Install via `npx` (recommended, once published)

You don't clone anything. Your AI host launches the server on demand with `npx`.

### Claude Desktop

Edit your config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
  (e.g. `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json`)
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add (or merge) this block, filling in **your** service-key values:

```json
{
  "mcpServers": {
    "sap-cpi-monitoring": {
      "command": "npx",
      "args": ["-y", "sap-cpi-monitoring-mcp-server"],
      "env": {
        "CPI_API_BASE_URL": "https://<your-tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com",
        "CPI_TOKEN_URL": "https://<your-subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
        "CPI_CLIENT_ID": "<your clientid>",
        "CPI_CLIENT_SECRET": "<your clientsecret>"
      }
    }
  }
}
```

Then **fully quit and reopen Claude Desktop**.

### Claude Code

```bash
claude mcp add sap-cpi-monitoring \
  --env CPI_API_BASE_URL=https://<your-tenant>...hana.ondemand.com \
  --env CPI_TOKEN_URL=https://<your-subdomain>.authentication.<region>.hana.ondemand.com/oauth/token \
  --env CPI_CLIENT_ID=<your clientid> \
  --env CPI_CLIENT_SECRET=<your clientsecret> \
  -- npx -y sap-cpi-monitoring-mcp-server
```

---

## Option 2 — Install from source (private distribution / not on npm)

If the package is **not** published to npm, install it from the repo:

```bash
git clone <repo-url> sap-cpi-monitoring-mcp
cd sap-cpi-monitoring-mcp/mcp-server
npm install
npm run build
```

Then point your AI host at the built file with an **absolute path**:

```json
{
  "mcpServers": {
    "sap-cpi-monitoring": {
      "command": "node",
      "args": ["C:\\full\\path\\to\\sap-cpi-monitoring-mcp\\mcp-server\\dist\\index.js"],
      "env": {
        "CPI_API_BASE_URL": "https://<your-tenant>...hana.ondemand.com",
        "CPI_TOKEN_URL": "https://<your-subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
        "CPI_CLIENT_ID": "<your clientid>",
        "CPI_CLIENT_SECRET": "<your clientsecret>"
      }
    }
  }
}
```

> The `env` block is the **only** place your credentials live. You can also put
> them in a local `mcp-server/.env` file instead (copy `.env.example`), but the
> `env` block is cleaner because it ties the credentials to your AI host config.

---

## Verify it works

1. Restart your AI host.
2. Look for the MCP / tools indicator (🔌). You should see `sap-cpi-monitoring`
   with 8 tools.
3. Ask, in chat:
   - *"Check my CPI connectivity"* → calls `check_cpi_metadata`
   - *"Show me failed CPI messages in the last 24 hours"* → `get_failed_messages`
   - *"Give me a CPI health summary"* → `get_cpi_health_summary`

If the tools don't appear, the server most likely failed to start because a
`CPI_*` value is missing or wrong — check the four values against your service key.

---

## Available tools

| Tool | What it does |
|------|--------------|
| `check_cpi_metadata` | Verify connectivity + OData metadata summary |
| `get_recent_messages` | Recent Message Processing Logs (newest first) |
| `get_failed_messages` | Failed/escalated messages in a time window |
| `get_messages_by_iflow` | Messages for a specific iFlow by name |
| `get_message_by_id` | Detail for one message by GUID |
| `get_message_error_details` | Full "Last Error" text + failing step for a GUID |
| `get_last_error_for_iflow` | Most recent error for a specific iFlow |
| `get_cpi_health_summary` | Aggregated health summary (counts + status) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tools don't appear in the host | Server failed to start | A `CPI_*` value is missing/wrong; check all four |
| `OAuth authentication failed (401)` | Wrong `clientid`/`clientsecret` | Re-copy from the service key |
| `OAuth forbidden (403)` | Missing role | Add `MonitoringDataRead` to the service instance |
| `404` on `/api/v1/...` | Using an `integration-flow`-plan key (`-rt` host) | Recreate the instance with the **`api`** plan |
| `Cannot reach token endpoint` | Wrong `CPI_TOKEN_URL` or proxy | Verify the token URL and your network |
