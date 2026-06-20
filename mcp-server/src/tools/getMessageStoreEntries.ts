/**
 * Tool: get_message_store_entries
 *
 * List persisted Message Store entries associated with a CPI message.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchMessageStoreEntries,
  toMessageStoreEntrySummary,
} from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerGetMessageStoreEntries(
  server: McpServer,
  ctx: SessionContext,
): void {
  server.registerTool(
    "get_message_store_entries",
    {
      title: "Get Message Store Entries",
      description:
        "List persisted SAP CPI Message Store entries for a MessageGuid. " +
        "Use this when an iFlow uses Persist steps and the service key has MessagePayloadsRead.",
      inputSchema: z.object({
        messageGuid: z
          .string()
          .regex(
            /^[A-Za-z0-9_-]{8,80}$/,
            "Must be a CPI MessageGuid (letters, digits, '_' or '-')",
          )
          .describe("The MessageGuid of the CPI message"),
        top: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Number of persisted entries to retrieve (1-50, default 20)"),
      }),
    },
    async ({ messageGuid, top }) => {
      try {
        const entries = await fetchMessageStoreEntries(
          messageGuid,
          top,
          ctx.requireConfig(),
        );
        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No persisted Message Store entries found for message "${messageGuid}".`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(entries.map(toMessageStoreEntrySummary), null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving Message Store entries for "${messageGuid}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

