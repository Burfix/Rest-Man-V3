"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  {
    value: "operational",
    label: "Operational",
    badge: "bg-green-50 text-green-700 ring-green-200",
  },
  {
    value: "needs_attention",
    label: "Needs Attention",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  {
    value: "out_of_service",
    label: "Out of Service",
    badge: "bg-red-50 text-red-700 ring-red-200",
  },
] as const;

type Status = (typeof STATUS_OPTIONS)[number]["value"];

export default function EditStatusButton({
  equipmentId,
  currentStatus,
}: {
  equipmentId: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // position:fixed is viewport-relative — no scroll offset needed
      setDropPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        dropRef.current && !dropRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleSelect(newStatus: Status) {
    if (newStatus === currentStatus) { setOpen(false); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/maintenance/equipment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: equipmentId, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      router.refresh();
    } catch {
      alert("Could not update status. Please try again.");
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  const current = STATUS_OPTIONS.find((s) => s.value === currentStatus);

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        disabled={saving}
        title="Click to change status"
        className={cn(
          "rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-opacity",
          current?.badge ?? "bg-stone-100 text-stone-500 ring-stone-200",
          saving && "opacity-50 cursor-wait",
          !saving && "hover:opacity-80 cursor-pointer"
        )}
      >
        {saving ? "Saving…" : (current?.label ?? currentStatus)}
        {!saving && <span className="ml-1 opacity-50">▾</span>}
      </button>

      {open && dropPos && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
          className="w-44 rounded-lg border border-stone-200 bg-white shadow-lg"
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-stone-50",
                opt.value === currentStatus && "font-semibold"
              )}
            >
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                  opt.badge
                )}
              >
                {opt.label}
              </span>
              {opt.value === currentStatus && (
                <span className="ml-auto text-stone-400">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
