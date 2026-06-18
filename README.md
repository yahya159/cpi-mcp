# SAP CPI Monitoring MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects to **SAP Integration Suite / Cloud Integration (CPI)** monitoring APIs and exposes iFlow execution data, Message Processing Logs, failure analysis, and health summaries as MCP tools.

## Architecture

```
+------------------+       stdio        +-----------------------+      HTTPS/OAuth2     +------------------------+
|   MCP Client     | <----------------> |   MCP Server          | <------------------> |  SAP CPI OData API     |
|  (test only)     |    MCP Protocol    |  (sap-cpi-monitoring) |   Client Credentials  |  /api/v1/              |
+------------------+                    +-----------------------+                       |  MessageProcessingLogs |
                                                                                        |  $metadata             |
                                                                                        +------------------------+
```

**Key principles:**
- The MCP server handles all SAP authentication and API calls.
- The MCP client never sees SAP credentials or calls CPI directly.
- OAuth2 tokens are cached in memory and refreshed automatically.
- All secrets come from environment variables, never hardcoded.

## Why an MCP Client?

The MCP client included in this project is **only for local testing**. In production, the MCP server would be consumed by an AI assistant (e.g. Claude Desktop, VS Code + Claude, or another MCP-compatible host). The test client lets you verify connectivity and tool behavior without needing an AI host.

## How the MCP Server Connects to SAP Integration Suite

The server uses the **SAP CPI OData API** exposed by the **Process Integration Runtime** service instance on SAP BTP. Authentication uses **OAuth2 Client Credentials** flow with credentials from the service key.

### SAP BTP Setup

1. **Create a Service Instance:**
   - Go to SAP BTP Cockpit > your subaccount > Service Marketplace.
   - Find **Process Integration Runtime**.
   - Create an instance with plan **`api`** — this is the plan that grants access to the
     monitoring **OData API** (`/api/v1/...`).
   - Under instance parameters you may add the monitoring role:
     ```json
     {
       "roles": ["MonitoringDataRead"]
     }
     ```

   > ⚠️ **Plan matters — use `api`, not `integration-flow`.**
   > The `integration-flow` plan is for *sending messages to deployed iFlows at runtime*. Its
   > service key `url` points at the **runtime** host (`...-rt.cfapps...`) and its token is
   > **rejected (401)** by the OData API. Tokens from the `api`-plan instance are what the
   > `/api/v1/MessageProcessingLogs` endpoint accepts. If you previously created an
   > `integration-flow` instance and got 404s on `/api/v1/...` or a flat `Unauthorized`, this
   > is why.

2. **Create a Service Key:**
   - On the service instance, create a service key.
   - The key will contain: `url` (API base), `tokenurl`, `clientid`, `clientsecret`.

3. **Required Roles/Scopes:**
   - With the `api` plan, the default scopes (`IntegrationOperationServer.read`,
     `NodeManager.read`, etc.) already grant read access to Message Processing Logs.
     `MonitoringDataRead` is a useful explicit role to add but may not be strictly required
     depending on tenant version.

   > 💡 **`CPI_API_BASE_URL` is the Tenant Management Node host** — the `url` field from the
   > `api`-plan service key, e.g.
   > `https://<tenant>.it-cpitrial05.cfapps.us10-001.hana.ondemand.com` (note: **no `-rt`**).
   > Do not use the Integration Suite browser/tooling URL.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `check_cpi_metadata` | Verify CPI API connectivity and retrieve OData metadata summary |
| `get_recent_messages` | Get recent Message Processing Logs (newest first) |
| `get_failed_messages` | Get failed/escalated messages within a time window |
| `get_messages_by_iflow` | Get messages for a specific iFlow by name |
| `get_message_by_id` | Get detailed info for a single message by its GUID |
| `get_message_error_details` | Get the full "Last Error" text (and failing step id) for a message by its GUID |
| `get_last_error_for_iflow` | Get the most recent error for a specific iFlow |
| `get_cpi_health_summary` | Generate a health summary with counts and status |

> **Typical failure-analysis flow:** call `get_last_error_for_iflow` (or `get_failed_messages`)
> to find a failing message and its `MessageGuid`, then pass that GUID to
> `get_message_error_details` to read the actual error / stack trace.

## Setup

### Prerequisites

- Node.js 18+ and npm
- An SAP BTP subaccount with SAP Integration Suite enabled
- A Process Integration Runtime service instance with a service key

