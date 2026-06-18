/**
 * Tool: check_cpi_metadata
 *
 * Verifies connectivity to the SAP CPI OData API and retrieves metadata.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchMetadata } from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerCheckMetadata(server: McpServer, ctx: SessionContext): void {
  server.registerTool(
    "check_cpi_metadata",
    {
      title: "Check CPI Metadata",
      description:
        "Check whether the SAP CPI OData API is reachable and retrieve metadata summary. " +
        "Use this to confirm connectivity and authentication before other calls.",
    },
    async () => {
      try {
        const summary = await fetchMetadata(ctx.requireConfig());
        return {
          content: [
            {
              type: "text" as const,
              text: `CPI Metadata Check: OK\n\n${summary}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `CPI Metadata Check: FAILED\n\nError: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
