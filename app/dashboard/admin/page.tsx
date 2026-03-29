"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  totalStores: number;
  activeStores: number;
  totalUsers: number;
  activeRoles: number;
  auditEntries: number;
  roleCounts: Record<string, number>;
  totalOrgs: number;
  activeToday: number;
  integrationCount: number;
  staleStores: number;
  weeklyRevenue: number;
  orgBreakdown: Record<string, { name: string; stores: number; users: number }>;
  stores: { id: string; name: string; is_active: boolean; store_code: string }[];
}

interface Store {
  id: string;
  name: string;
  store_code: string;
  address: string | null;
  city: string | null;
  timezone: string;
  is_active: boolean;
  seating_capacity: number | null;
  target_avg_spend: number | null;
  target_labour_pct: number | null;
  target_margin_pct: number | null;
  organisation_id: string | null;
  region_id: string | null;
  created_at: string;
}

interface UserEntry {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  last_seen_at: string | null;
  roles: { role: string; site_id: string | null; region_id: string | null; is_active: boolean; granted_at: string }[];
  site_ids: string[];
}

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface StoreHealth {
  id: string;
  name: string;
  store_code: string;
  is_active: boolean;
  integration_status: string;
  last_sync_at: string | null;
  stale_minutes: number | null;
  last_sales_date: string | null;
  recent_errors: number;
  failed_runs: number;
  health: "healthy" | "warning" | "critical" | "unknown";
}

interface DataHealthData {
  stores: StoreHealth[];
  summary: { total: number; healthy: number; warning: number; critical: number; unknown: number };
}

interface SyncRun {
  run_id: string;
  site_id: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_fetched: number;
  store_name: string;
}

interface SyncLogsData {
  runs: SyncRun[];
  errors: { site_id: string; sync_type: string; message: string; created_at: string }[];
  total: number;
  page: number;
  limit: number;
}

interface Integration {
  store_id: string;
  store_name: string;
  store_code: string;
  is_active: boolean;
  micros: {
    connected: boolean;
    status: string;
    org_id: string | null;
    loc_id: string | null;
    last_sync_at: string | null;
    token_expires_at: string | null;
    sync_age_minutes: number | null;
  };
  google_reviews: { connected: boolean; status: string };
  inventory: { connected: boolean; status: string };
}

interface IntegrationsData {
  integrations: Integration[];
  summary: {
    total_stores: number;
    micros_connected: number;
    micros_stale: number;
    micros_expired: number;
    micros_disconnected: number;
    micros_none: number;
  };
}

type Tab = "overview" | "organisations" | "stores" | "team" | "roles" | "integrations" | "data-health" | "sync-logs" | "audit" | "settings";

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview",      label: "Overview",       icon: "📊" },
  { id: "organisations", label: "Organisations",   icon: "🏢" },
  { id: "stores",        label: "Stores",          icon: "🏪" },
  { id: "team",          label: "Team",            icon: "👥" },
  { id: "roles",         label: "Roles",           icon: "🔐" },
  { id: "integrations",  label: "Integrations",    icon: "🔌" },
  { id: "data-health",   label: "Data Health",     icon: "💓" },
  { id: "sync-logs",     label: "Sync Logs",       icon: "🔄" },
  { id: "audit",         label: "Audit",           icon: "📜" },
  { id: "settings",      label: "Settings",        icon: "⚙️" },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  executive: "Executive",
  head_office: "Head Office",
  area_manager: "Area Manager",
  gm: "General Manager",
  supervisor: "Supervisor",
  contractor: "Contractor",
  auditor: "Auditor",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin:  "bg-red-500/20 text-red-300 border-red-500/30",
  executive:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  head_office:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  area_manager: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  gm:           "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  supervisor:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  contractor:   "bg-orange-500/20 text-orange-300 border-orange-500/30",
  auditor:      "bg-stone-500/20 text-stone-300 border-stone-500/30",
  viewer:       "bg-stone-500/20 text-stone-400 border-stone-500/30",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin:  "Full system access · manage everything including org settings & users",
  executive:    "Read-only all stores · financial dashboards · compliance visibility",
  head_office:  "All stores read/write · store settings · integrations · no user management",
  area_manager: "Region-scoped · manage assigned stores · full operational access",
  gm:           "Single-store · full operational access · no admin settings",
  supervisor:   "Single-store · limited ops · create actions & maintenance",
  contractor:   "Maintenance tickets only · assigned store",
  auditor:      "Read-only all stores · compliance & audit log access",
  viewer:       "Single-store read-only · compliance view",
};

