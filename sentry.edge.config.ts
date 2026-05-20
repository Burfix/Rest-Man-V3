import * as Sentry from "@sentry/nextjs";

// Edge runtime: minimal config — many Node.js Sentry integrations are unavailable here.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
