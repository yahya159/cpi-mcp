/**
 * Multi-tenant connection store — backend-agnostic facade.
 *
 * Backend is selected once, lazily, at first use:
 *   - SAP HANA Cloud  — when a `schema`-plan HANA service is bound (VCAP_SERVICES).
 *                        This is what runs on Cloud Foundry.
 *   - JSON file       — local/dev fallback (connections.json in cwd).
 *
 * Callers import the same async functions regardless of backend.
 *
 * Connection records contain client secrets, so the file is gitignored and the
 * secret fields are never returned to clients — only { id, name, apiBaseUrl }
 * is exposed (see toPublic / PublicConnection).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CpiConfig } from "./odata.js";
import type { HanaCreds } from "./connectionsStore.hana.js";

export interface Connection extends CpiConfig {
  id: string;
  name: string;
}

/** Connection as exposed to clients — never includes secrets. */
export interface PublicConnection {
  id: string;
  name: string;
  apiBaseUrl: string;
}

/** Backend contract. */
export interface ConnectionStore {
  listConnections(): Promise<PublicConnection[]>;
  getConnection(id: string): Promise<Connection | undefined>;
  addConnection(data: { name: string } & CpiConfig): Promise<PublicConnection>;
  deleteConnection(id: string): Promise<boolean>;
}

export function toPublic(c: Connection): PublicConnection {
  return { id: c.id, name: c.name, apiBaseUrl: c.apiBaseUrl };
}

// ---------------------------------------------------------------------------
// File backend (local/dev)
// ---------------------------------------------------------------------------

function createFileStore(): ConnectionStore {
  const FILE = path.resolve(process.cwd(), "connections.json");

  const readFile = (): Connection[] => {
    if (!existsSync(FILE)) return [];
    try {
      const parsed = JSON.parse(readFileSync(FILE, "utf8"));
      return Array.isArray(parsed) ? (parsed as Connection[]) : [];
    } catch {
      return [];
    }
  };
  const writeFile = (rows: Connection[]): void =>
    writeFileSync(FILE, JSON.stringify(rows, null, 2), "utf8");

  return {
    async listConnections() {
      return readFile().map(toPublic);
    },
    async getConnection(id) {
      return readFile().find((c) => c.id === id);
    },
    async addConnection(data) {
      const rows = readFile();
      const connection: Connection = {
        id: randomUUID(),
        name: data.name,
        apiBaseUrl: data.apiBaseUrl.replace(/\/+$/, ""),
        tokenUrl: data.tokenUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      };
      rows.push(connection);
      writeFile(rows);
      return toPublic(connection);
    },
    async deleteConnection(id) {
      const rows = readFile();
      const next = rows.filter((c) => c.id !== id);
      if (next.length === rows.length) return false;
      writeFile(next);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

/** Find HANA credentials in VCAP_SERVICES (bound `schema`-plan instance). */
function findHanaCredentials(): HanaCreds | null {
  const raw = process.env.VCAP_SERVICES;
  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Flatten all bound services across offerings.
  const all: any[] = [];
  for (const key of Object.keys(parsed)) {
    const arr = (parsed as any)[key];
    if (Array.isArray(arr)) all.push(...arr);
  }

  const wantName = process.env.CONNECTIONS_DB_INSTANCE ?? "cpi-mcp-db";
  const byName = all.find((s) => s?.name === wantName && s?.credentials);
  const byPlan = all.find(
    (s) => s?.label === "hana" && s?.plan === "schema" && s?.credentials,
  );
  const svc = byName ?? byPlan;

  const c = svc?.credentials;
  if (!c?.host || !c?.user || !c?.password) return null;

  return {
    host: c.host,
    port: c.port ?? 443,
    user: c.user,
    password: c.password,
    schema: c.schema ?? c.currentSchema,
    certificate: c.certificate,
  };
}

let _storePromise: Promise<ConnectionStore> | null = null;

function getStore(): Promise<ConnectionStore> {
  if (!_storePromise) {
    const creds = findHanaCredentials();
    if (creds) {
      // Lazy import so the native HANA driver is only loaded when actually bound.
      _storePromise = import("./connectionsStore.hana.js").then((m) =>
        m.createHanaStore(creds),
      );
    } else {
      _storePromise = Promise.resolve(createFileStore());
    }
  }
  return _storePromise;
}

// ---------------------------------------------------------------------------
// Public API (stable across backends)
// ---------------------------------------------------------------------------

export async function listConnections(): Promise<PublicConnection[]> {
  return (await getStore()).listConnections();
}

export async function getConnection(id: string): Promise<Connection | undefined> {
  return (await getStore()).getConnection(id);
}

export async function addConnection(
  data: { name: string } & CpiConfig,
): Promise<PublicConnection> {
  return (await getStore()).addConnection(data);
}

export async function deleteConnection(id: string): Promise<boolean> {
  return (await getStore()).deleteConnection(id);
}
