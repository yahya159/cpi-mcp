# SAP CPI Monitoring MCP - Deployment and Agent Guide

This guide explains what this project is, how it is deployed on SAP BTP, which
BTP services are required, which credentials are needed, and how to connect it
to AI agents through MCP.

Related guides:

- [`README.md`](./README.md) - project overview and quick start.
- [`TECHNICAL_DOCUMENTATION.md`](./TECHNICAL_DOCUMENTATION.md) - codebase architecture and folder walkthrough.
- [`CONNECT_EXTERNAL_AGENT.md`](./CONNECT_EXTERNAL_AGENT.md) - shorter handoff guide for users on another PC or another agent.
- [`CF_DEPLOY.md`](./CF_DEPLOY.md) - focused Cloud Foundry deployment checklist.

The current deployed shape is:

```text
AI agent / IDE / client
  -> HTTPS Streamable HTTP MCP endpoint (/mcp)
  -> SAP BTP Cloud Foundry app: sap-cpi-monitoring-mcp
  -> SAP CPI OData API (/api/v1/MessageProcessingLogs)
  -> SAP HANA Cloud schema service for saved CPI connections
```

## Purpose

This project exposes SAP Cloud Integration (CPI) monitoring data as MCP tools.
An AI agent can ask for recent messages, failed messages, iFlow health, and
error details without receiving SAP credentials directly.

The server talks to SAP CPI using OAuth2 Client Credentials from a Process
Integration Runtime service key. It supports two runtime modes:

| Mode | Entry point | Transport | Persistence | Purpose |
|------|-------------|-----------|-------------|---------|
| Local stdio | `mcp-server/src/index.ts` | MCP stdio | Environment variables only | Local development and test client |
| Local dashboard | `mcp-server/src/web.ts` | Express REST/UI | `connections.json` fallback | Browser dashboard on localhost |
| Deployed remote MCP | `mcp-server/src/http.ts` | Streamable HTTP MCP | SAP HANA Cloud | Remote AI agents and multi-tenant use |

The deployed remote MCP mode is the production path.

## Current Deployment

Current target used by this project:

```text
SAP BTP region/API: https://api.cf.us10-001.hana.ondemand.com
Cloud Foundry org: 49386377trial
Cloud Foundry space: dev
Cloud Foundry app: sap-cpi-monitoring-mcp
Route: sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com
Health URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/health
MCP URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
Bound HANA service: cpi-mcp-db
```

Do not commit real bearer tokens, SAP client secrets, or service keys.

## Repository Layout

```text
cpi-monitoring-mcp/
  README.md
  DEPLOYMENT_AND_AGENT_GUIDE.md
  CF_DEPLOY.md
  CLIENT_SETUP.md
  mcp-server/
    manifest.yml
    package.json
    src/
      index.ts                    local stdio MCP entry point
      http.ts                     deployed Streamable HTTP MCP entry point
      web.ts                      local browser dashboard
      server.ts                   MCP server and tool registration
      cpi/
        auth.ts                   OAuth2 token retrieval and cache
        odata.ts                  low-level SAP OData HTTP helper
        cpiClient.ts              high-level CPI monitoring functions
        connectionsStore.ts       file/HANA store facade
        connectionsStore.hana.ts  HANA-backed saved connection store
        sessionContext.ts         active CPI connection per MCP session
        messageLogs.ts            message summary mapping
      tools/
        manageConnections.ts      connect_cpi/list_connections/use_connection
        *.ts                      monitoring MCP tools
    public/                       local dashboard assets
  mcp-client/
    src/index.ts                  local stdio test client
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `connect_cpi` | Validate CPI service-key values, activate them for this MCP session, and optionally save them |
| `use_connection` | Activate a saved CPI connection by id |
| `list_connections` | List saved CPI connections without secrets |
| `current_connection` | Show which CPI connection the current MCP session is using |
| `check_cpi_metadata` | Verify CPI OData connectivity and read `$metadata` |
| `get_recent_messages` | Read recent Message Processing Logs |
| `get_failed_messages` | Read failed/escalated messages in a time window |
| `get_messages_by_iflow` | Read messages for a specific iFlow |
| `get_message_by_id` | Read one Message Processing Log by `MessageGuid` |
| `get_message_error_details` | Read the full CPI Last Error text for one failed message |
| `get_last_error_for_iflow` | Find the latest failed/escalated message for an iFlow |
| `get_cpi_health_summary` | Aggregate message counts and health status |

Typical agent flow:

```text
list_connections
use_connection(connectionId)
get_cpi_health_summary(lastHours)
get_failed_messages(lastHours)
get_message_error_details(messageGuid)
```

For a new tenant:

```text
connect_cpi(name, apiBaseUrl, tokenUrl, clientId, clientSecret, save=true)
```

## Required SAP BTP Services

You need two separate SAP-side concepts:

1. A Cloud Foundry runtime target to deploy this Node.js MCP server.
2. SAP Integration Suite / Cloud Integration API credentials for each CPI tenant
   that the MCP server will monitor.

For deployed multi-tenant persistence, you also need a HANA service binding.

### 1. Cloud Foundry Runtime

The application is pushed as a Node.js Cloud Foundry app.

Required:

```text
Entitlement/service: Cloud Foundry runtime
Buildpack: nodejs_buildpack
Memory: 256M
Disk quota: 512M
Instances: 1 minimum
```

The app uses the `$PORT` supplied by Cloud Foundry and binds to `0.0.0.0`.

Manifest:

```yaml
applications:
  - name: sap-cpi-monitoring-mcp
    memory: 256M
    disk_quota: 512M
    instances: 1
    buildpacks:
      - nodejs_buildpack
    command: node dist/http.js
    health-check-type: http
    health-check-http-endpoint: /health
    services:
      - cpi-mcp-db
