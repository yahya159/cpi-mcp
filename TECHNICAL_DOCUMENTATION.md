# SAP CPI Monitoring MCP - Technical Documentation

This document explains how the project is structured, how the runtime flows work, and what each important folder and file is responsible for.

## Project Purpose

This project exposes SAP Integration Suite / Cloud Integration (CPI) monitoring data through MCP tools and a local web dashboard.

It lets an AI agent or browser user inspect:

- CPI connectivity and OData metadata.
- Recent Message Processing Logs.
- Failed and escalated messages.
- Message details by GUID.
- Full CPI "Last Error" text for failed messages.
- Health summaries across a time window.

## High-Level Flow

```text
AI agent / dashboard
        |
        v
MCP tools or dashboard REST API
        |
        v
Shared CPI client layer
        |
        v
SAP OAuth token endpoint + SAP CPI OData API
```

## Repository Layout

```text
cpi-monitoring-mcp/
  mcp-server/
  mcp-client/
  README.md
  CLIENT_SETUP.md
  CF_DEPLOY.md
  CONNECT_EXTERNAL_AGENT.md
  DEPLOYMENT_AND_AGENT_GUIDE.md
  TECHNICAL_DOCUMENTATION.md
  .gitignore
```

## Root Files

| File | Purpose |
|------|---------|
| `README.md` | Main project overview and quick-start information |
| `CLIENT_SETUP.md` | Local MCP client setup for users running their own server |
| `CF_DEPLOY.md` | Focused Cloud Foundry deployment checklist |
| `CONNECT_EXTERNAL_AGENT.md` | Handoff guide for connecting another PC, agent, or MCP client |
| `DEPLOYMENT_AND_AGENT_GUIDE.md` | Full production deployment and agent onboarding guide |
| `TECHNICAL_DOCUMENTATION.md` | Codebase and architecture documentation |
| `.gitignore` | Keeps dependencies, generated files, local secrets, and runtime files out of git |

## `mcp-server`

`mcp-server` is the main application.

```text
mcp-server/
  src/
  public/
  package.json
  package-lock.json
  tsconfig.json
  manifest.yml
```

### `package.json`

Defines the server package, dependencies, and runtime scripts.

Important scripts:

```bash
npm run build       # compile TypeScript to dist/
npm run dev         # build and run the local stdio MCP server
npm run start       # run the compiled stdio MCP server
npm run start:http  # run the compiled HTTP MCP server
npm run dev:http    # build and run the HTTP MCP server
npm run web         # build and run the local browser dashboard
```

Main dependencies:

- `@modelcontextprotocol/sdk` for MCP server and transport support.
- `axios` for SAP OAuth and OData HTTP calls.
- `express` for the HTTP MCP wrapper and dashboard API.
- `dotenv` for local environment loading.
- `zod` for MCP tool input validation.
- `@sap/hana-client` as an optional dependency for HANA-backed saved connections.

### `manifest.yml`

Cloud Foundry deployment manifest.

The deployed app runs:

```bash
node dist/http.js
```

That means Cloud Foundry uses the Streamable HTTP MCP transport from `src/http.ts`, not the local stdio entry point.

## `mcp-server/src`

```text
src/
  index.ts
  http.ts
  web.ts
  server.ts
  cpi/
  tools/
```

### `index.ts`

Local stdio MCP entry point.

Responsibilities:

1. Load environment variables.
2. Validate required `CPI_*` variables.
3. Seed a `SessionContext` from `.env`.
4. Create the MCP server.
5. Connect it through `StdioServerTransport`.

This file is used for local MCP clients and the included test client.

### `http.ts`

Remote Streamable HTTP MCP entry point.

Responsibilities:

1. Start an Express server.
2. Expose `GET /health`.
3. Expose `POST /mcp`, `GET /mcp`, and `DELETE /mcp`.
4. Create one MCP transport per MCP session.
5. Create one `SessionContext` per MCP session.
6. Enforce `MCP_AUTH_TOKEN` when configured.

Authentication:

```text
Preferred:
Authorization: Bearer <MCP_AUTH_TOKEN>

Fallback for limited clients:
?token=<MCP_AUTH_TOKEN>
```

If `MCP_AUTH_TOKEN` is not set, `/mcp` is open. That is acceptable only for local testing or internal-only routes.

### `web.ts`

Local browser dashboard server.

It serves static files from `public/` and exposes REST endpoints over the same CPI client functions used by the MCP tools.

Endpoints:

```text
GET    /api/connections
POST   /api/connections/test
POST   /api/connections
DELETE /api/connections/:id

GET    /api/check
GET    /api/recent
GET    /api/failed
GET    /api/health-summary
GET    /api/error/:guid
```

