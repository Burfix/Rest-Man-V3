"use server";

/**
 * UserProfile — reads the current authenticated user from the Supabase session
 * and renders their email + a sign-out button.
 * This is a Server Component so it can read cookies directly.
 */

import { cookies } from "next/headers";
import { createSessionClient } from "@/lib/supabase/session";
import { signOut } from "@/app/login/actions";

export default async function UserProfile() {
  let email: string | null = null;

  try {
    const cookieStore = cookies();
    const supabase = createSessionClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
  } catch {
    // If session check fails, show nothing
  }

  return (
    <div className="border-t border-stone-100 px-4 py-4">
      {email && (
        <p
          className="mb-2 truncate text-xs font-medium text-stone-600"
          title={email}
        >
          {email}
        </p>
      )}
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"
        >
          Sign out
        </button>
      </form>
      <p className="mt-3 text-xs text-stone-300">V&A Waterfront · Cape Town</p>
    </div>
  );
}
