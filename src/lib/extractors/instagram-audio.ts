/**
 * Audio-based recipe extraction from Instagram reels.
 *
 * When the reel caption has no recipe, we attempt to transcribe the video
 * audio using Groq's hosted Whisper model (whisper-large-v3) and then run
 * the transcript through the existing LLM recipe extractor.
 *
 * The video URL is parsed from og:video meta tags OR from a JSON-LD
 * VideoObject.contentUrl field — Instagram's crawler HTML uses the latter.
 * Transcription requires GROQ_API_KEY.
 */

import * as cheerio from "cheerio";
import OpenAI, { toFile } from "openai";

/** Maximum video size to download: just under Groq Whisper's 25 MB file limit. */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

/** Timeout for the video binary download. */
const VIDEO_FETCH_TIMEOUT_MS = 30_000;

/**
 * Walk a parsed JSON-LD value looking for a VideoObject.contentUrl (the CDN
 * URL of the actual video file). Returns the first HTTPS URL found, or null.
 */
function findVideoUrlInJsonLd(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrlInJsonLd(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.contentUrl === "string" && obj.contentUrl.startsWith("https://")) {
      return obj.contentUrl;
    }
    for (const v of Object.values(obj)) {
      const found = findVideoUrlInJsonLd(v);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Parse the reel's video CDN URL from the fetched page.
 *
 * Checks in order:
 *   1. og:video:secure_url meta tag
 *   2. og:video meta tag
 *   3. JSON-LD VideoObject.contentUrl (Instagram's crawler HTML uses this)
 */
export function extractVideoUrl(html: string): string | null {
  const $ = cheerio.load(html);

  // 1. og:video meta tags — fast path.
  const ogVideo =
    $('meta[property="og:video:secure_url"]').attr("content") ??
    $('meta[property="og:video"]').attr("content") ??
    null;
  if (ogVideo) return ogVideo;

  // 2. JSON-LD VideoObject.contentUrl — Instagram's crawler-served HTML
  // typically puts the video CDN URL here rather than (or in addition to)
  // og:video meta tags.
  let jsonLdVideo: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdVideo) return;
    const content = $(el).html();
    if (!content) return;
    try {
      const found = findVideoUrlInJsonLd(JSON.parse(content));
      if (found) jsonLdVideo = found;
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return jsonLdVideo;
}

/**
 * Download a video from a CDN URL as a binary Buffer.
 *
 * This intentionally bypasses safeFetch: the URL comes from the Instagram
 * page we already fetched (not from user input), so SSRF risk is low. We
 * still enforce a byte cap and a timeout.
 *
 * Returns null on any error (network, oversize, timeout).
 */
export async function binaryFetch(
  url: string,
  opts: { maxBytes: number; timeoutMs: number }
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > opts.maxBytes) {
        reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribe a video/audio buffer using Groq's whisper-large-v3 model.
 *
 * Groq's API is drop-in compatible with the OpenAI SDK — only the baseURL
 * and API key differ. Accepts MP4 directly; Groq extracts the audio track
 * server-side.
 *
 * Returns the transcript text, or null if GROQ_API_KEY is unset or the
 * transcription fails.
 */
export async function transcribeWithWhisper(videoBuffer: Buffer): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY not set — skipping audio transcription");
    return null;
  }
  try {
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
    const file = await toFile(videoBuffer, "reel.mp4", { type: "video/mp4" });
    const transcription = await client.audio.transcriptions.create({
      model: "whisper-large-v3",
      file,
    });
    return transcription.text || null;
  } catch (err) {
    console.error("Whisper transcription failed:", err);
    return null;
  }
}

