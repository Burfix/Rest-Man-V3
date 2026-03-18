import { DailyOperationsDashboardSummary } from "@/types";
import DailyOpsSummaryCard from "@/components/dashboard/DailyOpsSummaryCard";
import MicrosSourcePill   from "@/components/ui/MicrosSourcePill";
import Link from "next/link";

interface Props {
  summary:          DailyOperationsDashboardSummary;
  microsSource?:    "micros_live" | "csv_upload" | null;
  microsSyncedAt?:  string | null;
}

export default function DailyOpsSection({ summary, microsSource, microsSyncedAt }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-stone-900">Daily Operations</h2>
          {microsSource && (
            <MicrosSourcePill source={microsSource} syncedAt={microsSyncedAt} />
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/operations/history"
            className="text-xs font-medium text-stone-400 hover:text-stone-700"
          >
            History →
          </Link>
          <Link
            href="/dashboard/operations"
            className="rounded-lg bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-700"
          >
            Upload report
          </Link>
        </div>
      </div>
      <DailyOpsSummaryCard summary={summary} />
    </section>
  );
}
