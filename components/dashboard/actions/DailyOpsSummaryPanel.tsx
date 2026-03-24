/**
 * DailyOpsSummaryPanel — server component
 *
 * Morning (before 14:00 SAST): top 3 priorities + active streaks
 * Evening (14:00+ SAST):       consequences → streak bar → KPIs → score bars → history → GM panel
 */

import { getDailyOpsSummary } from "@/services/ops/dailySummary";
import type { ScoreGrade } from "@/services/ops/operatingScore";
import type { Streak } from "@/services/ops/streaks";
import type { Consequence, ConsequenceSeverity } from "@/services/ops/consequences";
import type { GMPerformance } from "@/services/ops/gmPerformance";

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

// ── Streak bar ────────────────────────────────────────────────────────────────

function StreakBar({ streaks }: { streaks: Streak[] }) {
  if (streaks.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {streaks.map((s) => (
        <span
          key={s.type}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
            s.active
              ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-stone-50 text-stone-500 ring-stone-200"
          }`}
        >
          {s.emoji} {s.count} day{s.count === 1 ? "" : "s"} {s.label}
          {!s.active && <span className="text-stone-400 font-normal">(ended)</span>}
        </span>
      ))}
    </div>
  );
}

// ── Consequence banners ───────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<ConsequenceSeverity, string> = {
  critical: "border-red-300   bg-red-50   text-red-800",
  warning:  "border-amber-300 bg-amber-50 text-amber-900",
  watch:    "border-sky-300   bg-sky-50   text-sky-900",
};

const SEVERITY_BADGE: Record<ConsequenceSeverity, string> = {
  critical: "bg-red-100   text-red-700   ring-red-200",
  warning:  "bg-amber-100 text-amber-700 ring-amber-200",
  watch:    "bg-sky-100   text-sky-700   ring-sky-200",
};

function ConsequenceBanners({ consequences }: { consequences: Consequence[] }) {
  if (consequences.length === 0) return null;
  return (
    <div className="space-y-2">
      {consequences.map((c) => (
        <div
          key={c.id}
          className={`rounded-lg border px-4 py-3 ${SEVERITY_STYLES[c.severity]}`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset uppercase tracking-wide ${SEVERITY_BADGE[c.severity]}`}
                >
                  {c.severity}
                </span>
                <p className="text-sm font-semibold leading-snug">{c.headline}</p>
              </div>
              <p className="text-xs mt-1 opacity-80">{c.detail}</p>
              <p className="text-xs font-medium mt-1.5 opacity-90">→ {c.call_to_action}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── GM Performance panel ──────────────────────────────────────────────────────

const TREND_META: Record<string, { emoji: string; label: string; cls: string }> = {
  up:   { emoji: "↑", label: "Improving",   cls: "text-green-600" },
  down: { emoji: "↓", label: "Declining",   cls: "text-red-500"   },
  flat: { emoji: "→", label: "Stable",      cls: "text-stone-500" },
};

function GMPanel({ gm }: { gm: GMPerformance }) {
  const trend = gm.trend ? TREND_META[gm.trend] : null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
        👤 GM Performance
      </h3>

      {/* Score + trend row */}
      <div className="flex items-center gap-4">
        {gm.today_score !== null ? (
          <div className="text-center">
            <p className="text-3xl font-bold text-stone-800">
              {gm.today_score}
              <span className="text-xs font-normal text-stone-400">/100</span>
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              Today{gm.today_grade ? ` — Grade ${gm.today_grade}` : ""}
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-3xl font-bold text-stone-300">—</p>
            <p className="text-xs text-stone-400 mt-0.5">No score yet</p>
          </div>
        )}

        <div className="flex-1 space-y-1">
          {/* 7-day sparkline — simple bar chart */}
          {gm.weekly_scores.length > 0 && (
            <div className="flex items-end gap-0.5 h-8">
              {[...gm.weekly_scores].reverse().map((d, i) => {
                const h = d.score != null ? Math.max(4, Math.round((d.score / 100) * 32)) : 4;
                const cls =
                  d.score == null              ? "bg-stone-100" :
                  d.score >= 80               ? "bg-green-400"  :
                  d.score >= 60               ? "bg-amber-400"  :
                                               "bg-red-400";
                return (
                  <div
                    key={i}
                    title={d.date + ": " + (d.score ?? "—")}
                    className={`flex-1 rounded-sm ${cls}`}
                    style={{ height: `${h}px` }}
                  />
                );
              })}
            </div>
          )}

          {/* WoW delta */}
          {gm.week_over_week !== null && trend && (
            <p className={`text-xs font-semibold ${trend.cls}`}>
              {trend.emoji} {Math.abs(gm.week_over_week).toFixed(1)} pts vs last week — {trend.label}
            </p>
          )}
          {gm.weekly_avg !== null && (
            <p className="text-xs text-stone-400">
              7-day avg: <span className="font-semibold text-stone-600">{gm.weekly_avg.toFixed(0)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
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

        {/* Streak bar (morning) */}
        {summary.streaks.streaks.length > 0 && (
          <div className="mb-4">
            <StreakBar streaks={summary.streaks.streaks} />
          </div>
        )}

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

      {/* Consequence banners — highest stakes, shown first */}
      {summary.consequences.consequences.length > 0 && (
        <ConsequenceBanners consequences={summary.consequences.consequences} />
      )}

      {/* Streak bar */}
      {summary.streaks.streaks.length > 0 && (
        <StreakBar streaks={summary.streaks.streaks} />
      )}

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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              { key: "revenue",     label: "Revenue",     max: 25, color: "bg-emerald-400" },
              { key: "labour",      label: "Labour",      max: 20, color: "bg-sky-400"     },
              { key: "food_cost",   label: "Food Cost",   max: 20, color: "bg-orange-400"  },
              { key: "compliance",  label: "Compliance",  max: 15, color: "bg-violet-400"  },
              { key: "maintenance", label: "Maintenance", max: 10, color: "bg-amber-400"   },
              { key: "daily_ops",   label: "Daily Ops",   max: 10, color: "bg-cyan-400"    },
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

      {/* GM Performance panel */}
      <GMPanel gm={summary.gm} />
    </div>
  );
}
