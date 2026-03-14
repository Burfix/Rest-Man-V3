import { cn } from "@/lib/utils";

type Color = "blue" | "green" | "red" | "amber" | "stone" | "purple";

interface Props {
  children: React.ReactNode;
  color?: Color;
}

const colorMap: Record<Color, string> = {
  blue:   "bg-blue-50   text-blue-700   ring-blue-200",
  green:  "bg-green-50  text-green-700  ring-green-200",
  red:    "bg-red-50    text-red-700    ring-red-200",
  amber:  "bg-amber-50  text-amber-700  ring-amber-200",
  stone:  "bg-stone-100 text-stone-600  ring-stone-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
};

export default function Badge({ children, color = "stone" }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        colorMap[color]
      )}
    >
      {children}
    </span>
  );
}
