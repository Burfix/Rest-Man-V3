"use client";

import { useState, useRef, useTransition } from "react";
import { cn, formatShortDate } from "@/lib/utils";
import type { ComplianceItem, ComplianceDocument, ComplianceSummary, ComplianceStatus } from "@/types";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ComplianceStatus, {
  label: string;
  badge: string;
  ring: string;
  cardBorder: string;
  icon: string;
}> = {
  compliant: {
    label: "Compliant",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ring: "ring-emerald-400",
    cardBorder: "border-emerald-100",
    icon: "✓",
  },
  scheduled: {
    label: "Scheduled",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    ring: "ring-blue-400",
    cardBorder: "border-blue-100",
    icon: "📅",
  },
  due_soon: {
    label: "Due Soon",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    ring: "ring-amber-400",
    cardBorder: "border-amber-200",
    icon: "⚠",
  },
  in_progress: {
    label: "In Progress",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    ring: "ring-sky-400",
    cardBorder: "border-sky-100",
    icon: "↻",
  },
  expired: {
    label: "Expired",
    badge: "bg-red-50 text-red-700 ring-red-300",
    ring: "ring-red-500",
    cardBorder: "border-red-300",
    icon: "✗",
  },
  blocked: {
    label: "Blocked",
    badge: "bg-orange-50 text-orange-700 ring-orange-200",
    ring: "ring-orange-400",
    cardBorder: "border-orange-100",
    icon: "⊘",
  },
  unknown: {
    label: "Not Set Up",
    badge: "bg-stone-100 text-stone-500 ring-stone-200",
    ring: "ring-stone-300",
    cardBorder: "border-stone-200",
    icon: "?",
  },
};

// ── Category icons ────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  fire_certificate:    "🔥",
  health_inspection:   "🏥",
  pest_control:        "🐛",
  equipment_servicing: "🔧",
  liquor_licence:      "🍷",
  food_safety_training:"🍽️",
  electrical_compliance:"⚡",
  business_licence:    "📋",
  custom:              "📄",
};

function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? "📄";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function DaysChip({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days < 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        Due today
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        {days}d left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
      {days}d left
    </span>
  );
}

// ── Summary Header ────────────────────────────────────────────────────────────

function SummaryHeader({ summary }: { summary: ComplianceSummary }) {
  const pct = summary.compliance_pct;
  const barColor =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 50 ? "bg-amber-500" :
    "bg-red-500";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Score */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            Overall Compliance
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn(
              "text-4xl font-bold tabular-nums",
              pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"
            )}>
              {pct}%
            </span>
            <span className="text-sm text-stone-400">
              {summary.compliant + (summary.scheduled ?? 0)}/{summary.total - summary.unknown} managed
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-2 w-48 rounded-full bg-stone-100">
            <div
              className={cn("h-2 rounded-full transition-all", barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Stat pills */}
        <div className="flex flex-wrap gap-2">
          <StatPill label="Compliant"  value={summary.compliant}        color="emerald" />
          {(summary.scheduled ?? 0) > 0 && (
            <StatPill label="Scheduled" value={summary.scheduled ?? 0}  color="blue"    />
          )}
          <StatPill label="Due Soon"   value={summary.due_soon}         color="amber"   />
          <StatPill label="Expired"    value={summary.expired}          color="red"     />
          <StatPill label="Not Set Up" value={summary.unknown}          color="stone"   />
        </div>
      </div>

      {/* Critical banner */}
      {summary.expired > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="shrink-0 text-red-500">🚨</span>
          <p className="text-sm text-red-700 font-medium">
            <strong>{summary.expired} certificate{summary.expired > 1 ? "s are" : " is"} expired</strong>
            {" — "}
            {summary.critical_items.map((i) => i.display_name).join(", ")}.
            Renew immediately to avoid regulatory penalties.
          </p>
        </div>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "blue" | "amber" | "red" | "stone";
}) {
  const styles = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    blue:    "bg-blue-50 text-blue-700 ring-blue-200",
    amber:   "bg-amber-50 text-amber-700 ring-amber-200",
    red:     "bg-red-50 text-red-700 ring-red-200",
    stone:   "bg-stone-100 text-stone-500 ring-stone-200",
  };
  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1", styles[color])}>
      <span className="text-lg font-bold leading-none">{value}</span>
      <span>{label}</span>
    </div>
  );
}

