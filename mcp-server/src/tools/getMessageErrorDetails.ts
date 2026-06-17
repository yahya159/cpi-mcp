/**
 * Tool: get_message_error_details
 *
 * Retrieve the detailed error text (the "Last Error" body shown in the CPI
 * monitoring UI) for a failed message by its MessageGuid.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchErrorDetails } from "../cpi/cpiClient.js";

export function registerGetMessageErrorDetails(server: McpServer): void {
  server.registerTool(
    "get_message_error_details",
    {
      title: "Get Message Error Details",
      description:
        "Retrieve the detailed error text (the 'Last Error' / stack trace) for a failed " +
        "SAP CPI message by its MessageGuid. Use a MessageGuid obtained from " +
        "get_failed_messages, get_last_error_for_iflow, or get_recent_messages.",
      inputSchema: z.object({
        messageGuid: z
          .string()
          .regex(
            /^[A-Za-z0-9_-]{8,80}$/,
            "Must be a CPI MessageGuid (letters, digits, '_' or '-')",
          )
          .describe("The MessageGuid of the failed message"),
      }),
    },
    async ({ messageGuid }) => {
      try {
        const details = await fetchErrorDetails(messageGuid);
        if (!details) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No error information found for message "${messageGuid}". It may have completed successfully or has no error log.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving error details for "${messageGuid}": ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