Requests can include `?conn=<id>` to select a saved CPI connection. Without it, the server falls back to `.env` credentials.

### `server.ts`

MCP composition root.

It creates the `McpServer` and registers all tools:

```text
connect_cpi
use_connection
list_connections
current_connection
check_cpi_metadata
get_recent_messages
get_failed_messages
get_messages_by_iflow
get_message_by_id
get_message_error_details
get_last_error_for_iflow
get_cpi_health_summary
```

`server.ts` does not contain SAP-specific logic. It wires the tool layer to the MCP server.

## `mcp-server/src/cpi`

This folder contains the SAP integration and shared business logic.

```text
cpi/
  auth.ts
  odata.ts
  cpiClient.ts
  messageLogs.ts
  sessionContext.ts
  connectionsStore.ts
  connectionsStore.hana.ts
```

### `auth.ts`

Implements OAuth2 Client Credentials authentication.

It:

- Calls the SAP token endpoint.
- Uses `clientId` and `clientSecret`.
- Caches access tokens in memory.
- Refreshes tokens before expiry.
- Shares in-flight token requests to avoid duplicate token calls.

The cache key includes both client ID and client secret. That prevents a rotated or incorrect secret from reusing a previous valid token.

### `odata.ts`

Low-level SAP CPI OData HTTP helper.

Exports:

```ts
odataGet()
odataGetRaw()
```

`odataGet()` is used for JSON OData responses.

`odataGetRaw()` is used for raw XML or text responses, such as `$metadata` and `ErrorInformation/$value`.

It turns common HTTP and network failures into clearer errors:

```text
401 -> credential or token problem
403 -> missing role or scope
404 -> wrong path, wrong base URL, or missing resource
400 -> OData query/filter issue
timeout -> network or SAP endpoint issue
```

### `cpiClient.ts`

High-level SAP CPI client.

This is the main SAP monitoring logic. It builds OData queries and returns typed results for the MCP tools and dashboard.

Important functions:

```ts
getConfig()
fetchMetadata()
fetchRecentMessages()
fetchFailedMessages()
fetchMessagesByIflow()
fetchMessageById()
fetchErrorDetails()
fetchLastErrorForIflow()
fetchHealthSummary()
formatODataDate()
```

SAP CPI resources used:

```text
/api/v1/$metadata
/api/v1/MessageProcessingLogs
/api/v1/MessageProcessingLogs('<guid>')
/api/v1/MessageProcessingLogs('<guid>')/ErrorInformation
/api/v1/MessageProcessingLogs('<guid>')/ErrorInformation/$value
```

Example filters:

```text
Status eq 'FAILED' or Status eq 'ESCALATED'
LogStart gt datetime'yyyy-MM-ddTHH:mm:ss'
IntegrationFlowName eq '<iflow>'
```

`fetchHealthSummary()` calculates:

```text
totalMessages
completedMessages
failedMessages
escalatedMessages
topFailingIflows
latestFailure
healthStatus: HEALTHY | WARNING | CRITICAL
```

### `messageLogs.ts`

Formats raw SAP CPI `MessageProcessingLog` objects into clean response objects.

Output shape:

```ts
{
  messageGuid,
  iflowName,
  status,
  logStart,
  logEnd,
  sender,
  receiver,
  correlationId,
  applicationMessageId
}
```

If a tenant exposes different OData field names, update the mapping here and the query fields in `cpiClient.ts`.

### `sessionContext.ts`

Tracks the active CPI connection for one MCP session.

Local stdio mode:

```text
.env credentials -> SessionContext
```

Remote HTTP mode:

```text
MCP session -> own SessionContext -> selected CPI connection
```

Monitoring tools call `ctx.requireConfig()`. If no connection is active, the tool returns a clear error telling the agent to call `connect_cpi` or `use_connection`.

### `connectionsStore.ts`

Backend-agnostic saved connection store.

Storage selection:

```text
If HANA binding exists:
  use connectionsStore.hana.ts

Otherwise:
  use local connections.json file
```

Public connection responses never include secrets:

```ts
{
  id,
  name,
  apiBaseUrl
}
```

### `connectionsStore.hana.ts`

SAP HANA Cloud implementation of the saved connection store.

It creates a `CONNECTIONS` table if needed:

```text
ID
NAME
API_BASE_URL
TOKEN_URL
CLIENT_ID
CLIENT_SECRET
OWNER
CREATED_AT
```

Current limitation: `CLIENT_SECRET` is stored as-is. Encrypting secrets at rest is a production hardening item.

