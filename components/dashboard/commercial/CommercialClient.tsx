"use client";

/**
 * CommercialClient
 *
 * Interactive commercial dashboard. Receives pre-fetched summary + client
 * data from the server page and handles:
 *   - Summary KPI strip (MRR, Revenue MTD, Expenses MTD, Profit MTD)
 *   - Sortable client table
 *   - Click-to-open right-panel client detail (subscription, recent events, ROI)
 *   - Add Revenue modal (POST /api/commercial/revenue)
 *   - Add Expense modal (POST /api/commercial/expenses)
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { CommercialSummary, CommercialClientRow, RevenueEvent } from "@/lib/commercial/queries";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtZAR(n: number): string {
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000)     return `R${Math.round(n / 1_000)}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
  });
}

const today = new Date().toISOString().slice(0, 10);

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  active:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  trial:   "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  paused:  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  churned: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-500",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  payment:   "Payment",
  refund:    "Refund",
  credit:    "Credit",
  setup_fee: "Setup Fee",
  addon:     "Add-on",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
      STATUS_STYLE[status] ?? "bg-stone-100 text-stone-500",
    )}>
      {status}
    </span>
  );
}

// ── KPI tile ──────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, highlight,
}: { label: string; value: string; sub?: string; highlight?: "positive" | "negative" | "neutral" }) {
  const valueColor =
    highlight === "positive" ? "text-emerald-600 dark:text-emerald-400" :
    highlight === "negative" ? "text-red-600 dark:text-red-400"         :
    "text-stone-900 dark:text-stone-100";
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3 flex flex-col gap-0.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-500">{label}</p>
      <p className={cn("text-xl font-extrabold tabular-nums leading-none", valueColor)}>{value}</p>
      {sub && <p className="text-[11px] text-stone-500 dark:text-stone-500">{sub}</p>}
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md mx-4 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
          <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">{title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-500">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600";
const selectCls = inputCls;

// ── Client detail panel ───────────────────────────────────────────────────────

function ClientDetailPanel({
  client,
  onClose,
}: {
  client: CommercialClientRow;
  onClose: () => void;
}) {
  const profitability = client.monthly_fee > 0 && client.revenue_mtd > 0
    ? ((client.revenue_mtd / client.monthly_fee) * 100 - 100).toFixed(0)
    : null;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <div>
          <h2 className="text-base font-black text-stone-900 dark:text-stone-100">{client.name}</h2>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={client.status} />
            {client.site_name && (
              <span className="text-[10px] text-stone-500 dark:text-stone-500">
                🏪 {client.site_name}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-xl leading-none shrink-0 ml-3"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Contact */}
        {(client.contact_name || client.contact_email) && (
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-2">Contact</p>
            <div className="space-y-0.5">
              {client.contact_name && (
                <p className="text-sm text-stone-700 dark:text-stone-300">{client.contact_name}</p>
              )}
              {client.contact_email && (
                <p className="text-xs text-stone-500 dark:text-stone-500">
                  <a href={`mailto:${client.contact_email}`} className="hover:underline">{client.contact_email}</a>
                </p>
              )}
            </div>
          </section>
        )}

        {/* Subscription */}
        <section>
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-2">Subscription</p>
          {client.plan_name ? (
            <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-4 py-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-stone-500">Plan</p>
                <p className="text-sm font-bold text-stone-900 dark:text-stone-100">{client.plan_name}</p>
              </div>
              <div>
                <p className="text-[10px] text-stone-500">Monthly Fee</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtZAR(client.monthly_fee)}</p>
              </div>
              <div>
                <p className="text-[10px] text-stone-500">Billing</p>
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-300 capitalize">{client.billing_cycle ?? "Monthly"}</p>
              </div>
              <div>
                <p className="text-[10px] text-stone-500">Since</p>
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">{fmtDate(client.onboarded_at)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-400">No active subscription</p>
          )}
        </section>

        {/* Revenue summary */}
        <section>
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-2">Revenue</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-3 py-2.5">
              <p className="text-[10px] text-stone-500">This Month</p>
              <p className="text-base font-extrabold text-stone-900 dark:text-stone-100 tabular-nums">{fmtZAR(client.revenue_mtd)}</p>
            </div>
            <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-3 py-2.5">
              <p className="text-[10px] text-stone-500">Lifetime</p>
              <p className="text-base font-extrabold text-stone-900 dark:text-stone-100 tabular-nums">{fmtZAR(client.revenue_lifetime)}</p>
            </div>
          </div>
          {profitability !== null && (
            <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-500">
              Revenue this month is{" "}
              <span className={cn("font-bold", Number(profitability) >= 0 ? "text-emerald-600" : "text-red-500")}>
                {Number(profitability) >= 0 ? "+" : ""}{profitability}%
              </span>{" "}
              vs MRR
            </p>
          )}
        </section>

        {/* ROI insight */}
        {client.site_name && client.monthly_fee > 0 && (
          <section className="rounded-lg border border-sky-100 dark:border-sky-900/40 bg-sky-50/60 dark:bg-sky-950/20 px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-1">Operational Link</p>
            <p className="text-xs text-stone-700 dark:text-stone-300">
              <span className="font-semibold">{client.site_name}</span> is tracked in the ForgeStack Operating Engine.
              Client investment: <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmtZAR(client.monthly_fee)}/month</span>.
            </p>
          </section>
        )}

        {/* Recent transactions */}
        {client.recent_events.length > 0 && (
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-2">
              Recent Transactions
            </p>
            <div className="space-y-1">
              {client.recent_events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-800"
                >
                  <div>
                    <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                      {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                      {ev.description && <span className="font-normal text-stone-500"> — {ev.description}</span>}
                    </p>
                    <p className="text-[10px] text-stone-400">{fmtDate(ev.event_date)}</p>
                  </div>
                  <span className={cn(
                    "text-sm font-bold tabular-nums",
                    ev.event_type === "refund" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400",
                  )}>
                    {ev.event_type === "refund" ? "-" : "+"}{fmtZAR(ev.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Notes */}
        {client.notes && (
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-1">Notes</p>
            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed whitespace-pre-wrap">{client.notes}</p>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommercialClient({
  summary,
  clients,
}: {
  summary: CommercialSummary;
  clients: CommercialClientRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [selected,      setSelected]      = useState<CommercialClientRow | null>(null);
  const [showRevModal,  setShowRevModal]  = useState(false);
  const [showExpModal,  setShowExpModal]  = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [formError,     setFormError]     = useState<string | null>(null);

  const [revForm, setRevForm] = useState({
    client_id:  "",
    amount:     "",
    event_type: "payment",
    description: "",
    event_date: today,
  });

  const [expForm, setExpForm] = useState({
    category:    "",
    description: "",
    amount:      "",
    client_id:   "",
    expense_date: today,
  });

  // ── Submit: add revenue ──────────────────────────────────────────────────────
  async function handleAddRevenue(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseFloat(revForm.amount);
    if (!revForm.client_id) { setFormError("Please select a client."); return; }
    if (!Number.isFinite(amount) || amount === 0) { setFormError("Please enter a valid amount."); return; }
    setSubmitting(true);
    const res = await fetch("/api/commercial/revenue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...revForm, amount }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (json.error) { setFormError(json.error); return; }
    setShowRevModal(false);
    setRevForm({ client_id: "", amount: "", event_type: "payment", description: "", event_date: today });
    startTransition(() => router.refresh());
  }

  // ── Submit: add expense ──────────────────────────────────────────────────────
  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseFloat(expForm.amount);
    if (!expForm.category.trim()) { setFormError("Category is required."); return; }
    if (!expForm.description.trim()) { setFormError("Description is required."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError("Please enter a positive amount."); return; }
    setSubmitting(true);
    const res = await fetch("/api/commercial/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expForm, amount }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (json.error) { setFormError(json.error); return; }
    setShowExpModal(false);
    setExpForm({ category: "", description: "", amount: "", client_id: "", expense_date: today });
    startTransition(() => router.refresh());
  }

  const profitColor = summary.profit_mtd >= 0 ? "positive" as const : "negative" as const;

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-stone-900 dark:text-stone-100">Commercial</h1>
          <p className="text-xs text-stone-500 dark:text-stone-500 mt-0.5">
            {summary.active_clients} active client{summary.active_clients !== 1 ? "s" : ""}
            {summary.trial_clients > 0 ? ` · ${summary.trial_clients} on trial` : ""}
            {summary.churned_clients > 0 ? ` · ${summary.churned_clients} churned` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setFormError(null); setShowRevModal(true); }}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
          >
            + Revenue
          </button>
          <button
            onClick={() => { setFormError(null); setShowExpModal(true); }}
            className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-xs font-bold text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
          >
            + Expense
          </button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="MRR"
          value={fmtZAR(summary.mrr)}
          sub={`${summary.active_clients} active subscription${summary.active_clients !== 1 ? "s" : ""}`}
          highlight="positive"
        />
        <KpiTile
          label="Revenue MTD"
          value={fmtZAR(summary.revenue_mtd)}
          sub="Payments collected this month"
        />
        <KpiTile
          label="Expenses MTD"
          value={fmtZAR(summary.expenses_mtd)}
          sub="Platform costs this month"
          highlight={summary.expenses_mtd > summary.revenue_mtd ? "negative" : "neutral"}
        />
        <KpiTile
          label="Profit MTD"
          value={fmtZAR(Math.abs(summary.profit_mtd))}
          sub={summary.profit_mtd < 0 ? "Net loss this month" : "Net profit this month"}
          highlight={profitColor}
        />
      </div>

      {/* ── Main content: table + optional detail panel ── */}
      <div className={cn(
        "grid gap-5",
        selected ? "lg:grid-cols-[1fr_400px]" : "",
      )}>

        {/* Client table */}
        <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-500">Clients</p>
            <span className="text-[10px] text-stone-400">{clients.length} total</span>
          </div>

          {clients.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-stone-400 text-sm">No clients yet.</p>
              <p className="text-stone-400 text-xs mt-1">Add your first client via Supabase or the Admin panel.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 dark:bg-stone-800/60">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500">Client</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500">Status</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500 hidden sm:table-cell">Plan</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">MRR</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500 hidden md:table-cell">Rev MTD</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500 hidden lg:table-cell">Lifetime</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500 hidden lg:table-cell">Since</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {clients.map((client) => {
                    const isSelected = selected?.id === client.id;
                    return (
                      <tr
                        key={client.id}
                        onClick={() => setSelected(isSelected ? null : client)}
                        className={cn(
                          "cursor-pointer transition-colors",
                          isSelected
                            ? "bg-stone-100 dark:bg-stone-800"
                            : "hover:bg-stone-50 dark:hover:bg-stone-800/50",
                        )}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-semibold text-stone-900 dark:text-stone-100">{client.name}</p>
                            {client.site_name && (
                              <p className="text-[10px] text-stone-500 mt-0.5">🏪 {client.site_name}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={client.status} />
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-stone-600 dark:text-stone-400">
                            {client.plan_name ?? <span className="text-stone-400">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                          {client.monthly_fee > 0 ? fmtZAR(client.monthly_fee) : <span className="text-stone-400 font-normal">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-700 dark:text-stone-300 hidden md:table-cell">
                          {client.revenue_mtd > 0 ? fmtZAR(client.revenue_mtd) : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-500 dark:text-stone-500 hidden lg:table-cell">
                          {client.revenue_lifetime > 0 ? fmtZAR(client.revenue_lifetime) : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-stone-400 hidden lg:table-cell">
                          {fmtDate(client.onboarded_at)}
                        </td>
                        <td className="px-3 py-3 text-stone-400">
                          <span className="text-base">{isSelected ? "◀" : "▶"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <ClientDetailPanel
            client={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {/* ── Add Revenue modal ── */}
      {showRevModal && (
        <Modal title="Record Revenue Event" onClose={() => setShowRevModal(false)}>
          <form onSubmit={handleAddRevenue} className="space-y-4">
            <Field label="Client *">
              <select
                className={selectCls}
                value={revForm.client_id}
                onChange={(e) => setRevForm((f) => ({ ...f, client_id: e.target.value }))}
                required
              >
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (ZAR) *">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={inputCls}
                  value={revForm.amount}
                  onChange={(e) => setRevForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="e.g. 4500"
                  required
                />
              </Field>
              <Field label="Type">
                <select
                  className={selectCls}
                  value={revForm.event_type}
                  onChange={(e) => setRevForm((f) => ({ ...f, event_type: e.target.value }))}
                >
                  <option value="payment">Payment</option>
                  <option value="setup_fee">Setup Fee</option>
                  <option value="addon">Add-on</option>
                  <option value="credit">Credit</option>
                  <option value="refund">Refund</option>
                </select>
              </Field>
            </div>

            <Field label="Description">
              <input
                type="text"
                className={inputCls}
                value={revForm.description}
                onChange={(e) => setRevForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. April 2026 subscription"
              />
            </Field>

            <Field label="Date">
              <input
                type="date"
                className={inputCls}
                value={revForm.event_date}
                onChange={(e) => setRevForm((f) => ({ ...f, event_date: e.target.value }))}
              />
            </Field>

            {formError && (
              <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Saving…" : "Save Revenue"}
              </button>
              <button
                type="button"
                onClick={() => setShowRevModal(false)}
                className="rounded-lg border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add Expense modal ── */}
      {showExpModal && (
        <Modal title="Record Expense" onClose={() => setShowExpModal(false)}>
          <form onSubmit={handleAddExpense} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category *">
                <input
                  type="text"
                  className={inputCls}
                  value={expForm.category}
                  onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Infrastructure"
                  required
                />
              </Field>
              <Field label="Amount (ZAR) *">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={inputCls}
                  value={expForm.amount}
                  onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="e.g. 1200"
                  required
                />
              </Field>
            </div>

            <Field label="Description *">
              <input
                type="text"
                className={inputCls}
                value={expForm.description}
                onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Vercel Pro plan"
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Link to Client (optional)">
                <select
                  className={selectCls}
                  value={expForm.client_id}
                  onChange={(e) => setExpForm((f) => ({ ...f, client_id: e.target.value }))}
                >
                  <option value="">Platform-wide</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input
                  type="date"
                  className={inputCls}
                  value={expForm.expense_date}
                  onChange={(e) => setExpForm((f) => ({ ...f, expense_date: e.target.value }))}
                />
              </Field>
            </div>

            {formError && (
              <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-stone-900 dark:bg-stone-100 px-4 py-2 text-sm font-bold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Saving…" : "Save Expense"}
              </button>
              <button
                type="button"
                onClick={() => setShowExpModal(false)}
                className="rounded-lg border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
