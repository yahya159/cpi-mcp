/**
 * Simple MCP Client for testing the SAP CPI Monitoring MCP Server.
 *
 * This client connects to the MCP server via stdio and calls the main
 * monitoring tools to verify they work correctly.
 *
 * IMPORTANT:
 * - This client does NOT contain any SAP credentials.
 * - This client does NOT call SAP CPI directly.
 * - All SAP communication goes through the MCP server.
 * - This client is for local testing only.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_SCRIPT =
  process.env.MCP_SERVER_SCRIPT ??
  path.resolve(__dirname, "../../mcp-server/dist/index.js");

// The server loads its .env via dotenv, which resolves relative to the
// process working directory. Launch the server child process with the
// mcp-server folder as its cwd so it finds mcp-server/.env.
const SERVER_CWD = path.resolve(__dirname, "../../mcp-server");

function printSection(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function printResult(result: unknown): void {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content)
  ) {
    for (const item of (result as { content: { type: string; text?: string }[] }).content) {
      if (item.type === "text" && item.text) {
        // Try to pretty-print JSON, fall back to plain text
        try {
          const parsed = JSON.parse(item.text);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(item.text);
        }
      }
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

/** Extract the first messageGuid from a tool result that returned a JSON array. */
function extractFirstGuid(result: unknown): string | null {
  if (result && typeof result === "object" && "content" in result) {
    for (const item of (result as { content: { type: string; text?: string }[] }).content) {
      if (item.type === "text" && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed) && parsed[0]?.messageGuid) {
            return parsed[0].messageGuid as string;
          }
        } catch {
          // not JSON — ignore
        }
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log("SAP CPI Monitoring - MCP Client (test)");
  console.log("Connecting to MCP server via stdio...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_SCRIPT],
    cwd: SERVER_CWD,
  });

  const client = new Client({
    name: "sap-cpi-monitoring-test-client",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    console.log("Connected to MCP server.\n");

    // List available tools
    printSection("Available Tools");
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      console.log(`  - ${tool.name}: ${tool.description ?? ""}`);
    }

    // 1. Check CPI Metadata
    printSection("1. Check CPI Metadata");
    try {
      const metadataResult = await client.callTool({
        name: "check_cpi_metadata",
        arguments: {},
      });
      printResult(metadataResult);
    } catch (err) {
      console.error("  Error:", err instanceof Error ? err.message : err);
    }

    // 2. Get Recent Messages
    printSection("2. Recent Messages (top 5)");
    try {
      const recentResult = await client.callTool({
        name: "get_recent_messages",
        arguments: { top: 5 },
      });
      printResult(recentResult);
    } catch (err) {
      console.error("  Error:", err instanceof Error ? err.message : err);
    }

    // 3. Get Failed Messages (last 24 hours)
    printSection("3. Failed Messages (last 24h, top 5)");
    try {
      const failedResult = await client.callTool({
        name: "get_failed_messages",
        arguments: { top: 5, lastHours: 24 },
      });
      printResult(failedResult);
    } catch (err) {
      console.error("  Error:", err instanceof Error ? err.message : err);
    }

    // 4. CPI Health Summary
    printSection("4. CPI Health Summary (last 24h)");
    try {
      const healthResult = await client.callTool({
        name: "get_cpi_health_summary",
        arguments: { lastHours: 24 },
      });
      printResult(healthResult);
    } catch (err) {
      console.error("  Error:", err instanceof Error ? err.message : err);
    }

    // 5. Error Details for the most recent failure (chained lookup)
    printSection("5. Error Details for latest failure (last 72h)");
    try {
      const failed = await client.callTool({
        name: "get_failed_messages",
        arguments: { top: 1, lastHours: 72 },
      });
      const guid = extractFirstGuid(failed);
      if (!guid) {
        console.log("No failed/escalated messages in the last 72h to inspect.");
      } else {
        console.log(`Found failed message ${guid}; fetching error details...\n`);
        const details = await client.callTool({
          name: "get_message_error_details",
          arguments: { messageGuid: guid },
        });
        printResult(details);
      }
    } catch (err) {
      console.error("  Error:", err instanceof Error ? err.message : err);
    }

    console.log("\n" + "=".repeat(60));
    console.log("  Test run complete.");
    console.log("=".repeat(60) + "\n");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Fatal client error:", err);
  process.exit(1);
});
