/**
 * Tool: get_failed_messages
 *
 * Retrieve failed or escalated CPI messages within a time window.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchFailedMessages } from "../cpi/cpiClient.js";
import { toMessageSummaries } from "../cpi/messageLogs.js";

export function registerGetFailedMessages(server: McpServer): void {
  server.registerTool(
    "get_failed_messages",
    {
      title: "Get Failed CPI Messages",
      description:
        "Retrieve failed or escalated SAP CPI messages within a given time window.",
      inputSchema: z.object({
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of messages to retrieve (1-100, default 20)"),
        lastHours: z
          .number()
          .min(1)
          .max(720)
          .default(24)
          .describe("Look back period in hours (default 24)"),
      }),
    },
    async ({ top, lastHours }) => {
      try {
        const logs = await fetchFailedMessages(top, lastHours);
        if (logs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No failed or escalated messages found in the last ${lastHours} hours.`,
              },
            ],
          };
        }
        const summaries = toMessageSummaries(logs);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summaries, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving failed messages: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