### 1. Clone and Install

```bash
# Install MCP server dependencies
cd mcp-server
npm install

# Install MCP client dependencies (for testing)
cd ../mcp-client
npm install
```

### 2. Configure Environment Variables

```bash
cd mcp-server
cp .env.example .env
```

Edit `.env` with values from your SAP BTP service key:

```env
# Base URL — the "url" field from the api-plan service key (Tenant Management Node, no -rt)
CPI_API_BASE_URL=https://<tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com

# Token URL — the "tokenurl" field from the service key
CPI_TOKEN_URL=https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token

# Client credentials — "clientid" and "clientsecret" from the service key
CPI_CLIENT_ID=sb-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx!bXXXX|it!bXXXX
CPI_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 3. Build and Run the MCP Server

```bash
cd mcp-server
npm run dev
```

The server starts in stdio mode and waits for MCP protocol messages on stdin/stdout.

### 4. Run the Test Client

In a **separate terminal**:

```bash
cd mcp-client
npm run dev
```

The client spawns the MCP server as a child process, connects via stdio, and calls the test tools.

> **Note:** the test client launches the server child process with `mcp-server` as its working
> directory, so the server's `dotenv` finds `mcp-server/.env`. (Build the server at least once —
> `npm run build` in `mcp-server` — before running the client, since it runs `dist/index.js`.)

## Web Dashboard (local)

A simple browser dashboard is included for visual, click-driven monitoring. It is a thin
HTTP layer (`src/web.ts`, Express) over the **same** `cpiClient` functions the MCP tools use —
so the browser never sees SAP credentials (they stay in `mcp-server/.env`).

```bash
cd mcp-server
npm install
npm run web
```

Then open **http://localhost:5174** (override with `WEB_PORT`).

### Connections page (multi-tenant)

The landing page (`/`) manages **Integration Suite connections**:

1. **Add a connection** by either **uploading the service-key JSON** (the file with
   `clientid` / `clientsecret` / `url` / `tokenurl` — it is parsed in the browser and fills the
   form) **or filling the fields manually**.
2. Click **Test connection** — the server performs the OAuth handshake and one OData call. A
   wrong secret or URL fails here.
3. If the test passes, **Save** the connection. It is stored **server-side** in
   `connections.json`; the browser only keeps the connection **id**.
4. Click **Open** on a saved connection → redirects to `dashboard.html?conn=<id>`.

> 🔒 `connections.json` contains client secrets in plain text, so it is **gitignored**. The API
> only ever returns `id`, `name`, and `apiBaseUrl` to the browser — never the secret.

### Dashboard page

`dashboard.html?conn=<id>` shows monitoring data for the selected connection:
- Time-window buttons: **Last 24 hours / 7 days / 30 days**.
- Health summary cards (total / completed / failed / escalated + HEALTHY/WARNING/CRITICAL).
- Tables of failed and recent messages with human-readable timestamps.
- **View error** on any failed message opens a panel with the full "Last Error" text and failing step id.

### REST endpoints

Dashboard endpoints take an optional `?conn=<id>` (saved connection). Without it they use the
tenant from `.env`.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/connections` | List saved connections (no secrets) |
| `POST /api/connections/test` | Test credentials without saving |
| `POST /api/connections` | Save a connection (after validating) |
| `DELETE /api/connections/:id` | Remove a connection |
| `GET /api/check?conn=` | Connectivity + tenant base URL |
| `GET /api/recent?top=20&conn=` | Recent messages |
| `GET /api/failed?lastHours=24&top=100&conn=` | Failed/escalated in a window |
| `GET /api/health-summary?lastHours=24&conn=` | Aggregated health summary |
| `GET /api/error/:guid?conn=` | Full error text for one message |

## Testing $metadata

Before relying on specific OData field names, verify what your tenant exposes:

1. Start the server and client as described above.
2. The client calls `check_cpi_metadata` first, which hits `/api/v1/$metadata`.
3. Review the output — it shows entity types and confirms connectivity.
4. For full metadata inspection, you can also call the endpoint directly in a browser or via curl (with a valid Bearer token).

## Adapting OData Field Names

SAP CPI OData field names can vary between tenant versions. The code uses these standard property names:

