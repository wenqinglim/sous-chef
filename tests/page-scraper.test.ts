/**
 * Tests for the residential page fetcher (fetchPageHtmlViaScraper) — the Apify
 * Website Content Crawler that fetches a page's HTML off our IP when a recipe
 * site (e.g. Cloudflare-fronted) 403s our datacenter fetch. The HTTP call is
 * mocked; we assert the request shape and the parsing/degradation behavior.
 */

import { fetchPageHtmlViaScraper } from "@/lib/extractors/page-scraper";

const PAGE_URL = "https://natashaskitchen.com/smash-burger-recipe/";
const HTML = "<html><head><script type=\"application/ld+json\">{}</script></head></html>";

const originalFetch = global.fetch;
const originalToken = process.env.APIFY_TOKEN;

function mockFetchJson(value: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => value,
  });
}

beforeEach(() => {
  process.env.APIFY_TOKEN = "apify_api_test";
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.APIFY_TOKEN = originalToken;
  jest.restoreAllMocks();
});

describe("fetchPageHtmlViaScraper", () => {
  test("returns null (without fetching) when APIFY_TOKEN is unset", async () => {
    delete process.env.APIFY_TOKEN;
    global.fetch = jest.fn();

    const result = await fetchPageHtmlViaScraper(PAGE_URL);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns the rendered HTML from the Apify dataset item", async () => {
    mockFetchJson([{ url: PAGE_URL, html: HTML }]);

    const result = await fetchPageHtmlViaScraper(PAGE_URL);

    expect(result).toBe(HTML);
  });

  test("POSTs the page URL to the Apify crawler endpoint with the token + residential proxy", async () => {
    mockFetchJson([{ html: HTML }]);

    await fetchPageHtmlViaScraper(PAGE_URL);

    const [calledUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toContain("api.apify.com");
    expect(calledUrl).toContain("website-content-crawler");
    expect(calledUrl).toContain("token=apify_api_test");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.startUrls).toEqual([{ url: PAGE_URL }]);
    expect(body.saveHtml).toBe(true);
    expect(body.maxCrawlPages).toBe(1);
    expect(body.proxyConfiguration.apifyProxyGroups).toContain("RESIDENTIAL");
  });

  test("returns null when the item has no html", async () => {
    mockFetchJson([{ url: PAGE_URL, text: "just text" }]);
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });

  test("returns null when the html is blank", async () => {
    mockFetchJson([{ html: "   " }]);
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });

  test("returns null on an empty dataset (page unreachable / quota exhausted)", async () => {
    mockFetchJson([]);
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });

  test("returns null on a non-array response", async () => {
    mockFetchJson({ error: "bad input" });
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });

  test("returns null on a non-ok HTTP status", async () => {
    mockFetchJson([{ html: HTML }], false, 402);
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });

  test("returns null when the fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    expect(await fetchPageHtmlViaScraper(PAGE_URL)).toBeNull();
  });
});
