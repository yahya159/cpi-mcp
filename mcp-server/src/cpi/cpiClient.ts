/**
 * High-level SAP CPI client.
 *
 * Reads configuration from environment variables and provides typed methods
 * for querying MessageProcessingLogs and $metadata.
 *
 * NOTE: OData field names (e.g. IntegrationFlowName, LogStart, Status) are
 * based on the standard SAP CPI schema.  If your tenant uses a different
 * schema version the field names may differ.  Call check_cpi_metadata first
 * and compare against the entity properties returned.
 */

import { CpiConfig, odataGet, odataGetRaw } from "./odata.js";
import { CPI_READ_ROLES } from "./roles.js";

// ---------------------------------------------------------------------------
// OData v2 helpers & constants
// ---------------------------------------------------------------------------

const MPL_SELECT_FULL = [
  "MessageGuid",
  "IntegrationFlowName",
  "Status",
  "LogStart",
  "LogEnd",
  "Sender",
  "Receiver",
  "CorrelationId",
  "ApplicationMessageId",
  "ApplicationMessageType",
].join(",");

const MPL_SELECT_SUMMARY = [
  "MessageGuid",
  "IntegrationFlowName",
  "Status",
  "LogStart",
  "ApplicationMessageType",
].join(",");

// SAP CPI MessageGuids are NOT always dashed UUIDs. Many tenants use a
// token-style id such as "AGoyrcQJPSGje_agRByePL8XRa_W". Accept both a
// standard UUID and the token form (letters, digits, '_' and '-'). The
// allowed character set excludes the single quote, so the value is safe to
// embed in an OData key segment.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CPI_MSG_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

function isValidMessageId(value: string): boolean {
  return UUID_RE.test(value) || CPI_MSG_ID_RE.test(value);
}

/**
 * Format a Date as an OData v2 datetime literal: datetime'yyyy-MM-ddTHH:mm:ss'
 * SAP CPI uses OData v2 which does NOT accept milliseconds or the trailing "Z".
 */
function toODataDateTime(date: Date): string {
  const iso = date.toISOString(); // e.g. "2026-06-17T00:00:00.000Z"
  const stripped = iso.replace(/\.\d{3}Z$/, "");
  return `datetime'${stripped}'`;
}

/**
 * Convert an OData v2 date string into a readable ISO-8601 timestamp.
 *
 * SAP CPI returns timestamps as "/Date(1781706180598)/" (epoch milliseconds,
 * optionally with a "+0000" offset). This turns that into "2026-06-17T05:03:00.598Z".
 * If the value is already a plain string or cannot be parsed, it is returned as-is.
 */
export function formatODataDate(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const match = /\/Date\((-?\d+)(?:[+-]\d+)?\)\//.exec(value);
  if (!match) return value;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadConfig(): CpiConfig {
  const apiBaseUrl = process.env.CPI_API_BASE_URL;
  const tokenUrl = process.env.CPI_TOKEN_URL;
  const clientId = process.env.CPI_CLIENT_ID;
  const clientSecret = process.env.CPI_CLIENT_SECRET;

  if (!apiBaseUrl) throw new Error("Missing environment variable: CPI_API_BASE_URL");
  if (!tokenUrl) throw new Error("Missing environment variable: CPI_TOKEN_URL");
  if (!clientId) throw new Error("Missing environment variable: CPI_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing environment variable: CPI_CLIENT_SECRET");

  // Strip trailing slash
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    tokenUrl,
    clientId,
    clientSecret,
  };
}

let _config: CpiConfig | null = null;

export function getConfig(): CpiConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset cached config. Exposed for testing. */
export function resetConfig(): void {
  _config = null;
}

// ---------------------------------------------------------------------------
// Types  (fields based on standard SAP CPI OData schema)
// ---------------------------------------------------------------------------

/**
 * Represents one MessageProcessingLog entry.
 *
 * NOTE: Field names follow the standard CPI OData entity type.
 * Some tenants may expose slightly different property names.
 * After calling $metadata you can confirm the exact names.
 */
export interface MessageProcessingLog {
  MessageGuid: string;
  CorrelationId?: string;
  // "IntegrationFlowName" is the standard property; some schemas use
  // "IntegrationArtifact/Name" as a navigation property instead.
  IntegrationFlowName?: string;
  Status: string;
  LogStart?: string;
  LogEnd?: string;
  Sender?: string;
  Receiver?: string;
  ApplicationMessageId?: string;
  ApplicationMessageType?: string;
  // Custom/additional fields may exist depending on tenant
  [key: string]: unknown;
}

