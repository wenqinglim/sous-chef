/**
 * Audio-based recipe extraction from Instagram reels.
 *
 * When the reel caption has no recipe, we attempt to transcribe the video
 * audio using Groq's hosted Whisper model (whisper-large-v3) and then run
 * the transcript through the existing LLM recipe extractor.
 *
 * Video URL discovery (in priority order):
 *   1. og:video:secure_url / og:video — only when pointing at the CDN, not
 *      Instagram's own embed page (which is HTML, not video).
 *   2. JSON-LD VideoObject.contentUrl.
 *   3. Regex scan of the raw HTML for CDN MP4 URLs embedded in <script> JSON
 *      data (e.g. window._sharedData, window.__additionalDataLoaded).
 *
 * Transcription requires GROQ_API_KEY.
 */

import * as cheerio from "cheerio";
import OpenAI, { toFile } from "openai";

/** Maximum video size to download: just under Groq Whisper's 25 MB file limit. */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

/** Timeout for the video binary download. */
const VIDEO_FETCH_TIMEOUT_MS = 30_000;

/**
 * Headers for CDN video downloads. Matches the UA used to fetch the reel page
 * so the CDN doesn't reject the request as an anonymous bot (yields 403).
 * Defined here rather than imported from instagram.ts to avoid a circular dep.
 */
const CDN_FETCH_HEADERS = {
  "User-Agent":
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  Referer: "https://www.instagram.com/",
};

/**
 * True if `url` points at an Instagram CDN (scontent*.cdninstagram.com,
 * video*.cdninstagram.com, *.fbcdn.net) rather than an Instagram page.
 * og:video on reels typically contains the HTML embed URL
 * (`/reel/XXX/embed/captioned/`), which is useless for audio extraction.
 */
function isInstagramCdnUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname.endsWith(".cdninstagram.com") ||
      hostname.endsWith(".fbcdn.net")
    );
  } catch {
    return false;
  }
}

/**
 * Walk a parsed JSON-LD value looking for a VideoObject.contentUrl (the CDN
 * URL of the actual video file). Returns the first CDN URL found, or null.
 */
function findVideoUrlInJsonLd(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrlInJsonLd(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.contentUrl === "string" && isInstagramCdnUrl(obj.contentUrl)) {
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
 * Instagram CDN video URLs in raw HTML (including in script tag JSON blobs).
 * Path prefix /v/ is stable for Instagram CDN video content.
 * Terminates at the first quote, whitespace, or angle bracket.
 */
const CDN_VIDEO_RE = /https:\/\/[a-z0-9][\w.-]*\.cdninstagram\.com\/v\/[^\s"'<>]+/gi;

/**
 * Parse the reel's video CDN URL from the fetched page.
 *
 * Checks in order:
 *   1. og:video:secure_url / og:video (only CDN URLs — skips embed pages).
 *   2. JSON-LD VideoObject.contentUrl.
 *   3. Regex scan of the raw HTML for CDN URLs in <script> JSON data.
 */
export function extractVideoUrl(html: string): string | null {
  const $ = cheerio.load(html);

  // 1. og:video meta tags — only use if they point to the CDN, not an embed page.
  // Instagram's og:video often contains `/reel/XXX/embed/captioned/` (HTML), not MP4.
  for (const prop of ["og:video:secure_url", "og:video"]) {
    const val = $(`meta[property="${prop}"]`).attr("content");
    if (val && isInstagramCdnUrl(val)) return val;
  }

  // 2. JSON-LD VideoObject.contentUrl.
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
  if (jsonLdVideo) return jsonLdVideo;

  // 3. Regex scan for CDN MP4 URLs embedded anywhere in the page.
  // Instagram's crawler HTML sometimes includes the video CDN URL inside
  // <script> tags as JSON data (window._sharedData, VideoObject, etc.).
  // Decode common JSON escape sequences before scanning.
  const decoded = html
    .replace(/\\u002[Ff]/g, "/")  // / → /
    .replace(/\\u0026/g, "&")     // & → &
    .replace(/\\\//g, "/");        // \/ → /

  CDN_VIDEO_RE.lastIndex = 0;
  return decoded.match(CDN_VIDEO_RE)?.[0] ?? null;
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
    const res = await fetch(url, {
      signal: controller.signal,
      headers: CDN_FETCH_HEADERS,
    });
    if (!res.ok || !res.body) {
      console.error(`binaryFetch: HTTP ${res.status} for ${url}`);
      return null;
    }

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

