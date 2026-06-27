/**
 * SSRF-safe outbound fetch.
 *
 * Sous-Chef fetches user-supplied recipe URLs server-side (to bypass CORS).
 * Once we accept *arbitrary* URLs we become an SSRF sink: a malicious URL could
 * point at internal services or cloud metadata endpoints (169.254.169.254).
 * This module is the single choke point for those fetches.
 *
 * Defenses:
 *   1. Only http/https schemes (blocks file:, data:, gopher:, ...).
 *   2. DNS-resolve the host and reject if ANY resolved IP is private/reserved.
 *   3. Follow redirects manually, re-validating each hop (a plain
 *      redirect:"follow" would re-open the hole via a redirect to an internal IP).
 *   4. Cap the response body size so a hostile URL can't stream gigabytes.
 *
 * Residual risk: DNS rebinding (TOCTOU between lookup and connect) is not
 * mitigated here — acceptable for this single-fetch MVP. The high-assurance fix
 * is to pin the validated IP and connect to it directly with a Host header.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

/** Thrown when a URL is rejected for safety reasons. Callers map this to HTTP 400. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Hostnames that must never be resolved/fetched, regardless of DNS. */
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

/** True if an IPv4 dotted-quad string is in a private/reserved range. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved/broadcast
  return false;
}

/** True if an IPv6 string is loopback, unspecified, ULA, link-local, or maps to a private IPv4. */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — validate the embedded v4.
  const mapped = lower.match(/(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const first = lower.split(":")[0];
  const head = parseInt(first || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True if an IP literal (v4 or v6) is private/reserved/loopback. Exported for testing. */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // not a recognizable IP → unsafe
}

/**
 * Validate a URL's scheme and resolve+check its host. Throws BlockedUrlError if
 * the URL is unsafe. Returns the parsed URL on success.
 */
async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (isBlockedHostname(host)) {
    throw new BlockedUrlError("URL host is not allowed");
  }

  // If the host is already an IP literal, check it directly.
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError("URL resolves to a private address");
    return parsed;
  }

  // Otherwise resolve via DNS and reject if ANY address is private/reserved.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("Could not resolve URL host");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new BlockedUrlError("URL resolves to a private address");
  }

  return parsed;
}

/** Read a response body as text, aborting if it exceeds MAX_RESPONSE_BYTES. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Response body exceeded size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
}

/**
 * Fetch a user-supplied URL with SSRF protections, manual redirect validation,
 * and a response-size cap.
 *
 * Throws BlockedUrlError for unsafe URLs (caller → HTTP 400). Throws a generic
 * Error for network/timeout failures (caller → HTTP 502). On an HTTP error
 * status the result is returned with `ok: false` so the caller can report it.
 */
export async function safeFetch(
  rawUrl: string,
  opts: {
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const validated = await assertSafeUrl(currentUrl);

    const response = await fetch(validated.toString(), {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        // Caller-supplied headers (e.g. Cookie, X-IG-App-ID) override the defaults.
        ...opts.headers,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Handle redirects manually so we can re-validate each hop's target.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break; // 3xx with no Location — treat as final
      currentUrl = new URL(location, validated).toString();
      await response.body?.cancel();
      continue;
    }

    return {
      ok: response.ok,
      status: response.status,
      text: response.ok ? await readCapped(response) : "",
      finalUrl: validated.toString(),
    };
  }

  throw new BlockedUrlError("Too many redirects");
}
