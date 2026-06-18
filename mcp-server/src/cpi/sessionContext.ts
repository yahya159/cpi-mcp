/**
 * Per-session connection context for the multi-tenant MCP server.
 *
 * Over HTTP, each MCP session belongs to one client who may operate against a
 * different SAP CPI tenant. A SessionContext holds the *active* CpiConfig for
 * that session. The monitoring tools resolve their config from here instead of
 * from a single global env tenant.
 *
 * For the stdio entry point (single tenant, local), the context is seeded from
 * the CPI_* environment variables so behaviour is unchanged.
 */

import type { CpiConfig } from "./odata.js";

export class SessionContext {
  private active: CpiConfig | null = null;
  private activeName: string | null = null;

  constructor(seed?: CpiConfig | null, seedName = "env") {
    if (seed) {
      this.active = seed;
      this.activeName = seedName;
    }
  }

  /** Select the active CPI tenant for this session. */
  setActive(config: CpiConfig, name: string): void {
    this.active = config;
    this.activeName = name;
  }

  /** Name/label of the active connection, or null if none selected. */
  getActiveName(): string | null {
    return this.activeName;
  }

  /**
   * Return the active CpiConfig, or throw a clear, actionable error if the
   * session has not selected a connection yet. The error text is surfaced to
   * the AI so it knows to call connect_cpi / use_connection first.
   */
  requireConfig(): CpiConfig {
    if (!this.active) {
      throw new Error(
        "No CPI connection selected for this session. " +
          "Call `connect_cpi` with your SAP service-key values (apiBaseUrl, " +
          "tokenUrl, clientId, clientSecret), or `use_connection` with a saved " +
          "connection id, before requesting monitoring data.",
      );
    }
    return this.active;
  }
}
