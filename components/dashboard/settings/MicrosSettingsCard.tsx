"use client";

/**
 * MicrosSettingsCard — integration configuration card
 *
 * Matches the existing admin settings aesthetic:
 *   rounded-lg border border-stone-200 bg-white p-6
 *   text-base font-semibold text-stone-800 section headings
 *   dl / dt / dd pattern for read-only display
 *   form rows using the same font-size and spacing
 */

import { useState, useRef } from "react";
import { useRouter }         from "next/navigation";
import { cn }                from "@/lib/utils";
import type { MicrosConnection } from "@/types/micros";
import type { MicrosIntegrationStatus, IntegrationHealth } from "@/lib/integrations/status";
import { sanitizeMicrosError }                            from "@/lib/integrations/status";

// ── Status chip ───────────────────────────────────────────────────────────

const HEALTH_STYLES: Record<IntegrationHealth, string> = {
  connected:      "bg-green-50  text-green-700  ring-green-200",
  degraded:       "bg-amber-50  text-amber-700  ring-amber-200",
  not_configured: "bg-stone-100 text-stone-500  ring-stone-200",
  auth_failed:    "bg-red-50    text-red-700    ring-red-200",
  awaiting_setup: "bg-stone-100 text-stone-500  ring-stone-200",
  disabled:       "bg-stone-100 text-stone-500  ring-stone-200",
  syncing:        "bg-sky-50    text-sky-700    ring-sky-200",
};

const HEALTH_DOT: Record<IntegrationHealth, string> = {
  connected:      "bg-green-500",
  degraded:       "bg-amber-500",
  not_configured: "bg-stone-400",
  auth_failed:    "bg-red-500",
  awaiting_setup: "bg-stone-400",
  disabled:       "bg-stone-400",
  syncing:        "bg-sky-500 animate-pulse",
};

function ConnectionChip({ health, label }: { health: IntegrationHealth; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        HEALTH_STYLES[health],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", HEALTH_DOT[health])} />
      {label}
    </span>
  );
}

// ── Form input style ──────────────────────────────────────────────────────

const fieldCls =
  "block w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-300";

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  connection:   MicrosConnection | null;
  microsHealth: MicrosIntegrationStatus;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; stage?: string; reasonCode?: string; message: string };

// ── Component ─────────────────────────────────────────────────────────────

