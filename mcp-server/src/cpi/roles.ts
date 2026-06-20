export const CPI_READ_ROLES = [
  "MonitoringDataRead",
  "MessagePayloadsRead",
  "HealthCheckMonitoringDataRead",
  "WorkspacePackagesRead",
] as const;

export const CPI_READ_ROLE_HINT = CPI_READ_ROLES.join(", ");

