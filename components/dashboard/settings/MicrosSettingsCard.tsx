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
  | { status: "error"; stage?: string; message: string };

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
          status:  "error",
          stage:   json.stage,
          message: json.message ?? json.error ?? "Connection test failed.",
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
    </section>
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
