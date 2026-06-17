/**
 * Low-level OData HTTP helper for SAP CPI.
 *
 * All requests are authenticated via OAuth2 and sent to the configured
 * CPI_API_BASE_URL. Responses are returned as parsed JSON.
 */

import axios, { AxiosError } from "axios";
import { getAccessToken } from "./auth.js";

/** Extract the human-readable message from an OData v2 JSON error envelope. */
function extractODataError(data: unknown): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const error = obj.error as Record<string, unknown> | undefined;
    const msg = error?.message as Record<string, unknown> | undefined;
    if (typeof msg?.value === "string") return msg.value;
  }
  return typeof data === "string" ? data : JSON.stringify(data);
}

export interface CpiConfig {
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Execute a GET request against the SAP CPI OData API.
 *
 * @param config  CPI connection config (from env)
 * @param path    OData path, e.g. "/api/v1/MessageProcessingLogs"
 * @param params  OData query parameters ($top, $filter, $orderby, etc.)
 */
export async function odataGet<T = unknown>(
  config: CpiConfig,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getAccessToken(
    config.tokenUrl,
    config.clientId,
    config.clientSecret,
  );

  const url = `${config.apiBaseUrl}${path}`;

  try {
    const response = await axios.get<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params,
      timeout: 30_000,
    });

    return response.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;

      const detail = err.response?.data
        ? extractODataError(err.response.data)
        : undefined;

      if (status === 401) {
        throw new Error(
          `CPI API returned 401 Unauthorized. Token may have expired or lacks required scopes.${detail ? ` Detail: ${detail}` : ""}`,
        );
      }
      if (status === 403) {
        throw new Error(
          `CPI API returned 403 Forbidden. Ensure the service key has MonitoringDataRead role.${detail ? ` Detail: ${detail}` : ""}`,
        );
      }
      if (status === 404) {
        throw new Error(
          `CPI API returned 404 Not Found for path: ${path}. Verify CPI_API_BASE_URL and API path.${detail ? ` Detail: ${detail}` : ""}`,
        );
      }
      if (status === 400) {
        throw new Error(
          `CPI OData bad request (400). Possible filter syntax error. Detail: ${detail ?? "unknown"}`,
        );
      }
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        throw new Error(
          `Cannot reach CPI tenant. Check CPI_API_BASE_URL: ${config.apiBaseUrl}`,
        );
      }
      if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
        throw new Error("CPI API request timed out. Check network connectivity.");
      }
      throw new Error(
        `CPI OData request failed: ${status ?? err.code ?? err.message}`,
      );
    }

    throw new Error(`Unexpected error calling CPI API: ${String(err)}`);
  }
}

/**
 * Fetch raw (non-JSON) content from the CPI API, e.g. $metadata XML.
 */
export async function odataGetRaw(
  config: CpiConfig,
  path: string,
): Promise<string> {
  const token = await getAccessToken(
    config.tokenUrl,
    config.clientId,
    config.clientSecret,
  );

  const url = `${config.apiBaseUrl}${path}`;

  try {
    const response = await axios.get<string>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/xml",
      },
      responseType: "text",
      timeout: 30_000,
    });

    return response.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 401) {
        throw new Error("CPI $metadata request returned 401. Check credentials.");
      }
      if (status === 404) {
        throw new Error(
          `CPI $metadata endpoint not found (404). Verify CPI_API_BASE_URL: ${config.apiBaseUrl}`,
        );
      }
      throw new Error(
        `CPI $metadata request failed: ${status ?? err.code ?? err.message}`,
      );
    }
    throw new Error(`Unexpected error fetching CPI metadata: ${String(err)}`);
  }
}
