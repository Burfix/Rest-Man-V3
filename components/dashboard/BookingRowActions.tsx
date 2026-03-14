"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Reservation } from "@/types";

interface Props {
  reservation: Reservation;
}

type Action = "confirmed" | "cancelled" | "remind";

export default function BookingRowActions({ reservation }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isPending   = reservation.status === "pending";
  const isActive    = reservation.status === "pending" || reservation.status === "confirmed";
  const hasPhone    = !!reservation.phone_number &&
                      reservation.phone_number !== "website-no-phone";

  async function updateStatus(status: "confirmed" | "cancelled") {
    setLoading(status);
    try {
      const res = await fetch(`/api/bookings/${reservation.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notify: hasPhone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }
      setDone(status === "confirmed" ? "✓ Confirmed" : "✓ Cancelled");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setDone(`✗ ${msg}`);
    } finally {
      setLoading(null);
    }
  }

  async function sendReminder() {
    setLoading("remind");
    try {
      const res = await fetch(`/api/bookings/${reservation.id}/remind`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
      const { sent, reason } = json as { sent: boolean; reason?: string };
      setDone(sent ? "✓ Sent" : `— ${reason ?? "Not sent"}`);
    } catch (err) {
      setDone(`✗ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setLoading(null);
    }
  }

  // After an action, show the result label for 4s then reset
  if (done) {
    setTimeout(() => setDone(null), 4000);
    const isError = done.startsWith("✗");
    return (
      <span
        className={`text-xs font-medium ${
          isError ? "text-red-500" : "text-stone-500"
        }`}
      >
        {done}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {isPending && (
        <ActionButton
          onClick={() => updateStatus("confirmed")}
          loading={loading === "confirmed"}
          disabled={loading !== null}
          label="Confirm"
          loadingLabel="…"
          className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
        />
      )}

      {isActive && (
        <ActionButton
          onClick={() => updateStatus("cancelled")}
          loading={loading === "cancelled"}
          disabled={loading !== null}
          label="Cancel"
          loadingLabel="…"
          className="bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
        />
      )}

      {isActive && hasPhone && (
        <ActionButton
          onClick={sendReminder}
          loading={loading === "remind"}
          disabled={loading !== null}
          label="💬 Remind"
          loadingLabel="…"
          title="Send WhatsApp reminder"
          className="bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
        />
      )}
    </div>
  );
}

interface ButtonProps {
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
  label: string;
  loadingLabel: string;
  title?: string;
  className: string;
}

function ActionButton({
  onClick,
  loading,
  disabled,
  label,
  loadingLabel,
  title,
  className,
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${className}`}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}
