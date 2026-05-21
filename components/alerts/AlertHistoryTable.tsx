"use client";

/**
 * components/alerts/AlertHistoryTable.tsx
 *
 * Displays the alert history with delivery status, send and acknowledge actions.
 */

import { useState } from "react";

interface AlertRow {
  id:              string;
  alert_type:      string;
  severity:        string;
  title:           string;
  status:          string;
  sent_at:         string | null;
  acknowledged_at: string | null;
  failed_reason:   string | null;
  retry_count:     number;
  created_at:      string;
  manager:         { name: string; role: string } | null;
}

interface Props {
  alerts:         AlertRow[];
  onSend:         (id: string, force?: boolean) => Promise<void>;
  onAcknowledge:  (id: string) => Promise<void>;
}

const STATUS_STYLES: Record<string, string> = {
  pending:      "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  sent:         "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  failed:       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  acknowledged: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
};

const SEVERITY_DOT: Record<string, string> = {
  info:     "bg-blue-400",
  warning:  "bg-amber-400",
  critical: "bg-red-500",
};

export function AlertHistoryTable({ alerts, onSend, onAcknowledge }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function withLoading(id: string, fn: () => Promise<void>) {
    setLoadingId(id);
    try { await fn(); } finally { setLoadingId(null); }
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 py-12 text-center">
        <p className="text-sm text-zinc-500">No alerts yet. Create one using the form.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-800">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Severity</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Issue</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Manager</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Type</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Sent</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 bg-white dark:bg-zinc-900">
          {alerts.map((alert) => (
            <tr key={alert.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              {/* Severity */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span
                    className={[
                      "inline-block h-2 w-2 rounded-full",
                      SEVERITY_DOT[alert.severity] ?? "bg-zinc-400",
                    ].join(" ")}
                  />
                  <span className="capitalize text-zinc-700 dark:text-zinc-300">{alert.severity}</span>
                </div>
              </td>

              {/* Title */}
              <td className="px-4 py-3 max-w-xs">
                <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{alert.title}</p>
                {alert.failed_reason && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate">
                    {alert.failed_reason.slice(0, 80)}
                  </p>
                )}
              </td>

              {/* Manager */}
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {alert.manager ? (
                  <span>{alert.manager.name}</span>
                ) : (
                  <span className="italic text-zinc-400">—</span>
                )}
              </td>

              {/* Type */}
              <td className="px-4 py-3">
                <span className="capitalize text-zinc-500">{alert.alert_type}</span>
              </td>

              {/* Status */}
              <td className="px-4 py-3">
                <span
                  className={[
                    "inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                    STATUS_STYLES[alert.status] ?? STATUS_STYLES.pending,
                  ].join(" ")}
                >
                  {alert.status}
                </span>
                {alert.retry_count > 0 && (
                  <span className="ml-1 text-xs text-zinc-400">×{alert.retry_count}</span>
                )}
              </td>

              {/* Sent at */}
              <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                {alert.sent_at ? formatTime(alert.sent_at) : "—"}
                {alert.acknowledged_at && (
                  <div className="text-xs text-green-600 dark:text-green-400">
                    ACK {formatTime(alert.acknowledged_at)}
                  </div>
                )}
              </td>

              {/* Actions */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {(alert.status === "pending" || alert.status === "failed") && (
                    <button
                      onClick={() => withLoading(alert.id, () => onSend(alert.id, alert.retry_count > 0))}
                      disabled={loadingId === alert.id}
                      className="rounded px-2 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 disabled:opacity-50 transition-colors"
                    >
                      {loadingId === alert.id ? "…" : alert.retry_count > 0 ? "Retry" : "Send"}
                    </button>
                  )}

                  {alert.status === "sent" && (
                    <>
                      <button
                        onClick={() => withLoading(alert.id, () => onAcknowledge(alert.id))}
                        disabled={loadingId === alert.id}
                        className="rounded px-2 py-1 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 disabled:opacity-50 transition-colors"
                      >
                        {loadingId === alert.id ? "…" : "Acknowledge"}
                      </button>
                      <button
                        onClick={() => withLoading(alert.id, () => onSend(alert.id, true))}
                        disabled={loadingId === alert.id}
                        className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 disabled:opacity-50 transition-colors"
                        title="Force resend (bypasses 30-min dedup)"
                      >
                        Resend
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-ZA", {
      day:    "numeric",
      month:  "short",
      hour:   "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Johannesburg",
    });
  } catch {
    return iso;
  }
}
