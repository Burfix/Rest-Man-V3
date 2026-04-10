"use client";

import { useEffect, useState } from "react";

interface ImpersonationState {
  impersonating: boolean;
  targetEmail?: string;
  targetRole?: string;
  targetUserId?: string;
  realEmail?: string;
}

export default function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    fetch("/api/admin/impersonate/status")
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => setState(null));
  }, []);

  if (!state?.impersonating) return null;

  async function endImpersonation() {
    setEnding(true);
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
      // Hard reload to fully clear client-side state and caches
      window.location.href = "/dashboard/admin";
    } catch {
      setEnding(false);
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-black text-sm font-medium flex items-center justify-between px-4 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="text-base">🎭</span>
        <span>
          Impersonating <strong>{state.targetEmail}</strong>
          {state.targetRole && (
            <span className="opacity-75"> ({state.targetRole})</span>
          )}
        </span>
      </div>
      <button
        onClick={endImpersonation}
        disabled={ending}
        className="bg-black/20 hover:bg-black/30 text-black font-semibold px-3 py-1 rounded transition-colors text-xs"
      >
        {ending ? "Returning…" : "← Return to your account"}
      </button>
    </div>
  );
}