## `mcp-server/src/tools`

This folder contains the MCP tool registrations.

Each tool follows this pattern:

1. Register a tool name, title, and description.
2. Validate inputs with `zod`.
3. Read the active CPI config from `SessionContext`.
4. Call a function in `cpiClient.ts`.
5. Return MCP text content.
6. Mark failures with `isError: true`.

| File | Registered tool(s) |
|------|--------------------|
| `manageConnections.ts` | `connect_cpi`, `use_connection`, `list_connections`, `current_connection` |
| `checkMetadata.ts` | `check_cpi_metadata` |
| `getRecentMessages.ts` | `get_recent_messages` |
| `getFailedMessages.ts` | `get_failed_messages` |
| `getMessagesByIflow.ts` | `get_messages_by_iflow` |
| `getMessageById.ts` | `get_message_by_id` |
| `getMessageErrorDetails.ts` | `get_message_error_details` |
| `getLastErrorForIflow.ts` | `get_last_error_for_iflow` |
| `getHealthSummary.ts` | `get_cpi_health_summary` |

## `mcp-server/public`

This folder contains the browser dashboard frontend.

```text
public/
  index.html
  dashboard.html
  connections.js
  app.js
  style.css
```

### `index.html`

Connections page.

Users can:

- Upload SAP service-key JSON.
- Fill connection fields manually.
- Test CPI credentials.
- Save a connection.
- Open a dashboard for a saved connection.
- Delete saved connections.

### `connections.js`

Browser logic for the connections page.

It:

1. Parses uploaded service-key JSON.
2. Extracts `url`, `tokenurl`, `clientid`, and `clientsecret`.
3. Calls `/api/connections/test`.
4. Enables save only after a successful test.
5. Calls `/api/connections` to save.
6. Lists saved connections.
7. Deletes saved connections.

### `dashboard.html`

Monitoring dashboard page.

Displays:

- Time-window controls.
- Health summary cards.
- Failed and escalated messages.
- Recent messages.
- Error detail drawer.

### `app.js`

Browser logic for the dashboard page.

It calls:

```text
/api/check
/api/health-summary
/api/failed
/api/recent
/api/error/:guid
```

It preserves the selected connection with `?conn=<id>`.

### `style.css`

Styles the connections page and dashboard.

## `mcp-client`

The `mcp-client` folder contains a local test client.

```text
mcp-client/
  src/
    index.ts
  package.json
  package-lock.json
  tsconfig.json
```

### `mcp-client/src/index.ts`

The test client:

1. Starts the compiled MCP server as a child process.
2. Connects through stdio.
3. Lists available tools.
4. Calls representative monitoring tools.
5. Fetches error details for the most recent failed message if one exists.

It does not contain SAP credentials. The child server process loads credentials from `mcp-server/.env`.

## Runtime Flows

### Local Stdio MCP

```text
mcp-client or local AI host
        |
        v
mcp-server/src/index.ts
        |
        v
createServer(SessionContext from .env)
        |
        v
registered MCP tools
        |
        v
cpiClient.ts
        |
        v
auth.ts -> SAP OAuth token
odata.ts -> SAP CPI OData API
```

### Remote HTTP MCP

```text
external AI agent
        |
        v
POST /mcp
        |
        v
mcp-server/src/http.ts
        |
        v
new MCP session + SessionContext
        |
        v
connect_cpi or use_connection
        |
        v
monitoring tools
        |
        v
SAP CPI OData API
```

### Web Dashboard

```text
browser
        |
        v
mcp-server/src/web.ts
        |
        v
/api/... endpoints
        |
        v
cpiClient.ts
        |
        v
SAP CPI OData API
```

## Configuration

Local single-tenant mode:

```env
CPI_API_BASE_URL=
CPI_TOKEN_URL=
CPI_CLIENT_ID=
CPI_CLIENT_SECRET=
```

Remote HTTP MCP auth:

```env
MCP_AUTH_TOKEN=
```

Optional HANA selector:

```env
CONNECTIONS_DB_INSTANCE=cpi-mcp-db
```

Local dashboard port:

```env
WEB_PORT=5174
```

Cloud Foundry injects `PORT` automatically.

## Design Summary

`server.ts` wires the MCP server and tools.

`tools/` translates MCP requests into CPI client calls.

`cpi/` owns SAP-specific authentication, OData access, message mapping, saved connection storage, and health calculations.

`web.ts` exposes a local REST/dashboard layer over the same CPI functions.

`public/` contains the browser UI.

`mcp-client/` is only for local testing.
