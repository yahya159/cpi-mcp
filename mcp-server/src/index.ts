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

  const server = createServer();

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
