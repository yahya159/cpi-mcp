/**
 * Tool: get_recent_messages
 *
 * Retrieve recent CPI Message Processing Logs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchRecentMessages } from "../cpi/cpiClient.js";
import { toMessageSummaries } from "../cpi/messageLogs.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerGetRecentMessages(server: McpServer, ctx: SessionContext): void {
  server.registerTool(
    "get_recent_messages",
    {
      title: "Get Recent CPI Messages",
      description:
        "Retrieve recent SAP CPI Message Processing Logs, ordered newest first.",
      inputSchema: z.object({
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of messages to retrieve (1-100, default 20)"),
      }),
    },
    async ({ top }) => {
      try {
        const logs = await fetchRecentMessages(top, ctx.requireConfig());
        if (logs.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No recent messages found." }],
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
              text: `Error retrieving recent messages: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
