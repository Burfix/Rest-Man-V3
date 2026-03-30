"use server";

/**
 * Server Actions for authentication.
 * These run on the server; cookies are set/cleared server-side.
 */

import { createSessionClient } from "@/lib/supabase/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function signIn(
  _prevState: { error: string } | null,
  formData: FormData
): Promise<{ error: string }> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  const next = (formData.get("next") as string | null) ?? "/dashboard";

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const cookieStore = cookies();
  const supabase = createSessionClient(cookieStore);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never expose Supabase internals to the UI
    if (
      error.message.toLowerCase().includes("invalid") ||
      error.message.toLowerCase().includes("invalid login")
    ) {
      return { error: "Invalid email or password." };
    }
    return { error: "Sign in failed. Please try again." };
  }

  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function signOut() {
  const cookieStore = cookies();
  const supabase = createSessionClient(cookieStore);
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPassword(
  _prevState: { error: string; success: boolean } | null,
  formData: FormData
): Promise<{ error: string; success: boolean }> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  if (!email) return { error: "Email address is required.", success: false };

  const cookieStore = cookies();
  const supabase = createSessionClient(cookieStore);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://si-cantina-concierge.vercel.app";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/reset-password`,
  });

  if (error) {
    return {
      error: "Could not send reset email. Check the address and try again.",
      success: false,
    };
  }
  return { error: "", success: true };
}
