/**
 * MCP Server definition.
 *
 * Creates the McpServer instance and registers all SAP CPI monitoring tools.
 * Transport binding is handled separately (stdio in index.ts, Streamable HTTP
 * in http.ts).
 *
 * Each server instance is bound to a SessionContext that holds the active CPI
 * tenant for the session. Over HTTP every session gets its own context; over
 * stdio a single context seeded from the environment is used.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SessionContext } from "./cpi/sessionContext.js";
import { registerManageConnections } from "./tools/manageConnections.js";
import { registerCheckMetadata } from "./tools/checkMetadata.js";
import { registerCheckPermissions } from "./tools/checkPermissions.js";
import { registerGetRecentMessages } from "./tools/getRecentMessages.js";
import { registerGetFailedMessages } from "./tools/getFailedMessages.js";
import { registerGetMessagesByIflow } from "./tools/getMessagesByIflow.js";
import { registerGetMessageById } from "./tools/getMessageById.js";
import { registerGetMessageErrorDetails } from "./tools/getMessageErrorDetails.js";
import { registerGetMessageStoreEntries } from "./tools/getMessageStoreEntries.js";
import { registerGetMessageStorePayload } from "./tools/getMessageStorePayload.js";
import { registerGetLastErrorForIflow } from "./tools/getLastErrorForIflow.js";
import { registerGetHealthSummary } from "./tools/getHealthSummary.js";
import { registerListIntegrationPackages } from "./tools/listIntegrationPackages.js";

export function createServer(ctx: SessionContext): McpServer {
  const server = new McpServer({
    name: "sap-cpi-monitoring",
    version: "1.0.0",
  });

  // Connection management (multi-tenant): select which CPI tenant this session targets.
  registerManageConnections(server, ctx);

  // Monitoring tools (operate on the session's active connection).
  registerCheckMetadata(server, ctx);
  registerCheckPermissions(server, ctx);
  registerGetRecentMessages(server, ctx);
  registerGetFailedMessages(server, ctx);
  registerGetMessagesByIflow(server, ctx);
  registerGetMessageById(server, ctx);
  registerGetMessageErrorDetails(server, ctx);
  registerGetMessageStoreEntries(server, ctx);
  registerGetMessageStorePayload(server, ctx);
  registerGetLastErrorForIflow(server, ctx);
  registerGetHealthSummary(server, ctx);
  registerListIntegrationPackages(server, ctx);

  return server;
}
