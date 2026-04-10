"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface MicrosConnection {
  auth_server_url: string;
  app_server_url: string;
  client_id: string;
  org_identifier: string;
  loc_ref: string;
  username: string;
  location_name: string;
  status: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

interface Props {
  storeId: string;
  storeName: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MicrosConfigModal({ storeId, storeName, open, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    auth_server_url: "",
    app_server_url: "",
    client_id: "",
    org_identifier: "",
    loc_ref: "",
    username: "",
    password: "",
    location_name: "",
  });

  // Fetch existing credentials when modal opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setTestResult(null);

    fetch(`/api/admin/integrations/${storeId}/micros`)
      .then((r) => r.json())
      .then((data) => {
        if (data.connection) {
          const c = data.connection;
          setForm({
            auth_server_url: c.auth_server_url || "",
            app_server_url: c.app_server_url || "",
            client_id: c.client_id || "",
            org_identifier: c.org_identifier || "",
            loc_ref: c.loc_ref || "",
            username: c.username || c.api_account_name || "",
            password: "", // Never returned from server
            location_name: c.location_name || "",
          });
        } else {
          setForm({
            auth_server_url: "",
            app_server_url: "",
            client_id: "",
            org_identifier: "",
            loc_ref: "",
            username: "",
            password: "",
            location_name: storeName,
          });
        }
      })
      .catch(() => setError("Failed to load existing credentials"))
      .finally(() => setLoading(false));
  }, [open, storeId, storeName]);

  if (!open) return null;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/admin/integrations/${storeId}/micros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_server_url: form.auth_server_url,
          client_id: form.client_id,
          username: form.username,
          password: form.password,
          org_identifier: form.org_identifier,
        }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success ?? false,
        message: data.message || data.error || "Unknown result",
      });
    } catch {
      setTestResult({ success: false, message: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/integrations/${storeId}/micros`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setSuccess("Credentials saved successfully");
      onSaved();
    } catch {
      setError("Request failed");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`Configure Micros for ${storeName}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-800 bg-stone-900 px-6 py-4 rounded-t-2xl">
          <div>
            <h2 className="text-base font-semibold text-stone-100">Configure Micros</h2>
            <p className="text-xs text-stone-500 mt-0.5">{storeName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {loading ? (
            <p className="text-sm text-stone-500 text-center py-8">Loading…</p>
          ) : (
            <>
              {/* Connection fields */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Oracle MICROS BI Credentials</h3>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-400 mb-1">Auth Server URL</label>
                    <input
                      className={inputClass}
                      placeholder="https://idcs-xxxx.identity.oraclecloud.com"
                      value={form.auth_server_url}
                      onChange={(e) => setForm({ ...form, auth_server_url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-400 mb-1">BI App Server URL</label>
                    <input
                      className={inputClass}
                      placeholder="https://xxxx.oracleindustry.com"
                      value={form.app_server_url}
                      onChange={(e) => setForm({ ...form, app_server_url: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-stone-400 mb-1">Client ID</label>
                      <input
                        className={inputClass}
                        placeholder="OAuth Client ID"
                        value={form.client_id}
                        onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-stone-400 mb-1">Org Identifier</label>
                      <input
                        className={inputClass}
                        placeholder="e.g. SCS"
                        value={form.org_identifier}
                        onChange={(e) => setForm({ ...form, org_identifier: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-400 mb-1">Location Ref</label>
                    <input
                      className={inputClass}
                      placeholder="e.g. 2000002"
                      value={form.loc_ref}
                      onChange={(e) => setForm({ ...form, loc_ref: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Auth credentials */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">API Account</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-400 mb-1">Username</label>
                    <input
                      className={inputClass}
                      placeholder="API account username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-400 mb-1">Password</label>
                    <input
                      type="password"
                      className={inputClass}
                      placeholder="••••••••"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-stone-600">Password is encrypted before storage. Never stored in plaintext.</p>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium",
                  testResult.success
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border border-red-500/30"
                )}>
                  {testResult.success ? "✓ " : "✗ "}{testResult.message}
                </div>
              )}

              {/* Error / success messages */}
              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-400">
                  {success}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex items-center justify-between border-t border-stone-800 px-6 py-4">
            <button
              onClick={handleTestConnection}
              disabled={testing || !form.auth_server_url || !form.client_id || !form.username || !form.password}
              className="rounded-lg border border-stone-700 px-4 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-stone-700 px-4 py-2 text-xs font-medium text-stone-400 hover:bg-stone-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.auth_server_url || !form.app_server_url || !form.client_id || !form.loc_ref || !form.username || !form.password}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save Credentials"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
