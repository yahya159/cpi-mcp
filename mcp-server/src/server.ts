/**
 * MCP Server definition.
 *
 * Creates the McpServer instance and registers all SAP CPI monitoring tools.
 * Transport binding is handled separately in index.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCheckMetadata } from "./tools/checkMetadata.js";
import { registerGetRecentMessages } from "./tools/getRecentMessages.js";
import { registerGetFailedMessages } from "./tools/getFailedMessages.js";
import { registerGetMessagesByIflow } from "./tools/getMessagesByIflow.js";
import { registerGetMessageById } from "./tools/getMessageById.js";
import { registerGetMessageErrorDetails } from "./tools/getMessageErrorDetails.js";
import { registerGetLastErrorForIflow } from "./tools/getLastErrorForIflow.js";
import { registerGetHealthSummary } from "./tools/getHealthSummary.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "sap-cpi-monitoring",
    version: "1.0.0",
  });

  // Register all tools
  registerCheckMetadata(server);
  registerGetRecentMessages(server);
  registerGetFailedMessages(server);
  registerGetMessagesByIflow(server);
  registerGetMessageById(server);
  registerGetMessageErrorDetails(server);
  registerGetLastErrorForIflow(server);
  registerGetHealthSummary(server);

  return server;
}
