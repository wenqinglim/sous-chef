/**
 * Tests for Instagram audio extraction:
 *   - binaryFetch (CDN host-validated binary download with size cap)
 *   - transcribeWithWhisper (Groq Whisper transcription, mocked)
 *   - extractFromInstagramWithAudio orchestration
 */

// Mock the LLM extractor so orchestration tests never hit Claude.
jest.mock("@/lib/extractors/llm-fallback", () => ({
  extractWithLlm: jest.fn(),
}));

// Mock the audio helpers so orchestration tests control each step. The video
// URL + caption come from the scraper provider (mocked below), so the
// orchestration only needs binaryFetch + transcribeWithWhisper from here.
jest.mock("@/lib/extractors/instagram-audio", () => ({
  binaryFetch: jest.fn(),
  transcribeWithWhisper: jest.fn(),
  MAX_VIDEO_BYTES: 24 * 1024 * 1024,
}));

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

// ─── binaryFetch ──────────────────────────────────────────────────────────────

const realBinaryFetch = jest.requireActual<
  typeof import("@/lib/extractors/instagram-audio")
>("@/lib/extractors/instagram-audio").binaryFetch;

describe("binaryFetch", () => {
  // Must be an Instagram CDN host to pass binaryFetch's host validation.
  const CDN_URL = "https://scontent-sea1-1.cdninstagram.com/v/t50/reel.mp4";
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

  test("rejects a non-CDN host without fetching", async () => {
    global.fetch = jest.fn();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await realBinaryFetch("https://evil.example.com/internal", {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("non-CDN host"));
    spy.mockRestore();
  });

  test("returns a Buffer on a successful response", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: makeStream(data),
    });
    const result = await realBinaryFetch(CDN_URL, {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
  });

  test("returns null and logs error when response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, body: null });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await realBinaryFetch(CDN_URL, {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("403"));
    spy.mockRestore();
  });

  test("returns null and logs a diagnostic when data exceeds maxBytes", async () => {
    const data = new Uint8Array(100);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: makeStream(data),
    });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await realBinaryFetch(CDN_URL, {
      maxBytes: 50,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
    // Previously silent — now the size cap is visible in the logs.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("exceeds cap"));
    spy.mockRestore();
  });

  test("returns null and logs a diagnostic on fetch error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network error"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await realBinaryFetch(CDN_URL, {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
    // Previously swallowed by `catch {}` — now the error reason is logged.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("binaryFetch threw"));
    spy.mockRestore();
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

  test("audio path: LLM finds no recipe in transcript, no caption → no_recipe (LLM still called)", async () => {
    // The transcript gate is gone: even a non-recipe transcript reaches the LLM,
    // which returns an empty recipe → we classify that as no_recipe.
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: null,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(
      "Hey everyone, welcome back to my travel vlog! Today we're in Tokyo."
    );
    mockedExtractWithLlm.mockResolvedValue({
      recipe: { ...mockRecipeComplete, ingredients: [], instructions: [] },
    });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(1);
  });

  test("audio path: partial caption + transcript → both are merged into the LLM input", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    const transcript = "First boil the noodles, then melt the butter and toss everything together.";
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial }) // caption call (no instructions)
      .mockResolvedValueOnce({ recipe: mockRecipeComplete }); // merged caption+transcript call
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    // The 2nd (audio) LLM call sees BOTH the caption and the transcript.
    const audioInput = mockedExtractWithLlm.mock.calls[1][0];
    expect(audioInput).toContain(RECIPE_CAPTION);
    expect(audioInput).toContain(transcript);
  });

  test("audio path: LLM returns empty recipe but a partial caption exists → returns the partial", async () => {
    mockedFetchInstagramMedia.mockResolvedValue({
      caption: RECIPE_CAPTION,
      videoUrl: "https://cdn.instagram.com/reel.mp4",
    });
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial }) // caption call
      .mockResolvedValueOnce({
        recipe: { ...mockRecipeComplete, ingredients: [], instructions: [] },
      }); // audio call yields nothing usable
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue("um, anyway, like and subscribe");

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipePartial);
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