interface ODataCollection<T> {
  d: {
    results: T[];
    __next?: string;
  };
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

const METADATA_MAX_CHARS = 8_000;

/** Fetch raw $metadata XML. */
export async function fetchMetadataRaw(config: CpiConfig = getConfig()): Promise<string> {
  return odataGetRaw(config, "/api/v1/$metadata");
}

/** Extract EntitySet names from OData v2 metadata XML. */
function extractEntitySetNames(metadataXml: string): string[] {
  const entitySetRe = /<EntitySet\s+[^>]*Name="([^"]+)"/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = entitySetRe.exec(metadataXml)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/** Fetch $metadata XML. Returns a trimmed summary string. */
export async function fetchMetadata(config: CpiConfig = getConfig()): Promise<string> {
  const raw = await fetchMetadataRaw(config);

  if (raw.length <= METADATA_MAX_CHARS) return raw;

  // Extract EntityType names via regex (works on both minified and formatted XML)
  const entityTypeRe = /<EntityType\s+[^>]*Name="([^"]+)"/g;
  const entityTypes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = entityTypeRe.exec(raw)) !== null && entityTypes.length < 30) {
    entityTypes.push(match[1]);
  }

  return [
    `Metadata retrieved successfully (${raw.length} characters).`,
    "",
    `Entity types found (first ${entityTypes.length}):`,
    ...entityTypes.map((n) => `  - ${n}`),
    "",
    "Full metadata is available but truncated for readability.",
    "Use the raw $metadata endpoint in a browser to inspect all properties.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Role / permission checks
// ---------------------------------------------------------------------------

export type CpiPermissionStatus =
  | "ok"
  | "forbidden"
  | "unavailable"
  | "not_supported"
  | "failed"
  | "not_verified";

export interface CpiPermissionCheck {
  role: (typeof CPI_READ_ROLES)[number];
  capability: string;
  endpoint: string;
  status: CpiPermissionStatus;
  detail: string;
}

function statusFromProbeError(err: unknown): Pick<CpiPermissionCheck, "status" | "detail"> {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("403")) {
    return { status: "forbidden", detail: message };
  }
  if (message.includes("404")) {
    return { status: "unavailable", detail: message };
  }
  if (message.includes("501")) {
    return {
      status: "not_supported",
      detail:
        `${message}. SAP accepted the token, but this tenant/API endpoint does not implement the probed read path.`,
    };
  }
  return { status: "failed", detail: message };
}

async function probeReadEndpoint(
  config: CpiConfig,
  role: CpiPermissionCheck["role"],
  capability: string,
  endpoint: string,
  params: Record<string, string> = { $top: "1", $format: "json" },
): Promise<CpiPermissionCheck> {
  try {
    await odataGet(config, endpoint, params);
    return {
      role,
      capability,
      endpoint,
      status: "ok",
      detail: "Read probe succeeded.",
    };
  } catch (err) {
    const { status, detail } = statusFromProbeError(err);
    return { role, capability, endpoint, status, detail };
  }
}

async function probeMessagePayloadsRole(
  config: CpiConfig,
): Promise<CpiPermissionCheck> {
  let recent: MessageProcessingLog[];
  try {
    recent = await fetchRecentMessages(1, config);
  } catch (err) {
    const { status, detail } = statusFromProbeError(err);
    return {
      role: "MessagePayloadsRead",
      capability: "Persisted message payloads",
      endpoint: "/api/v1/MessageProcessingLogs",
      status,
      detail,
    };
  }

  const messageGuid = recent[0]?.MessageGuid;
  if (!messageGuid) {
    return {
      role: "MessagePayloadsRead",
      capability: "Persisted message payloads",
      endpoint: "/api/v1/MessageProcessingLogs('<MessageGuid>')/MessageStoreEntries",
      status: "not_verified",
      detail:
        "No recent Message Processing Log was available to probe the per-message MessageStoreEntries endpoint.",
    };
  }

  return probeReadEndpoint(
    config,
    "MessagePayloadsRead",
    "Persisted message payloads",
    `/api/v1/MessageProcessingLogs('${messageGuid}')/MessageStoreEntries`,
  );
}

