/**
 * Tool: list_integration_packages
 *
 * List SAP Integration Suite workspace packages.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchIntegrationPackages,
  toIntegrationPackageSummary,
} from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerListIntegrationPackages(
  server: McpServer,
  ctx: SessionContext,
): void {
  server.registerTool(
    "list_integration_packages",
    {
      title: "List Integration Packages",
      description:
        "List SAP Integration Suite workspace packages through the Cloud Integration OData API. " +
        "Requires WorkspacePackagesRead.",
      inputSchema: z.object({
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Number of packages to retrieve (1-100, default 50)"),
      }),
    },
    async ({ top }) => {
      try {
        const packages = await fetchIntegrationPackages(top, ctx.requireConfig());
        if (packages.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No integration packages found.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                packages.map(toIntegrationPackageSummary),
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing integration packages: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

