# SAP CPI Monitoring MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for SAP Integration Suite / Cloud Integration (CPI) monitoring.

The server connects to SAP CPI monitoring APIs and exposes iFlow execution data, Message Processing Logs, failure details, and health summaries as MCP tools.

## Guides

- [Deployment and Agent Guide](./DEPLOYMENT_AND_AGENT_GUIDE.md) - full production guide covering SAP BTP services, HANA persistence, Cloud Foundry deployment, credentials, and agent setup.
- [External Agent Connection Guide](./CONNECT_EXTERNAL_AGENT.md) - shorter handoff guide for connecting another PC, agent, or MCP client.
- [Technical Documentation](./TECHNICAL_DOCUMENTATION.md) - codebase walkthrough, folder responsibilities, runtime flows, and implementation details.
- [Client Setup](./CLIENT_SETUP.md) - local client setup for users running the server on their own machine.
- [Cloud Foundry Deployment Notes](./CF_DEPLOY.md) - focused Cloud Foundry deployment checklist.

## Deployed Architecture

```text
AI agent / IDE / client
  -> HTTPS Streamable HTTP MCP endpoint (/mcp)
  -> SAP BTP Cloud Foundry app: sap-cpi-monitoring-mcp
  -> SAP CPI OData API (/api/v1/MessageProcessingLogs)
  -> SAP HANA Cloud schema service for saved CPI connections
```

## Local Architecture

```text
+------------------+       stdio        +-----------------------+      HTTPS/OAuth2     +------------------------+
| MCP client       | <----------------> | MCP server            | <------------------> | SAP CPI OData API     |
| (test/local)     |    MCP protocol    | sap-cpi-monitoring    | client credentials   | /api/v1/              |
+------------------+                    +-----------------------+                       | MessageProcessingLogs |
                                                                                        | $metadata             |
                                                                                        +------------------------+
```

## Key Principles

- The MCP server handles SAP authentication and API calls.
- MCP clients never receive SAP credentials and never call CPI directly.
- OAuth2 tokens are cached in memory and refreshed automatically.
- Secrets come from environment variables, service keys, or saved connection storage. They are not hardcoded.
- Remote MCP sessions are multi-tenant: each session selects an active CPI connection with `connect_cpi` or `use_connection`.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `connect_cpi` | Validate CPI service-key values, activate them for the session, and optionally save them |
| `use_connection` | Activate a previously saved CPI connection by id |
| `list_connections` | List saved CPI connections without secrets |
| `current_connection` | Show which CPI connection the current MCP session is using |
| `check_cpi_metadata` | Verify CPI API connectivity and retrieve an OData metadata summary |
| `check_cpi_permissions` | Probe the read permissions covered by the recommended api-plan roles |
| `get_recent_messages` | Get recent Message Processing Logs, newest first |
| `get_failed_messages` | Get failed or escalated messages within a time window |
| `get_messages_by_iflow` | Get messages for a specific iFlow by name |
| `get_message_by_id` | Get detailed information for one message by GUID |
| `get_message_error_details` | Get the full "Last Error" text and failing step id for a message |
| `get_message_store_entries` | List persisted Message Store entries for a message |
| `get_message_store_payload` | Get persisted payload content for a Message Store entry |
| `get_last_error_for_iflow` | Get the most recent failed or escalated message for an iFlow |
| `get_cpi_health_summary` | Generate a health summary with message counts and status |
| `list_integration_packages` | List Integration Suite workspace packages |

Typical failure-analysis flow:

```text
get_failed_messages or get_last_error_for_iflow
  -> copy MessageGuid
  -> get_message_error_details
```

## SAP BTP Requirements

Create a **Process Integration Runtime** service instance with plan **`api`**.

Do not use the `integration-flow` plan for monitoring. That plan is for sending runtime messages to deployed iFlows. Its service key commonly points to a `...-rt.cfapps...` runtime host, and its token is rejected by the monitoring OData API.

Recommended instance parameters:

```json
{
  "roles": [
    "MonitoringDataRead",
    "MessagePayloadsRead",
    "HealthCheckMonitoringDataRead",
    "WorkspacePackagesRead"
  ]
}
```

Role usage in this MCP:

| Role | Used for |
|------|----------|
| `MonitoringDataRead` | Message Processing Logs, failed/recent messages, message-based health summary |
| `MessagePayloadsRead` | Persisted Message Store entries and payload content |
| `HealthCheckMonitoringDataRead` | Health-check monitoring probe where a tenant exposes a matching health/JMS/certificate entity |
| `WorkspacePackagesRead` | Integration package inventory |

The service key must provide:

| Service-key field | Used as |
|-------------------|---------|
| `url` | `CPI_API_BASE_URL` / `apiBaseUrl` |
| `tokenurl` | `CPI_TOKEN_URL` / `tokenUrl` |
| `clientid` | `CPI_CLIENT_ID` / `clientId` |
| `clientsecret` | `CPI_CLIENT_SECRET` / `clientSecret` |

