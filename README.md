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
   - Create an instance with plan **integration-flow**.
   - Under instance parameters, ensure the role `MonitoringDataRead` is included:
     ```json
     {
       "roles": ["MonitoringDataRead"]
     }
     ```

2. **Create a Service Key:**
   - On the service instance, create a service key.
   - The key will contain: `url` (API base), `tokenurl`, `clientid`, `clientsecret`.

3. **Required Roles/Scopes:**
   - `MonitoringDataRead` — allows read access to Message Processing Logs and monitoring data.
   - Without this role, API calls will return 403 Forbidden.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `check_cpi_metadata` | Verify CPI API connectivity and retrieve OData metadata summary |
| `get_recent_messages` | Get recent Message Processing Logs (newest first) |
| `get_failed_messages` | Get failed/escalated messages within a time window |
| `get_messages_by_iflow` | Get messages for a specific iFlow by name |
| `get_message_by_id` | Get detailed info for a single message by its GUID |
| `get_last_error_for_iflow` | Get the most recent error for a specific iFlow |
| `get_cpi_health_summary` | Generate a health summary with counts and status |

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
# Base URL — use the "url" field from the service key
CPI_API_BASE_URL=https://<tenant>.it-cpi018.cfapps.eu10.hana.ondemand.com

# Token URL — use the "tokenurl" field from the service key
CPI_TOKEN_URL=https://<subdomain>.authentication.eu10.hana.ondemand.com/oauth/token

# Client credentials — use "clientid" and "clientsecret" from the service key
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
| `CPI API returned 404` | Wrong base URL or API path | Verify `CPI_API_BASE_URL` matches service key `url` |
| `CPI OData bad request (400)` | Filter syntax error | Field names may differ — check `$metadata` |
| `Request timed out` | Network issue or firewall | Check connectivity to SAP BTP |
| `ECONNREFUSED` | Server not reachable | Verify URL and that the CPI tenant is running |

## Project Structure

```
sap-cpi-monitoring-mcp/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts              # Entry point, env validation, stdio transport
│   │   ├── server.ts             # McpServer creation and tool registration
│   │   ├── cpi/
│   │   │   ├── auth.ts           # OAuth2 client credentials with token caching
│   │   │   ├── odata.ts          # Low-level OData HTTP client
│   │   │   ├── cpiClient.ts      # High-level CPI API methods
│   │   │   └── messageLogs.ts    # Log formatting helpers
│   │   └── tools/
│   │       ├── checkMetadata.ts
│   │       ├── getRecentMessages.ts
│   │       ├── getFailedMessages.ts
│   │       ├── getMessagesByIflow.ts
│   │       ├── getMessageById.ts
│   │       ├── getLastErrorForIflow.ts
│   │       └── getHealthSummary.ts
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
