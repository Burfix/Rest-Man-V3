/**
 * /dashboard/compliance-engine
 *
 * Entry point to the Compliance Engine (separate system).
 * Does NOT import or merge compliance code — surfaces a link only.
 *
 * Portal URL is read from NEXT_PUBLIC_COMPLIANCE_URL at build time,
 * falling back to the Vercel deployment URL.
 *
 * Access: super_admin | executive | head_office | area_manager | auditor | tenant_owner
 */

import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/get-user-context";
import { logger } from "@/lib/logger";

// ── Inline SVG icons (no external dependency) ─────────────────────────────────
function IconArrowUpRight({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M7 7h10v10" /><path d="M7 17 17 7" />
    </svg>
  );
}
function IconShieldCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconBadgeCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconClock({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}

export const dynamic = "force-dynamic";

const ALLOWED = ["super_admin", "executive", "head_office", "area_manager", "auditor", "tenant_owner"];

const COMPLIANCE_URL =
  process.env.NEXT_PUBLIC_COMPLIANCE_URL ?? "https://vna-compliance.vercel.app";

const QUICK_LINKS = [
  {
    label: "Tenant Portal",
    description: "Submit & track certificates",
    path: "/portal",
  },
  {
    label: "Review Queue",
    description: "Approve pending submissions",
    path: "/review-queue",
  },
  {
    label: "Risk Radar",
    description: "Precinct compliance overview",
    path: "/risk-radar",
  },
];

export default async function ComplianceEnginePage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ALLOWED.includes(ctx.role ?? "")) {
    redirect("/dashboard");
  }

  logger.info("Compliance Engine portal accessed", {
    type: "external_navigation",
    target: "compliance_engine",
    userId: ctx.userId,
    role: ctx.role,
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 tracking-tight">
          Compliance Engine
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Manage tenant compliance, certificates, and audit readiness across your precinct.
        </p>
      </div>

      {/* ── Main card ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 overflow-hidden">
        {/* Card header */}
        <div className="flex items-center gap-3 border-b border-stone-100 dark:border-stone-800 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40 shrink-0">
            <IconShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Compliance Engine
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-500 leading-tight">
              Powered by ForgeStack · Separate system
            </p>
          </div>
        </div>

        {/* Meta strip */}
        <div className="flex flex-wrap gap-4 px-5 py-4 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <IconBadgeCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-xs text-stone-600 dark:text-stone-400">
              Trial:{" "}
              <span className="font-medium text-stone-800 dark:text-stone-200">
                V&amp;A Waterfront
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs text-stone-600 dark:text-stone-400">
              Status:{" "}
              <span className="font-medium text-stone-800 dark:text-stone-200">Active</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <IconClock className="h-4 w-4 text-stone-400 shrink-0" />
            <span className="text-xs text-stone-500 dark:text-stone-500">
              Sync: live via compliance portal
            </span>
          </div>
        </div>

        {/* Description + CTA */}
        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
            The Compliance Engine is a dedicated portal where tenants submit their compliance
            certificates, officers review and approve submissions, and executives monitor audit
            readiness across the precinct.
          </p>

          <div className="flex flex-wrap gap-3 items-center">
            <a
              href={COMPLIANCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 dark:bg-stone-100 px-4 py-2.5 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
            >
              Open Compliance Portal
              <IconArrowUpRight className="h-4 w-4" />
            </a>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-500">
              <IconArrowUpRight className="h-3 w-3" />
              External
            </span>
          </div>
        </div>
      </div>

      {/* ── Quick links ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {QUICK_LINKS.map(({ label, description, path }) => (
          <a
            key={path}
            href={`${COMPLIANCE_URL}${path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-1 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 px-4 py-3.5 hover:border-stone-300 dark:hover:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-900 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-stone-800 dark:text-stone-200">
                {label}
              </span>
              <IconArrowUpRight className="h-3.5 w-3.5 text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors" />
            </div>
            <span className="text-[11px] text-stone-500 dark:text-stone-500 leading-tight">
              {description}
            </span>
          </a>
        ))}
      </div>

      {/* ── Footer note ──────────────────────────────────────────────── */}
      <p className="text-[11px] text-stone-400 dark:text-stone-600 leading-relaxed">
        The Compliance Engine runs as a separate system. Data is managed independently. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_COMPLIANCE_URL</code> in your environment to
        point to a custom subdomain.
      </p>
    </div>
  );
}
