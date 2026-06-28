import { isPrivateIp, safeFetch, BlockedUrlError } from "@/lib/extractors/safe-fetch";

// Mock DNS so host resolution is deterministic and offline.
jest.mock("dns/promises", () => ({
  lookup: jest.fn(),
}));
import { lookup } from "dns/promises";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

// ─── IP classifier ────────────────────────────────────────────────────────────

describe("isPrivateIp", () => {
  const PRIVATE = [
    "127.0.0.1", // loopback
    "10.0.0.1", // 10/8
    "10.255.255.255",
    "172.16.0.1", // 172.16/12
    "172.31.255.255",
    "192.168.1.1", // 192.168/16
    "169.254.169.254", // cloud metadata (link-local)
    "0.0.0.0", // "this network"
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "::1", // IPv6 loopback
    "::", // IPv6 unspecified
    "fc00::1", // unique-local
    "fe80::1", // link-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1", // IPv4-mapped private
    "not-an-ip", // garbage → unsafe
  ];

  const PUBLIC = [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
    "192.167.0.1", // just outside 192.168/16
    "169.253.0.1", // just outside link-local
    "2606:4700:4700::1111", // Cloudflare DNS (public v6)
  ];

  test.each(PRIVATE)("%s is private/blocked", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  test.each(PUBLIC)("%s is public/allowed", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

// ─── safeFetch URL validation ─────────────────────────────────────────────────

describe("safeFetch — scheme rejection", () => {
  test.each(["file:///etc/passwd", "data:text/html,<h1>x", "gopher://x", "ftp://x/y"])(
    "rejects %s",
    async (url) => {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(BlockedUrlError);
    }
  );

  test("rejects invalid URL", async () => {
    await expect(safeFetch("not a url")).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe("safeFetch — host blocking", () => {
  test("rejects localhost", async () => {
    await expect(safeFetch("http://localhost/recipe")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  test("rejects .internal hostnames", async () => {
    await expect(safeFetch("http://db.internal/recipe")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  test("rejects an IP literal in a private range", async () => {
    await expect(
      safeFetch("http://169.254.169.254/latest/meta-data/")
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  test("rejects when DNS resolves to a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(safeFetch("http://evil.example.com/recipe")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });
});

// ─── safeFetch redirect validation ────────────────────────────────────────────

describe("safeFetch — redirect validation", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  test("re-validates redirect targets and blocks redirect to a private IP", async () => {
    // Public host on the first hop, then a redirect to the metadata endpoint.
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    global.fetch = jest.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Map([["location", "http://169.254.169.254/"]]),
      body: { cancel: jest.fn() },
    }) as unknown as typeof fetch;

    await expect(safeFetch("http://public.example.com/recipe")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  test("returns body for a public host that responds 200", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map(),
      text: async () => "<html>recipe</html>",
      body: null, // null body → readCapped falls back to .text()
    }) as unknown as typeof fetch;

    const result = await safeFetch("http://public.example.com/recipe");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.text).toContain("recipe");
  });
});

// ─── safeFetch request headers (anti-bot fingerprint) ─────────────────────────

describe("safeFetch — request headers", () => {
  const realFetch = global.fetch;

  function mock200() {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map(),
      text: async () => "<html>ok</html>",
      body: null,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function sentHeaders(fetchMock: jest.Mock): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  }

  beforeEach(() => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  test("default path sends a full Chrome browser fingerprint", async () => {
    const fetchMock = mock200();
    await safeFetch("http://recipe.example.com/r");

    const headers = sentHeaders(fetchMock);
    expect(headers["User-Agent"]).toContain("Chrome/131");
    expect(headers["Sec-Fetch-Mode"]).toBe("navigate");
    expect(headers["Sec-Ch-Ua"]).toContain("Google Chrome");
    expect(headers["Upgrade-Insecure-Requests"]).toBe("1");
    expect(headers["Accept"]).toContain("text/html");
  });

  test("custom userAgent opts out of the bot fingerprint but keeps Accept", async () => {
    const fetchMock = mock200();
    await safeFetch("http://recipe.example.com/r", {
      userAgent: "facebookexternalhit/1.1",
    });

    const headers = sentHeaders(fetchMock);
    expect(headers["User-Agent"]).toBe("facebookexternalhit/1.1");
    // Accept / Accept-Language are unconditional — a real crawler sends them too.
    expect(headers["Accept"]).toContain("text/html");
    expect(headers["Accept-Language"]).toBe("en-US,en;q=0.9");
    // ...but the browser fingerprint headers are dropped.
    expect(headers["Sec-Fetch-Mode"]).toBeUndefined();
    expect(headers["Sec-Ch-Ua"]).toBeUndefined();
    expect(headers["Upgrade-Insecure-Requests"]).toBeUndefined();
  });
});
