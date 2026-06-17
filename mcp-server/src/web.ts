/**
 * Local web dashboard for the SAP CPI Monitoring server.
 *
 * This is a thin HTTP layer over the SAME cpiClient functions used by the MCP
 * tools. It lets a browser frontend show recent/failed messages, a health
 * summary, and per-message error details — without the browser ever seeing SAP
 * credentials (they stay in this server's .env, exactly like the MCP server).
 *
 * This is separate from index.ts (the stdio MCP server). Run it with:
 *   npm run web
 * then open http://localhost:5174
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchMetadata,
  fetchRecentMessages,
  fetchFailedMessages,
  fetchHealthSummary,
  fetchErrorDetails,
} from "./cpi/cpiClient.js";
import { toMessageSummaries } from "./cpi/messageLogs.js";

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
      res.status(500).json({ error: message });
    });
  };
}

/** Clamp a query param to an integer within [min, max], falling back to def. */
function intParam(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Connectivity / which tenant are we pointed at.
app.get(
  "/api/check",
  handle(async (_req, res) => {
    const summary = await fetchMetadata();
    res.json({ ok: true, baseUrl: process.env.CPI_API_BASE_URL, summary });
  }),
);

// Recent messages (newest first).
app.get(
  "/api/recent",
  handle(async (req, res) => {
    const top = intParam(req.query.top, 20, 1, 100);
    const logs = await fetchRecentMessages(top);
    res.json(toMessageSummaries(logs));
  }),
);

// Failed / escalated messages in a time window.
app.get(
  "/api/failed",
  handle(async (req, res) => {
    const lastHours = intParam(req.query.lastHours, 24, 1, 8760);
    const top = intParam(req.query.top, 50, 1, 100);
    const logs = await fetchFailedMessages(top, lastHours);
    res.json(toMessageSummaries(logs));
  }),
);

// Aggregated health summary.
app.get(
  "/api/health-summary",
  handle(async (req, res) => {
    const lastHours = intParam(req.query.lastHours, 24, 1, 8760);
    res.json(await fetchHealthSummary(lastHours));
  }),
);

// Detailed error text for one message.
app.get(
  "/api/error/:guid",
  handle(async (req, res) => {
    const details = await fetchErrorDetails(req.params.guid);
    if (!details) {
      res.status(404).json({ error: "No error information for this message." });
      return;
    }
    res.json(details);
  }),
);

app.listen(PORT, () => {
  console.log(`CPI Monitoring dashboard running at http://localhost:${PORT}`);
  console.log(`Tenant: ${process.env.CPI_API_BASE_URL ?? "(CPI_API_BASE_URL not set)"}`);
});
