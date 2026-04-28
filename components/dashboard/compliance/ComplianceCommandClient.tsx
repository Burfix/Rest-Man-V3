"use client";

/**
 * ComplianceCommandClient — Head Office Compliance Command Center
 *
 * Six sections:
 *   1. Urgency Banner
 *   2. KPI Strip (5 metrics)
 *   3. Risk Radar + Audit Readiness (side-by-side)
 *   4. Tenant Compliance Grid
 *   5. Expiry Timeline (4 windows)
 *   6. Footer timestamp + refresh
 *
 * Data: single fetch to /api/compliance/engine/command (5 min auto-refresh)
 */

import { useEffect, useState, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = "CRITICAL" | "WARNING" | "INFO";
type ExpiryWindow = "EXPIRED" | "30_DAYS" | "60_DAYS" | "90_DAYS" | "OK";

type RiskItem = {
  tenant_id:          string;
  tenant:             string;
  precinct:           string | null;
  certificate_type:   string | null;
  certificate_id:     string;
  status:             string;
  expiry_date:        string | null;
  risk_level:         RiskLevel;
  recommended_action: string | null;
  action_owner:       string | null;
  action_deadline:    string | null;
};

type TenantSummaryItem = {
  tenant_id:          string;
  tenant:             string;
  precinct:           string | null;
  total_certificates: number;
  approved:           number;
  awaiting_review:    number;
  rejected:           number;
  expired:            number;
  missing:            number;
  expiring_30_days:   number;
  compliance_pct:     number | null;
};

type ExpiringItem = {
  certificate_id:    string;
  tenant_id:         string;
  tenant:            string;
  precinct:          string | null;
  certificate_type:  string;
  expiry_date:       string;
  expiry_window:     ExpiryWindow;
  days_until_expiry: number;
};

type CommandData = {
  headline:              string;
  compliance_pct:        number | null;
  total_tenants:         number;
  non_compliant_count:   number;
  expiring_soon_count:   number;
  awaiting_review_count: number;
  audit_readiness_pct:   number | null;
  critical_count:        number;
  warning_count:         number;
  top_risks:             RiskItem[];
  tenant_summaries:      TenantSummaryItem[];
  expiring_soon:         ExpiringItem[];
  generated_at:          string;
};

// ─── Icons ──────────────────────────────────────────────────────────────────────

function IcoFlame({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
function IcoAlert({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}
function IcoCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IcoShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IcoClock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
function IcoBuilding({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" />
      <path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" />
      <path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
    </svg>
  );
}
function IcoRefresh({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
function IcoClipboard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
  if (diff <= 0)  return "Immediate";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7)  return `${diff} days`;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "2-digit",
  });
}

type TenantStatus = "non-compliant" | "action-required" | "operating-normally";

function getTenantStatus(s: TenantSummaryItem): TenantStatus {
  if (s.expired > 0 || s.missing > 0) return "non-compliant";
  if (s.awaiting_review > 0 || s.rejected > 0) return "action-required";
  return "operating-normally";
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, variant = "neutral", icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "critical" | "warning" | "ok" | "neutral";
  icon?: React.ReactNode;
}) {
  const bg = {
    critical: "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40",
    warning:  "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40",
    ok:       "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40",
    neutral:  "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/40",
  }[variant];
  const valColor = {
    critical: "text-red-700 dark:text-red-300",
    warning:  "text-amber-700 dark:text-amber-300",
    ok:       "text-emerald-700 dark:text-emerald-300",
    neutral:  "text-slate-900 dark:text-slate-50",
  }[variant];
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${bg}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`text-3xl font-bold tabular-nums leading-none mt-0.5 ${valColor}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Risk row ─────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: RiskLevel }) {
  const cfg = {
    CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    WARNING:  "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    INFO:     "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  }[level];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${cfg}`}>
      {level}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    EXPIRED:         "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    MISSING:         "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    REJECTED:        "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    AWAITING_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    APPROVED:        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  };
  const label: Record<string, string> = {
    EXPIRED: "Expired", MISSING: "Required Missing", REJECTED: "Rejected",
    AWAITING_REVIEW: "Awaiting Review", APPROVED: "Approved",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cfg[status] ?? "bg-slate-100 text-slate-600"}`}>
      {label[status] ?? status}
    </span>
  );
}

function RiskRow({ risk }: { risk: RiskItem }) {
  return (
    <div className="px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors border-b border-slate-100 dark:border-slate-700/40 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{risk.tenant}</span>
            {risk.precinct && <span className="text-xs text-slate-400">{risk.precinct}</span>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {risk.certificate_type ?? "Unknown certificate"}
          </p>
          {risk.recommended_action && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              <span className="font-medium">Action:</span> {risk.recommended_action}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <RiskBadge level={risk.risk_level} />
          <StatusChip status={risk.status} />
          {risk.action_owner && (
            <span className="text-xs text-slate-400">
              Owner: <span className="font-medium">{risk.action_owner}</span>
            </span>
          )}
          {risk.action_deadline && (
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Due: {formatDeadline(risk.action_deadline)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Risk Radar Panel ─────────────────────────────────────────────────────────

function RiskRadarPanel({ risks }: { risks: RiskItem[] }) {
  const critical = risks.filter((r) => r.risk_level === "CRITICAL");
  const warning  = risks.filter((r) => r.risk_level === "WARNING");
  const info     = risks.filter((r) => r.risk_level === "INFO");

  if (risks.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
        <IcoShield className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No active risks</p>
        <p className="text-xs text-slate-400 mt-1">Precinct is operating within compliance target</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Risk Radar</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {risks.length} open issue{risks.length !== 1 ? "s" : ""} — sorted by severity
          </p>
        </div>
        <div className="flex gap-2">
          {critical.length > 0 && (
            <span className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400 px-2 py-0.5 rounded">
              {critical.length} Critical
            </span>
          )}
          {warning.length > 0 && (
            <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 px-2 py-0.5 rounded">
              {warning.length} Warning
            </span>
          )}
        </div>
      </div>

      {critical.length > 0 && (
        <div>
          <div className="px-5 py-2 bg-red-50/60 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/40">
            <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">
              Critical — Immediate Action Required
            </span>
          </div>
          {critical.map((r) => <RiskRow key={r.certificate_id} risk={r} />)}
        </div>
      )}

      {warning.length > 0 && (
        <div>
          <div className="px-5 py-2 bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/40">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              Warning — Action Required
            </span>
          </div>
          {warning.map((r) => <RiskRow key={r.certificate_id} risk={r} />)}
        </div>
      )}

      {info.length > 0 && (
        <div>
          <div className="px-5 py-2 bg-slate-50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/40">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Monitoring
            </span>
          </div>
          {info.map((r) => <RiskRow key={r.certificate_id} risk={r} />)}
        </div>
      )}
    </div>
  );
}

// ─── Audit Readiness Panel ───────────────────────────────────────────────────

function AuditReadinessPanel({ data }: { data: CommandData }) {
  const totalExpired  = data.tenant_summaries.reduce((n, s) => n + s.expired, 0);
  const totalMissing  = data.tenant_summaries.reduce((n, s) => n + s.missing, 0);
  const totalApproved = data.tenant_summaries.reduce((n, s) => n + s.approved, 0);
  const pct = data.audit_readiness_pct ?? 0;
  const pctColor =
    pct >= 80 ? "text-emerald-600 dark:text-emerald-400" :
    pct >= 60 ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400";
  const barColor =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";

  function AuditStat({ label, value, color }: { label: string; value: number; color: string }) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
        <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-5 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <IcoClipboard className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Audit Readiness</h3>
      </div>

      <div className="text-center py-5 border border-slate-100 dark:border-slate-700 rounded-lg mb-5">
        <p className={`text-5xl font-bold tabular-nums ${pctColor}`}>{pct}%</p>
        <p className="text-xs text-slate-400 mt-1.5">of certificates audit-ready</p>
        <div className="mt-3 mx-6 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex-1">
        <AuditStat
          label="Approved Certificates"
          value={totalApproved}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <AuditStat
          label="Awaiting Review"
          value={data.awaiting_review_count}
          color="text-blue-600 dark:text-blue-400"
        />
        <AuditStat
          label="Missing Required Documents"
          value={totalMissing}
          color="text-slate-600 dark:text-slate-300"
        />
        <AuditStat
          label="Expired Certificates"
          value={totalExpired}
          color="text-red-600 dark:text-red-400"
        />
      </div>
    </div>
  );
}

// ─── Compliance % bar ─────────────────────────────────────────────────────────

function ComplianceBar({ pct }: { pct: number }) {
  const color =
    pct >= 95 ? "bg-emerald-500" :
    pct >= 75 ? "bg-amber-500"   :
    "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300 w-8 text-right">
        {pct}%
      </span>
    </div>
  );
}

// ─── Tenant Status Badge ──────────────────────────────────────────────────────

function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const cfg = {
    "non-compliant":      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60",
    "action-required":    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/60",
    "operating-normally": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/60",
  }[status];
  const label = {
    "non-compliant":      "Non-Compliant",
    "action-required":    "Action Required",
    "operating-normally": "Operating Normally",
  }[status];
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg}`}>
      {label}
    </span>
  );
}

