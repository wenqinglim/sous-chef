/**
 * Residential-IP page fetcher for recipe sites that block our datacenter IP.
 *
 * Some recipe sites (e.g. natashaskitchen.com) sit behind Cloudflare Bot
 * Management, which scores every request on its TLS/JA3 fingerprint *and* the
 * IP's reputation — not just its headers. Node's `fetch` (undici) has a
 * non-browser TLS fingerprint and Vercel runs on datacenter IPs, so a direct
 * `safeFetch` gets a 403 no matter how complete the browser header set is. The
 * full client-hint fingerprint in safe-fetch.ts (BROWSER_FINGERPRINT_HEADERS)
 * is necessary for the sites that *only* sniff headers, but it cannot pass a
 * TLS-fingerprint + IP-reputation challenge. Header spoofing alone is a dead end
 * for those sites — see the failed attempt in commit 24d8394 (#41).
 *
 * Same playbook as Instagram (instagram-scraper.ts): when the direct fetch is
 * blocked, delegate the fetch to Apify, which runs a real browser behind a
 * residential proxy and hands back the rendered HTML. We then run the normal
 * schema.org extractor on that HTML, so nothing downstream changes.
 *
 * Returns null (not an error) when unconfigured or the scrape yields nothing —
 * the caller degrades to a clear error + the manual-paste fallback.
 */

// Apify's maintained Website Content Crawler. The synchronous run endpoint runs
// the actor and returns the resulting dataset items inline, so one POST gives us
// the rendered page HTML. Same Apify account/token as the Instagram scraper.
const APIFY_ENDPOINT =
  "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items";

// Backstop timeout, not a steady-state budget. The actor cold-starts and renders
// the page in a real browser behind a residential proxy, which can take a while;
// we keep this under the /api/extract route's 60s maxDuration. A direct safeFetch
// 403 returns near-instantly (no body is read), so this fallback gets almost the
// whole request budget.
const APIFY_TIMEOUT_MS = 50_000;

/**
 * Fetch a page's rendered HTML via the residential scraper.
 *
 * Returns the HTML string, or null when the provider is unconfigured or yields
 * nothing — the caller degrades to a clear error / the manual-paste fallback.
 */
export async function fetchPageHtmlViaScraper(url: string): Promise<string | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error(
      "[scrape] APIFY_TOKEN not set — cannot fetch blocked page via scraper. Paste the recipe to import."
    );
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${APIFY_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url }],
        // Single page only — we want this exact recipe URL, not a crawl.
        maxCrawlPages: 1,
        maxCrawlDepth: 0,
        // A real browser is required to clear Cloudflare's JS/TLS challenge;
        // the cheerio crawler would get the same 403 we already got.
        crawlerType: "playwright:firefox",
        // We need the raw HTML (schema.org JSON-LD lives in it); skip the
        // text/markdown transforms the actor does by default.
        saveHtml: true,
        saveMarkdown: false,
        // Residential IPs are what actually clears the IP-reputation check.
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[scrape] Apify crawler returned HTTP ${res.status}`);
      return null;
    }

    const items: unknown = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      console.error(
        "[scrape] Apify crawler returned no items (page unreachable, blocked even residentially, or quota exhausted?)."
      );
      return null;
    }

    const item = items[0] as Record<string, unknown>;
    const html =
      typeof item.html === "string" && item.html.trim().length > 0 ? item.html : null;
    console.error(
      `[scrape] Apify crawler: html=${html ? `${html.length} chars` : "none"}`
    );
    return html;
  } catch (e) {
    console.error("[scrape] Apify crawler fetch failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
