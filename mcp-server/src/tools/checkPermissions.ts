/**
 * Tool: check_cpi_permissions
 *
 * Probe the read-only CPI API capabilities covered by the recommended
 * Process Integration Runtime api-plan roles.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkCpiReadPermissions } from "../cpi/cpiClient.js";
import type { SessionContext } from "../cpi/sessionContext.js";

export function registerCheckPermissions(server: McpServer, ctx: SessionContext): void {
  server.registerTool(
    "check_cpi_permissions",
    {
      title: "Check CPI Read Permissions",
      description:
        "Probe whether the active SAP CPI service key can read monitoring logs, " +
        "persisted message payloads, health-check monitoring data where discoverable, " +
        "and workspace packages. This validates the recommended api-plan roles.",
    },
    async () => {
      try {
        const checks = await checkCpiReadPermissions(ctx.requireConfig());
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(checks, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `CPI permission check failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

