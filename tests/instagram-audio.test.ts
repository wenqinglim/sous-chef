/**
 * Tests for Instagram audio extraction:
 *   - extractVideoUrl (og:video parsing)
 *   - binaryFetch (binary download with size cap)
 *   - transcribeWithWhisper (Groq Whisper transcription, mocked)
 *   - extractFromInstagramWithAudio orchestration
 */

import * as fs from "fs";
import * as path from "path";

// Mock the LLM extractor so orchestration tests never hit Claude.
jest.mock("@/lib/extractors/llm-fallback", () => ({
  extractWithLlm: jest.fn(),
}));

// Mock the audio helpers so orchestration tests control each step. The video
// URL + caption now come from the scraper provider (mocked below), so the
// orchestration only needs binaryFetch + transcribeWithWhisper from here. The
// video-discovery helpers stay exported (and are unit-tested via requireActual).
jest.mock("@/lib/extractors/instagram-audio", () => {
  const actual = jest.requireActual("@/lib/extractors/instagram-audio");
  return {
    extractVideoUrl: actual.extractVideoUrl,
    extractVideoUrlFromApiJson: actual.extractVideoUrlFromApiJson,
    CDN_ANY_RE: actual.CDN_ANY_RE,
    unescapeEmbedded: actual.unescapeEmbedded,
    binaryFetch: jest.fn(),
    transcribeWithWhisper: jest.fn(),
    MAX_VIDEO_BYTES: 24 * 1024 * 1024,
  };
});

// Mock the scraper provider — orchestration tests supply caption + videoUrl.
jest.mock("@/lib/extractors/instagram-scraper", () => ({
  fetchInstagramMedia: jest.fn(),
}));

// Mock openai for the transcribeWithWhisper unit tests (imported separately).
jest.mock("openai");

import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import {
  binaryFetch,
  transcribeWithWhisper,
} from "@/lib/extractors/instagram-audio";
import { fetchInstagramMedia } from "@/lib/extractors/instagram-scraper";
import { extractFromInstagramWithAudio } from "@/lib/extractors/instagram";
import type { Recipe } from "@/types";

const mockedExtractWithLlm = extractWithLlm as jest.MockedFunction<typeof extractWithLlm>;
const mockedFetchInstagramMedia = fetchInstagramMedia as jest.MockedFunction<
  typeof fetchInstagramMedia
>;
const mockedBinaryFetch = binaryFetch as jest.MockedFunction<typeof binaryFetch>;
const mockedTranscribeWithWhisper = transcribeWithWhisper as jest.MockedFunction<
  typeof transcribeWithWhisper
>;

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

const recipeHtml = loadFixture("instagram-recipe.html");

const REEL_URL = "https://www.instagram.com/reel/ABC123/";

// Complete recipe (both ingredients and instructions present).
const mockRecipeComplete: Recipe = {
  id: "test-id",
  url: REEL_URL,
  title: "Garlic Butter Noodles",
  base_servings: 2,
  parsed_at: new Date().toISOString(),
  cuisine_source: "unknown",
  ingredients: [
    { recipe_id: "test-id", raw_text: "200g noodles", quantity: 200, unit: "g", name: "noodles", canonical_id: null },
  ],
  instructions: ["Boil noodles.", "Toss with garlic butter."],
};

// Partial recipe — ingredients only, no instructions (the reported bug scenario).
const mockRecipePartial: Recipe = {
  id: "test-id",
  url: REEL_URL,
  title: "Garlic Butter Noodles",
  base_servings: 2,
  parsed_at: new Date().toISOString(),
  cuisine_source: "unknown",
  ingredients: [
    { recipe_id: "test-id", raw_text: "200g noodles", quantity: 200, unit: "g", name: "noodles", canonical_id: null },
  ],
  instructions: [],
};

