import { DailyOperationsDashboardSummary } from "@/types";
import DailyOpsSummaryCard from "@/components/dashboard/DailyOpsSummaryCard";
import Link from "next/link";

interface Props {
  summary: DailyOperationsDashboardSummary;
}

export default function DailyOpsSection({ summary }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">Daily Operations</h2>
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
