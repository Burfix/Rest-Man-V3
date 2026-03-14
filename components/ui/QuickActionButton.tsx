/**
 * QuickActionButton — compact row-level action button.
 *
 * Variants: primary (stone-900 fill), ghost (outline), danger (red outline)
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-stone-900 text-white hover:bg-stone-700",
  ghost:   "border border-stone-300 text-stone-700 hover:bg-stone-50 hover:border-stone-400",
  danger:  "border border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400",
};

interface Props {
  href?:     string;
  onClick?:  () => void;
  variant?:  Variant;
  children:  React.ReactNode;
  className?: string;
}

export default function QuickActionButton({
  href,
  onClick,
  variant  = "ghost",
  children,
  className,
}: Props) {
  const base = cn(
    "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0",
    VARIANTS[variant],
    className
  );

  if (href) {
    return <Link href={href} className={base}>{children}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  );
}
