/**
 * OAuth2 Client Credentials authentication for SAP CPI.
 *
 * Uses the token URL, client ID, and client secret from the SAP BTP
 * "Process Integration Runtime" service key.
 *
 * Tokens are cached in memory and refreshed automatically before expiry.
 * Secrets are never logged or written to disk.
 */

import axios, { AxiosError } from "axios";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Tokens are cached per client id so that multiple CPI tenants (multi-tenant
// dashboard) never share or overwrite each other's token.
const tokenCache = new Map<string, CachedToken>();
const inflightRequests = new Map<string, Promise<string>>();

/** Safety margin: refresh 60 seconds before actual expiry. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Cache key includes the secret so that the same client id with a different
 * (e.g. mistyped or rotated) secret is treated as different credentials. This
 * keeps "test connection" honest: a wrong secret cannot reuse a previously
 * cached valid token.
 */
function cacheKey(clientId: string, clientSecret: string): string {
  return `${clientId}\n${clientSecret}`;
}

async function fetchNewToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  try {
    const response = await axios.post<TokenResponse>(
      tokenUrl,
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      {
        auth: { username: clientId, password: clientSecret },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
      },
    );

    const { access_token, expires_in } = response.data;

    tokenCache.set(cacheKey(clientId, clientSecret), {
      accessToken: access_token,
      expiresAt: Date.now() + expires_in * 1000 - EXPIRY_MARGIN_MS,
    });

    return access_token;
  } catch (err) {
    tokenCache.delete(cacheKey(clientId, clientSecret));

    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 401) {
        throw new Error(
          "OAuth authentication failed (401). Check CPI_CLIENT_ID and CPI_CLIENT_SECRET.",
        );
      }
      if (status === 403) {
        throw new Error(
          "OAuth forbidden (403). The client may lack required scopes/roles.",
        );
      }
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        throw new Error(
          `Cannot reach token endpoint. Check CPI_TOKEN_URL: ${tokenUrl}`,
        );
      }
      if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
        throw new Error("Token request timed out. Check network connectivity.");
      }
      throw new Error(
        `OAuth token request failed: ${status ?? err.code ?? err.message}`,
      );
    }

    throw new Error(`Unexpected error during OAuth token request: ${String(err)}`);
  }
}

/**
 * Return a valid OAuth2 access token, fetching or refreshing as needed.
 * Concurrent callers share a single in-flight request to avoid redundant token fetches.
 */
export async function getAccessToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const key = cacheKey(clientId, clientSecret);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  let inflight = inflightRequests.get(key);
  if (!inflight) {
    inflight = fetchNewToken(tokenUrl, clientId, clientSecret).finally(() => {
      inflightRequests.delete(key);
    });
    inflightRequests.set(key, inflight);
  }

  return inflight;
}

/** Reset all cached state. Exposed for testing. */
export function resetAuthState(): void {
  tokenCache.clear();
  inflightRequests.clear();
}