```

### 2. SAP HANA Cloud Persistence

The deployed app stores saved CPI connections in SAP HANA Cloud. This is what
proves persistence across app restarts.

Required service binding:

```text
Service offering: hana
Plan: schema
Recommended service instance name: cpi-mcp-db
```

The code detects the HANA binding from `VCAP_SERVICES`. It first looks for a
service named by `CONNECTIONS_DB_INSTANCE`, falling back to `cpi-mcp-db`, then
falls back to any `hana` service with plan `schema`.

Expected bound credentials:

```text
host
port
user
password
schema or currentSchema
certificate (optional)
```

The app creates a table named `CONNECTIONS` automatically if it does not exist:

```sql
CREATE TABLE CONNECTIONS (
  ID NVARCHAR(36) PRIMARY KEY,
  NAME NVARCHAR(256),
  API_BASE_URL NVARCHAR(1024),
  TOKEN_URL NVARCHAR(1024),
  CLIENT_ID NVARCHAR(512),
  CLIENT_SECRET NVARCHAR(2048),
  OWNER NVARCHAR(256),
  CREATED_AT TIMESTAMP
)
```

Current limitation: `CLIENT_SECRET` is stored as-is. Encrypting secrets at rest
and enforcing per-owner isolation are production hardening items.

If no HANA binding exists, the app falls back to `connections.json` in the
process working directory. That fallback is only for local development because
Cloud Foundry filesystems are ephemeral.

### 3. SAP Integration Suite / CPI Monitoring API

Each CPI tenant monitored by the MCP server needs a service key from:

```text
Service: Process Integration Runtime
Plan: api
```

Use the `api` plan, not the `integration-flow` plan.

The `integration-flow` plan is for sending runtime messages to deployed iFlows.
Its service key often points to a `...-rt.cfapps...` runtime host and its token
is rejected by the monitoring OData API. This MCP server needs the Tenant
Management Node API host that exposes `/api/v1/MessageProcessingLogs`.

Recommended service instance parameter:

```json
{
  "roles": ["MonitoringDataRead"]
}
```

Depending on tenant version, the default api-plan scopes may already include
read access, but adding `MonitoringDataRead` makes the intent explicit.

Create a service key and collect these fields:

| Service-key field | MCP field | Example shape |
|-------------------|-----------|---------------|
| `url` | `apiBaseUrl` | `https://<tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com` |
| `tokenurl` | `tokenUrl` | `https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token` |
| `clientid` | `clientId` | `sb-...!b...|it!...` |
| `clientsecret` | `clientSecret` | secret value from the service key |

These values are supplied to `connect_cpi` by an agent or entered in the local
dashboard. The browser/agent receives only saved connection id, name, and API
base URL. It does not receive the client secret back.

## Environment Variables

### Required for deployed remote MCP auth

```text
MCP_AUTH_TOKEN=<long-random-secret>
```

Clients must send:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

`src/http.ts` also accepts `?token=<MCP_AUTH_TOKEN>` for clients that cannot add
custom headers. Prefer the header because query-string tokens can appear in
logs, browser history, and screenshots.

### Optional HANA service selector

```text
CONNECTIONS_DB_INSTANCE=cpi-mcp-db
```

Only set this if your HANA schema service has a different name and you want to
force the app to choose it.

### Optional single-tenant fallback

If these are set on the deployed app, new MCP sessions start pre-connected to
that CPI tenant:

```text
CPI_API_BASE_URL=<api-plan service key url>
CPI_TOKEN_URL=<api-plan service key tokenurl>
CPI_CLIENT_ID=<api-plan service key clientid>
CPI_CLIENT_SECRET=<api-plan service key clientsecret>
```

For true multi-tenant operation, do not rely on these. Let sessions call
`connect_cpi` or `use_connection`.

### Local dashboard

```text
WEB_PORT=5174
```

## Deploy to SAP BTP Cloud Foundry

### 1. Log in and target the space

```powershell
cf login --sso -a https://api.cf.us10-001.hana.ondemand.com
cf target -o 49386377trial -s dev
```

Adjust org, space, and API endpoint for another subaccount/region.

### 2. Provision or identify the HANA schema service

Check available HANA plans:

```powershell
cf marketplace -e hana
```

Create a schema service if you do not already have one:

```powershell
cf create-service hana schema cpi-mcp-db
cf service cpi-mcp-db
```

Wait until creation succeeds.

If your service has a different name, update `mcp-server/manifest.yml`:

```yaml
services:
  - <your-hana-schema-service-name>
```

And optionally set:

```powershell
cf set-env sap-cpi-monitoring-mcp CONNECTIONS_DB_INSTANCE "<your-hana-schema-service-name>"
```

### 3. Build the TypeScript app

```powershell
cd mcp-server
npm install
npm run build
```

This creates `dist/http.js`, which is the deployed entry point.

### 4. Push the app

```powershell
cf push
```

The manifest tells Cloud Foundry to run:

```text
node dist/http.js
```

### 5. Set the MCP bearer token

Generate a long random token, then set it out of band:

```powershell
cf set-env sap-cpi-monitoring-mcp MCP_AUTH_TOKEN "<long-random-secret>"
cf restage sap-cpi-monitoring-mcp
```

Do not put the real token in git.

### 6. Verify the app

Check app status and route:

```powershell
cf app sap-cpi-monitoring-mcp
```

Health check:

```powershell
curl https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/health
```

Expected shape:

```json
{
  "status": "ok",
  "server": "sap-cpi-monitoring",
  "transport": "streamable-http"
}
```

MCP initialize:

```powershell
curl -i -X POST https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -H "Authorization: Bearer <MCP_AUTH_TOKEN>" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Unauthenticated requests should return `401`.

## Prove HANA Persistence

1. Connect an agent.
2. Call `connect_cpi` with `save=true`.
3. Call `list_connections` and confirm the saved connection appears.
4. Restart or restage the app:

```powershell
cf restart sap-cpi-monitoring-mcp
```

5. Connect again.
6. Call `list_connections`.

If the saved connection still appears after restart, persistence is coming from
HANA. In-memory state and Cloud Foundry filesystem state do not survive restart.

## Connect Agents

All remote agents use the same MCP endpoint:

```text
https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
```

Use the bearer token configured in `MCP_AUTH_TOKEN`. Do not paste real tokens
into docs, screenshots, or source control.

### Codex Desktop / Codex CLI

Codex supports Streamable HTTP MCP servers with bearer-token authentication.

Set the token in a local user environment variable:

```powershell
[Environment]::SetEnvironmentVariable("SAP_CPI_MCP_TOKEN", "<MCP_AUTH_TOKEN>", "User")
$env:SAP_CPI_MCP_TOKEN = "<MCP_AUTH_TOKEN>"
```

Add the MCP server:

```powershell
codex mcp add sap-cpi `
  --url https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp `
  --bearer-token-env-var SAP_CPI_MCP_TOKEN
```

Verify:

```powershell
codex mcp get sap-cpi
codex mcp list
```

Restart Codex Desktop or start a new Codex session so the MCP tools are loaded.

Prompt examples:

```text
Use the sap-cpi MCP. List my saved CPI connections.
```

```text
Use the saved CPI connection and give me the CPI health summary for the last 30 days.
```

```text
Show the latest error details for Second_iflow.
```

### Claude Code

Claude Code supports custom headers:

```bash
claude mcp add --transport http sap-cpi \
  https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Then ask:

```text
List my saved CPI connections.
Use the saved connection and show failed CPI messages in the last 30 days.
```

### Claude Desktop Custom Connector

Claude Desktop custom connectors commonly accept a URL and optional OAuth
client fields, but not always a static bearer header.

Use:

```text
Name: sap-cpi
URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
OAuth client id: leave empty
OAuth client secret: leave empty
```

If the connector cannot send the bearer header, use this fallback URL only for
testing:

```text
https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp?token=<MCP_AUTH_TOKEN>
```

