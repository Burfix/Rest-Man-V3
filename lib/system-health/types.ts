/**
 * lib/system-health/types.ts
 *
 * Shared types for the System Health console.
 * Used by the service, API routes, and UI components.
 */

export type OverallStatus = "healthy" | "degraded" | "critical";

export type DataSourceStatus =
  | "live"
  | "fresh"
  | "delayed"
  | "stale"
  | "missing"
  | "not_configured";

export type JobStatus = "success" | "running" | "failed" | "idle" | "disabled";

export type TrustLevel = "high" | "medium" | "low" | "none";

export interface DataSourceHealth {
  key: string;            // internal key: 'sales' | 'labour' | ...
  label: string;          // display: 'Sales' | 'Labour' | ...
  status: DataSourceStatus;
  lastSuccess: string | null;   // ISO timestamp of last successful record
  lastAttempt: string | null;   // ISO timestamp of last attempted sync
  dataAgeMinutes: number | null;
  trust: TrustLevel;
  action: string;               // recommended operator action
}

export interface MicrosHealth {
  connected: boolean;
  connectionId: string | null;
  locationRef: string | null;
  serverUrl: string | null;
  lastSalesSync: string | null;
  lastLabourSync: string | null;
  lastInventorySync: string | null;
  lastError: string | null;
}

export interface JobHealth {
  id: string;
  label: string;
  jobType: string;
  lastRun: string | null;
  nextRun: string | null;
  status: JobStatus;
  failureCount: number;
  attemptCount: number;
  canRunNow: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  /** true = auto-checked based on live system state */
  auto: boolean;
  checked: boolean;
  category: "system" | "data" | "ops" | "reports";
}

export interface SystemIncident {
  id: string;
  source: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  status: "open" | "acknowledged" | "investigating" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  // Operator workflow fields (added in migration 091)
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  assignedTo?: string | null;
  resolvedBy?: string | null;
  operatorNotes?: string | null;
  escalationLevel?: "normal" | "elevated" | "urgent";
  updatedAt?: string | null;
}

export interface ErrorHealth {
  sentryConfigured: boolean;
  syncFailures24h: number;
  deadLetterJobs: number;
  lastException: string | null;
}

export interface SystemHealthPayload {
  overallStatus: OverallStatus;
  summary: string;
  /** ISO timestamp of the last successful sync across all sources */
  lastSuccessfulSync: string | null;
  failedJobs24h: number;
  openCriticalActions: number;
  /** 0–100 weighted freshness score across all data sources */
  dataFreshnessScore: number;
  dataSources: DataSourceHealth[];
  micros: MicrosHealth;
  jobs: JobHealth[];
  errors: ErrorHealth;
  checklist: ChecklistItem[];
  incidents: SystemIncident[];
  checkedAt: string;
}
