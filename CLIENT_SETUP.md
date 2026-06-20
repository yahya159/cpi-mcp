# Client Setup - SAP CPI Monitoring MCP Server

Use this guide when each user runs the SAP CPI Monitoring MCP server locally from their own AI host, such as Claude Desktop or Claude Code.

In this setup, the server runs on the user's own machine with that user's SAP credentials.

> Security: your SAP credentials stay on your machine. They live only in your local AI host configuration or local `.env` file.

## Requirements

1. Node.js 18 or newer.
2. An SAP BTP service key from a **Process Integration Runtime** instance created with plan **`api`**.
3. The following service-key fields:

| Service-key field | Environment variable |
|-------------------|----------------------|
| `url` | `CPI_API_BASE_URL` |
| `tokenurl` | `CPI_TOKEN_URL` |
| `clientid` | `CPI_CLIENT_ID` |
| `clientsecret` | `CPI_CLIENT_SECRET` |

Use the `api` plan, not `integration-flow`.

The `integration-flow` plan points to a `...-rt.cfapps...` runtime host and is rejected by the monitoring OData API. The monitoring tools need the Tenant Management Node API host from the `api`-plan service key.

## Option 1: Install with `npx`

Use this option after the package is published to npm.

The AI host starts the MCP server on demand with `npx`.

### Claude Desktop

Edit the Claude Desktop configuration file:

| OS | Config path |
|----|-------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Add or merge this block:

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

Fully quit and reopen Claude Desktop after editing the file.

### Claude Code

```bash
claude mcp add sap-cpi-monitoring \
  --env CPI_API_BASE_URL=https://<your-tenant>...hana.ondemand.com \
  --env CPI_TOKEN_URL=https://<your-subdomain>.authentication.<region>.hana.ondemand.com/oauth/token \
  --env CPI_CLIENT_ID=<your-clientid> \
  --env CPI_CLIENT_SECRET=<your-clientsecret> \
  -- npx -y sap-cpi-monitoring-mcp-server
```

## Option 2: Install from Source

Use this option if the package is private or not published to npm.

```bash
git clone <repo-url> sap-cpi-monitoring-mcp
cd sap-cpi-monitoring-mcp/mcp-server
npm install
npm run build
```

Then point your AI host at the compiled server file with an absolute path:

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

The `env` block is the only place your credentials need to live. You can also use a local `mcp-server/.env` file, but the AI host `env` block is usually clearer because the credentials are tied directly to that MCP server configuration.

## Verify the Setup

1. Restart your AI host.
2. Check that the MCP tools indicator shows `sap-cpi-monitoring`.
3. Ask one of these prompts:

```text
Check my CPI connectivity.
```

```text
Show me failed CPI messages in the last 24 hours.
```

```text
Give me a CPI health summary.
```

If the tools do not appear, the server most likely failed to start because one of the `CPI_*` values is missing or wrong.

## Available Tools

| Tool | What it does |
|------|--------------|
| `check_cpi_metadata` | Verifies connectivity and returns an OData metadata summary |
| `get_recent_messages` | Lists recent Message Processing Logs, newest first |
| `get_failed_messages` | Lists failed or escalated messages in a time window |
| `get_messages_by_iflow` | Lists messages for a specific iFlow by name |
| `get_message_by_id` | Returns detail for one message by GUID |
| `get_message_error_details` | Returns full "Last Error" text and failing step for a GUID |
| `get_last_error_for_iflow` | Finds the most recent error for a specific iFlow |
| `get_cpi_health_summary` | Returns aggregated health counts and status |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tools do not appear | Server failed to start | Check that all four `CPI_*` values are present and correct |
| `OAuth authentication failed (401)` | Wrong `clientid` or `clientsecret` | Recopy values from the service key |
| `OAuth forbidden (403)` | Missing role or scope | Add the recommended api-plan read roles or verify service-key scopes |
| `404` on `/api/v1/...` | Wrong service key plan or `-rt` host | Recreate the service instance with plan `api` |
| `Cannot reach token endpoint` | Wrong `CPI_TOKEN_URL`, proxy, or network issue | Verify the token URL and network access |
