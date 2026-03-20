"use client";

/**
 * MicrosDebugPanel
 *
 * Production-safe admin-only panel that shows Oracle MICROS config diagnostics.
 * Data source: GET /api/micros/debug-config
 *
 * Never shows the full client ID, password, tokens, or raw secrets.
 * Conditionally rendered by the integrations page only for admin users.
 */

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DebugConfig {
  authServerPresent: boolean;
  authServer: string | null;
  biServerPresent: boolean;
  biServer: string | null;
  clientIdPresent: boolean;
  clientIdLength: number;
  clientIdFirst6: string;
  clientIdLast6: string;
  clientIdHasWhitespace: boolean;
  clientIdHasNewline: boolean;
  usernamePresent: boolean;
  passwordPresent: boolean;
  orgShortNamePresent: boolean;
  locationRefPresent: boolean;
  redirectUri: string;
  microsEnabled: boolean;
  environmentMismatch: boolean;
  environmentMismatchWarning: string | null;
  checkedAt: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: DebugConfig }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MicrosDebugPanel({
  lastSyncError,
  connectionStatus,
}: {
  lastSyncError: string | null | undefined;
  connectionStatus?: string | null;
}) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    setState({ status: "loading" });
    fetch("/api/micros/debug-config")
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setState({ status: "error", message: "Insufficient permissions." });
          return;
        }
        if (!res.ok) {
          setState({ status: "error", message: "HTTP " + res.status });
          return;
        }
        const data = (await res.json()) as DebugConfig;
        setState({ status: "ok", data });
      })
      .catch((err) => {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
  }, []);

  const reasonCode = deriveReasonCode(lastSyncError);

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          MICROS Debug Diagnostics
        </h3>
        <span className="ml-auto text-xs text-amber-500">Admin only</span>
      </div>

      {state.status === "loading" && (
        <p className="animate-pulse text-xs text-amber-600">
          Loading diagnostics...
        </p>
      )}

      {state.status === "error" && (
        <p className="text-xs text-red-600">Error: {state.message}</p>
      )}

      {state.status === "ok" && (
        <div className="space-y-4">
          {/* Client ID */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-amber-700">
              Client ID
            </p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-amber-100">
                <DiagRow
                  label="Preview"
                  value={
                    state.data.clientIdPresent
                      ? state.data.clientIdFirst6 +
                        "..." +
                        state.data.clientIdLast6
                      : "(not set)"
                  }
                  highlight={!state.data.clientIdPresent ? "error" : undefined}
                />
                <DiagRow
                  label="Length"
                  value={String(state.data.clientIdLength)}
                  highlight={
                    state.data.clientIdLength === 0 ? "error" : undefined
                  }
                />
                <DiagRow
                  label="Whitespace detected"
                  value={state.data.clientIdHasWhitespace ? "YES" : "No"}
                  highlight={
                    state.data.clientIdHasWhitespace ? "warn" : undefined
                  }
                />
                <DiagRow
                  label="Newline detected"
                  value={state.data.clientIdHasNewline ? "YES" : "No"}
                  highlight={
                    state.data.clientIdHasNewline ? "warn" : undefined
                  }
                />
              </tbody>
            </table>
          </div>

          {/* Servers */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-amber-700">
              Servers
            </p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-amber-100">
                <DiagRow
                  label="Auth server"
                  value={state.data.authServer ?? "(not set)"}
                  highlight={
                    !state.data.authServerPresent ? "error" : undefined
                  }
                />
                <DiagRow
                  label="BI server"
                  value={state.data.biServer ?? "(not set)"}
                />
                <DiagRow
                  label="Env mismatch"
                  value={state.data.environmentMismatch ? "YES" : "No"}
                  highlight={
                    state.data.environmentMismatch ? "warn" : undefined
                  }
                />
              </tbody>
            </table>
            {state.data.environmentMismatchWarning && (
              <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-100 px-2 py-1.5 text-xs text-amber-800">
                {state.data.environmentMismatchWarning}
              </p>
            )}
          </div>

          {/* Env vars present */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-amber-700">
              Env vars present
            </p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-amber-100">
                <DiagRow
                  label="MICROS_CLIENT_ID"
                  value={state.data.clientIdPresent ? "present" : "MISSING"}
                  highlight={
                    !state.data.clientIdPresent ? "error" : undefined
                  }
                />
                <DiagRow
                  label="MICROS_USERNAME"
                  value={state.data.usernamePresent ? "present" : "MISSING"}
                  highlight={
                    !state.data.usernamePresent ? "error" : undefined
                  }
                />
                <DiagRow
                  label="MICROS_PASSWORD"
                  value={state.data.passwordPresent ? "present" : "MISSING"}
                  highlight={
                    !state.data.passwordPresent ? "error" : undefined
                  }
                />
                <DiagRow
                  label="MICROS_ORG_SHORT_NAME"
                  value={state.data.orgShortNamePresent ? "present" : "missing"}
                  highlight={
                    !state.data.orgShortNamePresent ? "warn" : undefined
                  }
                />
                <DiagRow
                  label="MICROS_LOCATION_REF"
                  value={state.data.locationRefPresent ? "present" : "missing"}
                />
              </tbody>
            </table>
          </div>

          {/* Last test result */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-amber-700">
              Last test-connection result
            </p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-amber-100">
                <DiagRow label="Stage" value="token (password grant)" />
                <DiagRow
                  label="Connection status"
                  value={connectionStatus ?? "unknown"}
                  highlight={
                    connectionStatus === "connected" ? undefined : "warn"
                  }
                />
                <DiagRow
                  label="Reason code"
                  value={reasonCode ?? "—"}
                  highlight={
                    reasonCode && reasonCode !== "—" ? "warn" : undefined
                  }
                />
              </tbody>
            </table>
            {lastSyncError && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-amber-600 hover:text-amber-800">
                  Last error (sanitized)
                </summary>
                <p className="mt-1 break-all rounded-md border border-amber-200 bg-white px-2 py-1.5 font-mono text-xs text-stone-600">
                  {lastSyncError}
                </p>
              </details>
            )}
          </div>

          <p className="text-right text-xs text-amber-400">
            Checked:{" "}
            {new Date(state.data.checkedAt).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
            })}
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// DiagRow helper
// ---------------------------------------------------------------------------

function DiagRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "warn" | "error";
}) {
  const valueClass =
    highlight === "error"
      ? "font-semibold text-red-600"
      : highlight === "warn"
        ? "font-semibold text-amber-700"
        : "text-stone-700";

  return (
    <tr>
      <td className="py-1 pr-3 text-stone-500">{label}</td>
      <td className={"py-1 " + valueClass}>{value}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Derive a reasonCode from lastSyncError text
// ---------------------------------------------------------------------------

function deriveReasonCode(lastSyncError: string | null | undefined): string | null {
  if (!lastSyncError) return null;
  const e = lastSyncError.toLowerCase();
  if (
    e.includes("invalid_client_id") ||
    e.includes("client id was rejected") ||
    e.includes("client id rejected")
  )
    return "INVALID_CLIENT_ID";
  if (
    e.includes("invalid_grant") ||
    e.includes("invalid micros credentials")
  )
    return "INVALID_CREDENTIALS";
  if (
    e.includes("invalid_request") ||
    e.includes("authentication request invalid")
  )
    return "INVALID_REQUEST";
  if (e.includes("timed out")) return "TIMEOUT";
  return null;
}
