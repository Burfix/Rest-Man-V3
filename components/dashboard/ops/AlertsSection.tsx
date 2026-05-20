import Link from "next/link";
import { PriorityAlert } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  alerts: PriorityAlert[];
}

const severityConfig = {
  high: {
    container: "border-red-200 bg-red-50",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 ring-red-200",
    link: "text-red-700 hover:text-red-900",
    label: "High",
  },
  medium: {
    container: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 ring-amber-200",
    link: "text-amber-700 hover:text-amber-900",
    label: "Medium",
  },
  low: {
    container: "border-blue-100 bg-blue-50",
    dot: "bg-blue-400",
    badge: "bg-blue-100 text-blue-700 ring-blue-200",
    link: "text-blue-700 hover:text-blue-900",
    label: "Low",
  },
} as const;

const typeIcon: Record<PriorityAlert["type"], string> = {
  escalation: "🚨",
  low_review: "⭐",
  urgent_repair: "🔧",
  out_of_service: "⛔",
  no_sales_upload: "📊",
  large_booking: "👥",
};

export default function AlertsSection({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <section>
        <SectionHeader title="Priority Alerts" />
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          ✓ No active alerts — all systems clear.
        </div>
      </section>
    );
  }

  const highAlerts = alerts.filter((a) => a.severity === "high");

  return (
    <section>
      <SectionHeader
        title="Priority Alerts"
        badge={
          highAlerts.length > 0
            ? `${highAlerts.length} high`
            : undefined
        }
        badgeColor="red"
      />
      <div className="space-y-2">
        {alerts.map((alert, i) => {
          const cfg = severityConfig[alert.severity];
          return (
            <div
              key={`${alert.type}-${i}`}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3",
                cfg.container
              )}
            >
              {/* Severity dot */}
              <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", cfg.dot)} />

              {/* Icon */}
              <span className="text-base leading-none">{typeIcon[alert.type]}</span>

              {/* Summary */}
              <p className="flex-1 text-sm font-medium text-stone-800">
                {alert.summary}
              </p>

              {/* Severity badge */}
              <span
                className={cn(
                  "hidden shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset sm:inline-flex",
                  cfg.badge
                )}
              >
                {cfg.label}
              </span>

              {/* Action link */}
              <Link
                href={alert.href}
                className={cn(
                  "shrink-0 text-xs font-semibold uppercase tracking-wide",
                  cfg.link
                )}
              >
                View →
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Inline section header used here (shared header below for sub-components)
function SectionHeader({
  title,
  badge,
  badgeColor = "stone",
}: {
  title: string;
  badge?: string;
  badgeColor?: "red" | "stone";
}) {
  const badgeClasses =
    badgeColor === "red"
      ? "bg-red-100 text-red-700 ring-red-200"
      : "bg-stone-100 text-stone-600 ring-stone-200";

  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {badge && (
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            badgeClasses
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
