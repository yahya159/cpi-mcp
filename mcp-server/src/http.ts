#!/usr/bin/env node
/**
 * Streamable HTTP entry point for the SAP CPI Monitoring MCP Server.
 *
 * This is the deployable, remote-capable transport. Any MCP-compatible AI /
 * IDE / agent can connect to it over HTTP. It is multi-tenant: each MCP session
 * gets its own SessionContext and selects its CPI tenant at runtime via the
 * connect_cpi / use_connection tools.
 *
 * Designed for Cloud Foundry: binds 0.0.0.0:$PORT and exposes GET /health.
 *
 * Auth: if MCP_AUTH_TOKEN is set, every /mcp request must send
 *   Authorization: Bearer <MCP_AUTH_TOKEN>
 * If it is unset the endpoint is OPEN (a warning is logged) — only acceptable
 * for local testing or an internal-only route.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "./server.js";
import { SessionContext } from "./cpi/sessionContext.js";
import { getConfig } from "./cpi/cpiClient.js";
import type { CpiConfig } from "./cpi/odata.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN?.trim();

/**
 * Optional single-tenant fallback: if the CPI_* env vars are present, new
 * sessions start pre-connected to that tenant. Otherwise sessions start empty
 * and must call connect_cpi / use_connection.
 */
function seedConfig(): CpiConfig | null {
  try {
    return getConfig();
  } catch {
    return null;
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Liveness/readiness probe for Cloud Foundry.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "sap-cpi-monitoring", transport: "streamable-http" });
});

/**
 * Reject requests that don't carry the shared token (when configured).
 * Accepts either `Authorization: Bearer <token>` (preferred) or `?token=<token>`
 * in the URL — the latter is for MCP clients (e.g. Claude Desktop's custom
 * connector) whose UI cannot attach a custom header.
 */
function authorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true; // open mode
  const header = req.headers.authorization ?? "";
  const headerToken = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  return headerToken === AUTH_TOKEN || queryToken === AUTH_TOKEN;
}

// Active transports keyed by MCP session id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp — client→server messages (incl. the initialize handshake).
app.post("/mcp", async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token." },
      id: null,
    });
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Existing session.
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session: create a transport + server + per-session context.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };

    const ctx = new SessionContext(seedConfig());
    const server = createServer(ctx);
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session id." },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// GET /mcp (SSE stream) and DELETE /mcp (session teardown).
async function handleSessionRequest(req: Request, res: Response): Promise<void> {
  if (!authorized(req)) {
    res.status(401).send("Unauthorized");
    return;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session id.");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SAP CPI Monitoring MCP Server (Streamable HTTP) listening on 0.0.0.0:${PORT}/mcp`,
  );
  if (!AUTH_TOKEN) {
    console.warn(
      "WARNING: MCP_AUTH_TOKEN is not set — the /mcp endpoint is OPEN. " +
        "Set MCP_AUTH_TOKEN before exposing this on a public route.",
    );
  }
  if (seedConfig()) {
    console.log("A default CPI tenant is configured via env (single-tenant fallback enabled).");
  }
});
