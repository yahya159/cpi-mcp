/**
 * Tools: connect_cpi, use_connection, list_connections, current_connection
 *
 * Multi-tenant connection management. Because the server is shared by many
 * clients over HTTP, each session must select which SAP CPI tenant it targets
 * before calling the monitoring tools.
 *
 *   - connect_cpi      : provide service-key values; validates, (optionally)
 *                        saves them, and makes them active for this session.
 *   - use_connection   : activate a previously-saved connection by id.
 *   - list_connections : list saved connections (never returns secrets).
 *   - current_connection: report which connection is active for this session.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { SessionContext } from "../cpi/sessionContext.js";
import type { CpiConfig } from "../cpi/odata.js";
import { fetchMetadata } from "../cpi/cpiClient.js";
import {
  addConnection,
  getConnection,
  listConnections,
} from "../cpi/connectionsStore.js";

function text(body: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: body }],
    ...(isError ? { isError: true } : {}),
  };
}

export function registerManageConnections(
  server: McpServer,
  ctx: SessionContext,
): void {
  // -------------------------------------------------------------------------
  // connect_cpi — supply credentials, validate, activate (and optionally save)
  // -------------------------------------------------------------------------
  server.registerTool(
    "connect_cpi",
    {
      title: "Connect to a CPI Tenant",
      description:
        "Connect this session to a SAP Integration Suite / CPI tenant using the " +
        "four values from an api-plan service key. Validates the credentials, " +
        "makes the connection active for this session, and (by default) saves it " +
        "so it can be reused later via use_connection. Secrets are never returned.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("A friendly name for this connection (e.g. 'Acme DEV')"),
        apiBaseUrl: z
          .string()
          .min(1)
          .describe(
            "The 'url' field from the api-plan service key (Tenant Management Node, no -rt)",
          ),
        tokenUrl: z
          .string()
          .min(1)
          .describe("The 'tokenurl' field from the service key (OAuth token endpoint)"),
        clientId: z.string().min(1).describe("The 'clientid' from the service key"),
        clientSecret: z
          .string()
          .min(1)
          .describe("The 'clientsecret' from the service key"),
        save: z
          .boolean()
          .default(true)
          .describe("Persist this connection for later reuse (default true)"),
      }),
    },
    async ({ name, apiBaseUrl, tokenUrl, clientId, clientSecret, save }) => {
      const config: CpiConfig = {
        apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/, ""),
        tokenUrl: tokenUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      };

      // Validate by performing the real OAuth handshake + one OData call.
      try {
        await fetchMetadata(config);
      } catch (err) {
        return text(
          `Connection test FAILED. The credentials were not accepted by SAP CPI.\n` +
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }

      let savedId: string | undefined;
      if (save) {
        const saved = await addConnection({ name, ...config });
        savedId = saved.id;
      }

      ctx.setActive(config, name);

      return text(
        `Connected to "${name}" (${config.apiBaseUrl}).\n` +
          (savedId
            ? `Saved as connection id: ${savedId} (reuse later with use_connection).`
            : `Not saved (save=false); active for this session only.`),
      );
    },
  );

  // -------------------------------------------------------------------------
  // use_connection — activate a saved connection by id
  // -------------------------------------------------------------------------
  server.registerTool(
    "use_connection",
    {
      title: "Use a Saved Connection",
      description:
        "Activate a previously-saved CPI connection for this session by its id. " +
        "Use list_connections to discover available ids.",
      inputSchema: z.object({
        connectionId: z
          .string()
          .min(1)
          .describe("The id of a saved connection (from list_connections)"),
      }),
    },
    async ({ connectionId }) => {
      const conn = await getConnection(connectionId);
      if (!conn) {
        return text(
          `No saved connection with id "${connectionId}". Call list_connections to see available ids.`,
          true,
        );
      }
      ctx.setActive(
        {
          apiBaseUrl: conn.apiBaseUrl,
          tokenUrl: conn.tokenUrl,
          clientId: conn.clientId,
          clientSecret: conn.clientSecret,
        },
        conn.name,
      );
      return text(`Now using connection "${conn.name}" (${conn.apiBaseUrl}).`);
    },
  );

  // -------------------------------------------------------------------------
  // list_connections — list saved connections (no secrets)
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_connections",
    {
      title: "List Saved Connections",
      description:
        "List saved CPI connections (id, name, apiBaseUrl only — never secrets).",
    },
    async () => {
      const all = await listConnections();
      if (all.length === 0) {
        return text(
          "No saved connections yet. Use connect_cpi to add one.",
        );
      }
      return text(JSON.stringify(all, null, 2));
    },
  );

  // -------------------------------------------------------------------------
  // current_connection — what is active for this session
  // -------------------------------------------------------------------------
  server.registerTool(
    "current_connection",
    {
      title: "Current Connection",
      description: "Report which CPI connection is active for this session.",
    },
    async () => {
      const name = ctx.getActiveName();
      return text(
        name
          ? `Active connection for this session: "${name}".`
          : "No connection is active for this session yet. Use connect_cpi or use_connection.",
      );
    },
  );
}