async function probeHealthCheckRole(
  config: CpiConfig,
): Promise<CpiPermissionCheck> {
  let entitySets: string[];
  try {
    entitySets = extractEntitySetNames(await fetchMetadataRaw(config));
  } catch (err) {
    const { status, detail } = statusFromProbeError(err);
    return {
      role: "HealthCheckMonitoringDataRead",
      capability: "Health-check monitoring data",
      endpoint: "/api/v1/$metadata",
      status,
      detail,
    };
  }

  const candidate = entitySets.find((name) =>
    /(health|jms|queue|messaging)/i.test(name),
  );

  if (!candidate) {
    return {
      role: "HealthCheckMonitoringDataRead",
      capability: "Health-check monitoring data",
      endpoint: "/api/v1/$metadata",
      status: "not_verified",
      detail:
        "No obvious health-check entity set was found in this tenant's /api/v1/$metadata. " +
        "SAP documents this role for health-check monitoring metrics such as JMS queue statistics and certificate expiry dates, but this MCP could not safely identify a tenant-specific endpoint.",
    };
  }

  return probeReadEndpoint(
    config,
    "HealthCheckMonitoringDataRead",
    "Health-check monitoring data",
    `/api/v1/${candidate}`,
  );
}

/** Probe the read-only capabilities covered by the recommended api-plan roles. */
export async function checkCpiReadPermissions(
  config: CpiConfig = getConfig(),
): Promise<CpiPermissionCheck[]> {
  const checks = await Promise.all([
    probeReadEndpoint(
      config,
      "MonitoringDataRead",
      "Message Processing Logs",
      "/api/v1/MessageProcessingLogs",
    ),
    probeMessagePayloadsRole(config),
    probeReadEndpoint(
      config,
      "WorkspacePackagesRead",
      "Integration packages",
      "/api/v1/IntegrationPackages",
    ),
    probeHealthCheckRole(config),
  ]);

  return checks;
}

/** Fetch recent MessageProcessingLogs. */
export async function fetchRecentMessages(
  top: number,
  config: CpiConfig = getConfig(),
): Promise<MessageProcessingLog[]> {
  // $orderby=LogStart desc is the standard way to get newest first.
  // If the tenant does not support $orderby on LogStart, remove the param.
  const data = await odataGet<ODataCollection<MessageProcessingLog>>(
    config,
    "/api/v1/MessageProcessingLogs",
    {
      $top: String(top),
      $select: MPL_SELECT_FULL,
      $orderby: "LogStart desc",
      $format: "json",
    },
  );

  return data?.d?.results ?? [];
}

/**
 * Fetch failed / escalated messages within a time window.
 *
 * NOTE: The $filter uses "Status eq 'FAILED' or Status eq 'ESCALATED'".
 * Some CPI tenants use "RETRY" or other statuses; adapt as needed after
 * checking $metadata.
 */
export async function fetchFailedMessages(
  top: number,
  lastHours: number,
  config: CpiConfig = getConfig(),
): Promise<MessageProcessingLog[]> {
  const since = toODataDateTime(new Date(Date.now() - lastHours * 3600_000));

  const filter = [
    `(Status eq 'FAILED' or Status eq 'ESCALATED')`,
    `LogStart gt ${since}`,
  ].join(" and ");

  const data = await odataGet<ODataCollection<MessageProcessingLog>>(
    config,
    "/api/v1/MessageProcessingLogs",
    {
      $top: String(top),
      $select: MPL_SELECT_FULL,
      $filter: filter,
      $orderby: "LogStart desc",
      $format: "json",
    },
  );

  return data?.d?.results ?? [];
}

/**
 * Fetch messages for a specific iFlow by name.
 *
 * The filter uses "IntegrationFlowName eq '...'".
 * If your tenant uses a different property for the artifact name,
 * you must adapt this filter after checking $metadata.
 */
