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

// Mock the audio helpers so orchestration tests control each step.
jest.mock("@/lib/extractors/instagram-audio", () => ({
  extractVideoUrl: jest.fn(),
  binaryFetch: jest.fn(),
  transcribeWithWhisper: jest.fn(),
  MAX_VIDEO_BYTES: 24 * 1024 * 1024,
}));

// Mock openai for the transcribeWithWhisper unit tests (imported separately).
jest.mock("openai");

import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import {
  extractVideoUrl,
  binaryFetch,
  transcribeWithWhisper,
} from "@/lib/extractors/instagram-audio";
import { extractFromInstagramWithAudio } from "@/lib/extractors/instagram";
import type { Recipe } from "@/types";

const mockedExtractWithLlm = extractWithLlm as jest.MockedFunction<typeof extractWithLlm>;
const mockedExtractVideoUrl = extractVideoUrl as jest.MockedFunction<typeof extractVideoUrl>;
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
  test("parses og:video:secure_url", () => {
    const html = `<html><head>
      <meta property="og:video:secure_url" content="https://cdn.instagram.com/video/reel.mp4" />
      <meta property="og:video" content="http://cdn.instagram.com/video/reel.mp4" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(
      "https://cdn.instagram.com/video/reel.mp4"
    );
  });

  test("falls back to og:video when secure_url is absent", () => {
    const html = `<html><head>
      <meta property="og:video" content="https://cdn.instagram.com/video/reel.mp4" />
    </head><body></body></html>`;
    expect(realExtractVideoUrl(html)).toBe(
      "https://cdn.instagram.com/video/reel.mp4"
    );
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

  test("returns null when response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, body: null });
    const result = await realBinaryFetch("https://cdn.example.com/reel.mp4", {
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(result).toBeNull();
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
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(recipeHtml, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedExtractVideoUrl).not.toHaveBeenCalled();
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("caption"));
  });

  test("caption has ingredients but no instructions → audio path fires, audio result returned", async () => {
    // First LLM call (caption): returns partial recipe (no instructions).
    // Second LLM call (transcript): returns complete recipe.
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial })
      .mockResolvedValueOnce({ recipe: mockRecipeComplete });

    // Must pass looksLikeRecipe: contains a keyword ("combine") and quantity+unit matches.
    const transcript =
      "Boil 200g noodles for 8 minutes. Melt 3 tbsp butter with 4 cloves garlic. Combine and serve. Serves 2.";
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(recipeHtml, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    // Both caption and audio LLM calls were made.
    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(2);
    // Audio pipeline ran.
    expect(mockedExtractVideoUrl).toHaveBeenCalled();
    expect(mockedBinaryFetch).toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).toHaveBeenCalled();
    // Status messages should mention the incomplete caption and audio steps.
    const statusMessages = onStatus.mock.calls.map((c) => c[0] as string);
    expect(statusMessages.some((m) => /incomplete/i.test(m))).toBe(true);
  });

  test("caption has ingredients but no instructions + audio fails → partial caption result returned", async () => {
    mockedExtractWithLlm.mockResolvedValueOnce({ recipe: mockRecipePartial });
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(null); // download fails

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(recipeHtml, REEL_URL, onStatus);

    // Returns partial caption result rather than an error.
    expect(result.recipe).toBe(mockRecipePartial);
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
  });

  test("no caption → audio path fires → recipe extracted from transcript", async () => {
    const noCaption = `<html><head><title>Login • Instagram</title></head><body></body></html>`;
    const transcript =
      "Today I'm making Garlic Butter Pasta. You'll need 200g pasta, 3 tbsp butter, 4 cloves garlic. Cook pasta, melt butter, sauté garlic, combine. Serves 2.";

    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedExtractVideoUrl).toHaveBeenCalledWith(noCaption);
    expect(mockedBinaryFetch).toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).toHaveBeenCalled();
    expect(mockedExtractWithLlm).toHaveBeenCalledWith(transcript, REEL_URL);
    expect(onStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("caption present but not a recipe → audio fallback fires", async () => {
    const nonRecipeCaption = `<html><head>
      <meta property="og:description" content="Golden hour vibes at the coast ✨" />
    </head><body></body></html>`;
    const transcript =
      "In today's video I'll show you how to make Spaghetti Carbonara. You need 200g pasta, 2 eggs, 100g pancetta, 50g parmesan. Serves 2. Boil pasta, fry pancetta, mix eggs and parmesan, combine.";

    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipeComplete });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(nonRecipeCaption, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipeComplete);
    expect(mockedExtractVideoUrl).toHaveBeenCalled();
  });

  test("audio path: no og:video URL, no caption result → returns no_recipe error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
  });

  test("audio path: binaryFetch fails, no caption result → returns extractor_error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
  });

  test("audio path: Whisper returns null, no caption result → returns extractor_error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("audio path: transcript not a recipe, no caption result → returns no_recipe error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(
      "Hey everyone, welcome back to my travel vlog! Today we're in Tokyo."
    );

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("audio path: LLM fails, no caption result → error propagated", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    const transcript =
      "Today I'm making Garlic Butter Pasta. You need 200g pasta, 3 tbsp butter, 4 cloves garlic. Cook and serve. Serves 2.";

    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({
      recipe: null,
      error: "LLM API call failed: quota exceeded",
      kind: "extractor_error",
    });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(result.error).toMatch(/quota exceeded/i);
  });

  test("audio path: LLM fails, partial caption result exists → returns partial caption", async () => {
    mockedExtractWithLlm
      .mockResolvedValueOnce({ recipe: mockRecipePartial }) // caption call
      .mockResolvedValueOnce({                               // audio call
        recipe: null,
        error: "LLM API call failed: quota exceeded",
        kind: "extractor_error",
      });

    const transcript =
      "Boil 200g noodles for 8 minutes. Melt 3 tbsp butter with 4 cloves garlic. Combine and serve. Serves 2.";
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(recipeHtml, REEL_URL, onStatus);

    // Graceful degradation: partial recipe beats an error.
    expect(result.recipe).toBe(mockRecipePartial);
  });
});
