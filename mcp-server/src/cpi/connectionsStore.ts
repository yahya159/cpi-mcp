/**
 * Persistent store for saved CPI tenant connections (multi-tenant dashboard).
 *
 * Connections are saved to connections.json in the server working directory.
 * The file contains client secrets in plain text, so it is gitignored and must
 * stay on the server only — the browser never receives secret fields (see the
 * `toPublic` helper and the API in web.ts).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CpiConfig } from "./odata.js";

export interface Connection extends CpiConfig {
  id: string;
  name: string;
}

/** Connection as exposed to the browser — never includes secrets. */
export interface PublicConnection {
  id: string;
  name: string;
  apiBaseUrl: string;
}

const FILE = path.resolve(process.cwd(), "connections.json");

function loadAll(): Connection[] {
  if (!existsSync(FILE)) return [];
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Connection[]) : [];
  } catch {
    return [];
  }
}

function saveAll(connections: Connection[]): void {
  writeFileSync(FILE, JSON.stringify(connections, null, 2), "utf8");
}

export function toPublic(c: Connection): PublicConnection {
  return { id: c.id, name: c.name, apiBaseUrl: c.apiBaseUrl };
}

export function listConnections(): PublicConnection[] {
  return loadAll().map(toPublic);
}

/** Full connection (with secrets) — server-side use only. */
export function getConnection(id: string): Connection | undefined {
  return loadAll().find((c) => c.id === id);
}

export function addConnection(
  data: { name: string } & CpiConfig,
): PublicConnection {
  const connections = loadAll();
  const connection: Connection = {
    id: randomUUID(),
    name: data.name,
    apiBaseUrl: data.apiBaseUrl.replace(/\/+$/, ""),
    tokenUrl: data.tokenUrl,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
  };
  connections.push(connection);
  saveAll(connections);
  return toPublic(connection);
}

export function deleteConnection(id: string): boolean {
  const connections = loadAll();
  const next = connections.filter((c) => c.id !== id);
  if (next.length === connections.length) return false;
  saveAll(next);
  return true;
}
