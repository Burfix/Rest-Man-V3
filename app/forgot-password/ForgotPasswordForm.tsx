"use client";

import { useFormState, useFormStatus } from "react-dom";
import { forgotPassword } from "@/app/login/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
    >
      {pending ? "Sending reset email…" : "Send reset email"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useFormState(forgotPassword, null);

  if (state?.success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-5 text-center">
        <p className="text-sm font-semibold text-green-800">Check your inbox</p>
        <p className="mt-1 text-sm text-green-700">
          We sent a password reset link to your email. It expires in 1 hour.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block text-xs text-stone-500 underline-offset-2 hover:underline"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-semibold uppercase tracking-wide text-stone-500"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          placeholder="manager@venue.co.za"
        />
      </div>

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
        >
          {state.error}
        </p>
      )}

      <SubmitButton />

      <div className="text-center">
        <a
          href="/login"
          className="text-xs text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline"
        >
          Back to sign in
        </a>
      </div>
    </form>
  );
}
