#!/usr/bin/env node
/**
 * Entry point for the SAP CPI Monitoring MCP Server.
 *
 * Loads environment variables, validates configuration, and starts the MCP
 * server using stdio transport (suitable for local development).
 *
 * For production / remote deployment, this file can be adapted to use
 * Streamable HTTP transport instead of stdio.
 */

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getConfig } from "./cpi/cpiClient.js";
import { SessionContext } from "./cpi/sessionContext.js";

async function main(): Promise<void> {
  // Validate required env vars early so failures are clear
  const required = [
    "CPI_API_BASE_URL",
    "CPI_TOKEN_URL",
    "CPI_CLIENT_ID",
    "CPI_CLIENT_SECRET",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}.\n` +
        "Copy .env.example to .env and fill in the values from your SAP BTP service key.",
    );
    process.exit(1);
  }

  // Single-tenant (stdio): seed the session context from the CPI_* env vars so
  // the monitoring tools work immediately without an explicit connect step.
  const ctx = new SessionContext(getConfig(), "env");
  const server = createServer(ctx);

  // Use stdio transport for local development
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio MCP protocol on stdout
  console.error("SAP CPI Monitoring MCP Server started (stdio transport).");
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
