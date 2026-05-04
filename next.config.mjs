import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withSentryConfig(nextConfig, {
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only print Sentry upload feedback in CI
  silent: !process.env.CI,

  // Upload source maps to Sentry so stack traces are readable in production
  // but strip them from the client bundle so paths aren't exposed to browsers
  hideSourceMaps: true,
  widenClientFileUpload: true,

  // Remove the Sentry logger in the production bundle
  disableLogger: true,

  // Auto-instrument Vercel Cron Monitors (links cron runs to Sentry check-ins)
  automaticVercelMonitors: true,
});