// ─── Tenant Card ──────────────────────────────────────────────────────────────

function TenantCard({ tenant }: { tenant: TenantSummaryItem }) {
  const status = getTenantStatus(tenant);
  const pct    = tenant.compliance_pct ?? 0;

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{tenant.tenant}</p>
          {tenant.precinct && (
            <p className="text-xs text-slate-400 mt-0.5">{tenant.precinct}</p>
          )}
        </div>
        <TenantStatusBadge status={status} />
      </div>

      <ComplianceBar pct={pct} />

      <div className="grid grid-cols-2 gap-1.5">
        {tenant.expired > 0 && (
          <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 rounded px-2 py-1">
            <span className="text-xs text-red-600 dark:text-red-400">Expired</span>
            <span className="text-xs font-bold text-red-700 dark:text-red-300">{tenant.expired}</span>
          </div>
        )}
        {tenant.missing > 0 && (
          <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/40 rounded px-2 py-1">
            <span className="text-xs text-slate-500">Required Missing</span>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{tenant.missing}</span>
          </div>
        )}
        {tenant.awaiting_review > 0 && (
          <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 rounded px-2 py-1">
            <span className="text-xs text-blue-600 dark:text-blue-400">Awaiting Review</span>
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{tenant.awaiting_review}</span>
          </div>
        )}
        {tenant.expiring_30_days > 0 && (
          <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
            <span className="text-xs text-amber-600 dark:text-amber-400">Expiry Risk</span>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{tenant.expiring_30_days}</span>
          </div>
        )}
        {tenant.approved > 0 && (
          <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1">
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Approved</span>
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{tenant.approved}</span>
          </div>
        )}
      </div>

      <button
        className="mt-auto pt-2.5 border-t border-slate-100 dark:border-slate-700/60 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-left transition-colors"
        type="button"
      >
        View Tenant →
      </button>
    </div>
  );
}