- `MessageGuid` — unique message identifier
- `IntegrationFlowName` — name of the iFlow/integration artifact
- `Status` — COMPLETED, FAILED, ESCALATED, etc.
- `LogStart` / `LogEnd` — timestamps
- `Sender` / `Receiver` — communication parties
- `CorrelationId` — correlation identifier
- `ApplicationMessageId` — business message ID

If your tenant uses different names:

1. Call `check_cpi_metadata` to inspect the actual entity properties.
2. Update the `MessageProcessingLog` interface in `mcp-server/src/cpi/cpiClient.ts`.
3. Update the field mapping in `mcp-server/src/cpi/messageLogs.ts`.
4. Update OData `$filter` and `$orderby` parameters in the query methods.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing environment variable: CPI_*` | `.env` file not configured | Copy `.env.example` to `.env` and fill in values |
| `OAuth authentication failed (401)` | Wrong client ID or secret | Verify credentials from service key |
| `OAuth forbidden (403)` | Missing roles/scopes | Ensure service instance has `MonitoringDataRead` role |
| `Cannot reach token endpoint` | Wrong token URL or network issue | Check `CPI_TOKEN_URL` and network/proxy settings |
| `CPI API returned 404` on `/api/v1/...` | Using the **runtime** host (`...-rt...`) from an `integration-flow`-plan key | Recreate the instance with the **`api`** plan; use its `url` (no `-rt`) |
| Flat `Unauthorized` / 401 from `/api/v1/...` with a valid token | Token is from an `integration-flow`-plan instance (wrong audience) | Use an **`api`**-plan service key |
| `CPI OData bad request (400)` | Filter syntax error | Field names may differ — check `$metadata` |
| `Invalid MessageGuid format` | Tenant uses token-style ids, not UUIDs | Already handled — ids like `AGoyrc...` are accepted |
| `Request timed out` | Network issue or firewall | Check connectivity to SAP BTP |
| `ECONNREFUSED` | Server not reachable | Verify URL and that the CPI tenant is running |

## Project Structure

```
sap-cpi-monitoring-mcp/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts              # Entry point, env validation, stdio transport
│   │   ├── web.ts                # Local web dashboard (Express HTTP layer)
│   │   ├── server.ts             # McpServer creation and tool registration
│   │   ├── cpi/
│   │   │   ├── auth.ts           # OAuth2 client credentials, per-client token cache
│   │   │   ├── odata.ts          # Low-level OData HTTP client
│   │   │   ├── cpiClient.ts      # High-level CPI API methods (config-injectable)
│   │   │   ├── connectionsStore.ts # Saved multi-tenant connections (server-side)
│   │   │   └── messageLogs.ts    # Log formatting helpers
│   │   └── tools/
│   │       ├── checkMetadata.ts
│   │       ├── getRecentMessages.ts
│   │       ├── getFailedMessages.ts
│   │       ├── getMessagesByIflow.ts
│   │       ├── getMessageById.ts
│   │       ├── getMessageErrorDetails.ts
│   │       ├── getLastErrorForIflow.ts
│   │       └── getHealthSummary.ts
│   ├── public/                   # Web dashboard frontend (HTML/CSS/JS)
│   │   ├── index.html            # Connections manager (landing page)
│   │   ├── connections.js        # Connections page logic
│   │   ├── dashboard.html        # Monitoring dashboard (per connection)
│   │   ├── app.js                # Dashboard logic
│   │   └── style.css
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── mcp-client/
│   ├── src/
│   │   └── index.ts              # Test client
│   ├── package.json
│   └── tsconfig.json
├── .gitignore
└── README.md
```

## Future: Deploying to SAP BTP Cloud Foundry

For production use, the MCP server should be deployed as a Cloud Foundry application with **Streamable HTTP transport** instead of stdio:

1. **Change the transport:** Replace `StdioServerTransport` with an HTTP-based transport (e.g. Express + Streamable HTTP transport from the MCP SDK).
2. **Add a `manifest.yml`** for CF deployment with environment variables bound via service bindings or user-provided services.
3. **Bind the Process Integration Runtime service** directly in CF instead of using `.env` — credentials will be available via `VCAP_SERVICES`.
4. **Add authentication** to the HTTP endpoint itself (e.g. via XSUAA / SAP Authorization and Trust Management).

Stdio is simpler for local development and testing. Streamable HTTP is the correct choice for remote/server deployments where the MCP client and server run on different machines.
