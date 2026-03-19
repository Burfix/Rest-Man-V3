/**
 * DailyOpsSummaryPanel — server component
 *
 * Morning (before 14:00 SAST): top 3 priorities for the day
 * Evening (14:00+ SAST):       completed / missed / score + 7-day history
 */

import { getDailyOpsSummary } from "@/services/ops/dailySummary";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXEC_EMOJI: Record<string, string> = {
  call:       "📞",
  message:    "💬",
  staffing:   "👥",
  compliance: "📋",
};

const IMPACT_CLASS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 ring-red-200",
  high:     "bg-orange-100 text-orange-700 ring-orange-200",
  medium:   "bg-amber-100 text-amber-700 ring-amber-200",
  low:      "bg-stone-100 text-stone-500 ring-stone-200",
};

const GRADE_CLASS: Record<ScoreGrade, string> = {
  A: "text-green-600",
  B: "text-lime-600",
  C: "text-amber-600",
  D: "text-orange-600",
  F: "text-red-600",
};

function fmtDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default async function DailyOpsSummaryPanel() {
  const summary = await getDailyOpsSummary();

  // ── Morning ─────────────────────────────────────────────────────────────────
  if (summary.mode === "morning") {
    return (
      <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
              ☀️ Morning Brief
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">{fmtDate(summary.date)}</p>
          </div>
          <div className="flex items-center gap-2">
            {summary.total_open > 3 && (
              <span className="text-xs text-stone-400">
                +{summary.total_open - 3} more open
              </span>
            )}
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
              Top {summary.top3.length} Priorities
            </span>
          </div>
        </div>

        {summary.top3.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-200 py-6 text-center">
            <p className="text-sm font-medium text-green-600">✓ No open actions</p>
            <p className="text-xs text-stone-400 mt-0.5">Great start — create actions as issues arise</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {summary.top3.map((action, i) => (
              <li
                key={action.id}
                className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm"
              >
                {/* Number badge */}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                  {i + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-900 leading-snug">
                    {action.title}
                  </p>
                  {action.description && (
                    <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">
                      {action.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {/* Impact */}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${
                        IMPACT_CLASS[action.impact_weight] ?? IMPACT_CLASS.low
                      }`}
                    >
                      {action.impact_weight}
                    </span>

                    {/* In progress indicator */}
                    {action.status === "in_progress" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                        In Progress
                      </span>
                    )}

                    {/* Execution type */}
                    {action.execution_type && (
                      <span className="text-xs text-stone-400">
                        {EXEC_EMOJI[action.execution_type]} {action.execution_type}
                      </span>
                    )}

                    {/* Assignee */}
                    {action.assigned_to && (
                      <span className="text-xs text-stone-400">👤 {action.assigned_to}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  // ── Evening ──────────────────────────────────────────────────────────────────
  const score = summary.ops_score;

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">🌙 Evening Debrief</h2>
          <p className="text-xs text-stone-500 mt-0.5">{fmtDate(summary.date)}</p>
        </div>
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
          Today&apos;s Summary
        </span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-3">
        {/* Completed */}
        <div className="rounded-lg border border-green-200 bg-white px-3 py-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-green-600">{summary.completed_today}</p>
          <p className="mt-0.5 text-xs font-medium text-stone-500">Completed</p>
        </div>

        {/* Missed */}
        <div
          className={`rounded-lg border bg-white px-3 py-3 text-center shadow-sm ${
            summary.missed_today > 0 ? "border-red-200" : "border-stone-200"
          }`}
        >
          <p
            className={`text-2xl font-bold ${
              summary.missed_today > 0 ? "text-red-500" : "text-stone-300"
            }`}
          >
            {summary.missed_today}
          </p>
          <p className="mt-0.5 text-xs font-medium text-stone-500">
            {summary.missed_today > 0 ? "Missed / Open" : "None missed"}
          </p>
        </div>

        {/* Score */}
        <div className="rounded-lg border border-indigo-200 bg-white px-3 py-3 text-center shadow-sm">
          {score ? (
            <>
              <p className={`text-2xl font-bold ${GRADE_CLASS[score.grade]}`}>
                {score.total}
                <span className="text-xs font-normal text-stone-400">/100</span>
              </p>
              <p className="mt-0.5 text-xs font-medium text-stone-500">
                Score — Grade {score.grade}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-stone-300">—</p>
              <p className="mt-0.5 text-xs font-medium text-stone-500">Score</p>
            </>
          )}
        </div>
      </div>

      {/* Score component breakdown */}
      {score && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { key: "revenue",     label: "Revenue",     max: 40, color: "bg-emerald-400" },
              { key: "labour",      label: "Labour",      max: 20, color: "bg-sky-400"     },
              { key: "compliance",  label: "Compliance",  max: 20, color: "bg-violet-400"  },
              { key: "maintenance", label: "Maintenance", max: 20, color: "bg-amber-400"   },
            ] as const
          ).map(({ key, label, max, color }) => {
            const comp  = score.components[key];
            const pct   = Math.round((comp.score / max) * 100);
            return (
              <div key={key} className="rounded-lg border border-stone-100 bg-white px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-stone-500">{label}</span>
                  <span className="text-xs font-semibold text-stone-700">
                    {comp.score}/{max}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 7-day history */}
      {summary.history.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">
            7-Day History
          </h3>
          <div className="overflow-x-auto rounded-lg border border-stone-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-stone-400">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-center font-medium">Done</th>
                  <th className="px-3 py-2 text-center font-medium">Missed</th>
                  <th className="px-3 py-2 text-center font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 bg-white">
                {summary.history.map((row) => (
                  <tr key={row.stat_date} className="text-stone-700">
                    <td className="px-3 py-2 font-medium">{fmtDate(row.stat_date)}</td>
                    <td className="px-3 py-2 text-center font-semibold text-green-600">
                      {row.total_completed}
                    </td>
                    <td
                      className={`px-3 py-2 text-center font-semibold ${
                        row.missed_actions > 0 ? "text-red-500" : "text-stone-300"
                      }`}
                    >
                      {row.missed_actions}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.ops_score != null ? (
                        <span className="font-semibold text-stone-700">{row.ops_score}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-stone-500">
                      {row.completion_rate_pct.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-stone-400 italic text-center py-2">
          No history yet — run daily reset to start recording
        </p>
      )}
    </div>
  );
}