// ─── Expiry Window Group ──────────────────────────────────────────────────────

function ExpiryGroup({
  title, certs, borderColor, headingColor, bgColor,
}: {
  title:        string;
  certs:        ExpiringItem[];
  borderColor:  string;
  headingColor: string;
  bgColor:      string;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${borderColor}`}>
      <div className={`px-4 py-2.5 ${bgColor} border-b ${borderColor} flex items-center justify-between`}>
        <span className={`text-xs font-bold uppercase tracking-wide ${headingColor}`}>{title}</span>
        <span className="text-xs text-slate-400 tabular-nums">
          {certs.length} cert{certs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {certs.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-400 bg-white dark:bg-slate-800/20">
          None
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800/30 divide-y divide-slate-100 dark:divide-slate-700/40">
          {certs.map((c) => (
            <div
              key={c.certificate_id}
              className="px-4 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-700/20"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{c.tenant}</p>
                <p className="text-xs text-slate-400 truncate">{c.certificate_type}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-xs font-bold tabular-nums ${headingColor}`}>
                  {c.days_until_expiry <= 0 ? "Expired" : `${c.days_until_expiry}d`}
                </p>
                <p className="text-xs text-slate-400">{formatDate(c.expiry_date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-80 rounded-xl bg-slate-200 dark:bg-slate-700" />
        <div className="lg:col-span-2 h-80 rounded-xl bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-52 rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: {
  title:    string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ComplianceCommandClient() {
  const [data, setData]                   = useState<CommandData | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/compliance/engine/command");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) return <Skeleton />;

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <IcoAlert className="w-12 h-12 text-red-400" />
        <p className="text-sm text-slate-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-600 dark:text-blue-400 underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const pct = data.compliance_pct ?? 0;
  const severity =
    data.non_compliant_count > 0 ? "critical" :
    data.expiring_soon_count > 0 ? "warning"  :
    "ok";

  const bannerBg = {
    critical: "bg-red-600",
    warning:  "bg-amber-500",
    ok:       "bg-emerald-600",
  }[severity];

  const bannerIcon = {
    critical: <IcoFlame className="w-5 h-5 text-white/90 shrink-0" />,
    warning:  <IcoAlert className="w-5 h-5 text-white/90 shrink-0" />,
    ok:       <IcoCheck className="w-5 h-5 text-white/90 shrink-0" />,
  }[severity];

  const expiredGroup = data.expiring_soon.filter((e) => e.expiry_window === "EXPIRED");
  const exp30Group   = data.expiring_soon.filter((e) => e.expiry_window === "30_DAYS");
  const exp60Group   = data.expiring_soon.filter((e) => e.expiry_window === "60_DAYS");
  const exp90Group   = data.expiring_soon.filter((e) => e.expiry_window === "90_DAYS");
  const totalExpiryIssues = expiredGroup.length + exp30Group.length + exp60Group.length + exp90Group.length;

  return (
    <div className="space-y-8">

      {/* ── 1. Urgency Banner ────────────────────────────────────────────────── */}
      <div className={`${bannerBg} rounded-xl px-5 py-4 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          {bannerIcon}
          <div>
            <p className="text-white font-semibold text-sm leading-snug">{data.headline}</p>
            <p className="text-white/70 text-xs mt-0.5">
              {data.total_tenants} tenant{data.total_tenants !== 1 ? "s" : ""} in precinct
              {data.critical_count > 0 ? ` · ${data.critical_count} critical issue${data.critical_count !== 1 ? "s" : ""}` : ""}
              {data.warning_count  > 0 ? ` · ${data.warning_count} warning${data.warning_count !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          title="Refresh"
          className="text-white/60 hover:text-white transition-colors shrink-0"
        >
          <IcoRefresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── 2. KPI Strip ─────────────────────────────────────────────────────── */}
      <Section title="Precinct Health" subtitle="Live compliance metrics across all tenants">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPICard
            label="Compliance Score"
            value={`${pct}%`}
            sub="Precinct average"
            variant={pct >= 80 ? "ok" : pct >= 60 ? "warning" : "critical"}
            icon={<IcoShield className="w-3.5 h-3.5" />}
          />
          <KPICard
            label="Non-Compliant"
            value={data.non_compliant_count}
            sub={`of ${data.total_tenants} tenants`}
            variant={data.non_compliant_count > 0 ? "critical" : "ok"}
            icon={<IcoFlame className="w-3.5 h-3.5" />}
          />
          <KPICard
            label="Expiry Risk"
            value={data.expiring_soon_count}
            sub="Expiring within 90 days"
            variant={data.expiring_soon_count > 0 ? "warning" : "ok"}
            icon={<IcoClock className="w-3.5 h-3.5" />}
          />
          <KPICard
            label="Awaiting Review"
            value={data.awaiting_review_count}
            sub="Pending officer action"
            variant={data.awaiting_review_count > 0 ? "warning" : "ok"}
            icon={<IcoClipboard className="w-3.5 h-3.5" />}
          />
          <KPICard
            label="Audit Readiness"
            value={`${data.audit_readiness_pct ?? 0}%`}
            sub="Certificates approved"
            variant={
              (data.audit_readiness_pct ?? 0) >= 80 ? "ok"      :
              (data.audit_readiness_pct ?? 0) >= 60 ? "warning" :
              "critical"
            }
            icon={<IcoShield className="w-3.5 h-3.5" />}
          />
        </div>
      </Section>

      {/* ── 3. Risk Radar + Audit Readiness ──────────────────────────────────── */}
      <Section
        title="Risk Radar"
        subtitle="All open compliance issues grouped by severity"
      >
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-3">
            <RiskRadarPanel risks={data.top_risks} />
          </div>
          <div className="lg:col-span-2">
            <AuditReadinessPanel data={data} />
          </div>
        </div>
      </Section>

      {/* ── 4. Tenant Compliance Grid ─────────────────────────────────────────── */}
      <Section
        title="Tenant Compliance"
        subtitle={`${data.tenant_summaries.length} tenant${data.tenant_summaries.length !== 1 ? "s" : ""} · sorted by compliance score`}
      >
        {data.tenant_summaries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-12 text-center">
            <IcoBuilding className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">No tenants registered yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.tenant_summaries.map((t) => (
              <TenantCard key={t.tenant_id} tenant={t} />
            ))}
          </div>
        )}
      </Section>

      {/* ── 5. Expiry Timeline ────────────────────────────────────────────────── */}
      {totalExpiryIssues > 0 && (
        <Section
          title="Expiry Timeline"
          subtitle={`${totalExpiryIssues} certificate${totalExpiryIssues !== 1 ? "s" : ""} require attention`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <ExpiryGroup
              title="Expired"
              certs={expiredGroup}
              borderColor="border-red-200 dark:border-red-900/60"
              headingColor="text-red-700 dark:text-red-400"
              bgColor="bg-red-50/60 dark:bg-red-950/20"
            />
            <ExpiryGroup
              title="Next 30 Days"
              certs={exp30Group}
              borderColor="border-orange-200 dark:border-orange-900/60"
              headingColor="text-orange-700 dark:text-orange-400"
              bgColor="bg-orange-50/60 dark:bg-orange-950/20"
            />
            <ExpiryGroup
              title="Next 60 Days"
              certs={exp60Group}
              borderColor="border-amber-200 dark:border-amber-900/60"
              headingColor="text-amber-700 dark:text-amber-400"
              bgColor="bg-amber-50/60 dark:bg-amber-950/20"
            />
            <ExpiryGroup
              title="Next 90 Days"
              certs={exp90Group}
              borderColor="border-slate-200 dark:border-slate-700"
              headingColor="text-slate-600 dark:text-slate-400"
              bgColor="bg-slate-50 dark:bg-slate-800/30"
            />
          </div>
        </Section>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
        <span>
          {data.total_tenants} tenant{data.total_tenants !== 1 ? "s" : ""}
          {data.critical_count > 0 ? ` · ${data.critical_count} critical` : ""}
          {data.warning_count  > 0 ? ` · ${data.warning_count} warning`   : ""}
        </span>
        {lastRefreshed && (
          <span>
            Updated {lastRefreshed.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            {" · "}
            <button
              type="button"
              onClick={load}
              className="underline hover:text-slate-600 dark:hover:text-slate-200"
            >
              Refresh
            </button>
          </span>
        )}
      </div>
    </div>
  );
}