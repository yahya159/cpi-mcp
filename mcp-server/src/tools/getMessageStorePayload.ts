/**
 * Tool: get_message_store_payload
 *
 * Retrieve raw payload content for a persisted Message Store entry.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchMessageStorePayload } from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerGetMessageStorePayload(
  server: McpServer,
  ctx: SessionContext,
): void {
  server.registerTool(
    "get_message_store_payload",
    {
      title: "Get Message Store Payload",
      description:
        "Retrieve the payload content for one SAP CPI Message Store entry id. " +
        "Get the entry id from get_message_store_entries. Requires MessagePayloadsRead.",
      inputSchema: z.object({
        entryId: z
          .string()
          .regex(
            /^[A-Za-z0-9_-]{8,80}$/,
            "Must be a Message Store entry id (letters, digits, '_' or '-')",
          )
          .describe("The Message Store entry id"),
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(200_000)
          .default(20_000)
          .describe("Maximum payload characters to return (default 20000)"),
      }),
    },
    async ({ entryId, maxChars }) => {
      try {
        const payload = await fetchMessageStorePayload(entryId, ctx.requireConfig());
        const truncated = payload.length > maxChars;
        const body = truncated
          ? payload.slice(0, maxChars) +
            `\n\n[Payload truncated at ${maxChars} of ${payload.length} characters.]`
          : payload;

        return {
          content: [
            {
              type: "text" as const,
              text: body,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving Message Store payload "${entryId}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

