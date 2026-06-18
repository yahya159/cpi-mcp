/**
 * Tool: get_cpi_health_summary
 *
 * Generate a monitoring health summary for CPI/iFlow executions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchHealthSummary } from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerGetHealthSummary(server: McpServer, ctx: SessionContext): void {
  server.registerTool(
    "get_cpi_health_summary",
    {
      title: "CPI Health Summary",
      description:
        "Generate a monitoring summary of SAP CPI / iFlow executions including " +
        "total, completed, failed, and escalated message counts, top failing iFlows, " +
        "and an overall health status (HEALTHY / WARNING / CRITICAL).",
      inputSchema: z.object({
        lastHours: z
          .number()
          .min(1)
          .max(720)
          .default(24)
          .describe("Look back period in hours (default 24)"),
      }),
    },
    async ({ lastHours }) => {
      try {
        const summary = await fetchHealthSummary(lastHours, ctx.requireConfig());
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error generating health summary: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