Prefer adding OAuth 2.1 support instead of relying on query-string tokens.

### Generic Streamable HTTP MCP Client

Configure:

```text
Transport: Streamable HTTP
URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
Header: Authorization: Bearer <MCP_AUTH_TOKEN>
```

After initialization, call:

```text
tools/list
tools/call list_connections
tools/call use_connection
tools/call get_cpi_health_summary
```

### ChatGPT / OAuth-based MCP Clients

Some clients require OAuth 2.1 for remote MCP. This server currently uses a
shared bearer token, not OAuth. For those clients, add an OAuth layer in front
of `/mcp` or implement OAuth support in the server before onboarding.

## First-Time Tenant Onboarding

To add a CPI tenant from an agent:

1. Create a Process Integration Runtime service instance with plan `api`.
2. Create a service key.
3. Give the agent these values from the service key:

```text
name: friendly display name
apiBaseUrl: service key url
tokenUrl: service key tokenurl
clientId: service key clientid
clientSecret: service key clientsecret
save: true
```

4. The agent calls `connect_cpi`.
5. The server validates credentials by fetching CPI `$metadata`.
6. If valid, the server saves the connection in HANA and makes it active for
   that MCP session.
7. Future sessions can call `list_connections` and `use_connection`.

## Local Development

### Local stdio MCP server

Create `mcp-server/.env`:

```env
CPI_API_BASE_URL=https://<tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com
CPI_TOKEN_URL=https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token
CPI_CLIENT_ID=<clientid>
CPI_CLIENT_SECRET=<clientsecret>
```

Run:

```bash
cd mcp-server
npm install
npm run build
npm run dev
```

In another terminal:

```bash
cd mcp-client
npm install
npm run dev
```

### Local browser dashboard

```bash
cd mcp-server
npm install
npm run web
```

Open:

```text
http://localhost:5174
```

The local dashboard stores saved connections in `mcp-server/connections.json`
when no HANA binding exists. That file contains secrets and is gitignored.

## Security Notes

- Rotate `MCP_AUTH_TOKEN` if it is pasted into chat, screenshots, shell history,
  or issue trackers.
- Do not commit `.env`, `connections.json`, service keys, or real bearer tokens.
- Prefer `Authorization: Bearer` over `?token=`.
- The HANA store currently persists CPI client secrets in plain text.
- Saved connections are currently global to the MCP deployment. Per-owner
  isolation is a required hardening step before serving unrelated users.
- The remote HTTP server warns if `MCP_AUTH_TOKEN` is unset. Do not expose it
  publicly without authentication.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/mcp` returns `401` | Missing or wrong bearer token | Send `Authorization: Bearer <MCP_AUTH_TOKEN>` |
| Agent connects but sees no active tenant | New MCP sessions start empty | Call `list_connections` then `use_connection`, or call `connect_cpi` |
| `list_connections` is empty after restart | HANA binding missing or wrong | Check `cf env`, `VCAP_SERVICES`, service name, and `CONNECTIONS_DB_INSTANCE` |
| Connection saves locally but not after CF restart | App used file fallback | Bind a HANA `schema` service and restage |
| `OAuth authentication failed (401)` | Wrong CPI `clientid`/`clientsecret` | Recreate or recopy the Process Integration Runtime service key |
| CPI API returns `404` | Wrong service plan or URL | Use Process Integration Runtime plan `api`; do not use `...-rt...` URLs |
| CPI API returns `403` | Missing roles/scopes | Add `MonitoringDataRead` or verify service-key scopes |
| `@sap/hana-client` load/connect failure | HANA service binding or native driver issue | Check service plan, credentials in `VCAP_SERVICES`, and staging logs |
| Claude Desktop cannot add connector | It cannot send static bearer headers | Use query-token test URL, Claude Code, Codex, or add OAuth |

Useful commands:

```powershell
cf logs sap-cpi-monitoring-mcp --recent
cf env sap-cpi-monitoring-mcp
cf app sap-cpi-monitoring-mcp
cf services
cf service cpi-mcp-db
```

## Hardening Roadmap

Before using this for multiple unrelated users or production secrets:

1. Encrypt CPI client secrets at rest in HANA.
2. Add per-owner isolation to `CONNECTIONS.OWNER`.
3. Replace shared bearer token auth with OAuth 2.1 or XSUAA-backed auth.
4. Remove or disable query-string token support.
5. Add rate limiting and audit logging.
6. Add automated tests for HANA store selection and MCP session isolation.
7. Add deployment pipeline checks that fail if `MCP_AUTH_TOKEN` is missing in CF.
