"use client";

/**
 * ActionTakenButton — Client component for marking a brain signal as actioned.
 * Small, stateful. Handles the POST /api/brain/action-taken call.
 */

import { useState } from "react";

type Props = {
  signalId: string;
  siteId:   string;
};

export default function ActionTakenButton({ signalId, siteId }: Props) {
  const [done,    setDone]    = useState(false);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch("/api/brain/action-taken", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ signalId, actionType: "manual_acknowledgment", notes: "" }),
      });
      setDone(true);
    } catch {
      // Silently fail — non-critical
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="text-[10px] font-mono text-emerald-400/70 pt-1">
        &#x2713; Actioned — brain will re-evaluate in 3 minutes
      </p>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="mt-1 text-[10px] font-mono text-stone-500 hover:text-stone-300 border border-[#2a2a2a] hover:border-stone-600 px-3 py-1.5 transition-colors disabled:opacity-40 cursor-pointer"
    >
      {pending ? "logging..." : "→ mark as actioned"}
    </button>
  );
}
