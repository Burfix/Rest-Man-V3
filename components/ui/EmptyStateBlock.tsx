/**
 * EmptyStateBlock — clean empty state with optional icon, title, body, and CTA.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  icon?:    string;
  title:    string;
  body?:    string;
  cta?:     { label: string; href: string };
  compact?: boolean;
  className?: string;
}

export default function EmptyStateBlock({
  icon,
  title,
  body,
  cta,
  compact,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 bg-stone-50 text-center",
        compact ? "py-6 px-4" : "py-10 px-6",
        className
      )}
    >
      {icon && (
        <span className={cn("mb-3", compact ? "text-2xl" : "text-3xl")}>{icon}</span>
      )}
      <p className={cn("font-semibold text-stone-600", compact ? "text-xs" : "text-sm")}>
        {title}
      </p>
      {body && (
        <p className={cn("mt-1 text-stone-500 dark:text-stone-400", compact ? "text-[11px]" : "text-xs")}>
          {body}
        </p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-3 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700 transition-colors"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
