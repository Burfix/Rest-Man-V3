/**
 * Google Places API (New) client — places.googleapis.com/v1
 * Server-side only — never call from the browser (exposes API key).
 *
 * Fetch responses are cached by Next.js for 1 hour to reduce quota usage.
 */

export interface GoogleReview {
  author_name: string;
  author_url: string;
  profile_photo_url: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number; // Unix timestamp (seconds)
}

export interface PlaceDetails {
  name: string;
  rating: number;
  user_ratings_total: number;
  reviews: GoogleReview[];
}

const PLACES_BASE = "https://places.googleapis.com/v1";

/** Fetch full place details (rating + up to 5 reviews) using Places API (New). */
export async function getPlaceDetails(
  placeId: string
): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  // Trim any accidental whitespace / newlines in the stored Place ID
  const cleanId = placeId.trim();
  const url = `${PLACES_BASE}/places/${encodeURIComponent(cleanId)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,reviews",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[GooglePlaces] getPlaceDetails HTTP ${res.status}:`, body);
      return null;
    }
    const json = await res.json();
    if (json.error) {
      console.error("[GooglePlaces] getPlaceDetails error:", json.error);
      return null;
    }
    return {
      name: json.displayName?.text ?? json.displayName ?? "",
      rating: json.rating ?? 0,
      user_ratings_total: json.userRatingCount ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reviews: (json.reviews ?? []).map((r: any): GoogleReview => ({
        author_name: r.authorAttribution?.displayName ?? "Anonymous",
        author_url: r.authorAttribution?.uri ?? "",
        profile_photo_url: r.authorAttribution?.photoUri ?? "",
        rating: r.rating ?? 0,
        relative_time_description: r.relativePublishTimeDescription ?? "",
        text: r.text?.text ?? r.originalText?.text ?? "",
        time: r.publishTime
          ? Math.floor(new Date(r.publishTime).getTime() / 1000)
          : 0,
      })),
    };
  } catch (err) {
    console.error("[GooglePlaces] getPlaceDetails error:", err);
    return null;
  }
}

/**
 * Auto-discover the Place ID via Places API (New) text search.
 * Result is cached for 24 hours.
 * Set GOOGLE_PLACE_ID env var to skip this call entirely.
 */
export async function findPlaceId(query: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName",
      },
      body: JSON.stringify({ textQuery: query }),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.places?.length) return null;
    const id: string = json.places[0].id ?? "";
    if (id) {
      console.log(
        `[GooglePlaces] Discovered Place ID: ${id}` +
          ` — add GOOGLE_PLACE_ID=${id} to Vercel env vars to skip discovery.`
      );
    }
    return id || null;
  } catch (err) {
    console.error("[GooglePlaces] findPlaceId error:", err);
    return null;
  }
}
