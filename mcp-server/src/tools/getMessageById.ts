/**
 * Tool: get_message_by_id
 *
 * Retrieve details for a single CPI message by its GUID.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchMessageById } from "../cpi/cpiClient.js";
import { toMessageSummary } from "../cpi/messageLogs.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerGetMessageById(server: McpServer, ctx: SessionContext): void {
  server.registerTool(
    "get_message_by_id",
    {
      title: "Get Message by ID",
      description:
        "Retrieve detailed information for a single SAP CPI Message Processing Log entry by its MessageGuid.",
      inputSchema: z.object({
        messageGuid: z
          .string()
          .regex(
            /^[A-Za-z0-9_-]{8,80}$/,
            "Must be a CPI MessageGuid (letters, digits, '_' or '-')",
          )
          .describe("The MessageGuid of the message to retrieve"),
      }),
    },
    async ({ messageGuid }) => {
      try {
        const log = await fetchMessageById(messageGuid, ctx.requireConfig());
        if (!log) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No message found with GUID "${messageGuid}".`,
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
              text: `Error retrieving message "${messageGuid}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
