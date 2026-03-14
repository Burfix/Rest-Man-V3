"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  equipmentId: string;
  onClose: () => void;
}

export default function LogRepairForm({ equipmentId, onClose }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    repair_date: new Date().toISOString().split("T")[0],
    contractor_name: "",
    contractor_company: "",
    contractor_phone: "",
    issue_reported: "",
    work_done: "",
    repair_cost: "",
    next_service_due: "",
  });

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.repair_date) return setError("Repair date is required.");

    setSaving(true);
    try {
      const res = await fetch("/api/maintenance/repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_id:       equipmentId,
          repair_date:        form.repair_date,
          contractor_name:    form.contractor_name.trim() || null,
          contractor_company: form.contractor_company.trim() || null,
          contractor_phone:   form.contractor_phone.trim() || null,
          issue_reported:     form.issue_reported.trim() || null,
          work_done:          form.work_done.trim() || null,
          repair_cost:        form.repair_cost ? Number(form.repair_cost) : null,
          next_service_due:   form.next_service_due || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log repair");
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      {/* Date + Cost */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">
            Repair Date <span className="text-red-500">*</span>
          </label>
          <input type="date" value={form.repair_date} onChange={e => set("repair_date", e.target.value)}
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Repair Cost (R)</label>
          <input type="number" min={0} step="0.01" value={form.repair_cost} onChange={e => set("repair_cost", e.target.value)}
            placeholder="e.g. 4800"
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
      </div>

      {/* Contractor */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Contractor Name</label>
          <input type="text" value={form.contractor_name} onChange={e => set("contractor_name", e.target.value)}
            placeholder="e.g. Raymond"
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Company</label>
          <input type="text" value={form.contractor_company} onChange={e => set("contractor_company", e.target.value)}
            placeholder="e.g. IceTech"
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Phone</label>
          <input type="tel" value={form.contractor_phone} onChange={e => set("contractor_phone", e.target.value)}
            placeholder="+27…"
            className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
        </div>
      </div>

      {/* Issue & Work */}
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">Issue Reported</label>
        <textarea rows={2} value={form.issue_reported} onChange={e => set("issue_reported", e.target.value)}
          placeholder="Describe the fault…"
          className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
      </div>
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">Work Done</label>
        <textarea rows={2} value={form.work_done} onChange={e => set("work_done", e.target.value)}
          placeholder="Describe the repair…"
          className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">Next Service Due</label>
        <input type="date" value={form.next_service_due} onChange={e => set("next_service_due", e.target.value)}
          className="w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400" />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving}
          className="rounded-md bg-stone-900 px-5 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : "Log Repair"}
        </button>
        <button type="button" onClick={onClose}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
