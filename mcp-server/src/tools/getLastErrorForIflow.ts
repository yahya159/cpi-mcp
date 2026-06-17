/**
 * Tool: get_last_error_for_iflow
 *
 * Retrieve the latest failed message for a specific iFlow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchLastErrorForIflow } from "../cpi/cpiClient.js";
import { toMessageSummary } from "../cpi/messageLogs.js";

export function registerGetLastErrorForIflow(server: McpServer): void {
  server.registerTool(
    "get_last_error_for_iflow",
    {
      title: "Get Last Error for iFlow",
      description:
        "Retrieve the most recent failed or escalated message for a specific integration flow (iFlow).",
      inputSchema: z.object({
        iflowName: z
          .string()
          .min(1)
          .describe("Name of the integration flow (iFlow)"),
      }),
    },
    async ({ iflowName }) => {
      try {
        const log = await fetchLastErrorForIflow(iflowName);
        if (!log) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No failed messages found for iFlow "${iflowName}".`,
              },
            ],
          };
        }
        const summary = toMessageSummary(log);
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
              text: `Error retrieving last error for iFlow "${iflowName}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