export async function fetchMessagesByIflow(
  iflowName: string,
  top: number,
  lastHours?: number,
  config: CpiConfig = getConfig(),
): Promise<MessageProcessingLog[]> {
  // Escape single quotes in the iFlow name for OData safety
  const safeName = iflowName.replace(/'/g, "''");

  const filters: string[] = [`IntegrationFlowName eq '${safeName}'`];

  if (lastHours !== undefined) {
    const since = toODataDateTime(new Date(Date.now() - lastHours * 3600_000));
    filters.push(`LogStart gt ${since}`);
  }

  const data = await odataGet<ODataCollection<MessageProcessingLog>>(
    config,
    "/api/v1/MessageProcessingLogs",
    {
      $top: String(top),
      $select: MPL_SELECT_FULL,
      $filter: filters.join(" and "),
      $orderby: "LogStart desc",
      $format: "json",
    },
  );

  return data?.d?.results ?? [];
}

/** Fetch a single message by its GUID. */
export async function fetchMessageById(
  messageGuid: string,
  config: CpiConfig = getConfig(),
): Promise<MessageProcessingLog | null> {
  if (!isValidMessageId(messageGuid)) {
    throw new Error(
      `Invalid MessageGuid format: "${messageGuid}". Expected a UUID or a CPI token id (letters, digits, '_' or '-').`,
    );
  }

  const path = `/api/v1/MessageProcessingLogs('${messageGuid}')`;

  try {
    const data = await odataGet<{ d: MessageProcessingLog }>(config, path, {
      $select: MPL_SELECT_FULL,
      $format: "json",
    });
    return data?.d ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Message Store / persisted payloads
// ---------------------------------------------------------------------------

export interface MessageStoreEntry {
  MessageStoreEntryId?: string;
  Id?: string;
  MessageGuid?: string;
  IntegrationFlowName?: string;
  StepId?: string;
  LogStart?: string;
  LogEnd?: string;
  CreatedAt?: string;
  RetainUntil?: string;
  [key: string]: unknown;
}

export interface MessageStoreEntrySummary {
  entryId: string;
  messageGuid: string;
  stepId: string;
  integrationFlowName: string;
  logStart: string;
  logEnd: string;
  createdAt: string;
  retainUntil: string;
}

function getMessageStoreEntryId(entry: MessageStoreEntry): string {
  const metadata = entry.__metadata as { uri?: unknown } | undefined;
  const metadataUri = typeof metadata?.uri === "string" ? metadata.uri : "";
  const uriMatch = /MessageStoreEntries\('([^']+)'\)/.exec(metadataUri);

  const candidates = [
    entry.MessageStoreEntryId,
    entry.Id,
    uriMatch?.[1],
    entry.MessageGuid,
  ];

  return candidates.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

export function toMessageStoreEntrySummary(
  entry: MessageStoreEntry,
): MessageStoreEntrySummary {
  return {
    entryId: getMessageStoreEntryId(entry),
    messageGuid: String(entry.MessageGuid ?? ""),
    stepId: String(entry.StepId ?? entry.StepID ?? entry.Name ?? "N/A"),
    integrationFlowName: String(entry.IntegrationFlowName ?? "N/A"),
    logStart: formatODataDate(entry.LogStart),
    logEnd: formatODataDate(entry.LogEnd),
    createdAt: formatODataDate(entry.CreatedAt),
    retainUntil: formatODataDate(entry.RetainUntil ?? entry.RetentionUntil),
  };
}

/** List persisted Message Store entries associated with one Message Processing Log. */
export async function fetchMessageStoreEntries(
  messageGuid: string,
  top = 20,
  config: CpiConfig = getConfig(),
): Promise<MessageStoreEntry[]> {
  if (!isValidMessageId(messageGuid)) {
    throw new Error(
      `Invalid MessageGuid format: "${messageGuid}". Expected a UUID or a CPI token id (letters, digits, '_' or '-').`,
    );
  }

  const data = await odataGet<ODataCollection<MessageStoreEntry>>(
    config,
    `/api/v1/MessageProcessingLogs('${messageGuid}')/MessageStoreEntries`,
    {
      $top: String(top),
      $format: "json",
    },
  );

  return data?.d?.results ?? [];
}

/** Fetch raw payload content for one persisted Message Store entry. */
export async function fetchMessageStorePayload(
  entryId: string,
  config: CpiConfig = getConfig(),
): Promise<string> {
  if (!isValidMessageId(entryId)) {
    throw new Error(
      `Invalid MessageStoreEntry id format: "${entryId}". Expected letters, digits, '_' or '-'.`,
    );
  }

  return odataGetRaw(
    config,
    `/api/v1/MessageStoreEntries('${entryId}')/$value`,
    "text/plain, application/json, application/xml, text/xml, */*",
  );
}

// ---------------------------------------------------------------------------
// Workspace packages
// ---------------------------------------------------------------------------

export interface IntegrationPackage {
  Id?: string;
  Name?: string;
  Description?: string;
  ShortText?: string;
  Version?: string;
  Vendor?: string;
  Mode?: string;
  SupportedPlatform?: string;
  CreationDate?: string;
  ModifiedDate?: string;
  CreatedBy?: string;
  ModifiedBy?: string;
  [key: string]: unknown;
}

export interface IntegrationPackageSummary {
  id: string;
  name: string;
  shortText: string;
  version: string;
  vendor: string;
  mode: string;
  supportedPlatform: string;
  createdAt: string;
  modifiedAt: string;
  modifiedBy: string;
}

export function toIntegrationPackageSummary(
  pkg: IntegrationPackage,
): IntegrationPackageSummary {
  return {
    id: String(pkg.Id ?? ""),
    name: String(pkg.Name ?? "N/A"),
    shortText: String(pkg.ShortText ?? pkg.Description ?? ""),
    version: String(pkg.Version ?? ""),
    vendor: String(pkg.Vendor ?? ""),
    mode: String(pkg.Mode ?? ""),
    supportedPlatform: String(pkg.SupportedPlatform ?? ""),
    createdAt: formatODataDate(pkg.CreationDate),
    modifiedAt: formatODataDate(pkg.ModifiedDate),
    modifiedBy: String(pkg.ModifiedBy ?? ""),
  };
}

/** List Integration Suite workspace packages. */
export async function fetchIntegrationPackages(
  top: number,
  config: CpiConfig = getConfig(),
): Promise<IntegrationPackage[]> {
  const data = await odataGet<ODataCollection<IntegrationPackage>>(
    config,
    "/api/v1/IntegrationPackages",
    {
      $top: String(top),
      $format: "json",
    },
  );

  return data?.d?.results ?? [];
}

/**
 * Detailed error information for a failed message.
 *
 * `errorText` is the long "Last Error" body shown in the CPI monitoring UI,
 * retrieved from the ErrorInformation media resource (.../ErrorInformation/$value).
 * `lastErrorModelStepId` identifies the iFlow model step that failed, when available.
 */
export interface MessageErrorDetails {
  messageGuid: string;
  lastErrorModelStepId?: string;
  errorText: string;
}

/**
 * Fetch the detailed error text for a single message by its GUID.
 *
 * Returns null when the message has no associated error information
 * (e.g. it completed successfully).
 */
export async function fetchErrorDetails(
  messageGuid: string,
  config: CpiConfig = getConfig(),
): Promise<MessageErrorDetails | null> {
  if (!isValidMessageId(messageGuid)) {
    throw new Error(
      `Invalid MessageGuid format: "${messageGuid}". Expected a UUID or a CPI token id (letters, digits, '_' or '-').`,
    );
  }

  const base = `/api/v1/MessageProcessingLogs('${messageGuid}')/ErrorInformation`;

  // The long error body is exposed as a text/plain media resource ($value).
  // A 404 here means there is no error information for this message.
  let errorText: string;
  try {
    errorText = (await odataGetRaw(config, `${base}/$value`, "text/plain")).trim();
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) {
      return null;
    }
    throw err;
  }

  // The failing model step id is a nice-to-have; ignore failures fetching it.
  let lastErrorModelStepId: string | undefined;
  try {
    const meta = await odataGet<{ d: { LastErrorModelStepId?: string } }>(
      config,
      base,
      { $format: "json" },
    );
    lastErrorModelStepId = meta?.d?.LastErrorModelStepId ?? undefined;
  } catch {
    // best-effort only
  }

  return { messageGuid, lastErrorModelStepId, errorText };
}

/**
 * Fetch the latest failed message for a given iFlow.
 */
export async function fetchLastErrorForIflow(
  iflowName: string,
  config: CpiConfig = getConfig(),
): Promise<MessageProcessingLog | null> {
  const safeName = iflowName.replace(/'/g, "''");

  const filter = [
    `IntegrationFlowName eq '${safeName}'`,
    `(Status eq 'FAILED' or Status eq 'ESCALATED')`,
  ].join(" and ");

  const data = await odataGet<ODataCollection<MessageProcessingLog>>(
    config,
    "/api/v1/MessageProcessingLogs",
    {
      $top: "1",
      $select: MPL_SELECT_FULL,
      $filter: filter,
      $orderby: "LogStart desc",
      $format: "json",
    },
  );

  const results = data?.d?.results ?? [];
  return results.length > 0 ? results[0] : null;
}

const HEALTH_PAGE_SIZE = 1000;
const HEALTH_MAX_MESSAGES = 5000;

/**
 * Build a health summary across all messages in a time window.
 * Pages through OData results via __next to avoid silently capping counts.
 */
export async function fetchHealthSummary(
  lastHours: number,
  config: CpiConfig = getConfig(),
): Promise<{
  period: string;
  totalMessages: number;
  completedMessages: number;
  failedMessages: number;
  escalatedMessages: number;
  sampled: boolean;
  sampledNote?: string;
  topFailingIflows: { iflowName: string; failedCount: number }[];
  latestFailure: {
    iflowName: string;
    messageGuid: string;
    timestamp: string;
    error: string;
  } | null;
  healthStatus: "HEALTHY" | "WARNING" | "CRITICAL";
}> {
  const since = toODataDateTime(new Date(Date.now() - lastHours * 3600_000));
  const filter = `LogStart gt ${since}`;

  const messages: MessageProcessingLog[] = [];
  let sampled = false;
  let nextUrl: string | undefined;

  // First page
  const firstPage = await odataGet<ODataCollection<MessageProcessingLog>>(
    config,
    "/api/v1/MessageProcessingLogs",
    {
      $top: String(HEALTH_PAGE_SIZE),
      $select: MPL_SELECT_SUMMARY,
      $filter: filter,
      $orderby: "LogStart desc",
      $format: "json",
    },
  );

  messages.push(...(firstPage?.d?.results ?? []));
  nextUrl = firstPage?.d?.__next;

  // Follow __next links up to the safety cap
  while (nextUrl && messages.length < HEALTH_MAX_MESSAGES) {
    let pagePath: string;
    try {
      const parsed = new URL(nextUrl);
      pagePath = parsed.pathname + parsed.search;
    } catch {
      // __next was already a relative path
      pagePath = nextUrl;
    }
    const page = await odataGet<ODataCollection<MessageProcessingLog>>(
      config,
      pagePath,
    );
    messages.push(...(page?.d?.results ?? []));
    nextUrl = page?.d?.__next;
  }

  if (nextUrl) {
    sampled = true;
  }

  const total = messages.length;
  let completed = 0;
  let failed = 0;
  let escalated = 0;

  const failCountByIflow = new Map<string, number>();
  let latestFailure: {
    iflowName: string;
    messageGuid: string;
    timestamp: string;
    error: string;
  } | null = null;

  for (const msg of messages) {
    const status = (msg.Status ?? "").toUpperCase();

    if (status === "COMPLETED") {
      completed++;
    } else if (status === "FAILED") {
      failed++;
      const name = msg.IntegrationFlowName ?? "Unknown";
      failCountByIflow.set(name, (failCountByIflow.get(name) ?? 0) + 1);

      if (!latestFailure) {
        latestFailure = {
          iflowName: name,
          messageGuid: msg.MessageGuid,
          timestamp: formatODataDate(msg.LogStart),
          error: String(msg.Status ?? "FAILED"),
        };
      }
    } else if (status === "ESCALATED") {
      escalated++;
      const name = msg.IntegrationFlowName ?? "Unknown";
      failCountByIflow.set(name, (failCountByIflow.get(name) ?? 0) + 1);

      if (!latestFailure) {
        latestFailure = {
          iflowName: name,
          messageGuid: msg.MessageGuid,
          timestamp: formatODataDate(msg.LogStart),
          error: "ESCALATED",
        };
      }
    }
  }

  const topFailingIflows = [...failCountByIflow.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([iflowName, failedCount]) => ({ iflowName, failedCount }));

  let healthStatus: "HEALTHY" | "WARNING" | "CRITICAL";
  const failureCount = failed + escalated;

  if (failureCount === 0) {
    healthStatus = "HEALTHY";
  } else if (total > 0 && failureCount / total > 0.25) {
    healthStatus = "CRITICAL";
  } else if (failureCount >= 10) {
    healthStatus = "CRITICAL";
  } else {
    healthStatus = "WARNING";
  }

  return {
    period: `last ${lastHours} hours`,
    totalMessages: total,
    completedMessages: completed,
    failedMessages: failed,
    escalatedMessages: escalated,
    sampled,
    ...(sampled
      ? {
          sampledNote: `Results capped at ${HEALTH_MAX_MESSAGES} messages. Actual total may be higher — counts and ratios are approximate.`,
        }
      : {}),
    topFailingIflows,
    latestFailure,
    healthStatus,
  };
}
