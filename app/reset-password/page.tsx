"use client";

/**
 * Reset Password page.
 *
 * Supabase sends a recovery link whose hash contains the access_token.
 * The browser Supabase client detects this on mount and fires the
 * PASSWORD_RECOVERY auth event, establishing a temporary session.
 * Once the session is ready we allow the user to set a new password.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Stage = "loading" | "ready" | "submitting" | "success" | "error";

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const supabase = createClient();

    // Check for error in the URL hash (e.g. #error=access_denied&error_description=...)
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const hashError = params.get("error");
    const hashErrorDesc = params.get("error_description");

    if (hashError) {
      const msg = hashErrorDesc?.replace(/\+/g, " ") || hashError;
      setErrorMsg(
        msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("denied")
          ? "This invite link has expired or has already been used. Please ask your admin to resend the invite."
          : msg
      );
      setStage("error");
      return;
    }

    // Listen for the recovery event that Supabase fires after parsing the hash
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStage("ready");
      }
    });

    // The singleton client may have already processed the hash before the listener
    // was set up. Check if we already have a session from a recovery token.
    const hashType = params.get("type");
    if (hashType === "recovery" || hashType === "invite") {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setStage((s) => (s === "loading" ? "ready" : s));
        }
      });
    }

    // Timeout fallback — if no event fires within 8s, show error
    const timeout = setTimeout(() => {
      setStage((s) => {
        if (s === "loading") {
          setErrorMsg("Could not verify the reset link. It may have expired or already been used.");
          return "error";
        }
        return s;
      });
    }, 8000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setStage("submitting");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg(
        error.message.toLowerCase().includes("expired")
          ? "Reset link has expired. Request a new one."
          : "Failed to update password. Please try again."
      );
      setStage("ready");
    } else {
      setStage("success");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
            Ops Engine
          </p>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">
            Set new password
          </h1>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white px-8 py-9 shadow-sm">
          {stage === "loading" && (
            <p className="text-center text-sm text-stone-500">
              Verifying reset link…
            </p>
          )}

          {stage === "error" && !password && (
            <div className="text-center">
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {errorMsg}
              </p>
              <a
                href="/login"
                className="mt-5 inline-block rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
              >
                Go to login
              </a>
            </div>
          )}

          {stage === "success" && (
            <div className="text-center">
              <p className="text-sm font-semibold text-green-800">
                Password updated
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Your password has been changed successfully.
              </p>
              <a
                href="/login"
                className="mt-5 inline-block rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
              >
                Sign in
              </a>
            </div>
          )}

          {(stage === "ready" || stage === "submitting" || stage === "error") && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wide text-stone-500"
                >
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm"
                  className="block text-xs font-semibold uppercase tracking-wide text-stone-500"
                >
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                  placeholder="••••••••"
                />
              </div>

              {errorMsg && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={stage === "submitting"}
                className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
              >
                {stage === "submitting" ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
