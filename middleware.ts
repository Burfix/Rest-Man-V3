/**
 * Next.js middleware — Supabase Auth session guard.
 *
 * Protected routes:
 *   /dashboard/**  → redirect to /login if unauthenticated
 *   /api/**        → 401 JSON response if unauthenticated
 *
 * Public API routes (no auth required):
 *   /api/webhooks/**          → inbound webhooks (WhatsApp, etc.)
 *   /api/bookings/reminders/** → cron-triggered
 *   /api/actions/daily-reset  → cron-triggered
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// API paths that must remain public (webhooks, cron jobs)
const PUBLIC_API_PREFIXES = [
  "/api/webhooks/",
  "/api/bookings/reminders/",
  "/api/actions/daily-reset",
  "/api/compliance/status",
  "/api/micros/sync",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");
  const requestId = generateRequestId();

  // Inject request ID into request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  // Skip auth for public API endpoints
  if (isApiRoute && isPublicApi(pathname)) {
    const resp = NextResponse.next({ request: { headers: requestHeaders } });
    resp.headers.set("x-request-id", requestId);
    return resp;
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (!url || !anonKey || !url.startsWith("https://")) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    let response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // API routes: 401 JSON response
      if (isApiRoute) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 },
        );
      }
      // Dashboard routes: redirect to login
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    response.headers.set("x-request-id", requestId);
    return response;
  } catch {
    if (isApiRoute) {
      return NextResponse.json({ error: "Authentication error" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/api/:path*"],
};