export default function MicrosSettingsCard({ connection: initial, microsHealth }: Props) {
  const router  = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [connection, setConnection] = useState<MicrosConnection | null>(initial);
  const [saveState,  setSaveState]  = useState<SaveState>({ status: "idle" });
  const [testState,  setTestState]  = useState<TestState>({ status: "idle" });
  const [editing,    setEditing]    = useState(!initial);

  // ── Save handler ────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveState({ status: "saving" });

    const fd = new FormData(e.currentTarget);
    const payload = {
      id:              connection?.id,
      location_name:   (fd.get("location_name") as string).trim(),
      loc_ref:         (fd.get("loc_ref") as string).trim(),
      auth_server_url: (fd.get("auth_server_url") as string).trim(),
      app_server_url:  (fd.get("app_server_url") as string).trim(),
      client_id:       (fd.get("client_id") as string).trim(),
      org_identifier:  (fd.get("org_identifier") as string).trim(),
    };

    try {
      const res  = await fetch("/api/micros/settings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setSaveState({ status: "error", message: json.error ?? "Failed to save." });
        return;
      }
      setConnection(json.connection);
      setSaveState({ status: "success", message: "Configuration saved." });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setSaveState({ status: "error", message: err instanceof Error ? err.message : "Unexpected error." });
    }
  }

  // ── Test connection handler ─────────────────────────────────────────────

  async function handleTestConnection() {
    setTestState({ status: "testing" });
    try {
      const res  = await fetch("/api/micros/test-connection", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({}),
      });
      const json = await res.json();
      if (json.ok) {
        setTestState({ status: "success", message: json.message ?? "Authentication successful and BI API is reachable." });
        setConnection((prev) =>
          prev ? { ...prev, status: "connected" } : prev,
        );
        router.refresh();
      } else {
        setTestState({
          status:     "error",
          stage:      json.stage,
          reasonCode: json.reasonCode,
          message:    json.userMessage ?? json.message ?? json.error ?? "Connection test failed.",
        });
      }
    } catch (err) {
      setTestState({ status: "error", message: err instanceof Error ? err.message : "Unexpected error." });
    }
  }

  // ── Manual sync handler ─────────────────────────────────────────────────

  async function handleSync() {
    setTestState({ status: "testing" });
    try {
      const res  = await fetch("/api/micros/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setTestState({ status: "success", message: "Sync completed successfully." });
        router.refresh();
      } else {
        setTestState({ status: "error", message: json.error ?? "Sync failed." });
      }
    } catch (err) {
      setTestState({ status: "error", message: err instanceof Error ? err.message : "Unexpected error." });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      day:      "2-digit",
      month:    "short",
      year:     "numeric",
      hour:     "2-digit",
      minute:   "2-digit",
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-6">

      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-stone-800">
            Oracle MICROS BI
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Live POS data — sales, labour, guest checks.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConnectionChip health={microsHealth.health} label={microsHealth.label} />
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Read-only state */}
      {!editing && connection && (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="Location"       value={connection.location_name || "—"} />
          <Row label="Location ref"   value={connection.loc_ref || "—"} />
          <Row label="Auth server"    value={obfuscate(connection.auth_server_url)} />
          <Row label="App server"     value={obfuscate(connection.app_server_url)} />
          <Row label="Client ID"      value={connection.client_id ? `${connection.client_id.slice(0, 8)}…` : "—"} />
          <Row label="Org identifier" value={connection.org_identifier || "—"} />
        </dl>
      )}

      {/* No connection yet */}
      {!editing && !connection && (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
          <p className="text-sm font-medium text-stone-500">Not configured</p>
          <p className="mt-1 text-xs text-stone-400">Enter your Oracle MICROS credentials to enable live POS sync.</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-4 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700 transition-colors"
          >
            Set up MICROS
          </button>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <form ref={formRef} onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Location name" name="location_name" placeholder="Si Cantina — Pilot"
              defaultValue={connection?.location_name ?? ""} />
            <Field label="Location ref (locRef)" name="loc_ref" placeholder="e.g. 1"
              defaultValue={connection?.loc_ref ?? ""} />
            <Field label="Auth server URL" name="auth_server_url" type="url"
              placeholder="https://identity.oraclecloud.com"
              defaultValue={connection?.auth_server_url ?? ""} required />
            <Field label="App server URL" name="app_server_url" type="url"
              placeholder="https://yourinstance.oraclecloud.com"
              defaultValue={connection?.app_server_url ?? ""} required />
            <Field label="Client ID" name="client_id" placeholder="Oracle OAuth client ID"
              defaultValue={connection?.client_id ?? ""} required />
            <Field label="Org identifier" name="org_identifier" placeholder="Oracle org / tenant"
              defaultValue={connection?.org_identifier ?? ""} required />
          </div>

          <p className="text-xs text-stone-400">
            The API account username and password are configured via the{" "}
            <code className="font-mono bg-stone-100 px-1 rounded">MICROS_USERNAME</code> and{" "}
            <code className="font-mono bg-stone-100 px-1 rounded">MICROS_PASSWORD</code> server environment variables.
          </p>

          {/* Save feedback */}
          {saveState.status === "error" && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveState.message}
            </p>
          )}
          {saveState.status === "success" && (
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {saveState.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saveState.status === "saving"}
              className="rounded-md bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
            >
              {saveState.status === "saving" ? "Saving…" : "Save configuration"}
            </button>
            {connection && (
              <button
                type="button"
                onClick={() => { setEditing(false); setSaveState({ status: "idle" }); }}
                className="rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* Sync status & actions — shown when saved + not editing form */}
      {!editing && connection && (
        <>
          <div className="mt-6 border-t border-stone-100 pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Sync Status
            </h3>

            {/* Connection health summary */}
            {microsHealth.health !== "connected" && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-stone-100 bg-stone-50 px-4 py-3">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[microsHealth.health]}`} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-stone-700">{microsHealth.label}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{microsHealth.userMessage}</p>
                  {connection?.last_sync_error && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
                        Technical details
                      </summary>
                      <p className="mt-1 rounded-md border border-stone-100 bg-white px-2 py-1.5 font-mono text-xs text-stone-600 break-all">
                        {sanitizeMicrosError(connection.last_sync_error)}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            )}
            {microsHealth.health === "connected" && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-100 bg-green-50 px-4 py-3">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-green-500" />
                <div>
                  <p className="text-xs font-semibold text-stone-700">Live POS feed active</p>
                  <p className="mt-0.5 text-xs text-stone-500">{microsHealth.userMessage}</p>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-xs text-stone-500">Last successful sync</dt>
                <dd className="mt-0.5 font-medium text-stone-800">
                  {formatDate(connection.last_successful_sync_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Last sync attempt</dt>
                <dd className="mt-0.5 font-medium text-stone-800">
                  {formatDate(connection.last_sync_at)}
                </dd>
              </div>

            </dl>
          </div>

          {/* Test-connection / sync feedback */}
          {testState.status === "error" && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {testState.message}
            </div>
          )}
          {testState.status === "success" && (
            <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {testState.message}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testState.status === "testing"}
              className="flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", testState.status === "testing" ? "bg-sky-400 animate-pulse" : "bg-stone-400")} />
              {testState.status === "testing" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={testState.status === "testing"}
              className="flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              Sync now
            </button>
          </div>
        </>
      )}

      {/* Admin-only debug panel — hidden for unauthorized users */}
      <MicrosDebugPanel testState={testState} />
    </section>
  );
}

// ── Admin debug panel ─────────────────────────────────────────────────────

interface DebugConfigResponse {
  authServerPresent:       boolean;
  authServer:              string;
  biServerPresent:         boolean;
  biServer:                string | null;
  clientIdPresent:         boolean;
  clientIdLength:          number;
  clientIdFirst6:          string;
  clientIdLast6:           string;
  clientIdHasWhitespace:   boolean;
  clientIdHasNewline:      boolean;
  usernamePresent:         boolean;
  orgShortNamePresent:     boolean;
  locationRefPresent:      boolean;
  passwordPresent:         boolean;
  redirectUri:             string;
  microsEnabled:           boolean;
  environmentMismatch:     boolean;
  environmentMismatchWarning: string | null;
  checkedAt:               string;
}

/**
 * Production-safe admin debug panel.
 * Fetches /api/micros/debug-config — returns null for 401/403 (non-admin).
 * Never displays full client ID, password, tokens or raw secrets.
 */
function MicrosDebugPanel({ testState }: { testState: TestState }) {
  const [open,   setOpen]   = useState(false);
  const [cfg,    setCfg]    = useState<DebugConfigResponse | null>(null);
  const [loading, setLoad]  = useState(false);
  const [fetchErr, setErr]  = useState<string | null>(null);

  async function load() {
    setLoad(true);
    setErr(null);
    try {
      const res = await fetch("/api/micros/debug-config");
      if (res.status === 401 || res.status === 403) {
        // Not an admin — hide the panel permanently.
        setErr("__hidden__");
        return;
      }
      if (!res.ok) {
        setErr(`Endpoint returned HTTP ${res.status}`);
        return;
      }
      setCfg(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoad(false);
    }
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && cfg === null && fetchErr === null) load();
  }

  // Suppress entirely for non-admins.
  if (fetchErr === "__hidden__") return null;

  // Derive authorize result from last test state.
  const authorizeResult =
    testState.status === "success"    ? { label: "Passed", colour: "text-green-700" }
    : testState.status === "error" && testState.stage === "config" ? { label: "Config error", colour: "text-amber-700" }
    : testState.status === "error"    ? { label: "Failed", colour: "text-red-700" }
    : testState.status === "testing"  ? { label: "Running…", colour: "text-sky-700" }
    : null;

  const reasonCode =
    testState.status === "error" && testState.reasonCode
      ? testState.reasonCode
      : testState.status === "success"
      ? "—"
      : null;

  return (
    <div className="mt-6 border-t border-stone-100 pt-4">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            Admin Debug
          </span>
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
            Admin only
          </span>
        </span>
        <svg
          className={cn("h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform", open && "rotate-180")}
          viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
        >
          <path d="M8 10.94 2.03 5l.97-.94L8 9.06 13 4.06l.97.94L8 10.94Z" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/40 px-4 py-3 space-y-4">

          {/* Refresh button + last-checked timestamp */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-stone-400">
              {cfg ? `Checked: ${new Date(cfg.checkedAt).toLocaleTimeString("en-ZA")}` : "Not loaded"}
            </span>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {fetchErr && (
            <p className="text-xs text-red-600">{fetchErr}</p>
          )}

          {!cfg && !fetchErr && loading && (
            <p className="text-xs text-stone-400">Loading config…</p>
          )}

          {cfg && (
            <dl className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 text-xs">

              {/* Client ID diagnostics */}
              <DebugRow
                label="Client ID preview"
                value={`${cfg.clientIdFirst6}…${cfg.clientIdLast6}`}
                mono
              />
              <DebugRow
                label="Client ID length"
                value={`${cfg.clientIdLength} chars`}
                mono
              />
              <DebugRow
                label="Whitespace in client ID"
                value={cfg.clientIdHasWhitespace ? "Yes" : "No"}
                flag={cfg.clientIdHasWhitespace ? "warn" : "ok"}
              />
              <DebugRow
                label="Newline in client ID"
                value={cfg.clientIdHasNewline ? "Yes" : "No"}
                flag={cfg.clientIdHasNewline ? "warn" : "ok"}
              />

              {/* Environment */}
              <DebugRow
                label="Environment mismatch"
                value={cfg.environmentMismatch ? "Yes" : "No"}
                flag={cfg.environmentMismatch ? "warn" : "ok"}
              />
              {cfg.environmentMismatch && cfg.environmentMismatchWarning && (
                <div className="col-span-full rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  {cfg.environmentMismatchWarning}
                </div>
              )}

              {/* Presence flags */}
              <DebugRow label="Auth server"      value={cfg.authServerPresent  ? cfg.authServer : "Missing"} flag={cfg.authServerPresent  ? "ok" : "warn"} />
              <DebugRow label="BI server"        value={cfg.biServerPresent    ? (cfg.biServer ?? "—") : "Missing"} flag={cfg.biServerPresent ? "ok" : "warn"} />
              <DebugRow label="Username present" value={cfg.usernamePresent    ? "Yes" : "No"} flag={cfg.usernamePresent    ? "ok" : "warn"} />
              <DebugRow label="Password present" value={cfg.passwordPresent    ? "Yes" : "No"} flag={cfg.passwordPresent    ? "ok" : "warn"} />
              <DebugRow label="Org short name"   value={cfg.orgShortNamePresent ? "Yes" : "No"} flag={cfg.orgShortNamePresent ? "ok" : "warn"} />
              <DebugRow label="Location ref"     value={cfg.locationRefPresent  ? "Yes" : "No"} flag={cfg.locationRefPresent  ? "ok" : "warn"} />
              <DebugRow label="Redirect URI"     value={cfg.redirectUri}         mono />
              <DebugRow label="MICROS enabled"   value={cfg.microsEnabled ? "Yes" : "No"} flag={cfg.microsEnabled ? "ok" : "neutral"} />
            </dl>
          )}

          {/* Last test connection result */}
          {(authorizeResult || reasonCode) && (
            <div className="border-t border-amber-100 pt-3 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                Last connection test
              </p>
              <dl className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 text-xs">
                {authorizeResult && (
                  <DebugRow
                    label="Authorize stage"
                    value={authorizeResult.label}
                    flag={
                      authorizeResult.colour === "text-green-700" ? "ok"
                      : authorizeResult.colour === "text-red-700"   ? "warn"
                      : "neutral"
                    }
                  />
                )}
                {reasonCode !== null && (
                  <DebugRow label="Reason code" value={reasonCode} mono />
                )}
                {testState.status === "error" && testState.stage && (
                  <DebugRow label="Failed stage" value={testState.stage} mono />
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DebugRow({
  label,
  value,
  flag,
  mono,
}: {
  label: string;
  value: string;
  flag?: "ok" | "warn" | "neutral";
  mono?: boolean;
}) {
  const valueColour =
    flag === "ok"      ? "text-green-700"
    : flag === "warn"  ? "text-amber-700 font-semibold"
    : "text-stone-800";

  return (
    <div>
      <dt className="text-[10px] text-stone-400">{label}</dt>
      <dd className={cn("mt-0.5 break-all", mono ? "font-mono text-[11px]" : "text-xs", valueColour)}>
        {flag === "warn" && (
          <span className="mr-1 text-amber-500" aria-hidden="true">⚠</span>
        )}
        {flag === "ok" && (
          <span className="mr-1 text-green-500" aria-hidden="true">✓</span>
        )}
        {value}
      </dd>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-stone-900 break-all">{value}</dd>
    </div>
  );
}

function Field({
  label, name, placeholder, defaultValue, type = "text", required,
}: {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-stone-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className={fieldCls}
      />
    </div>
  );
}

function obfuscate(url: string | null | undefined): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url.slice(0, 40) + (url.length > 40 ? "…" : "");
  }
}
