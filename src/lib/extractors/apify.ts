/**
 * Shared Apify actor runner.
 *
 * Both scrapers we depend on — the Instagram media scraper
 * (`instagram-scraper.ts`) and the residential page fetcher
 * (`page-scraper.ts`) — talk to Apify's synchronous
 * `run-sync-get-dataset-items` endpoint the same way: token guard, one POST
 * with `?token=`, abort-on-timeout, and degrade-to-null on any failure
 * (unconfigured token, non-2xx, empty/non-array dataset, thrown error). This
 * centralizes that boilerplate so the timeout/abort/degradation logic lives in
 * one place; callers supply the endpoint + request body and parse the returned
 * dataset items.
 *
 * Returns the dataset items array, or null when the run is unconfigured or
 * yields nothing — callers map that to a clear error + the manual-paste fallback.
 */

export async function runApifyActor(
  endpoint: string,
  body: object,
  opts: { timeoutMs: number; logPrefix: string }
): Promise<unknown[] | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error(
      `${opts.logPrefix} APIFY_TOKEN not set — cannot reach the scraper. Paste the recipe/caption to import.`
    );
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${endpoint}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`${opts.logPrefix} Apify returned HTTP ${res.status}`);
      return null;
    }

    const items: unknown = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      console.error(
        `${opts.logPrefix} Apify returned no items (target unreachable, private/removed, or quota exhausted?).`
      );
      return null;
    }

    return items;
  } catch (e) {
    console.error(`${opts.logPrefix} Apify fetch failed:`, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