// Caption strings the scraper provider returns (orchestration tests).
const RECIPE_CAPTION =
  "Garlic Butter Noodles\nIngredients:\n200g noodles\n3 tbsp butter\n4 cloves garlic\nMethod: boil noodles, toss with garlic butter.";
const NON_RECIPE_CAPTION =
  "Golden hour vibes at the coast, what a beautiful calm evening by the sea ✨";

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── extractVideoUrl ──────────────────────────────────────────────────────────

// Import the real implementation directly for unit tests.
// We need to bypass the mock above for these tests.
const realExtractVideoUrl = jest.requireActual<
  typeof import("@/lib/extractors/instagram-audio")
>("@/lib/extractors/instagram-audio").extractVideoUrl;

describe("extractVideoUrl", () => {
  // Use realistic cdninstagram.com domains throughout.
  const CDN_URL = "https://scontent-sea1-1.cdninstagram.com/v/t50.2886-16/reel.mp4";
  const EMBED_URL = "https://www.instagram.com/reel/ABC123/embed/captioned/";

  test("parses og:video:secure_url when it is a CDN URL", () => {
    const html = `<html><head>
      <meta property="og:video:secure_url" content="${CDN_URL}" />
      <meta property="og:video" content="${CDN_URL}" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("falls back to og:video when secure_url is absent (CDN URL)", () => {
    const html = `<html><head>
      <meta property="og:video" content="${CDN_URL}" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("skips og:video that is an Instagram embed page URL (not a video CDN)", () => {
    // Instagram's og:video typically contains the embed HTML page, not the MP4.
    // We must not return it — fetching it would give HTML, not audio.
    const html = `<html><head>
      <meta property="og:video" content="${EMBED_URL}" />
      <meta property="og:video:type" content="text/html" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBeNull();
  });

  test("parses contentUrl from JSON-LD VideoObject", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": "chef_demo on Instagram",
        "description": "Recipe caption here",
        "contentUrl": "${CDN_URL}"
      }
      </script>
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("prefers og:video CDN URL over JSON-LD contentUrl", () => {
    const otherCdn = "https://scontent-lax3-1.cdninstagram.com/v/t50/jsonld.mp4";
    const html = `<html><head>
      <meta property="og:video:secure_url" content="${CDN_URL}" />
      <script type="application/ld+json">
      { "@type": "VideoObject", "contentUrl": "${otherCdn}" }
      </script>
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("falls back to JSON-LD contentUrl when og:video is an embed URL", () => {
    const html = `<html><head>
      <meta property="og:video" content="${EMBED_URL}" />
      <script type="application/ld+json">
      { "@type": "VideoObject", "contentUrl": "${CDN_URL}" }
      </script>
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("falls back to JSON-LD contentUrl when og:video is absent", () => {
    const html = `<html><head>
      <meta property="og:description" content="some caption" />
      <script type="application/ld+json">
      { "@type": "VideoObject", "contentUrl": "${CDN_URL}" }
      </script>
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("finds CDN video URL embedded in script tag JSON (regex scan)", () => {
    // Simulates window._sharedData or window.__additionalDataLoaded patterns
    // where Instagram embeds the video CDN URL in a <script> block as a JSON
    // string value — common when JSON-LD and og:video tags are absent.
    const html = `<html><head>
      <meta property="og:description" content="some caption" />
    </head><body>
    <script type="text/javascript">
    window.__additionalDataLoaded('/reel/ABC123/',{"items":[{"video_url":"${CDN_URL}?bytestart=0&byteend=1234"}]});
    </script>
    </body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL + "?bytestart=0&byteend=1234");
  });

  test("handles JSON-escaped slashes in CDN URL (regex scan)", () => {
    const escaped = CDN_URL.replace(/\//g, "\\/");
    const html = `<html><body><script>var x={"video_url":"${escaped}"};</script></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(CDN_URL);
  });

  test("does not match image thumbnail URLs (.jpg) — only .mp4 videos", () => {
    // The og:image thumbnail lives on cdninstagram.com/v/ too (t51.* prefix, .jpg).
    // We must NOT return it — it's a JPEG, not a video, and the CDN returns 403.
    const html = `<html><head>
      <meta property="og:image" content="https://scontent-iad3-1.cdninstagram.com/v/t51.82787-15/image.jpg?_nc_ht=scontent-iad3-1.cdninstagram.com&amp;oe=ABC" />
      <meta property="og:video" content="https://www.instagram.com/reel/ABC123/embed/captioned/" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBeNull();
  });

  test("decodes &amp; HTML entities in CDN URL query parameters", () => {
    // og:image / og:description attributes in raw HTML use &amp; instead of &.
    // A video URL found in raw attribute markup would be malformed without this fix.
    const html = `<html><head>
      <meta property="og:description" content="some caption" />
    </head><body>
    <script type="text/javascript">
    window.__data={"video_url":"https:\\/\\/scontent-sea1-1.cdninstagram.com\\/v\\/t50.2886-16\\/reel.mp4?_nc_ht=scontent-sea1-1.cdninstagram.com&amp;oe=ABCDEF"};
    </script>
    </body></html>`;
    const result = realExtractVideoUrl(html);
    expect(result).not.toBeNull();
    // The returned URL must have & not &amp;
    expect(result).toContain("oe=ABCDEF");
    expect(result).not.toContain("&amp;");
  });

  test("returns null when no video meta tags are present", () => {
    const html = `<html><head>
      <meta property="og:description" content="some caption" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBeNull();
  });

  test("returns null for an empty page", () => {
    expect(realExtractVideoUrl("<html><body></body></html>")).toBeNull();
  });

  test("returns null for JSON-LD VideoObject without contentUrl", () => {
    // The test fixture has a VideoObject with only name/description (no contentUrl).
    expect(realExtractVideoUrl(recipeHtml)).toBeNull();
  });
});

// ─── unescapeEmbedded ─────────────────────────────────────────────────────────

const realUnescapeEmbedded = jest.requireActual<
  typeof import("@/lib/extractors/instagram-audio")
>("@/lib/extractors/instagram-audio").unescapeEmbedded;

describe("unescapeEmbedded", () => {
  test("decodes single-level escaped slashes", () => {
    expect(realUnescapeEmbedded("https:\\/\\/x.mp4")).toBe("https://x.mp4");
  });

  test("decodes \\u002F unicode slashes and \\u0026 ampersands", () => {
    expect(realUnescapeEmbedded("a\\u002Fb\\u0026c")).toBe("a/b&c");
  });

  test("decodes &amp; HTML entities", () => {
    expect(realUnescapeEmbedded("a&amp;b&amp;c")).toBe("a&b&c");
  });

  test("unwraps double-escaped slashes (contextJSON nesting) until stable", () => {
    // Double-escaped: each "/" stored as "\\/" then escaped again to "\\\\/".
    const doubled = "https:\\\\/\\\\/scontent.cdninstagram.com\\\\/v\\\\/reel.mp4";
    expect(realUnescapeEmbedded(doubled)).toBe(
      "https://scontent.cdninstagram.com/v/reel.mp4"
    );
  });

  test("leaves a clean URL untouched", () => {
    const url = "https://scontent.cdninstagram.com/o1/reel.mp4?efg=1";
    expect(realUnescapeEmbedded(url)).toBe(url);
  });
});

// ─── extractVideoUrlFromApiJson ───────────────────────────────────────────────

const realExtractVideoUrlFromApiJson = jest.requireActual<
  typeof import("@/lib/extractors/instagram-audio")
>("@/lib/extractors/instagram-audio").extractVideoUrlFromApiJson;

describe("extractVideoUrlFromApiJson", () => {
  const CDN_URL = "https://scontent-sea1-1.cdninstagram.com/v/t50.2886-16/reel.mp4";

  test("returns video_url at top level when it is a CDN URL", () => {
    expect(realExtractVideoUrlFromApiJson({ video_url: CDN_URL })).toBe(CDN_URL);
  });

  test("finds video_url nested inside GraphQL edge structure", () => {
    const graphql = {
      graphql: {
        shortcode_media: {
          __typename: "GraphVideo",
          video_url: CDN_URL,
        },
      },
    };
    expect(realExtractVideoUrlFromApiJson(graphql)).toBe(CDN_URL);
  });

  test("finds video_url inside an array of media items", () => {
    const data = { items: [{ media_type: 2, video_url: CDN_URL }] };
    expect(realExtractVideoUrlFromApiJson(data)).toBe(CDN_URL);
  });

  test("finds url inside video_versions[] (authenticated media/info shape)", () => {
    const data = {
      items: [
        {
          video_versions: [
            { type: 101, width: 720, url: CDN_URL },
            { type: 102, width: 480, url: "https://other.cdninstagram.com/v/low.mp4" },
          ],
        },
      ],
    };
    expect(realExtractVideoUrlFromApiJson(data)).toBe(CDN_URL);
  });

  test("finds playable_url when present", () => {
    expect(realExtractVideoUrlFromApiJson({ clip: { playable_url: CDN_URL } })).toBe(CDN_URL);
  });

  test("ignores video_versions entries whose url is not a CDN URL", () => {
    const data = { video_versions: [{ url: "https://example.com/not-cdn.mp4" }] };
    expect(realExtractVideoUrlFromApiJson(data)).toBeNull();
  });

  test("returns null when video_url is absent", () => {
    expect(realExtractVideoUrlFromApiJson({ title: "Garlic Pasta", caption: "yum" })).toBeNull();
  });

  test("returns null when video_url is not a CDN URL (e.g. a relative path)", () => {
    expect(realExtractVideoUrlFromApiJson({ video_url: "/relative/path.mp4" })).toBeNull();
  });

  test("returns null for non-object inputs", () => {
    expect(realExtractVideoUrlFromApiJson(null)).toBeNull();
    expect(realExtractVideoUrlFromApiJson("string")).toBeNull();
    expect(realExtractVideoUrlFromApiJson(42)).toBeNull();
  });
});

// ─── binaryFetch ──────────────────────────────────────────────────────────────

const realBinaryFetch = jest.requireActual<
  typeof import("@/lib/extractors/instagram-audio")
>("@/lib/extractors/instagram-audio").binaryFetch;

describe("binaryFetch", () => {
  const originalFetch = global.fetch;
  afterAll(() => {
    global.fetch = originalFetch;
  });

  function makeStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  test("returns a Buffer on a successful response", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: makeStream(data),
    });
    const result = await realBinaryFetch("https://cdn.example.com/reel.mp4", {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
  });

  test("returns null and logs error when response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, body: null });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await realBinaryFetch("https://cdn.example.com/reel.mp4", {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("403"));
    spy.mockRestore();
  });

  test("returns null when data exceeds maxBytes", async () => {
    const data = new Uint8Array(100);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: makeStream(data),
    });
    const result = await realBinaryFetch("https://cdn.example.com/reel.mp4", {
      maxBytes: 50,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
  });

  test("returns null on fetch error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const result = await realBinaryFetch("https://cdn.example.com/reel.mp4", {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
  });
});

// ─── extractFromInstagramWithAudio orchestration ───────────────────────────────

describe("extractFromInstagramWithAudio", () => {
  test("caption has complete recipe (ingredients + instructions) → audio path never triggered", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("caption"));
  });

  test("caption has ingredients but no instructions → audio path fires, audio result returned", async () => {
    // First LLM call (caption): returns partial recipe (no instructions).
    // Second LLM call (transcript): returns complete recipe.
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial })
      .mockResolvedValueOnce({ recipe: mockRecipeComplete });

    // Must pass looksLikeRecipe: contains a keyword ("combine") and quantity+unit matches.
    const transcript =
      "Boil 200g noodles for 8 minutes. Melt 3 tbsp butter with 4 cloves garlic. Combine and serve. Serves 2.";
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    // Both caption and audio LLM calls were made.
    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(2);
    // Audio pipeline ran.
    expect(mockedBinaryFetch).toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).toHaveBeenCalled();
    // Status messages should mention the incomplete caption and audio steps.
    const statusMessages = onStatus.mock.calls.map((c) => c[0] as string);
    expect(statusMessages.some((m) => /incomplete/i.test(m))).toBe(true);
  });

  test("caption has ingredients but no instructions + audio fails → partial caption result returned with status", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedExtractWithLlm.mockResolvedValueOnce({ recipe: mockRecipePartial });
    mockedBinaryFetch.mockResolvedValue(null); // download fails

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    // Returns partial caption result rather than an error.
    expect(result.recipe).toBe(mockRecipePartial);
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
    // A status message explains the degradation so the user isn't left wondering.
    const statusMessages = onStatus.mock.calls.map((c) => c[0] as string);
    expect(statusMessages.some((m) => /download failed|incomplete/i.test(m))).toBe(true);
  });

  test("no caption → audio path fires → recipe extracted from transcript", async () => {
    const transcript =
      "Today I'm making Garlic Butter Pasta. You'll need 200g pasta, 3 tbsp butter, 4 cloves garlic. Cook pasta, melt butter, sauté garlic, combine. Serves 2.";

    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedBinaryFetch).toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).toHaveBeenCalled();
    expect(mockedExtractWithLlm).toHaveBeenCalledWith(transcript, REEL_URL);
    expect(onStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("caption present but not a recipe → audio fallback fires", async () => {
    const transcript =
      "In today's video I'll show you how to make Spaghetti Carbonara. You need 200g pasta, 2 eggs, 100g pancetta, 50g parmesan. Serves 2. Boil pasta, fry pancetta, mix eggs and parmesan, combine.";

    mockedFetchInstagramMedia.mockResolvedValue({
      caption: NON_RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedBinaryFetch).toHaveBeenCalled();
    // Caption was never sent to the LLM (it didn't look like a recipe).
    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(1);
    expect(mockedExtractWithLlm).toHaveBeenCalledWith(transcript, REEL_URL);
  });

  test("scraper returns null (unconfigured / unreadable reel) → extractor_error mentioning paste", async () => {
    mockedFetchInstagramMedia.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(result.error).toMatch(/paste/i);
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
  });

  test("no video URL, no caption result → returns no_recipe error", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({ caption: null, videoUrl: null });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
  });

  test("audio path: binaryFetch fails, no caption result → returns extractor_error", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
  });

  test("audio path: Whisper returns null, no caption result → returns extractor_error", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("audio path: transcript not a recipe, no caption result → returns no_recipe error", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(
      "Hey everyone, welcome back to my travel vlog! Today we're in Tokyo."
    );

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("audio path: LLM fails, no caption result → error propagated", async () => {
    const transcript =
      "Today I'm making Garlic Butter Pasta. You need 200g pasta, 3 tbsp butter, 4 cloves garlic. Cook and serve. Serves 2.";

    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({
      recipe: null,
      error: "LLM API call failed: quota exceeded",
      kind: "extractor_error",
    });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(result.error).toMatch(/quota exceeded/i);
  });

  test("audio path: LLM fails, partial caption result exists → returns partial caption", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial }) // caption call
      .mockResolvedValueOnce({                               // audio call
        recipe: null,
        error: "LLM API call failed: quota exceeded",
        kind: "extractor_error",
      });

    const transcript =
      "Boil 200g noodles for 8 minutes. Melt 3 tbsp butter with 4 cloves garlic. Combine and serve. Serves 2.";
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    // Graceful degradation: partial recipe beats an error.
    expect(result.recipe).toBe(mockRecipePartial);
  });
});
