/**
 * Next.js middleware — Supabase Auth session guard + security headers.
 *
 * Protected routes:
 *   /dashboard/**  → redirect to /login if unauthenticated
 *   /api/**        → 401 JSON response if unauthenticated
 *
 * Bypass categories (no Supabase session required):
 *
 *   WEBHOOK_PATHS     — inbound webhooks from Meta, etc.
 *                       Route-level HMAC/signature verification is REQUIRED.
 *
 *   EXTERNAL_API_PATHS — endpoints called by third-party tools (e.g. WordPress plugin).
 *                        Route-level API key verification is REQUIRED.
 *
 *   Cron requests     — any /api/** request whose Authorization header matches
 *                        Bearer CRON_SECRET. Vercel cron jobs attach this header
 *                        automatically when CRON_SECRET is set.
 *                        Route-level cronGuard() still verifies the secret a second time.
 *
 * Operational routes (/api/micros/*, /api/reports/*, /api/accountability/*, etc.) are
 * NO LONGER unconditionally bypassed. They either arrive with a valid user session
 * (POST/manual triggers) or with Authorization: Bearer CRON_SECRET (cron triggers).
 */

import * as Sentry from "@sentry/nextjs";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// ── Bypass category 1: public webhooks ───────────────────────────────────────
// These have no Supabase session. Route-level signature verification is mandatory.
const WEBHOOK_PATHS = [
  "/api/webhooks/",
];

// ── Bypass category 2: external API callers ──────────────────────────────────
// Called by non-browser clients (WordPress, external tools) or uptime monitors.
// No Supabase session. Route-level verification is mandatory (API key, or public by design).
const EXTERNAL_API_PATHS = [
  "/api/compliance/status",
  "/api/health",           // public health check — no auth required for uptime monitors
];

function isWebhook(pathname: string): boolean {
  return WEBHOOK_PATHS.some((p) => pathname.startsWith(p));
}

function isExternalApi(pathname: string): boolean {
  return EXTERNAL_API_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Cron jobs (Vercel or external) carry Authorization: Bearer CRON_SECRET.
 * Verify the header here so the bypass is authenticated, not unconditional.
 * Route handlers call cronGuard() for a redundant second check.
 */
function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// ── Security response headers ─────────────────────────────────────────────────
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.sentry-cdn.com https://*.sentry.io",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://sentry.io https://us.i.posthog.com https://us-assets.i.posthog.com",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
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

  // ── Bypass 1: Webhooks (signature verification at route level) ────────────
  if (isApiRoute && isWebhook(pathname)) {
    const resp = NextResponse.next({ request: { headers: requestHeaders } });
    resp.headers.set("x-request-id", requestId);
    return addSecurityHeaders(resp);
  }

  // ── Bypass 2: External API callers (API key verification at route level) ──
  if (isApiRoute && isExternalApi(pathname)) {
    const resp = NextResponse.next({ request: { headers: requestHeaders } });
    resp.headers.set("x-request-id", requestId);
    return addSecurityHeaders(resp);
  }

  // ── Bypass 3: Authenticated cron requests (CRON_SECRET verified here + at route) ──
  if (isApiRoute && isCronRequest(request)) {
    const resp = NextResponse.next({ request: { headers: requestHeaders } });
    resp.headers.set("x-request-id", requestId);
    return addSecurityHeaders(resp);
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
    return addSecurityHeaders(response);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "middleware", pathname: request.nextUrl.pathname } });
    if (isApiRoute) {
      return NextResponse.json({ error: "Authentication error" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/api/:path*"],
};

