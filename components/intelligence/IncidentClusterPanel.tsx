"use client";

/**
 * components/intelligence/IncidentClusterPanel.tsx
 *
 * Tier-6 Incident Intelligence Panel.
 *
 * Fetches /api/intelligence/incident-clusters and renders:
 *   - Vendor suspicion banner (when 3+ sites share a degradation source)
 *   - Incident cluster list (multi-site degradation windows)
 *   - Repeated failure list (same site/source fires 3+ times in 24h)
 *
 * Deterministic rules only — no AI/LLM interpretation.
 * Refreshes every 5 minutes. Manual refresh available.
 */

import { useEffect, useState, useCallback } from "react";
import type {
  CorrelationReport,
  IncidentCluster,
  RepeatedFailure,
} from "@/lib/intelligence/incident-correlator";

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(severity: string) {
  if (severity === "critical") return "text-red-600  bg-red-50  border-red-200";
  if (severity === "warning")  return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-slate-500 bg-slate-50 border-slate-200";
}

function severityDot(severity: string) {
  if (severity === "critical") return "bg-red-500";
  if (severity === "warning")  return "bg-amber-400";
  return "bg-slate-400";
}

function fmtWindow(minutes: number): string {
  if (minutes < 2)   return "< 1 min span";
  if (minutes < 60)  return `~${minutes} min span`;
  return `~${Math.round(minutes / 6) / 10}h span`;
}

function fmtAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)    return "just now";
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VendorSuspicionBanner({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
      <span className="mt-0.5 text-red-500 text-lg leading-none" aria-hidden>⚠</span>
      <div>
        <p className="text-sm font-semibold text-red-700">
          Probable vendor-side outage detected
        </p>
        <p className="text-xs text-red-600 mt-0.5">
          {count} degradation source{count > 1 ? "s are" : " is"} affecting 3 or more
          sites within a 2-hour window. This pattern is consistent with a third-party
          integration failure rather than individual site issues.
        </p>
      </div>
    </div>
  );
}

function ClusterRow({ cluster }: { cluster: IncidentCluster }) {
  const colorCls = severityColor(cluster.severity);
  const dotCls   = severityDot(cluster.severity);

  return (
    <div className={`rounded-lg border p-3 ${colorCls}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotCls}`} />
          <span className="text-sm font-medium">{cluster.label}</span>
          {cluster.isVendorSuspicion && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
              VENDOR SUSPECTED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs opacity-80">
          <span className="rounded bg-white/60 px-2 py-0.5 border">
            {cluster.affectedSiteCount} site{cluster.affectedSiteCount > 1 ? "s" : ""}
          </span>
          <span>{fmtWindow(cluster.windowMinutes)}</span>
          <span>{fmtAgo(cluster.latestAt)}</span>
        </div>
      </div>
    </div>
  );
}

function RepeatedFailureRow({ failure }: { failure: RepeatedFailure }) {
  const dotCls = severityDot(failure.severity);

  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
      <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotCls}`} />
      <div className="min-w-0 flex-1">
        <span className="text-sm text-slate-700 truncate">{failure.label}</span>
      </div>
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200 whitespace-nowrap">
        ×{failure.count} in 24h
      </span>
      <span className="text-xs text-slate-400 whitespace-nowrap">{fmtAgo(failure.lastAt)}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; report: CorrelationReport; fetchedAt: Date }
  | { status: "error"; message: string };

export default function IncidentClusterPanel() {
  const [state, setState] = useState<FetchState>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/intelligence/incident-clusters");
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState({ status: "error", message: json.error ?? "Request failed" });
        return;
      }
      setState({ status: "ok", report: json as CorrelationReport, fetchedAt: new Date() });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, []);

  // Initial load + 5-minute auto-refresh
  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Incident Intelligence
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Multi-site degradation correlation · 24h window
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.status === "ok" && (
            <span className="text-xs text-slate-400">
              {fmtAgo(state.fetchedAt.toISOString())}
            </span>
          )}
          <button
            onClick={load}
            disabled={state.status === "loading"}
            className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            {state.status === "loading" ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Loading skeleton ────────────────────────────────────────────── */}
      {(state.status === "idle" || state.status === "loading") && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-10 rounded-lg bg-slate-100" />
          ))}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {state.status === "error" && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
          {state.message}
        </p>
      )}

      {/* ── Report ──────────────────────────────────────────────────────── */}
      {state.status === "ok" && (() => {
        const { report } = state;
        const hasClusters  = report.clusters.length > 0;
        const hasRepeated  = report.repeatedFailures.length > 0;
        const hasAnything  = hasClusters || hasRepeated;

        return (
          <div className="space-y-4">

            {/* Vendor suspicion banner */}
            {report.vendorSuspicionCount > 0 && (
              <VendorSuspicionBanner count={report.vendorSuspicionCount} />
            )}

            {/* Empty state */}
            {!hasAnything && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-6 text-center">
                <p className="text-sm text-slate-500">No correlated incidents detected</p>
                <p className="text-xs text-slate-400 mt-1">
                  All sites are degrading independently or not at all.
                </p>
              </div>
            )}

            {/* Clusters */}
            {hasClusters && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Active Clusters
                  <span className="ml-2 normal-case font-normal text-slate-400">
                    ({report.clusters.length} source{report.clusters.length > 1 ? "s" : ""}, {report.totalOpenIncidents} open incident{report.totalOpenIncidents !== 1 ? "s" : ""})
                  </span>
                </p>
                <div className="space-y-2">
                  {report.clusters.map((cluster) => (
                    <ClusterRow key={cluster.sourceKey} cluster={cluster} />
                  ))}
                </div>
              </div>
            )}

            {/* Repeated failures */}
            {hasRepeated && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Repeated Failures
                  <span className="ml-2 normal-case font-normal text-slate-400">
                    (same source · same site · ≥3× in 24h)
                  </span>
                </p>
                <div className="space-y-1.5">
                  {report.repeatedFailures.map((f) => (
                    <RepeatedFailureRow key={`${f.siteId}::${f.sourceKey}`} failure={f} />
                  ))}
                </div>
              </div>
            )}

          </div>
        );
      })()}

    </div>
  );
}
