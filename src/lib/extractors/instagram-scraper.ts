/**
 * Instagram media provider.
 *
 * Instagram login-walls server-side requests coming from datacenter IPs
 * (Vercel's) — even with a session cookie — so we can no longer fetch a reel's
 * page, caption, or video directly. Instead a third-party scraper API does the
 * fetch on its own (residential) infrastructure and hands us back the only two
 * things the rest of the pipeline needs: the caption text and the MP4 video URL.
 * No Instagram account or credentials of ours are involved, so there is nothing
 * for Instagram to flag against a personal account.
 *
 * The backend sits behind the `InstagramMedia` interface so a different provider
 * (e.g. a faster RapidAPI endpoint) can be dropped in without touching callers.
 */

export interface InstagramMedia {
  /** Reel caption text (already de-preambled by the provider), or null. */
  caption: string | null;
  /** Direct CDN MP4 URL for the reel video, or null. */
  videoUrl: string | null;
}

// Apify's maintained Instagram scraper. The synchronous run endpoint runs the
// actor and returns the resulting dataset items inline, so one POST gives us the
// caption + video URL. Free tier ($5/mo platform credit) easily covers 2 users.
const APIFY_ENDPOINT =
  "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";

// Backstop timeout, NOT a steady-state budget. The actor cold-starts on each run,
// but in practice returns in a few seconds. This matters because on the audio-
// fallback path the request must still binaryFetch (≤30s) and transcribe with
// Whisper *after* this call returns — so if Apify ever ran near its full budget,
// the total would blow past the /api/extract route's 60s maxDuration and the
// platform would kill the request mid-transcription. We keep the budget well under
// 60s and rely on Apify being fast; a reel that genuinely needs ~45s of scraping
// will fail the audio path either way. (A RapidAPI provider would respond in 1–3s
// if latency ever becomes a problem; swap it in behind fetchInstagramMedia.)
const APIFY_TIMEOUT_MS = 45_000;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/**
 * Fetch a reel's caption + video URL via the scraper API.
 *
 * Returns null (not an error) when the provider is unconfigured or yields
 * nothing — the caller degrades to a clear error / the manual-paste fallback.
 */
export async function fetchInstagramMedia(
  url: string
): Promise<InstagramMedia | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error(
      "[IG] APIFY_TOKEN not set — cannot fetch reel via scraper API. Paste the caption to import."
    );
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${APIFY_ENDPOINT}?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [url],
          resultsType: "details",
          resultsLimit: 1,
          addParentData: false,
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      console.error(`[IG] Apify scraper returned HTTP ${res.status}`);
      return null;
    }

    const items: unknown = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      console.error(
        "[IG] Apify scraper returned no items (reel private, removed, or quota exhausted?)."
      );
      return null;
    }

    const item = items[0] as Record<string, unknown>;
    const caption = firstString(item.caption);
    const videoUrl = firstString(item.videoUrl, item.videoUrlBackup);
    console.error(
      `[IG] Apify scraper: caption=${caption ? `${caption.length} chars` : "none"}, video=${videoUrl ? "yes" : "none"}`
    );
    return { caption, videoUrl };
  } catch (e) {
    console.error("[IG] Apify scraper fetch failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
