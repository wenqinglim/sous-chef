/**
 * Tests for the Instagram media provider (fetchInstagramMedia) — the scraper
 * API that supplies a reel's caption + video URL off our IP. The HTTP call is
 * mocked; we assert the request shape and the parsing/degradation behavior.
 */

import { fetchInstagramMedia } from "@/lib/extractors/instagram-scraper";

const REEL_URL = "https://www.instagram.com/reel/ABC123/";
const CDN_URL = "https://scontent-sea1-1.cdninstagram.com/v/t50/reel.mp4";

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

describe("fetchInstagramMedia", () => {
  test("returns null (without fetching) when APIFY_TOKEN is unset", async () => {
    delete process.env.APIFY_TOKEN;
    global.fetch = jest.fn();

    const result = await fetchInstagramMedia(REEL_URL);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("parses caption + videoUrl from the Apify dataset item", async () => {
    mockFetchJson([{ caption: "200g noodles, 3 tbsp butter. Method: toss.", videoUrl: CDN_URL }]);

    const result = await fetchInstagramMedia(REEL_URL);

    expect(result).toEqual({
      caption: "200g noodles, 3 tbsp butter. Method: toss.",
      videoUrl: CDN_URL,
    });
  });

  test("POSTs the reel URL to the Apify run-sync endpoint with the token", async () => {
    mockFetchJson([{ caption: "x", videoUrl: CDN_URL }]);

    await fetchInstagramMedia(REEL_URL);

    const [calledUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toContain("api.apify.com");
    expect(calledUrl).toContain("instagram-scraper");
    expect(calledUrl).toContain("token=apify_api_test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).directUrls).toEqual([REEL_URL]);
  });

  test("falls back to videoUrlBackup when videoUrl is absent", async () => {
    mockFetchJson([{ caption: "x", videoUrlBackup: CDN_URL }]);

    const result = await fetchInstagramMedia(REEL_URL);

    expect(result?.videoUrl).toBe(CDN_URL);
  });

  test("returns null caption/videoUrl fields when the item lacks them", async () => {
    mockFetchJson([{ shortCode: "ABC123" }]);

    const result = await fetchInstagramMedia(REEL_URL);

    expect(result).toEqual({ caption: null, videoUrl: null });
  });

  test("returns null on an empty dataset (private/removed reel)", async () => {
    mockFetchJson([]);
    expect(await fetchInstagramMedia(REEL_URL)).toBeNull();
  });

  test("returns null on a non-array response", async () => {
    mockFetchJson({ error: "bad input" });
    expect(await fetchInstagramMedia(REEL_URL)).toBeNull();
  });

  test("returns null on a non-ok HTTP status", async () => {
    mockFetchJson([{ caption: "x", videoUrl: CDN_URL }], false, 402);
    expect(await fetchInstagramMedia(REEL_URL)).toBeNull();
  });

  test("returns null when the fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    expect(await fetchInstagramMedia(REEL_URL)).toBeNull();
  });
});
