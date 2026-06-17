/**
 * Tool: get_messages_by_iflow
 *
 * Retrieve recent messages for a specific iFlow by name.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchMessagesByIflow } from "../cpi/cpiClient.js";
import { toMessageSummaries } from "../cpi/messageLogs.js";

export function registerGetMessagesByIflow(server: McpServer): void {
  server.registerTool(
    "get_messages_by_iflow",
    {
      title: "Get Messages by iFlow",
      description:
        "Retrieve recent SAP CPI Message Processing Logs for a specific integration flow (iFlow) by name.",
      inputSchema: z.object({
        iflowName: z
          .string()
          .min(1)
          .describe("Name of the integration flow (iFlow)"),
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
          .optional()
          .describe("Optional: restrict to the last N hours"),
      }),
    },
    async ({ iflowName, top, lastHours }) => {
      try {
        const logs = await fetchMessagesByIflow(iflowName, top, lastHours);
        if (logs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No messages found for iFlow "${iflowName}".`,
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
              text: `Error retrieving messages for iFlow "${iflowName}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
