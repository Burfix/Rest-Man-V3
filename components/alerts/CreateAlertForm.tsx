"use client";

/**
 * components/alerts/CreateAlertForm.tsx
 *
 * Form for creating a manager WhatsApp alert.
 * Supports site selection (HQ users), manager selection, severity, type, and message.
 */

import { useState } from "react";
import type { ManagerContact, AlertType, AlertSeverity, AlertSource } from "@/types/manager-alerts";

interface Site {
  id:   string;
  name: string;
}

interface Props {
  contacts:       ManagerContact[];
  sites:          Site[];
  currentSiteId:  string;
  isHq:           boolean;
  prefill?: {
    incident_id?: string;
    title?:       string;
    severity?:    string;
    source?:      string;
  };
  onSubmit: (payload: {
    site_id:    string;
    manager_id: string;
    alert_type: AlertType;
    severity:   AlertSeverity;
    source:     AlertSource;
    title:      string;
    message:    string;
    send_now:   boolean;
  }) => Promise<void>;
}

const ALERT_TYPES: { value: AlertType; label: string }[] = [
  { value: "labour",      label: "Labour"      },
  { value: "revenue",     label: "Revenue"      },
  { value: "compliance",  label: "Compliance"   },
  { value: "maintenance", label: "Maintenance"  },
  { value: "incident",    label: "Incident"     },
  { value: "inventory",   label: "Inventory"    },
  { value: "sync",        label: "Sync / Data"  },
  { value: "custom",      label: "Custom"       },
];

const SEVERITIES: { value: AlertSeverity; label: string; colour: string }[] = [
  { value: "info",     label: "Info",     colour: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
  { value: "warning",  label: "Warning",  colour: "text-amber-600 bg-amber-50 dark:bg-amber-900/20" },
  { value: "critical", label: "Critical", colour: "text-red-600 bg-red-50 dark:bg-red-900/20" },
];

const SUGGESTED_ACTIONS: Partial<Record<AlertType, string>> = {
  labour:      "Please check MICROS labour sync and confirm staffing data.",
  revenue:     "Please review live revenue and confirm register activity.",
  compliance:  "Please complete outstanding compliance checklist items.",
  maintenance: "Please inspect and address the reported maintenance issue.",
  incident:    "Please acknowledge the incident and provide an update.",
  sync:        "Please check the integration status and retry sync if needed.",
  inventory:   "Please review current stock levels and reconcile discrepancies.",
};

export function CreateAlertForm({ contacts, sites, currentSiteId, isHq, prefill, onSubmit }: Props) {
  const [siteId,     setSiteId]     = useState(currentSiteId);
  const [managerId,  setManagerId]  = useState("");
  const [alertType,  setAlertType]  = useState<AlertType>(
    (prefill?.source as AlertType | undefined) === "incident" ? "incident" : "labour"
  );
  const [severity,   setSeverity]   = useState<AlertSeverity>(
    (["info","warning","critical"].includes(prefill?.severity ?? "")) ? prefill!.severity as AlertSeverity : "warning"
  );
  const [title,      setTitle]      = useState(prefill?.title ?? "");
  const [message,    setMessage]    = useState(
    prefill?.title ? SUGGESTED_ACTIONS.incident ?? "" : ""
  );
  const [sendNow,    setSendNow]    = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Auto-fill suggested action when type changes
  function handleTypeChange(t: AlertType) {
    setAlertType(t);
    if (!message) {
      setMessage(SUGGESTED_ACTIONS[t] ?? "");
    }
  }

  const selectedContact = contacts.find((c) => c.id === managerId);

  // Message preview
  const preview = managerId && title
    ? [
        "[ForgeStack Alert]",
        `Site: ${sites.find((s) => s.id === siteId)?.name ?? currentSiteId}`,
        `Severity: ${severity === "critical" ? "🔴 Critical" : severity === "warning" ? "⚠️  Warning" : "ℹ️  Info"}`,
        `Issue: ${title}`,
        "",
        message,
      ].join("\n")
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!managerId || !title.trim() || !message.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        site_id:     siteId,
        manager_id:  managerId,
        alert_type:  alertType,
        severity,
        source:      prefill?.source ?? "manual",
        title:       title.trim(),
        message:     message.trim(),
        send_now:    sendNow,
        ...(prefill?.incident_id ? { incident_id: prefill.incident_id } : {}),
      });
      // Reset form
      setManagerId("");
      setTitle("");
      setMessage("");
      setSendNow(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {/* Site selector (HQ only) */}
      {isHq && sites.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Site
          </label>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-600 px-3 py-2 text-sm"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Manager */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Manager <span className="text-red-500">*</span>
        </label>
        {contacts.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">
            No active manager contacts for this site.
            Add contacts via Settings → Manager Contacts.
          </p>
        ) : (
          <select
            required
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-600 px-3 py-2 text-sm"
          >
            <option value="">Select manager…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.role}
              </option>
            ))}
          </select>
        )}
        {selectedContact && (
          <p className="mt-1 text-xs text-zinc-500">
            WhatsApp: {selectedContact.phone_whatsapp.slice(0, 4)}****
          </p>
        )}
      </div>

      {/* Alert type + severity (side by side) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Type
          </label>
          <select
            value={alertType}
            onChange={(e) => handleTypeChange(e.target.value as AlertType)}
            className="w-full rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-600 px-3 py-2 text-sm"
          >
            {ALERT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Severity
          </label>
          <div className="flex gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSeverity(s.value)}
                className={[
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium border transition-colors",
                  severity === s.value
                    ? `${s.colour} border-current`
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-500",
                ].join(" ")}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Issue title <span className="text-red-500">*</span>
        </label>
        <input
          required
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Labour sync stale for 4h"
          className="w-full rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-600 px-3 py-2 text-sm"
        />
      </div>

      {/* Message */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Message / action <span className="text-red-500">*</span>
        </label>
        <textarea
          required
          rows={3}
          value={message}
          maxLength={1200}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the issue and required action…"
          className="w-full rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 dark:border-zinc-600 px-3 py-2 text-sm resize-none"
        />
        <p className="mt-0.5 text-xs text-zinc-400 text-right">{message.length}/1200</p>
      </div>

      {/* Message preview */}
      {preview && (
        <div className="rounded-md bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs font-medium text-zinc-500 mb-1 uppercase tracking-wide">
            WhatsApp preview
          </p>
          <pre className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
            {preview}
          </pre>
          <p className="mt-1 text-xs text-zinc-400 italic">
            Reply ACK-{"{id}"} will be appended automatically.
          </p>
        </div>
      )}

      {/* Send now toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={sendNow}
          onChange={(e) => setSendNow(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
        />
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          Send via WhatsApp immediately
        </span>
      </label>

      <button
        type="submit"
        disabled={submitting || !managerId || !title.trim() || !message.trim()}
        className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "Sending…" : sendNow ? "Create & Send Alert" : "Create Alert"}
      </button>
    </form>
  );
}
