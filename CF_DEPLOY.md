# Deploy the MCP Server to SAP BTP Cloud Foundry

This guide deploys the Streamable HTTP MCP server from `mcp-server/src/http.ts`.

The stdio entry point in `mcp-server/src/index.ts` is kept for local development and single-tenant testing. It is not used by the Cloud Foundry deployment.

Current target used by this project:

```text
Cloud Foundry API: https://api.cf.us10-001.hana.ondemand.com
Org: 49386377trial
Space: dev
App: sap-cpi-monitoring-mcp
```

Adjust these values if deploying to another SAP BTP subaccount or region.

## Deployed Architecture

```text
AI / IDE / agent
  -> HTTPS /mcp with bearer token
  -> Cloud Foundry app: sap-cpi-monitoring-mcp
  -> OAuth2/HTTPS to each selected SAP CPI tenant
  -> SAP HANA Cloud schema service for saved connections
```

## Runtime Behavior

- **Transport:** Streamable HTTP MCP.
- **Auth:** `/mcp` requires `Authorization: Bearer <MCP_AUTH_TOKEN>`.
- **Multi-tenancy:** each MCP session selects a CPI tenant with `connect_cpi` or `use_connection`.
- **Persistence:** saved CPI connections are stored in SAP HANA Cloud, not on the Cloud Foundry filesystem.

## Step 1: Log in to Cloud Foundry

```powershell
cf login --sso -a https://api.cf.us10-001.hana.ondemand.com
cf target -o 49386377trial -s dev
cf target
```

## Step 2: Provision SAP HANA Cloud Storage

The deployed app expects a HANA `schema` service named `cpi-mcp-db` by default.

Check available HANA plans:

```powershell
cf marketplace -e hana
```

Create the schema service if needed:

```powershell
cf create-service hana schema cpi-mcp-db
cf service cpi-mcp-db
```

Wait until the service creation succeeds.

If you already have a HANA service with a different name, update `mcp-server/manifest.yml`:

```yaml
services:
  - <your-hana-schema-service-name>
```

You can also force the app to use that service name:

```powershell
cf set-env sap-cpi-monitoring-mcp CONNECTIONS_DB_INSTANCE "<your-hana-schema-service-name>"
```

## Step 3: Build the Server

```powershell
cd mcp-server
npm install
npm run build
```

This creates `dist/http.js`, which is the Cloud Foundry entry point.

## Step 4: Push the App

```powershell
cf push
```

The manifest runs:

```bash
node dist/http.js
```

Cloud Foundry health-checks:

```text
GET /health
```

## Step 5: Set the MCP Auth Token

Set a long random token out of band. Do not commit the real value.

```powershell
cf set-env sap-cpi-monitoring-mcp MCP_AUTH_TOKEN "<a-long-random-secret>"
cf restage sap-cpi-monitoring-mcp
```

All remote MCP clients must send:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Step 6: Test the Deployment

Get the route:

```powershell
cf app sap-cpi-monitoring-mcp
```

Health check:

```powershell
curl https://<route>/health
```

Expected response:

```json
{
  "status": "ok",
  "server": "sap-cpi-monitoring",
  "transport": "streamable-http"
}
```

MCP initialize test:

```powershell
curl -i -X POST https://<route>/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "Authorization: Bearer <MCP_AUTH_TOKEN>" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

An unauthenticated request should return `401`.

## Step 7: Connect an AI Agent

### Claude Code

```bash
claude mcp add --transport http sap-cpi https://<route>/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

### Codex

```powershell
[Environment]::SetEnvironmentVariable("SAP_CPI_MCP_TOKEN", "<MCP_AUTH_TOKEN>", "User")
$env:SAP_CPI_MCP_TOKEN = "<MCP_AUTH_TOKEN>"

codex mcp add sap-cpi `
  --url https://<route>/mcp `
  --bearer-token-env-var SAP_CPI_MCP_TOKEN
```

### Generic MCP Client

```text
Transport: Streamable HTTP
URL: https://<route>/mcp
Header: Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Usage Flow

For an existing saved connection:

```text
list_connections
use_connection
get_cpi_health_summary
get_failed_messages
get_message_error_details
```

For a new CPI tenant:

```text
connect_cpi
```

Provide:

```text
name
apiBaseUrl
tokenUrl
clientId
clientSecret
save=true
```

## Tool Summary

| Tool | Purpose |
|------|---------|
| `connect_cpi` | Validate service-key values, activate the connection, and optionally save it |
| `use_connection` | Activate a saved connection by id |
| `list_connections` | List saved connections without secrets |
| `current_connection` | Show the active connection for the current session |
| `check_cpi_metadata` | Test SAP CPI OData connectivity |
| `get_recent_messages` | Read recent Message Processing Logs |
| `get_failed_messages` | Read failed or escalated messages |
| `get_messages_by_iflow` | Read messages for one iFlow |
| `get_message_by_id` | Read one message by GUID |
| `get_message_error_details` | Read full error details for one failed message |
| `get_last_error_for_iflow` | Find the latest failed message for one iFlow |
| `get_cpi_health_summary` | Return aggregate health status and counts |

## Hardening Notes

Before using this with unrelated users or production secrets:

1. Encrypt CPI client secrets at rest in HANA.
2. Add per-owner isolation so users cannot activate another user's saved connection.
3. Replace the shared bearer token with OAuth 2.1 or XSUAA-backed authentication.
4. Disable query-string token fallback.
5. Add audit logging and rate limiting.
6. Add deployment checks that fail if `MCP_AUTH_TOKEN` is missing.
