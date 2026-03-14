/**
 * Login page — staff authentication.
 * Accessible only when unauthenticated; authenticated users are sent to /dashboard.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/session";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign In — Ops Engine",
};

interface Props {
  searchParams: { next?: string };
}

const FEATURES = [
  "Live bookings & cover management",
  "Google Reviews monitoring",
  "Weekly sales performance",
  "Equipment & maintenance tracking",
  "Daily operations reports",
  "Priority alerts & escalations",
];

export default async function LoginPage({ searchParams }: Props) {
  try {
    const cookieStore = cookies();
    const supabase = createSessionClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  } catch {
    // Env vars not configured — render login form
  }

  const next = searchParams.next ?? "/dashboard";

  return (
    <div className="flex min-h-screen">
      {/* ── Left panel: brand & context (desktop only) ────────────── */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col justify-between bg-stone-900 px-12 py-14">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
            Ops Engine
          </p>
          <h1 className="mt-6 text-4xl font-bold leading-tight text-white">
            Operations
            <br />
            Command Centre
          </h1>
          <p className="mt-4 text-base leading-relaxed text-stone-400">
            Manage bookings, reviews, sales, maintenance, and daily
            operations — all from one unified dashboard.
          </p>
        </div>

        <ul className="space-y-3">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm text-stone-300">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-400">
                ✓
              </span>
              {f}
            </li>
          ))}
        </ul>

        <p className="text-xs text-stone-600">V&A Waterfront · Cape Town</p>
      </div>

      {/* ── Right panel: form ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-stone-50 px-6 py-12">
        {/* Mobile brand header */}
        <div className="mb-8 text-center lg:hidden">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
            Ops Engine
          </p>
          <h1 className="mt-1 text-2xl font-bold text-stone-900">
            Operations Centre
          </h1>
        </div>

        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-stone-200 bg-white px-8 py-9 shadow-sm">
            <h2 className="mb-1 text-xl font-semibold text-stone-900">
              Sign in
            </h2>
            <p className="mb-7 text-sm text-stone-500">
              Enter your management account credentials.
            </p>
            <LoginForm next={next} />
          </div>

          <p className="mt-5 text-center text-xs text-stone-400">
            Ops Engine · Operations Platform
          </p>
        </div>
      </div>
    </div>
  );
}
