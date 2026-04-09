/**
 * PostHog server-side client (posthog-node).
 * Used for focused event capture in API routes only.
 * No autocapture, no pageviews, no client-side JS.
 */
import { PostHog } from "posthog-node";

// Singleton — reuse across hot-reloads and serverless invocations.
let _client: PostHog | null = null;

export function getPosthog(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null; // gracefully disabled when key is not set
  if (!_client) {
    _client = new PostHog(key, {
      host: "https://eu.i.posthog.com",
      flushAt: 1,          // flush immediately in serverless environments
      flushInterval: 0,
    });
  }
  return _client;
}
