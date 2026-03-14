/**
 * Google live reviews service.
 * Fetches the latest 5 Google reviews directly from the Places API.
 *
 * Place ID resolution order:
 *  1. GOOGLE_PLACE_ID env var (fastest — no extra API call)
 *  2. Auto-discover via Places Text Search (≤ 1 call per 24h, cached)
 *
 * After first deploy, check Vercel function logs for the line:
 *   [GoogleReviews] Discovered Place ID: ChIJ...
 * Then set GOOGLE_PLACE_ID=<that value> in Vercel env vars to skip discovery.
 */

import { findPlaceId, getPlaceDetails, GoogleReview } from "@/lib/google-places";

/** Venue query used for Place ID discovery if GOOGLE_PLACE_ID is not set. */
const SEARCH_QUERY = "Si Cantina Sociale Cape Town";

export interface GoogleLiveReviews {
  placeName: string;
  overallRating: number;
  totalReviews: number;
  reviews: GoogleReview[];
}

/**
 * Returns live Google reviews or `null` if:
 * - GOOGLE_PLACES_API_KEY is not set
 * - the Place ID cannot be resolved
 * - the API call fails (network / quota)
 *
 * Callers should handle null gracefully — the UI hides the section
 * when no data is available.
 */
export async function getGoogleLiveReviews(): Promise<GoogleLiveReviews | null> {
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;

  // Prefer the pre-cached static env var to avoid an extra API call.
  // Trim handles any accidental \n stored in the Vercel env var value.
  let placeId = process.env.GOOGLE_PLACE_ID?.trim() ?? null;

  if (!placeId) {
    placeId = await findPlaceId(SEARCH_QUERY);
    if (placeId) {
      // Log once so the operator can hard-code it.
      console.log(
        `[GoogleReviews] Discovered Place ID: ${placeId}` +
          ` — add GOOGLE_PLACE_ID=${placeId} to Vercel env vars to skip discovery.`
      );
    }
  }

  if (!placeId) return null;

  const details = await getPlaceDetails(placeId);
  if (!details) return null;

  return {
    placeName: details.name,
    overallRating: details.rating,
    totalReviews: details.user_ratings_total,
    reviews: details.reviews ?? [],
  };
}
