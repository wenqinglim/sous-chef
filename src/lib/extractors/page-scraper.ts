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

import { runApifyActor } from "@/lib/extractors/apify";

// Apify's maintained Website Content Crawler. The synchronous run endpoint runs
// the actor and returns the resulting dataset items inline, so one POST gives us
// the rendered page HTML. Same Apify account/token as the Instagram scraper.
const APIFY_ENDPOINT =
  "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items";

// Backstop timeout sized to leave headroom for the *downstream* extraction, not
// just the scrape. The /api/extract route's budget is 60s (maxDuration). On this
// path the request must still, after this call returns, run schema.org parsing
// and — if the scraped HTML has no clean JSON-LD — a Claude `extractWithLlm`
// round-trip (~15-20s) before saving. The preceding safeFetch 403 returns
// near-instantly (no body is read). So we cap the scrape at 35s, leaving ~20s
// for the LLM fallback + save to finish inside maxDuration; a scrape that needs
// longer fails here (→ clean 502 + paste fallback) rather than getting the whole
// request killed mid-LLM-call. (cf. instagram-scraper.ts, which budgets 45s
// because its downstream work is a bounded binaryFetch + Whisper, not an LLM.)
const APIFY_TIMEOUT_MS = 35_000;

/**
 * Fetch a page's rendered HTML via the residential scraper.
 *
 * Returns the HTML string, or null when the provider is unconfigured or yields
 * nothing — the caller degrades to a clear error / the manual-paste fallback.
 */
export async function fetchPageHtmlViaScraper(url: string): Promise<string | null> {
  const items = await runApifyActor(
    APIFY_ENDPOINT,
    {
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
    },
    { timeoutMs: APIFY_TIMEOUT_MS, logPrefix: "[scrape]" }
  );
  if (!items) return null;

  const item = items[0] as Record<string, unknown>;
  const html =
    typeof item.html === "string" && item.html.trim().length > 0 ? item.html : null;
  console.error(`[scrape] Apify crawler: html=${html ? `${html.length} chars` : "none"}`);
  return html;
}