`CPI_API_BASE_URL` must be the Tenant Management Node host from the `api`-plan service key. It should not contain `-rt`.

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- SAP Integration Suite enabled in SAP BTP
- Process Integration Runtime service instance with plan `api`
- Service key for that instance

### Install

```bash
cd mcp-server
npm install

cd ../mcp-client
npm install
```

### Configure Environment

Create `mcp-server/.env`:

```env
CPI_API_BASE_URL=https://<tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com
CPI_TOKEN_URL=https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token
CPI_CLIENT_ID=<service-key-clientid>
CPI_CLIENT_SECRET=<service-key-clientsecret>
```

### Run the Local MCP Server

```bash
cd mcp-server
npm run dev
```

The server starts in stdio mode and waits for MCP protocol messages on stdin/stdout.

### Run the Test Client

In a separate terminal:

```bash
cd mcp-client
npm run dev
```

The test client starts the MCP server as a child process, connects over stdio, lists tools, and calls the main monitoring tools.

## Local Web Dashboard

A browser dashboard is included for visual monitoring. It is a thin Express layer over the same `cpiClient` functions used by the MCP tools.

```bash
cd mcp-server
npm install
npm run web
```

Open:

```text
http://localhost:5174
```

The dashboard has:

- A connections page for uploading or entering SAP service-key values.
- A connection test step that validates OAuth and the OData API before saving.
- Server-side saved connections.
- A dashboard page with health cards, recent messages, failed messages, and error details.

Local saved connections are written to `mcp-server/connections.json` when no HANA binding exists. That file contains secrets and is gitignored.

## Dashboard REST Endpoints

Dashboard endpoints accept an optional `?conn=<id>` parameter. Without it, they use the tenant from `.env`.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/connections` | List saved connections without secrets |
| `POST /api/connections/test` | Test credentials and read-role probes without saving |
| `POST /api/connections` | Save a validated connection |
| `DELETE /api/connections/:id` | Delete a saved connection |
| `GET /api/check?conn=` | Connectivity check and tenant base URL |
| `GET /api/recent?top=20&conn=` | Recent messages |
| `GET /api/failed?lastHours=24&top=100&conn=` | Failed or escalated messages |
| `GET /api/health-summary?lastHours=24&conn=` | Aggregated health summary |
| `GET /api/error/:guid?conn=` | Full error text for one message |

## Project Structure

```text
cpi-monitoring-mcp/
  mcp-server/
    src/
      index.ts                 local stdio MCP entry point
      http.ts                  deployed Streamable HTTP MCP entry point
      web.ts                   local browser dashboard
      server.ts                MCP server creation and tool registration
      cpi/
        auth.ts                OAuth2 client-credentials token cache
        odata.ts               low-level SAP OData HTTP client
        cpiClient.ts           high-level CPI monitoring functions
        connectionsStore.ts    file/HANA store facade
        connectionsStore.hana.ts
        sessionContext.ts      active CPI connection per MCP session
        messageLogs.ts         message summary mapping
      tools/                   MCP tool registrations
    public/                    dashboard HTML/CSS/JS
    manifest.yml               Cloud Foundry manifest
  mcp-client/
    src/index.ts               local stdio test client
```

## Troubleshooting

| Error | Likely cause | Fix |
|-------|--------------|-----|
| `Missing environment variable: CPI_*` | `.env` is missing or incomplete | Create `mcp-server/.env` and fill all required values |
| `OAuth authentication failed (401)` | Wrong client ID or secret | Recopy values from the service key |
| `OAuth forbidden (403)` | Missing role or scope | Add the recommended api-plan roles or verify service-key scopes |
| `CPI API returned 404` on `/api/v1/...` | Wrong base URL or `integration-flow` service key | Use a Process Integration Runtime `api` service key with no `-rt` URL |
| Flat `Unauthorized` from `/api/v1/...` | Token has wrong audience | Use an `api`-plan service key |
| `CPI OData bad request (400)` | Filter or field-name mismatch | Call `check_cpi_metadata` and verify tenant metadata |
| `Request timed out` | Network, proxy, or firewall issue | Verify access to SAP BTP endpoints |

## Production Deployment

The production path is implemented by:

```text
mcp-server/src/http.ts
mcp-server/manifest.yml
```

Cloud Foundry runs:

```bash
node dist/http.js
```

The deployed app exposes:

```text
GET    /health
POST   /mcp
GET    /mcp
DELETE /mcp
```

Saved CPI connections are persisted in a bound SAP HANA Cloud `schema` service named `cpi-mcp-db` by default.

Remote clients authenticate with:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

For production commands and agent-specific setup, use [DEPLOYMENT_AND_AGENT_GUIDE.md](./DEPLOYMENT_AND_AGENT_GUIDE.md).