// ── Edit Panel ────────────────────────────────────────────────────────────────

function EditPanel({
  item,
  onClose,
  onSaved,
}: {
  item: ComplianceItem;
  onClose: () => void;
  onSaved: (updated: ComplianceItem) => void;
}) {
  const [form, setForm] = useState({
    last_inspection_date: item.last_inspection_date ?? "",
    next_due_date:        item.next_due_date ?? "",
    responsible_party:    item.responsible_party ?? "",
    notes:                item.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          last_inspection_date: form.last_inspection_date || null,
          next_due_date:        form.next_due_date || null,
          responsible_party:    form.responsible_party || null,
          notes:                form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved({ ...data.item, documents: item.documents });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="form-label">Last Inspection Date</label>
          <input
            type="date"
            value={form.last_inspection_date}
            onChange={(e) => setForm((f) => ({ ...f, last_inspection_date: e.target.value }))}
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label">Next Due Date</label>
          <input
            type="date"
            value={form.next_due_date}
            onChange={(e) => setForm((f) => ({ ...f, next_due_date: e.target.value }))}
            className="form-input"
          />
        </div>
      </div>
      <div>
        <label className="form-label">Responsible Party</label>
        <input
          type="text"
          placeholder="e.g. City of Cape Town EHP, John Smith"
          value={form.responsible_party}
          onChange={(e) => setForm((f) => ({ ...f, responsible_party: e.target.value }))}
          className="form-input"
        />
      </div>
      <div>
        <label className="form-label">Notes</label>
        <textarea
          rows={2}
          placeholder="Any relevant notes..."
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="form-input"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-stone-300 px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Upload Panel ──────────────────────────────────────────────────────────────

function SchedulePanel({
  item,
  onClose,
  onSaved,
}: {
  item: ComplianceItem;
  onClose: () => void;
  onSaved: (updated: ComplianceItem) => void;
}) {
  const [form, setForm] = useState({
    scheduled_service_date: item.scheduled_service_date ?? "",
    scheduled_with:         item.scheduled_with ?? "",
    schedule_note:          "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClearing = !form.scheduled_service_date && !!item.scheduled_service_date;

  async function handleSave() {
    if (!isClearing && !form.scheduled_service_date) {
      setError("Please select a renewal date");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_service_date: form.scheduled_service_date || null,
          scheduled_with:         form.scheduled_with || null,
          schedule_note:          form.schedule_note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved({ ...data.item, documents: item.documents });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_service_date: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Clear failed");
      onSaved({ ...data.item, documents: item.documents });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <p className="text-xs font-semibold text-stone-700">📅 Schedule Renewal / Service</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="form-label">Renewal Date *</label>
          <input
            type="date"
            value={form.scheduled_service_date}
            onChange={(e) => setForm((f) => ({ ...f, scheduled_service_date: e.target.value }))}
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label">Provider / Vendor</label>
          <input
            type="text"
            placeholder="e.g. FireTech Solutions"
            value={form.scheduled_with}
            onChange={(e) => setForm((f) => ({ ...f, scheduled_with: e.target.value }))}
            className="form-input"
          />
        </div>
      </div>
      <div>
        <label className="form-label">Note (optional)</label>
        <input
          type="text"
          placeholder="e.g. Deposit paid, confirmed via email"
          value={form.schedule_note}
          onChange={(e) => setForm((f) => ({ ...f, schedule_note: e.target.value }))}
          className="form-input"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : item.scheduled_service_date ? "Update Schedule" : "Schedule Renewal"}
        </button>
        {item.scheduled_service_date && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Clear Schedule
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-md border border-stone-300 px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Upload Panel (certificate) ────────────────────────────────────────────────

function UploadPanel({
  item,
  onClose,
  onUploaded,
}: {
  item: ComplianceItem;
  onClose: () => void;
  onUploaded: (doc: ComplianceDocument) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please select a file.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("item_id", item.id);
      const res = await fetch("/api/compliance/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onUploaded(data.document);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
      <p className="text-xs font-semibold text-stone-700">Upload Certificate / Report</p>
      <div
        className="flex items-center gap-3 rounded-lg border-2 border-dashed border-stone-300 bg-white px-4 py-5 cursor-pointer hover:border-stone-400 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <span className="text-2xl">📎</span>
        <div>
          <p className="text-sm font-medium text-stone-700">
            {fileName ?? "Click to choose a file"}
          </p>
          <p className="text-xs text-stone-400">PDF, images, Word — max 10 MB</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleUpload}
          disabled={uploading || !fileName}
          className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-stone-300 px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Compliance Card ───────────────────────────────────────────────────────────

function ComplianceCard({
  item: initialItem,
  onDelete,
}: {
  item: ComplianceItem;
  onDelete: (id: string) => void;
}) {
  const [item, setItem] = useState<ComplianceItem>(initialItem);
  const [panel, setPanel] = useState<"edit" | "upload" | "schedule" | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);

  const cfg = STATUS_CONFIG[item.status];
  const days = daysUntil(item.next_due_date);

  function togglePanel(p: "edit" | "upload" | "schedule") {
    setPanel((prev) => (prev === p ? null : p));
  }

  async function handleDeleteDoc(docId: string) {
    setDeletingDoc(docId);
    try {
      await fetch(`/api/compliance/upload?doc_id=${docId}`, { method: "DELETE" });
      setItem((prev) => ({
        ...prev,
        documents: (prev.documents ?? []).filter((d) => d.id !== docId),
      }));
    } finally {
      setDeletingDoc(null);
    }
  }

  return (
    <div className={cn(
      "rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md",
      cfg.cardBorder,
      item.status === "expired" && "ring-1 ring-red-300"
    )}>
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-2xl shrink-0">{categoryIcon(item.category)}</span>
            <div className="min-w-0">
              <p className="font-semibold text-stone-900 text-sm leading-snug">{item.display_name}</p>
              {item.description && (
                <p className="mt-0.5 text-xs text-stone-400 line-clamp-2">{item.description}</p>
              )}
            </div>
          </div>
          {/* Status badge */}
          <span className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
            cfg.badge
          )}>
            <span>{cfg.icon}</span>
            {cfg.label}
          </span>
        </div>

        {/* Date fields */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-stone-400">Last Inspection</p>
            <p className="font-medium text-stone-700">
              {item.last_inspection_date ? formatShortDate(item.last_inspection_date) : "—"}
            </p>
          </div>
          <div>
            <p className="text-stone-400">Next Due</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium text-stone-700">
                {item.next_due_date ? formatShortDate(item.next_due_date) : "—"}
              </p>
              <DaysChip days={days} />
            </div>
          </div>
        </div>

        {/* Responsible party */}
        {item.responsible_party && (
          <p className="mt-2 text-xs text-stone-500">
            <span className="text-stone-400">Responsible: </span>{item.responsible_party}
          </p>
        )}

        {/* Scheduled service helper text */}
        {item.status === "scheduled" && item.scheduled_service_date && (
          <p className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-xs text-blue-700">
            📅 Service booked for {formatShortDate(item.scheduled_service_date)}
            {item.scheduled_with ? ` — ${item.scheduled_with}` : ""}. Certificate remains valid until{" "}
            {item.next_due_date ? formatShortDate(item.next_due_date) : "expiry"}.
          </p>
        )}

        {/* Notes */}
        {item.notes && (
          <p className="mt-1.5 text-xs text-stone-500 italic line-clamp-2">{item.notes}</p>
        )}

        {/* Documents */}
        {(item.documents?.length ?? 0) > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-stone-500">Certificates / Documents</p>
            {item.documents!.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-3 py-1.5 text-xs"
              >
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-blue-600 hover:underline min-w-0 truncate"
                >
                  <span>📎</span>
                  <span className="truncate">{doc.file_name}</span>
                </a>
                <button
                  onClick={() => handleDeleteDoc(doc.id)}
                  disabled={deletingDoc === doc.id}
                  className="shrink-0 text-stone-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Remove document"
                >
                  {deletingDoc === doc.id ? "…" : "✕"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          <button
            onClick={() => togglePanel("edit")}
            className={cn(
              "flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              panel === "edit"
                ? "border-stone-400 bg-stone-100 text-stone-800"
                : "border-stone-200 text-stone-600 hover:bg-stone-50"
            )}
          >
            ✏️ Edit Dates
          </button>
          <button
            onClick={() => togglePanel("upload")}
            className={cn(
              "flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              panel === "upload"
                ? "border-blue-400 bg-blue-50 text-blue-700"
                : "border-stone-200 text-stone-600 hover:bg-stone-50"
            )}
          >
            📎 Upload Certificate
          </button>

          {(item.status === "due_soon" || item.status === "expired" || item.status === "scheduled") && (
            <button
              onClick={() => togglePanel("schedule")}
              className={cn(
                "flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                panel === "schedule"
                  ? "border-blue-400 bg-blue-50 text-blue-700"
                  : "border-blue-100 text-blue-600 hover:bg-blue-50"
              )}
            >
              📅 {item.scheduled_service_date ? "Edit Schedule" : "Schedule Renewal"}
            </button>
          )}

          {!item.is_default && (
            <button
              onClick={() => onDelete(item.id)}
              className="ml-auto text-xs text-stone-400 hover:text-red-500 transition-colors"
              title="Remove this compliance item"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Slide-in panels */}
      <div className="px-4 pb-4">
        {panel === "edit" && (
          <EditPanel
            item={item}
            onClose={() => setPanel(null)}
            onSaved={(updated) => {
              setItem(updated);
              setPanel(null);
            }}
          />
        )}
        {panel === "upload" && (
          <UploadPanel
            item={item}
            onClose={() => setPanel(null)}
            onUploaded={(doc) => {
              setItem((prev) => ({
                ...prev,
                documents: [doc, ...(prev.documents ?? [])],
              }));
              setPanel(null);
            }}
          />
        )}
        {panel === "schedule" && (
          <SchedulePanel
            item={item}
            onClose={() => setPanel(null)}
            onSaved={(updated) => {
              setItem(updated);
              setPanel(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Add Custom Item Form ──────────────────────────────────────────────────────

function AddCustomItemForm({ onAdded, onClose }: { onAdded: (item: ComplianceItem) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    display_name: "",
    description: "",
    next_due_date: "",
    responsible_party: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!form.display_name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, category: "custom" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add item");
      onAdded(data.item);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-5">
      <h3 className="text-sm font-semibold text-stone-800 mb-4">Add Custom Compliance Item</h3>
      <div className="space-y-3">
        <div>
          <label className="form-label">Name *</label>
          <input
            type="text"
            placeholder="e.g. Environmental Impact Assessment"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label">Description</label>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="form-input"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Next Due Date</label>
            <input
              type="date"
              value={form.next_due_date}
              onChange={(e) => setForm((f) => ({ ...f, next_due_date: e.target.value }))}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Responsible Party</label>
            <input
              type="text"
              value={form.responsible_party}
              onChange={(e) => setForm((f) => ({ ...f, responsible_party: e.target.value }))}
              className="form-input"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="rounded-md bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add Item"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-stone-300 px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ComplianceHub Component ─────────────────────────────────────────────

interface Props {
  items: ComplianceItem[];
  summary: ComplianceSummary;
}

type FilterStatus = "all" | ComplianceStatus;

export default function ComplianceHub({ items: initialItems, summary: initialSummary }: Props) {
  const [items, setItems] = useState<ComplianceItem[]>(initialItems);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [, startTransition] = useTransition();

  // Recompute summary from current items
  const summary = computeLocalSummary(items);

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  // Sort: expired first, then due_soon, then compliant, then unknown — within each group by next_due_date
  const sorted = [...filtered].sort((a, b) => {
    const order: Record<ComplianceStatus, number> = {
    expired:     0,
    due_soon:    1,
    blocked:     2,
    scheduled:   3,
    in_progress: 4,
    compliant:   5,
    unknown:     6,
  };
    const diff = order[a.status] - order[b.status];
    if (diff !== 0) return diff;
    if (!a.next_due_date) return 1;
    if (!b.next_due_date) return -1;
    return a.next_due_date.localeCompare(b.next_due_date);
  });

  function handleDelete(id: string) {
    if (!confirm("Remove this compliance item?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/compliance/items/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <SummaryHeader summary={summary} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1">
          {([
            "all", "expired", "due_soon", "scheduled", "compliant", "unknown",
          ] as FilterStatus[]).map((f) => {
            const labels: Record<FilterStatus, string> = {
              all:         "All",
              expired:     "Expired",
              due_soon:    "Due Soon",
              scheduled:   "Scheduled",
              in_progress: "In Progress",
              blocked:     "Blocked",
              compliant:   "Compliant",
              unknown:     "Not Set Up",
            };
            const counts: Record<FilterStatus, number> = {
              all:         items.length,
              expired:     summary.expired,
              due_soon:    summary.due_soon,
              scheduled:   summary.scheduled ?? 0,
              in_progress: items.filter((i) => i.status === "in_progress").length,
              blocked:     items.filter((i) => i.status === "blocked").length,
              compliant:   summary.compliant,
              unknown:     summary.unknown,
            };
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                )}
              >
                {labels[f]} ({counts[f]})
              </button>
            );
          })}
        </div>

        {/* Add custom button */}
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
            showAddForm
              ? "border-stone-400 bg-stone-100 text-stone-800"
              : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
          )}
        >
          {showAddForm ? "✕ Cancel" : "+ Add Custom Item"}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <AddCustomItemForm
          onAdded={(newItem) => {
            setItems((prev) => [newItem, ...prev]);
            setShowAddForm(false);
          }}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Grid */}
      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 py-12 text-center">
          <p className="text-sm text-stone-500">No compliance items match this filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((item) => (
            <ComplianceCard key={item.id} item={item} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Local summary computation (client-side, avoids extra re-fetch) ────────────

function computeLocalSummary(items: ComplianceItem[]): ComplianceSummary {
  const s: ComplianceSummary = {
    total:           items.length,
    compliant:       0,
    scheduled:       0,
    due_soon:        0,
    expired:         0,
    unknown:         0,
    compliance_pct:  0,
    critical_items:  [],
    due_soon_items:  [],
    scheduled_items: [],
  };
  for (const item of items) {
    if (
      item.status === "compliant" || item.status === "scheduled" ||
      item.status === "due_soon"  || item.status === "expired"   ||
      item.status === "unknown"
    ) {
      s[item.status]++;
    }
    if (item.status === "expired")   s.critical_items.push(item);
    if (item.status === "due_soon")  s.due_soon_items.push(item);
    if (item.status === "scheduled") s.scheduled_items.push(item);
  }
  const rated = s.total - s.unknown;
  // Scheduled = proactively managed — treat as compliant for the percentage
  s.compliance_pct = rated > 0
    ? Math.round(((s.compliant + s.scheduled) / rated) * 100)
    : 0;
  return s;
}
