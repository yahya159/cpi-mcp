/**
 * Local web dashboard for the SAP CPI Monitoring server.
 *
 * Thin HTTP layer over the SAME cpiClient functions used by the MCP tools.
 *
 * Multi-tenant: users add CPI connections (service-key values) via the
 * Connections page. Connections are stored server-side (connections.json); the
 * browser only ever holds a connection id. Dashboard endpoints accept a
 * `?conn=<id>` query param and use that connection's credentials. With no
 * `conn` param they fall back to the tenant configured in .env.
 *
 * Run with:  npm run web   →  http://localhost:5174
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getConfig,
  fetchMetadata,
  fetchRecentMessages,
  fetchFailedMessages,
  fetchHealthSummary,
  fetchErrorDetails,
} from "./cpi/cpiClient.js";
import { toMessageSummaries } from "./cpi/messageLogs.js";
import type { CpiConfig } from "./cpi/odata.js";
import {
  addConnection,
  deleteConnection,
  getConnection,
  listConnections,
} from "./cpi/connectionsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.WEB_PORT ?? 5174);

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

/** Wrap an async handler so thrown errors become a clean JSON 500. */
function handle(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        typeof (err as { status?: unknown })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      res.status(status).json({ error: message });
    });
  };
}

/** Clamp a query param to an integer within [min, max], falling back to def. */
function intParam(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Resolve which CPI tenant a dashboard request targets.
 * `?conn=<id>` selects a saved connection; otherwise the .env tenant is used.
 * Throws a 400-style error if the connection id is unknown.
 */
function resolveConfig(req: Request): CpiConfig {
  const connId = req.query.conn;
  if (typeof connId === "string" && connId.length > 0) {
    const conn = getConnection(connId);
    if (!conn) {
      throw Object.assign(new Error("Unknown connection id."), { status: 404 });
    }
    return {
      apiBaseUrl: conn.apiBaseUrl,
      tokenUrl: conn.tokenUrl,
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
    };
  }
  return getConfig(); // falls back to .env (throws clearly if unset)
}

/** Build a CpiConfig from a request body (used for testing / saving). */
function configFromBody(body: unknown): CpiConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const apiBaseUrl = String(b.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
  const tokenUrl = String(b.tokenUrl ?? "").trim();
  const clientId = String(b.clientId ?? "").trim();
  const clientSecret = String(b.clientSecret ?? "").trim();
  if (!apiBaseUrl || !tokenUrl || !clientId || !clientSecret) {
    throw Object.assign(
      new Error("All fields are required: apiBaseUrl, tokenUrl, clientId, clientSecret."),
      { status: 400 },
    );
  }
  return { apiBaseUrl, tokenUrl, clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

// List saved connections (no secrets).
app.get(
  "/api/connections",
  handle(async (_req, res) => {
    res.json(listConnections());
  }),
);

// Test a connection's credentials WITHOUT saving. Body: { apiBaseUrl, tokenUrl, clientId, clientSecret }.
app.post(
  "/api/connections/test",
  handle(async (req, res) => {
    const config = configFromBody(req.body);
    try {
      await fetchMetadata(config); // exercises OAuth + the OData API
      res.json({ ok: true, apiBaseUrl: config.apiBaseUrl });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

// Save a connection (after testing). Body adds { name }.
app.post(
  "/api/connections",
  handle(async (req, res) => {
    const config = configFromBody(req.body);
    const name =
      String((req.body as Record<string, unknown>)?.name ?? "").trim() ||
      new URL(config.apiBaseUrl).hostname.split(".")[0];
    // Validate before persisting.
    await fetchMetadata(config);
    res.status(201).json(addConnection({ name, ...config }));
  }),
);

app.delete(
  "/api/connections/:id",
  handle(async (req, res) => {
    const ok = deleteConnection(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  }),
);

// ---------------------------------------------------------------------------
// Monitoring data (scoped by ?conn=<id>, or .env fallback)
// ---------------------------------------------------------------------------

app.get(
  "/api/check",
  handle(async (req, res) => {
    const config = resolveConfig(req);
    const summary = await fetchMetadata(config);
    res.json({ ok: true, baseUrl: config.apiBaseUrl, summary });
  }),
);

app.get(
  "/api/recent",
  handle(async (req, res) => {
    const top = intParam(req.query.top, 20, 1, 100);
    const logs = await fetchRecentMessages(top, resolveConfig(req));
    res.json(toMessageSummaries(logs));
  }),
);

app.get(
  "/api/failed",
  handle(async (req, res) => {
    const lastHours = intParam(req.query.lastHours, 24, 1, 8760);
    const top = intParam(req.query.top, 50, 1, 100);
    const logs = await fetchFailedMessages(top, lastHours, resolveConfig(req));
    res.json(toMessageSummaries(logs));
  }),
);

app.get(
  "/api/health-summary",
  handle(async (req, res) => {
    const lastHours = intParam(req.query.lastHours, 24, 1, 8760);
    res.json(await fetchHealthSummary(lastHours, resolveConfig(req)));
  }),
);

app.get(
  "/api/error/:guid",
  handle(async (req, res) => {
    const details = await fetchErrorDetails(req.params.guid, resolveConfig(req));
    if (!details) {
      res.status(404).json({ error: "No error information for this message." });
      return;
    }
    res.json(details);
  }),
);

app.listen(PORT, () => {
  console.log(`CPI Monitoring dashboard running at http://localhost:${PORT}`);
});
