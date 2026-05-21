"use client";

/**
 * components/alerts/AlertsPageClient.tsx
 *
 * Client-side shell for the Manager Alerts dashboard.
 * Owns create/send/acknowledge state and renders the form + history table.
 */

import { useState, useTransition } from "react";
import { CreateAlertForm }  from "./CreateAlertForm";
import { AlertHistoryTable } from "./AlertHistoryTable";
import type { ManagerContact, ManagerAlertWithContact, AlertType, AlertSeverity, AlertSource } from "@/types/manager-alerts";

interface Site {
  id:   string;
  name: string;
}

interface AlertRow {
  id:              string;
  site_id:         string;
  manager_id:      string;
  alert_type:      string;
  severity:        string;
  source:          string;
  title:           string;
  message:         string;
  status:          string;
  sent_at:         string | null;
  acknowledged_at: string | null;
  failed_reason:   string | null;
  retry_count:     number;
  incident_id:     string | null;
  created_at:      string;
  updated_at:      string;
  manager:         { name: string; role: string } | null;
}

interface Props {
  initialAlerts:  AlertRow[];
  contacts:       ManagerContact[];
  sites:          Site[];
  currentSiteId:  string;
  isHq:           boolean;
  userId:         string;
  prefill?: {
    incident_id: string;
    title:       string;
    severity:    string;
    source:      string;
  };
}

export default function AlertsPageClient({
  initialAlerts,
  contacts,
  sites,
  currentSiteId,
  isHq,
  prefill,
}: Props) {
  const [alerts, setAlerts] = useState<AlertRow[]>(initialAlerts);
  const [tab, setTab]       = useState<"create" | "history">("create");
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [, startTransition] = useTransition();

  function showFeedback(type: "ok" | "error", message: string) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 5000);
  }

  async function handleCreate(payload: {
    site_id:    string;
    manager_id: string;
    alert_type: AlertType;
    severity:   AlertSeverity;
    source:     AlertSource;
    title:      string;
    message:    string;
    send_now:   boolean;
  }) {
    const res = await fetch("/api/manager-alerts", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showFeedback("error", data.error ?? "Failed to create alert");
      return;
    }

    const data = await res.json();
    const newAlert: AlertRow = {
      ...data.alert,
      manager: contacts.find((c) => c.id === data.alert.manager_id)
        ? { name: contacts.find((c) => c.id === data.alert.manager_id)!.name,
            role: contacts.find((c) => c.id === data.alert.manager_id)!.role }
        : null,
    };

    startTransition(() => {
      setAlerts((prev) => [newAlert, ...prev]);
    });

    const sentOk = data.sent?.ok;
    const skipped = data.sent?.skipped;

    if (payload.send_now) {
      if (sentOk) {
        showFeedback("ok", "Alert created and sent via WhatsApp.");
      } else if (skipped) {
        showFeedback("ok", `Alert created. Send skipped: ${data.sent?.reason ?? "dedup window"}`);
      } else {
        showFeedback("error", `Alert created but delivery failed: ${data.sent?.error ?? "unknown"}`);
      }
    } else {
      showFeedback("ok", "Alert created. Use Send to deliver via WhatsApp.");
    }

    setTab("history");
  }

  async function handleSend(alertId: string, force = false) {
    const res = await fetch(`/api/manager-alerts/${alertId}/send`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ force }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 409) {
      showFeedback("ok", data.reason ?? "Already sent within dedup window.");
      return;
    }

    if (!res.ok) {
      showFeedback("error", data.error ?? "Delivery failed");
      return;
    }

    setAlerts((prev) =>
      prev.map((a) => a.id === alertId ? { ...a, status: "sent", sent_at: new Date().toISOString() } : a)
    );
    showFeedback("ok", "Sent via WhatsApp.");
  }

  async function handleAcknowledge(alertId: string) {
    const res = await fetch(`/api/manager-alerts/${alertId}/acknowledge`, {
      method: "POST",
    });

    if (!res.ok) {
      showFeedback("error", "Failed to acknowledge alert");
      return;
    }

    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId
          ? { ...a, status: "acknowledged", acknowledged_at: new Date().toISOString() }
          : a
      )
    );
    showFeedback("ok", "Alert acknowledged.");
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        {(["create", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            ].join(" ")}
          >
            {t === "create" ? "Create Alert" : `History (${alerts.length})`}
          </button>
        ))}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={[
            "rounded-md px-4 py-2 text-sm",
            feedback.type === "ok"
              ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300",
          ].join(" ")}
        >
          {feedback.message}
        </div>
      )}

      {/* Content */}
      {tab === "create" ? (
        <CreateAlertForm
          contacts={contacts}
          sites={sites}
          currentSiteId={currentSiteId}
          isHq={isHq}
          prefill={prefill}
          onSubmit={handleCreate}
        />
      ) : (
        <AlertHistoryTable
          alerts={alerts}
          onSend={handleSend}
          onAcknowledge={handleAcknowledge}
        />
      )}
    </div>
  );
}
