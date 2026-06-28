/**
 * Audio-based recipe extraction from Instagram reels.
 *
 * When the reel caption has no recipe, we transcribe the video audio using
 * Groq's hosted Whisper model (whisper-large-v3) and run the transcript through
 * the existing LLM recipe extractor.
 *
 * The reel's video CDN URL is supplied by the scraper provider
 * (`instagram-scraper.ts`); this module just downloads that URL (`binaryFetch`,
 * host-validated to an Instagram CDN) and transcribes it (`transcribeWithWhisper`).
 * Transcription requires GROQ_API_KEY.
 */

import OpenAI, { toFile } from "openai";

/** Maximum video size to download: just under Groq Whisper's 25 MB file limit. */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

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
 * True if `url` points at an Instagram CDN host (`*.cdninstagram.com`,
 * `*.fbcdn.net`). Used to host-validate the scraper-supplied video URL before
 * downloading it (cheap SSRF guard against a buggy/compromised scraper response).
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
 * Download a video from an Instagram CDN URL as a binary Buffer.
 *
 * The URL comes from the third-party scraper API (not user input, but not our
 * own fetched HTML either), so we host-validate it to an Instagram CDN before
 * fetching — a cheap SSRF guard against a buggy/compromised scraper response
 * pointing this at an internal address — and bypass safeFetch for the binary
 * stream. A byte cap and timeout are still enforced.
 *
 * Returns null on any error (non-CDN host, network, oversize, timeout).
 */
export async function binaryFetch(
  url: string,
  opts: { maxBytes: number; timeoutMs: number }
): Promise<Buffer | null> {
  if (!isInstagramCdnUrl(url)) {
    console.error(`[IG] binaryFetch: refusing non-CDN host: ${url}`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: CDN_FETCH_HEADERS,
    });
    // Surface what the CDN told us before we start streaming — a Content-Length
    // over the cap is the most common (and otherwise invisible) failure cause.
    console.error(
      `[IG] binaryFetch: status=${res.status} content-length=${res.headers?.get?.("content-length") ?? "?"}`
    );
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
        console.error(
          `[IG] binaryFetch: exceeds cap (${total} > ${opts.maxBytes} bytes) — aborting download`
        );
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    console.error(`[IG] binaryFetch: downloaded ${total} bytes`);
    return Buffer.concat(chunks);
  } catch (err) {
    // AbortError = our timeout fired; TypeError/ECONNRESET = network/TLS. Either
    // way the previous code returned null with no trace.
    console.error(
      `[IG] binaryFetch threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
    );
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

