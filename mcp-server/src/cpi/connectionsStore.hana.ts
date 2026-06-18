/**
 * SAP HANA Cloud backend for the multi-tenant connection store.
 *
 * Used when the app is bound to a HANA `schema`-plan service on Cloud Foundry
 * (credentials arrive via VCAP_SERVICES). A plain schema is used — not an HDI
 * container — so the runtime user can CREATE/INSERT/DELETE its own table.
 *
 * The @sap/hana-client driver is a native, optional dependency. This module is
 * imported lazily (only when a HANA binding is present), so local/stdio usage
 * never requires the native module.
 *
 * NOTE: client secrets are stored as-is for now. Encrypting them at rest is a
 * tracked hardening item (see CF_DEPLOY.md).
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type {
  Connection,
  ConnectionStore,
  PublicConnection,
} from "./connectionsStore.js";

const require = createRequire(import.meta.url);

export interface HanaCreds {
  host: string;
  port: string | number;
  user: string;
  password: string;
  schema: string;
  certificate?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function exec(conn: any, sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    conn.exec(sql, params, (err: any, rows: any) =>
      err ? reject(err) : resolve(rows),
    );
  });
}

function connect(conn: any, params: any): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.connect(params, (err: any) => (err ? reject(err) : resolve()));
  });
}

const CREATE_TABLE = `CREATE TABLE CONNECTIONS (
  ID NVARCHAR(36) PRIMARY KEY,
  NAME NVARCHAR(256),
  API_BASE_URL NVARCHAR(1024),
  TOKEN_URL NVARCHAR(1024),
  CLIENT_ID NVARCHAR(512),
  CLIENT_SECRET NVARCHAR(2048),
  OWNER NVARCHAR(256),
  CREATED_AT TIMESTAMP
)`;

export async function createHanaStore(creds: HanaCreds): Promise<ConnectionStore> {
  const hana = require("@sap/hana-client");
  const conn = hana.createConnection();

  await connect(conn, {
    serverNode: `${creds.host}:${creds.port}`,
    uid: creds.user,
    pwd: creds.password,
    encrypt: "true",
    sslValidateCertificate: creds.certificate ? "true" : "false",
    ...(creds.certificate ? { sslTrustStore: creds.certificate } : {}),
    currentSchema: creds.schema,
  });

  // Create the table once; ignore "table already exists" (HANA SQL error 288).
  try {
    await exec(conn, CREATE_TABLE);
  } catch (err: any) {
    const code = err?.code;
    if (code !== 288 && !/exist/i.test(String(err?.message))) throw err;
  }

  const store: ConnectionStore = {
    async listConnections(): Promise<PublicConnection[]> {
      const rows = await exec(
        conn,
        `SELECT ID, NAME, API_BASE_URL FROM CONNECTIONS ORDER BY CREATED_AT`,
      );
      return (rows as any[]).map((r) => ({
        id: r.ID,
        name: r.NAME,
        apiBaseUrl: r.API_BASE_URL,
      }));
    },

    async getConnection(id: string): Promise<Connection | undefined> {
      const rows = await exec(
        conn,
        `SELECT ID, NAME, API_BASE_URL, TOKEN_URL, CLIENT_ID, CLIENT_SECRET
         FROM CONNECTIONS WHERE ID = ?`,
        [id],
      );
      const r = (rows as any[])[0];
      if (!r) return undefined;
      return {
        id: r.ID,
        name: r.NAME,
        apiBaseUrl: r.API_BASE_URL,
        tokenUrl: r.TOKEN_URL,
        clientId: r.CLIENT_ID,
        clientSecret: r.CLIENT_SECRET,
      };
    },

    async addConnection(data): Promise<PublicConnection> {
      const id = randomUUID();
      const apiBaseUrl = data.apiBaseUrl.replace(/\/+$/, "");
      await exec(
        conn,
        `INSERT INTO CONNECTIONS
           (ID, NAME, API_BASE_URL, TOKEN_URL, CLIENT_ID, CLIENT_SECRET, OWNER, CREATED_AT)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, data.name, apiBaseUrl, data.tokenUrl, data.clientId, data.clientSecret, null],
      );
      return { id, name: data.name, apiBaseUrl };
    },

    async deleteConnection(id: string): Promise<boolean> {
      const affected = await exec(conn, `DELETE FROM CONNECTIONS WHERE ID = ?`, [id]);
      return typeof affected === "number" ? affected > 0 : true;
    },
  };

  return store;
}
