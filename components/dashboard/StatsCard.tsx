import { cn } from "@/lib/utils";

type Color = "blue" | "green" | "red" | "amber" | "stone";

interface Props {
  label: string;
  value: number | string;
  color?: Color;
}

const colorMap: Record<Color, string> = {
  blue:  "border-blue-100  bg-blue-50  text-blue-700",
  green: "border-green-100 bg-green-50 text-green-700",
  red:   "border-red-100   bg-red-50   text-red-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  stone: "border-stone-200 bg-stone-50 text-stone-700",
};

export default function StatsCard({ label, value, color = "stone" }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border px-5 py-4",
        colorMap[color]
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}
