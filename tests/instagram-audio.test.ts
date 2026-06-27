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

const mockRecipe: Recipe = {
  id: "test-id",
  url: REEL_URL,
  title: "Garlic Butter Noodles",
  base_servings: 2,
  parsed_at: new Date().toISOString(),
  cuisine_source: "unknown",
  ingredients: [],
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
  test("caption has recipe → LLM called, audio path never triggered", async () => {
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipe });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(recipeHtml, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipe);
    expect(mockedExtractVideoUrl).not.toHaveBeenCalled();
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(
      expect.stringContaining("caption")
    );
  });

  test("no caption → audio path fires → recipe extracted from transcript", async () => {
    const noCaption = `<html><head><title>Login • Instagram</title></head><body></body></html>`;
    const transcript =
      "Today I'm making Garlic Butter Pasta. You'll need 200g pasta, 3 tbsp butter, 4 cloves garlic. Cook pasta, melt butter, sauté garlic, combine. Serves 2.";

    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(Buffer.from("fake video"));
    mockedTranscribeWithWhisper.mockResolvedValue(transcript);
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipe });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBe(mockRecipe);
    expect(mockedExtractVideoUrl).toHaveBeenCalledWith(noCaption);
    expect(mockedBinaryFetch).toHaveBeenCalled();
    expect(mockedTranscribeWithWhisper).toHaveBeenCalled();
    expect(mockedExtractWithLlm).toHaveBeenCalledWith(transcript, REEL_URL);
    // Should emit several status messages
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
    mockedExtractWithLlm.mockResolvedValue({ recipe: mockRecipe });

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(
      nonRecipeCaption,
      REEL_URL,
      onStatus
    );

    expect(result.recipe).toBe(mockRecipe);
    expect(mockedExtractVideoUrl).toHaveBeenCalled();
  });

  test("audio path: no og:video URL → returns no_recipe error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("no_recipe");
    expect(mockedBinaryFetch).not.toHaveBeenCalled();
  });

  test("audio path: binaryFetch fails → returns extractor_error", async () => {
    const noCaption = `<html><head><title>Login</title></head><body></body></html>`;
    mockedExtractVideoUrl.mockReturnValue("https://cdn.instagram.com/reel.mp4");
    mockedBinaryFetch.mockResolvedValue(null);

    const onStatus = jest.fn();
    const result = await extractFromInstagramWithAudio(noCaption, REEL_URL, onStatus);

    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
    expect(mockedTranscribeWithWhisper).not.toHaveBeenCalled();
  });

  test("audio path: Whisper returns null → returns extractor_error", async () => {
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

  test("audio path: transcript not a recipe → returns no_recipe error", async () => {
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

  test("audio path: LLM fails → error propagated", async () => {
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
});
