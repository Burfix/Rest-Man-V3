/**
 * SetupProgressSection — shown when one or more operational areas have no data.
 * Disappears automatically once all areas have at least one record.
 * Receives pre-fetched counts from the dashboard page (no extra queries).
 */

interface SetupItem {
  label: string;
  done: boolean;
  href: string;
  cta: string;
}

interface Props {
  hasEquipment: boolean;
  hasSales: boolean;
  hasReviews: boolean;
}

export default function SetupProgressSection({
  hasEquipment,
  hasSales,
  hasReviews,
}: Props) {
  const items: SetupItem[] = [
    {
      label: "Equipment inventory",
      done: hasEquipment,
      href: "/dashboard/maintenance",
      cta: "Add equipment",
    },
    {
      label: "Weekly sales upload",
      done: hasSales,
      href: "/dashboard/sales",
      cta: "Upload sales CSV",
    },
    {
      label: "Reviews imported",
      done: hasReviews,
      href: "/dashboard/reviews",
      cta: "Sync reviews",
    },
  ];

  const remaining = items.filter((i) => !i.done);
  if (remaining.length === 0) return null;

  const complete = items.length - remaining.length;
  const pct = Math.round((complete / items.length) * 100);

  return (
    <section
      aria-label="System setup progress"
      className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-900">
            System setup — {complete}/{items.length} areas active
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            Complete the steps below to unlock full operational visibility.
          </p>
        </div>
        <span className="shrink-0 text-lg font-bold text-amber-700">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                item.done
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-200 text-amber-800"
              }`}
            >
              {item.done ? "✓" : "!"}
            </span>
            {item.done ? (
              <span className="text-sm text-stone-500 line-through">
                {item.label}
              </span>
            ) : (
              <a
                href={item.href}
                className="text-sm font-medium text-amber-900 underline-offset-2 hover:underline"
              >
                {item.cta}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
