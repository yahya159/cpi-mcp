# Connect an External Agent to SAP CPI MCP

Use this guide when you have another PC, another AI agent, or another MCP client
and you want it to use the deployed SAP CPI Monitoring MCP server.

For the full deployment guide, see
[`DEPLOYMENT_AND_AGENT_GUIDE.md`](./DEPLOYMENT_AND_AGENT_GUIDE.md).

## Endpoint

The deployed MCP endpoint is:

```text
https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
```

Transport:

```text
Streamable HTTP MCP
```

Authentication:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

The agent connects to the MCP server. The MCP server then connects to SAP CPI
through the selected saved CPI connection.

```text
External agent
  -> HTTPS /mcp with bearer token
  -> SAP BTP Cloud Foundry app
  -> saved CPI connection from HANA
  -> SAP CPI OData monitoring API
```

## Required Credentials

There are two different credential sets. Do not mix them.

| Credential | Who needs it | Where it comes from | Purpose |
|------------|--------------|---------------------|---------|
| `MCP_AUTH_TOKEN` | The external agent/client | Cloud Foundry app environment variable | Allows the agent to connect to `/mcp` |
| CPI service-key values | The MCP server, via `connect_cpi` | SAP BTP Process Integration Runtime service key, plan `api` | Allows the MCP server to read CPI monitoring data |

## 1. Get the MCP Bearer Token

The MCP bearer token is the value configured on the deployed Cloud Foundry app:

```text
MCP_AUTH_TOKEN
```

An administrator can view or reset it from the machine logged into Cloud
Foundry:

```powershell
cf login --sso -a https://api.cf.us10-001.hana.ondemand.com
cf target -o <org> -s <space>
cf env sap-cpi-monitoring-mcp
```

Look for:

```text
MCP_AUTH_TOKEN
```

To rotate it:

```powershell
cf set-env sap-cpi-monitoring-mcp MCP_AUTH_TOKEN "<new-long-random-secret>"
cf restage sap-cpi-monitoring-mcp
```

Give external users the token securely. Do not paste it into source control,
public tickets, screenshots, or shared documentation.

## 2. Get SAP CPI Credentials

Only needed when adding a new CPI tenant/connection. If the tenant is already
saved in HANA, the external agent only needs `list_connections` and
`use_connection`.

The CPI credentials come from SAP BTP:

```text
Service: Process Integration Runtime
Plan: api
Service key fields: url, tokenurl, clientid, clientsecret
```

Use the `api` plan, not `integration-flow`.

### Create or Locate the Service Instance

In SAP BTP Cockpit:

1. Open your subaccount.
2. Go to **Services > Instances and Subscriptions**.
3. Find or create **Process Integration Runtime**.
4. Use plan **api**.
5. Optional/recommended instance parameters:

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

### Create a Service Key

1. Open the Process Integration Runtime `api` service instance.
2. Go to **Service Keys**.
3. Create a new service key.
4. Open/copy the JSON.

You need these fields:

| Service key field | MCP `connect_cpi` field |
|-------------------|--------------------------|
| `url` | `apiBaseUrl` |
| `tokenurl` | `tokenUrl` |
| `clientid` | `clientId` |
| `clientsecret` | `clientSecret` |

Example shape:

```json
{
  "url": "https://<tenant>.it-cpitrialNN.cfapps.<region>.hana.ondemand.com",
  "tokenurl": "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
  "clientid": "sb-...",
  "clientsecret": "..."
}
```

Do not use a `url` containing `-rt` for monitoring. That usually means the key
came from an `integration-flow` service instance, which is not accepted by
`/api/v1/MessageProcessingLogs`.

## 3. Connect From Codex on Another PC

Install and sign in to Codex on the other PC.

Set the MCP token as a user environment variable:

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

Restart Codex Desktop or start a new Codex session, then ask:

```text
Use the sap-cpi MCP. List my saved CPI connections.
```

Then:

```text
Use the saved CPI connection and show the CPI health summary for the last 30 days.
```

If no saved CPI connection exists yet, ask:

```text
Use sap-cpi and connect to my CPI tenant.
```

Provide the `apiBaseUrl`, `tokenUrl`, `clientId`, and `clientSecret` from the
SAP service key.

## 4. Connect From Claude Code

Run:

```bash
claude mcp add --transport http sap-cpi \
  https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Verify:

```bash
claude mcp list
```

Prompt examples:

```text
List my saved CPI connections.
```

```text
Use that connection and show failed messages in the last 30 days.
```

```text
Get the latest error details for Second_iflow.
```

## 5. Connect From Claude Desktop

Claude Desktop custom connectors may not support static bearer headers.

Try this connector configuration:

```text
Name: sap-cpi
URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
OAuth client ID: leave empty
OAuth client secret: leave empty
```

If it fails with `401 Unauthorized`, Claude Desktop is not sending the bearer
token.

Temporary testing fallback:

```text
https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp?token=<MCP_AUTH_TOKEN>
```

This works only because the server currently accepts `?token=` for clients that
cannot attach headers. Prefer proper bearer headers or add OAuth support before
production use. Query-string tokens can appear in logs, browser history, and
screenshots.

## 6. Connect From a Generic MCP Client

Configure:

```text
Transport: Streamable HTTP
URL: https://sap-cpi-monitoring-mcp.cfapps.us10-001.hana.ondemand.com/mcp
Header: Authorization: Bearer <MCP_AUTH_TOKEN>
```

Then call tools in this order:

```text
list_connections
use_connection
get_cpi_health_summary
get_failed_messages
get_message_error_details
```

For a new CPI tenant, call:

```text
connect_cpi
```

with:

```text
name=<friendly name>
apiBaseUrl=<service key url>
tokenUrl=<service key tokenurl>
clientId=<service key clientid>
clientSecret=<service key clientsecret>
save=true
```

## 7. Expected First Test

After connecting an external agent, run this conversation:

```text
Use the sap-cpi MCP. List my saved CPI connections.
```

Expected result:

```text
At least one saved connection appears, or the agent says no saved connections exist.
```

If a connection exists:

```text
Use the first saved CPI connection and give me a health summary for the last 30 days.
```

If no connection exists:

```text
Connect to my CPI tenant and save it.
```

Then provide:

```text
name
apiBaseUrl
tokenUrl
clientId
clientSecret
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` from `/mcp` | Missing/wrong MCP bearer token | Send `Authorization: Bearer <MCP_AUTH_TOKEN>` |
| Agent connects but has no active tenant | MCP sessions start without an active CPI connection | Call `list_connections`, then `use_connection` |
| No saved connections | HANA is empty or user has not saved a tenant | Call `connect_cpi` with service-key values and `save=true` |
| CPI auth returns `401` | Wrong `clientid` or `clientsecret` | Recopy service-key values |
| CPI API returns `404` | Wrong service key plan or wrong API base URL | Use Process Integration Runtime plan `api`, not `integration-flow` |
| CPI API returns `403` | Missing CPI read role/scope | Add the recommended api-plan read roles or verify service-key scopes |
| Claude Desktop connector fails | It cannot send bearer header | Use Claude Code/Codex, use query-token fallback for testing, or add OAuth |

## Security Rules

- Never commit `MCP_AUTH_TOKEN`.
- Never commit SAP service-key JSON.
- Rotate `MCP_AUTH_TOKEN` if shared in chat or screenshots.
- Prefer bearer headers over query-string tokens.
- Do not expose the MCP endpoint without auth.
- For production with unrelated users, add OAuth, per-user connection isolation,
  and encryption for saved CPI secrets.