const HEALTH_STYLES: Record<string, string> = {
  healthy:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  warning:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  unknown:  "bg-stone-500/20 text-stone-400 border-stone-500/30",
};

const INTEGRATION_STYLES: Record<string, string> = {
  connected:    "bg-emerald-500/20 text-emerald-300",
  disconnected: "bg-red-500/20 text-red-300",
  expired:      "bg-amber-500/20 text-amber-300",
  stale:        "bg-orange-500/20 text-orange-300",
  none:         "bg-stone-500/20 text-stone-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Shared Components ─────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: { icon: string; label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className={cn("rounded-xl border border-stone-800 bg-stone-900/60 p-4 transition-colors hover:border-stone-700", accent && `ring-1 ${accent}`)}>
      <div className="text-lg">{icon}</div>
      <div className="mt-1 text-2xl font-bold text-stone-100">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide">{label}</div>
      {sub && <div className="mt-1 text-[10px] text-stone-600">{sub}</div>}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", ROLE_COLORS[role] ?? "bg-stone-700 text-stone-300 border-stone-600")}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function HealthBadge({ health }: { health: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", HEALTH_STYLES[health] ?? HEALTH_STYLES.unknown)}>
      {health}
    </span>
  );
}

function IntegrationBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", INTEGRATION_STYLES[status] ?? INTEGRATION_STYLES.none)}>
      {status}
    </span>
  );
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
        <h3 className="text-sm font-semibold text-stone-300">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-stone-800 bg-stone-900/60 h-16 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-center text-xs text-stone-500 py-8">{message}</p>;
}

// ── 1. Platform Overview ──────────────────────────────────────────────────────

