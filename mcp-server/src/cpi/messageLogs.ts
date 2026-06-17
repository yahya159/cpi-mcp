/**
 * Message log formatting helpers.
 *
 * Transforms raw CPI MessageProcessingLog objects into clean summaries
 * suitable for MCP tool responses.
 */

import { formatODataDate, type MessageProcessingLog } from "./cpiClient.js";

export interface MessageSummary {
  messageGuid: string;
  iflowName: string;
  status: string;
  logStart: string;
  logEnd: string;
  sender: string;
  receiver: string;
  correlationId: string;
  applicationMessageId: string;
}

/**
 * Convert a raw CPI log entry into a clean summary object.
 *
 * NOTE: If your tenant uses different field names (e.g. "IntegrationArtifact"
 * instead of "IntegrationFlowName"), adapt the mapping here.
 */
export function toMessageSummary(log: MessageProcessingLog): MessageSummary {
  return {
    messageGuid: log.MessageGuid ?? "",
    iflowName: log.IntegrationFlowName ?? "N/A",
    status: log.Status ?? "",
    logStart: formatODataDate(log.LogStart),
    logEnd: formatODataDate(log.LogEnd),
    sender: log.Sender ?? "N/A",
    receiver: log.Receiver ?? "N/A",
    correlationId: log.CorrelationId ?? "",
    applicationMessageId: log.ApplicationMessageId ?? "",
  };
}

export function toMessageSummaries(logs: MessageProcessingLog[]): MessageSummary[] {
  return logs.map(toMessageSummary);
}