function OverviewPanel({ data }: { data: OverviewData | null }) {
  if (!data) return <LoadingSkeleton />;

  const stats = [
    { icon: "🏢", label: "Organisations", value: data.totalOrgs },
    { icon: "🏪", label: "Active Stores", value: `${data.activeStores}/${data.totalStores}` },
    { icon: "👥", label: "Team Members", value: data.totalUsers },
    { icon: "🟢", label: "Active Today", value: data.activeToday },
    { icon: "🔌", label: "Integrations", value: data.integrationCount },
    { icon: "⚠️", label: "Stale Stores", value: data.staleStores, accent: data.staleStores > 0 ? "ring-amber-500/30" : undefined },
    { icon: "💰", label: "Weekly Revenue", value: formatCurrency(data.weeklyRevenue) },
    { icon: "📜", label: "Audit Events", value: data.auditEntries },
  ];

  return (
    <div className="space-y-6">
      {/* Primary stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Role distribution */}
        <SectionCard title="Role Distribution">
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.roleCounts).map(([role, count]) => (
              <div key={role} className="flex items-center gap-2">
                <RoleBadge role={role} />
                <span className="text-xs text-stone-400">×{count}</span>
              </div>
            ))}
            {Object.keys(data.roleCounts).length === 0 && (
              <p className="text-xs text-stone-500">No roles assigned yet</p>
            )}
          </div>
        </SectionCard>

        {/* Org breakdown */}
        <SectionCard title="Organisation Breakdown">
          {Object.keys(data.orgBreakdown).length === 0 ? (
            <p className="text-xs text-stone-500">No organisations yet</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.orgBreakdown).map(([id, org]) => (
                <div key={id} className="flex items-center justify-between rounded-lg bg-stone-800/40 px-3 py-2">
                  <span className="text-sm font-medium text-stone-200">{org.name}</span>
                  <div className="flex items-center gap-3 text-[11px] text-stone-500">
                    <span>{org.stores} store{org.stores !== 1 ? "s" : ""}</span>
                    <span>{org.users} user{org.users !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── 2. Organisations ──────────────────────────────────────────────────────────

function OrganisationsPanel({ data }: { data: OverviewData | null }) {
  if (!data) return <LoadingSkeleton />;

  const orgs = Object.entries(data.orgBreakdown);

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">{orgs.length} organisation{orgs.length !== 1 ? "s" : ""}</p>
      {orgs.length === 0 ? (
        <EmptyState message="No organisations configured yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orgs.map(([id, org]) => (
            <div key={id} className="rounded-xl border border-stone-800 bg-stone-900/60 p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20 text-blue-300 text-lg font-bold">
                  {org.name.charAt(0)}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-stone-200">{org.name}</h4>
                  <p className="text-[10px] font-mono text-stone-500">{id.slice(0, 8)}…</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-stone-800/50 p-3 text-center">
                  <div className="text-lg font-bold text-stone-100">{org.stores}</div>
                  <div className="text-[10px] text-stone-500 uppercase">Stores</div>
                </div>
                <div className="rounded-lg bg-stone-800/50 p-3 text-center">
                  <div className="text-lg font-bold text-stone-100">{org.users}</div>
                  <div className="text-[10px] text-stone-500 uppercase">Users</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3. Stores ─────────────────────────────────────────────────────────────────

function StoresPanel({ stores, onRefresh }: { stores: Store[] | null; onRefresh: () => void }) {
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", store_code: "", address: "", city: "", seating_capacity: "", target_avg_spend: "" });

  if (!stores) return <LoadingSkeleton />;

  const handleCreate = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/admin/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          store_code: form.store_code,
          address: form.address || null,
          city: form.city || null,
          seating_capacity: form.seating_capacity ? Number(form.seating_capacity) : null,
          target_avg_spend: form.target_avg_spend ? Number(form.target_avg_spend) : null,
        }),
      });
      setShowNew(false);
      setForm({ name: "", store_code: "", address: "", city: "", seating_capacity: "", target_avg_spend: "" });
      onRefresh();
    } catch { /* toast */ } finally { setSaving(false); }
  };

  const toggleActive = async (store: Store) => {
    await apiFetch(`/api/admin/stores/${store.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !store.is_active }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{stores.length} store{stores.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowNew(!showNew)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors">
          + Add Store
        </button>
      </div>

      {showNew && (
        <div className="rounded-xl border border-emerald-800/50 bg-stone-900/80 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-200">New Store</h4>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Store Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" />
            <input placeholder="Store Code" value={form.store_code} onChange={(e) => setForm({ ...form, store_code: e.target.value })} className="input-field" />
            <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-field" />
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input-field" />
            <input placeholder="Seats" type="number" value={form.seating_capacity} onChange={(e) => setForm({ ...form, seating_capacity: e.target.value })} className="input-field" />
            <input placeholder="Avg Spend (R)" type="number" value={form.target_avg_spend} onChange={(e) => setForm({ ...form, target_avg_spend: e.target.value })} className="input-field" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !form.name || !form.store_code} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors">
              {saving ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setShowNew(false)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        {stores.map((store) => (
          <div key={store.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-800/40 transition-colors">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", store.is_active ? "bg-emerald-400" : "bg-red-400")} />
                <span className="text-sm font-medium text-stone-200">{store.name}</span>
                <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] font-mono text-stone-400">{store.store_code}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-stone-500">
                {store.city && <span>{store.city}</span>}
                {store.seating_capacity && <span>{store.seating_capacity} seats</span>}
                {store.target_avg_spend && <span>R{store.target_avg_spend} avg</span>}
                <span className="font-mono text-[10px] text-stone-600">{store.id.slice(0, 8)}</span>
              </div>
            </div>
            <button
              onClick={() => toggleActive(store)}
              className={cn("rounded px-2 py-1 text-[10px] font-semibold transition-colors", store.is_active ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30")}
            >
              {store.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
        {stores.length === 0 && <EmptyState message="No stores configured" />}
      </div>
    </div>
  );
}

// ── 4. Team / Users ───────────────────────────────────────────────────────────

function TeamPanel({
  users,
  stores,
  onRefresh,
}: {
  users: UserEntry[] | null;
  stores: Store[] | null;
  onRefresh: () => void;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", full_name: "", role: "gm", site_id: "" });
  const router = useRouter();

  const handleChangeRole = async (userId: string, newRole: string) => {
    setChangingRole(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      setEditingRole(null);
      onRefresh();
    } catch { /* toast */ } finally { setChangingRole(null); }
  };

  const handleDelete = async (userId: string, name: string) => {
    if (!confirm(`Delete ${name}? This will remove their account, roles, and site access.`)) return;
    setDeleting(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      onRefresh();
    } catch { /* toast */ } finally { setDeleting(null); }
  };

  if (!users) return <LoadingSkeleton />;

  const handleInvite = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, full_name: form.full_name, role: form.role, site_id: form.site_id || null }),
      });
      setShowInvite(false);
      setForm({ email: "", full_name: "", role: "gm", site_id: "" });
      onRefresh();
    } catch { /* toast */ } finally { setSaving(false); }
  };

  const handleImpersonate = async (userId: string) => {
    setImpersonating(userId);
    try {
      await apiFetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: userId }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setImpersonating(null);
    }
  };

  const storeMap = new Map((stores ?? []).map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{users.length} team member{users.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowInvite(!showInvite)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors">
          + Invite User
        </button>
      </div>

      {showInvite && (
        <div className="rounded-xl border border-blue-800/50 bg-stone-900/80 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-200">Invite Team Member</h4>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" />
            <input placeholder="Full Name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="input-field">
              <option value="">All Sites</option>
              {(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleInvite} disabled={saving || !form.email || !form.full_name} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors">
              {saving ? "Inviting…" : "Send Invite"}
            </button>
            <button onClick={() => setShowInvite(false)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        {users.map((u) => {
          const primaryRole = u.roles.find((r) => r.is_active);
          const isEditing = editingRole === u.id;
          return (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-800/40 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", u.status === "active" ? "bg-emerald-400" : u.status === "invited" ? "bg-amber-400" : "bg-red-400")} />
                  <span className="text-sm font-medium text-stone-200">{u.full_name ?? u.email}</span>
                  {u.full_name && <span className="text-[11px] text-stone-500">{u.email}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {primaryRole && !isEditing && (
                    <button onClick={() => setEditingRole(u.id)} className="cursor-pointer" title="Click to change role">
                      <RoleBadge role={primaryRole.role} />
                    </button>
                  )}
                  {isEditing && (
                    <div className="flex items-center gap-1.5">
                      <select
                        defaultValue={primaryRole?.role ?? "viewer"}
                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                        disabled={changingRole === u.id}
                        className="rounded-md border border-stone-700 bg-stone-800 px-2 py-0.5 text-xs text-stone-200 focus:border-blue-500 focus:outline-none disabled:opacity-40"
                      >
                        {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button onClick={() => setEditingRole(null)} className="text-[10px] text-stone-500 hover:text-stone-300">Cancel</button>
                      {changingRole === u.id && <span className="text-[10px] text-stone-500">Saving…</span>}
                    </div>
                  )}
                  {u.site_ids.length > 0 && (
                    <span className="text-[10px] text-stone-500">
                      {u.site_ids.map((sid) => storeMap.get(sid) ?? sid.slice(0, 8)).join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {primaryRole?.role !== "super_admin" && (
                  <button
                    onClick={() => handleImpersonate(u.id)}
                    disabled={impersonating === u.id}
                    className="rounded px-2 py-1 text-[10px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-40"
                    title="View dashboard as this user"
                  >
                    {impersonating === u.id ? "…" : "Impersonate"}
                  </button>
                )}
                {primaryRole?.role !== "super_admin" && (
                  <button
                    onClick={() => handleDelete(u.id, u.full_name ?? u.email)}
                    disabled={deleting === u.id}
                    className="rounded px-2 py-1 text-[10px] font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-40"
                    title="Delete user"
                  >
                    {deleting === u.id ? "…" : "Delete"}
                  </button>
                )}
                <div className="text-right">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", u.status === "active" ? "bg-emerald-500/20 text-emerald-300" : u.status === "invited" ? "bg-amber-500/20 text-amber-300" : "bg-red-500/20 text-red-300")}>
                    {u.status}
                  </span>
                  {u.last_seen_at && (
                    <p className="mt-0.5 text-[10px] text-stone-600">Seen {timeAgo(u.last_seen_at)}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {users.length === 0 && <EmptyState message="No team members yet" />}
      </div>
    </div>
  );
}

// ── 5. Roles ──────────────────────────────────────────────────────────────────

function RolesPanel({ users }: { users: UserEntry[] | null }) {
  const allRoles = Object.keys(ROLE_LABELS);
  const roleMemberCounts: Record<string, number> = {};
  for (const u of users ?? []) {
    const active = u.roles.find((r) => r.is_active);
    if (active) roleMemberCounts[active.role] = (roleMemberCounts[active.role] ?? 0) + 1;
  }

  return (
    <div className="space-y-3">
      {allRoles.map((role) => (
        <div key={role} className="rounded-xl border border-stone-800 bg-stone-900/60 p-4 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RoleBadge role={role} />
              <span className="text-xs text-stone-500">{roleMemberCounts[role] ?? 0} member{(roleMemberCounts[role] ?? 0) !== 1 ? "s" : ""}</span>
            </div>
            <p className="text-[11px] text-stone-500 max-w-lg">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 6. Integrations ───────────────────────────────────────────────────────────

function IntegrationsPanel({ data }: { data: IntegrationsData | null }) {
  if (!data) return <LoadingSkeleton />;

  const { integrations, summary } = data;

  return (
    <div className="space-y-4">
      {/* Summary grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <StatCard icon="🔌" label="Total" value={summary.total_stores} />
        <StatCard icon="✅" label="Connected" value={summary.micros_connected} />
        <StatCard icon="⏳" label="Stale" value={summary.micros_stale} accent={summary.micros_stale > 0 ? "ring-orange-500/30" : undefined} />
        <StatCard icon="⏰" label="Expired" value={summary.micros_expired} accent={summary.micros_expired > 0 ? "ring-amber-500/30" : undefined} />
        <StatCard icon="🔴" label="Disconnected" value={summary.micros_disconnected} accent={summary.micros_disconnected > 0 ? "ring-red-500/30" : undefined} />
        <StatCard icon="⬜" label="Not Set Up" value={summary.micros_none} />
      </div>

      {/* Per-store list */}
      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-semibold text-stone-500 uppercase tracking-wider bg-stone-800/40">
          <div className="col-span-3">Store</div>
          <div className="col-span-2">MICROS</div>
          <div className="col-span-2">Reviews</div>
          <div className="col-span-2">Inventory</div>
          <div className="col-span-3">Last Sync</div>
        </div>
        {integrations.map((i) => (
          <div key={i.store_id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-stone-800/40 transition-colors">
            <div className="col-span-3">
              <div className="text-sm font-medium text-stone-200">{i.store_name}</div>
              <div className="text-[10px] font-mono text-stone-500">{i.store_code}</div>
            </div>
            <div className="col-span-2"><IntegrationBadge status={i.micros.status} /></div>
            <div className="col-span-2"><IntegrationBadge status={i.google_reviews.status} /></div>
            <div className="col-span-2"><IntegrationBadge status={i.inventory.status} /></div>
            <div className="col-span-3 text-[11px] text-stone-500">
              {i.micros.last_sync_at ? timeAgo(i.micros.last_sync_at) : "never"}
              {i.micros.sync_age_minutes !== null && i.micros.sync_age_minutes > 60 && (
                <span className="ml-1 text-amber-400">({Math.floor(i.micros.sync_age_minutes / 60)}h ago)</span>
              )}
            </div>
          </div>
        ))}
        {integrations.length === 0 && <EmptyState message="No stores to show" />}
      </div>
    </div>
  );
}

// ── 7. Data Health ────────────────────────────────────────────────────────────

function DataHealthPanel({ data, onRefresh }: { data: DataHealthData | null; onRefresh: () => void }) {
  if (!data) return <LoadingSkeleton />;

  const { stores: storeHealth, summary } = data;

  const healthOrder = ["critical", "warning", "unknown", "healthy"];
  const sorted = [...storeHealth].sort(
    (a, b) => healthOrder.indexOf(a.health) - healthOrder.indexOf(b.health)
  );

  return (
    <div className="space-y-4">
      {/* Summary ring */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard icon="📊" label="Total Stores" value={summary.total} />
        <StatCard icon="✅" label="Healthy" value={summary.healthy} />
        <StatCard icon="⚠️" label="Warning" value={summary.warning} accent={summary.warning > 0 ? "ring-amber-500/30" : undefined} />
        <StatCard icon="🔴" label="Critical" value={summary.critical} accent={summary.critical > 0 ? "ring-red-500/30" : undefined} />
        <StatCard icon="❓" label="Unknown" value={summary.unknown} />
      </div>

      {/* Per-store health */}
      <SectionCard
        title="Store Health Matrix"
        action={
          <button onClick={onRefresh} className="text-[10px] font-medium text-stone-400 hover:text-stone-200 transition-colors">
            ↻ Refresh
          </button>
        }
      >
        <div className="divide-y divide-stone-800">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
            <div className="col-span-3">Store</div>
            <div className="col-span-2">Health</div>
            <div className="col-span-2">Integration</div>
            <div className="col-span-2">Last Sync</div>
            <div className="col-span-1">Errors</div>
            <div className="col-span-2">Sales Date</div>
          </div>
          {sorted.map((store) => (
            <div key={store.id} className="grid grid-cols-12 gap-2 py-3 items-center">
              <div className="col-span-3">
                <div className="text-sm font-medium text-stone-200">{store.name}</div>
                <div className="text-[10px] font-mono text-stone-500">{store.store_code}</div>
              </div>
              <div className="col-span-2"><HealthBadge health={store.health} /></div>
              <div className="col-span-2"><IntegrationBadge status={store.integration_status} /></div>
              <div className="col-span-2 text-[11px] text-stone-500">
                {store.last_sync_at ? timeAgo(store.last_sync_at) : "never"}
                {store.stale_minutes !== null && store.stale_minutes > 120 && (
                  <div className="text-[10px] text-amber-400">{Math.floor(store.stale_minutes / 60)}h stale</div>
                )}
              </div>
              <div className="col-span-1">
                {store.recent_errors > 0 ? (
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">{store.recent_errors}</span>
                ) : (
                  <span className="text-[11px] text-stone-600">0</span>
                )}
              </div>
              <div className="col-span-2 text-[11px] text-stone-500">
                {store.last_sales_date ?? "—"}
              </div>
            </div>
          ))}
          {sorted.length === 0 && <EmptyState message="No stores to evaluate" />}
        </div>
      </SectionCard>
    </div>
  );
}

// ── 8. Sync Logs ──────────────────────────────────────────────────────────────

function SyncLogsPanel({ data, page, setPage }: { data: SyncLogsData | null; page: number; setPage: (p: number) => void }) {
  if (!data) return <LoadingSkeleton />;

  const totalPages = Math.ceil(data.total / data.limit);

  const statusColors: Record<string, string> = {
    completed: "bg-emerald-500/20 text-emerald-300",
    running:   "bg-blue-500/20 text-blue-300",
    failed:    "bg-red-500/20 text-red-300",
    partial:   "bg-amber-500/20 text-amber-300",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{data.total} sync run{data.total !== 1 ? "s" : ""} total</p>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-30 transition-colors">←</button>
          <span>{page} / {totalPages || 1}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-30 transition-colors">→</button>
        </div>
      </div>

      {/* Runs table */}
      <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-semibold text-stone-500 uppercase tracking-wider bg-stone-800/40">
          <div className="col-span-3">Store</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Records</div>
          <div className="col-span-3">Started</div>
        </div>
        {data.runs.map((run) => (
          <div key={run.run_id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-stone-800/40 transition-colors">
            <div className="col-span-3 text-sm text-stone-200 truncate">{run.store_name}</div>
            <div className="col-span-2">
              <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] font-mono text-stone-400">{run.sync_type}</span>
            </div>
            <div className="col-span-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", statusColors[run.status] ?? "bg-stone-700 text-stone-400")}>
                {run.status}
              </span>
            </div>
            <div className="col-span-2 text-[11px] text-stone-400">{run.records_fetched}</div>
            <div className="col-span-3 text-[11px] text-stone-500">{timeAgo(run.started_at)}</div>
          </div>
        ))}
        {data.runs.length === 0 && <EmptyState message="No sync runs recorded" />}
      </div>

      {/* Recent errors */}
      {data.errors.length > 0 && (
        <SectionCard title={`Recent Errors (${data.errors.length})`}>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {data.errors.map((e, i) => (
              <div key={i} className="rounded-lg bg-red-900/20 border border-red-800/30 p-3">
                <div className="flex items-center gap-2 text-[10px] text-red-400">
                  <span className="font-mono">{e.sync_type}</span>
                  <span className="text-stone-600">·</span>
                  <span>{timeAgo(e.created_at)}</span>
                </div>
                <p className="mt-1 text-[11px] text-red-300 font-mono truncate">{e.message}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ── 9. Audit Logs ─────────────────────────────────────────────────────────────

function AuditPanel({ entries, users }: { entries: AuditEntry[] | null; users: UserEntry[] | null }) {
  if (!entries) return <LoadingSkeleton />;

  const nameMap = new Map((users ?? []).map((u) => [u.id, u.full_name ?? u.email]));

  const formatAction = (action: string) => {
    const labels: Record<string, string> = {
      "user.invited": "Invited user",
      "role.changed": "Changed role",
      "access.granted": "Granted access",
      "store.created": "Created store",
      "store.updated": "Updated store",
      "impersonation.started": "Started impersonation",
      "impersonation.ended": "Ended impersonation",
    };
    return labels[action] ?? action;
  };

  const actionColors: Record<string, string> = {
    "impersonation.started": "bg-amber-800/40 text-amber-300",
    "impersonation.ended": "bg-amber-800/40 text-amber-300",
    "role.changed": "bg-blue-800/40 text-blue-300",
    "store.created": "bg-emerald-800/40 text-emerald-300",
  };

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <EmptyState message="No audit events recorded yet" />
      ) : (
        <div className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900/60 overflow-hidden">
          {entries.map((e) => (
            <div key={e.id} className="px-4 py-3 hover:bg-stone-800/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono", actionColors[e.action] ?? "bg-stone-800 text-stone-400")}>
                    {formatAction(e.action)}
                  </span>
                  {e.actor_user_id && (
                    <span className="text-[11px] text-stone-400">by {nameMap.get(e.actor_user_id) ?? e.actor_user_id.slice(0, 8)}</span>
                  )}
                  {e.target_user_id && (
                    <span className="text-[11px] text-stone-500">→ {nameMap.get(e.target_user_id) ?? e.target_user_id.slice(0, 8)}</span>
                  )}
                </div>
                <span className="text-[10px] text-stone-600">{timeAgo(e.created_at)}</span>
              </div>
              {Object.keys(e.metadata).length > 0 && (
                <p className="mt-1 text-[10px] text-stone-600 font-mono truncate max-w-xl">{JSON.stringify(e.metadata)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 10. Platform Settings ─────────────────────────────────────────────────────

function SettingsPanel() {
  const env = {
    "Runtime": "Next.js 14 / App Router",
    "Database": "Supabase (PostgreSQL)",
    "Auth": "Supabase Auth + RBAC",
    "POS Integration": "Oracle MICROS Simphony (BI API)",
    "Deployment": "Vercel",
    "Sync Engine": "v2 (adapter-based)",
  };

  const flags = [
    { key: "MICROS_IM_ENABLED", label: "MICROS Inventory Module", status: process.env.NEXT_PUBLIC_MICROS_IM_ENABLED === "true" },
  ];

  return (
    <div className="space-y-4">
      <SectionCard title="Environment">
        <div className="space-y-2">
          {Object.entries(env).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1">
              <span className="text-[11px] text-stone-500">{k}</span>
              <span className="text-[11px] font-mono text-stone-300">{v}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Feature Flags">
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.key} className="flex items-center justify-between py-1">
              <div>
                <span className="text-[11px] font-mono text-stone-300">{f.key}</span>
                <p className="text-[10px] text-stone-500">{f.label}</p>
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", f.status ? "bg-emerald-500/20 text-emerald-300" : "bg-stone-700 text-stone-400")}>
                {f.status ? "ON" : "OFF"}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Super Admin">
        <div className="space-y-2 text-[11px] text-stone-400">
          <p>Primary admin: <span className="text-stone-200 font-medium">Thami Gumpo</span> (newburf@gmail.com)</p>
          <p>Super admin bypasses all RBAC restrictions and can impersonate any user.</p>
          <p>All impersonation events are logged in the Audit Log.</p>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealthData | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLogsData | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsData | null>(null);
  const [syncPage, setSyncPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadOverview = useCallback(async () => {
    try { setOverview(await apiFetch("/api/admin/overview")); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadStores = useCallback(async () => {
    try { setStores((await apiFetch<{ stores: Store[] }>("/api/admin/stores")).stores); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadUsers = useCallback(async () => {
    try { setUsers((await apiFetch<{ users: UserEntry[] }>("/api/admin/users")).users); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadAudit = useCallback(async () => {
    try { setAudit((await apiFetch<{ entries: AuditEntry[] }>("/api/admin/audit")).entries); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadDataHealth = useCallback(async () => {
    try { setDataHealth(await apiFetch("/api/admin/data-health")); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadSyncLogs = useCallback(async (page = 1) => {
    try { setSyncLogs(await apiFetch(`/api/admin/sync-logs?page=${page}&limit=25`)); }
    catch (e: any) { setError(e.message); }
  }, []);

  const loadIntegrations = useCallback(async () => {
    try { setIntegrations(await apiFetch("/api/admin/integrations")); }
    catch (e: any) { setError(e.message); }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadOverview();
    loadStores();
    loadUsers();
  }, [loadOverview, loadStores, loadUsers]);

  // ── Lazy tab loading ──────────────────────────────────────────────────────

  useEffect(() => {
    if (tab === "audit" && !audit) loadAudit();
    if (tab === "data-health" && !dataHealth) loadDataHealth();
    if (tab === "sync-logs" && !syncLogs) loadSyncLogs(1);
    if (tab === "integrations" && !integrations) loadIntegrations();
  }, [tab, audit, dataHealth, syncLogs, integrations, loadAudit, loadDataHealth, loadSyncLogs, loadIntegrations]);

  // ── Sync log pagination ───────────────────────────────────────────────────

  useEffect(() => {
    if (tab === "sync-logs") loadSyncLogs(syncPage);
  }, [syncPage, tab, loadSyncLogs]);

  // ── Refresh ───────────────────────────────────────────────────────────────

  const handleRefresh = () => {
    setError(null);
    loadOverview();
    loadStores();
    loadUsers();
    if (tab === "audit") loadAudit();
    if (tab === "data-health") loadDataHealth();
    if (tab === "sync-logs") loadSyncLogs(syncPage);
    if (tab === "integrations") loadIntegrations();
  };

  return (
    <div className="min-h-screen space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-100 flex items-center gap-2">
            <span>🛡️</span> Platform Control Center
          </h1>
          <p className="mt-0.5 text-xs text-stone-500">Super admin · Full platform visibility & control</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-lg border border-stone-700 bg-stone-800/60 px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/30 px-4 py-2 text-xs text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Tab bar – scrollable, professional */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-stone-800 bg-stone-900/60 p-1 scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
              tab === t.id
                ? "bg-stone-800 text-stone-100 shadow-sm"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40",
            )}
          >
            <span className="text-sm">{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "overview"       && <OverviewPanel data={overview} />}
      {tab === "organisations"  && <OrganisationsPanel data={overview} />}
      {tab === "stores"         && <StoresPanel stores={stores} onRefresh={handleRefresh} />}
      {tab === "team"           && <TeamPanel users={users} stores={stores} onRefresh={handleRefresh} />}
      {tab === "roles"          && <RolesPanel users={users} />}
      {tab === "integrations"   && <IntegrationsPanel data={integrations} />}
      {tab === "data-health"    && <DataHealthPanel data={dataHealth} onRefresh={() => { setDataHealth(null); loadDataHealth(); }} />}
      {tab === "sync-logs"      && <SyncLogsPanel data={syncLogs} page={syncPage} setPage={setSyncPage} />}
      {tab === "audit"          && <AuditPanel entries={audit} users={users} />}
      {tab === "settings"       && <SettingsPanel />}
    </div>
  );
}
