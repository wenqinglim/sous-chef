/**
 * Auth unit tests — pure crypto surface plus a mocked-cookies pass through
 * `isAdmin()`. Route-handler guard tests live in tests/api-auth.test.ts.
 */

// next/headers is only importable inside a Next.js request scope; mock it so
// this module loads and so isAdmin() can be exercised with controlled cookies.
jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

// React `cache()` memoizes per-request in Next.js; in a bare jest run there's
// no request scope, so cache() falls through to plain invocation. That's what
// we want here (each test controls the cookie mock).

import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  isAdmin,
  newSession,
  signSession,
  verifyPassword,
  verifySession,
} from "@/lib/auth";

const mockCookies = cookies as unknown as jest.Mock;

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.ADMIN_SESSION_SECRET =
    "test-secret-at-least-16-bytes-long-please-1234567890";
  process.env.ADMIN_PASSWORD = "correct horse battery staple";
  mockCookies.mockReset();
});

afterAll(() => {
  process.env = originalEnv;
});

function cookieStore(entries: Record<string, string> = {}) {
  return {
    get: (name: string) =>
      entries[name] !== undefined ? { value: entries[name] } : undefined,
  };
}

describe("verifySession", () => {
  test("accepts a freshly signed session", () => {
    const expiresAt = Date.now() + 60_000;
    expect(verifySession(signSession(expiresAt))).toBe(true);
  });

  test("rejects a missing cookie", () => {
    expect(verifySession(undefined)).toBe(false);
    expect(verifySession("")).toBe(false);
  });

  test("rejects a tampered signature", () => {
    const expiresAt = Date.now() + 60_000;
    const good = signSession(expiresAt);
    const tampered = good.slice(0, -2) + (good.endsWith("a") ? "bb" : "aa");
    expect(verifySession(tampered)).toBe(false);
  });

  test("rejects a swapped expiresAt (signature no longer matches)", () => {
    const expiresAt = Date.now() + 60_000;
    const good = signSession(expiresAt);
    const sigOnly = good.split(".")[1];
    const forged = `${expiresAt + 999_999_999}.${sigOnly}`;
    expect(verifySession(forged)).toBe(false);
  });

  test("rejects an expired session", () => {
    const expiresAt = Date.now() - 1_000;
    expect(verifySession(signSession(expiresAt))).toBe(false);
  });

  test("rejects a malformed cookie value", () => {
    expect(verifySession("no-dot-here")).toBe(false);
    expect(verifySession(".onlyDot")).toBe(false);
    expect(verifySession("notANumber.deadbeef")).toBe(false);
  });

  test("rejects non-hex signature bytes without throwing", () => {
    const expiresAt = Date.now() + 60_000;
    // Buffer.from("zz", "hex") silently produces an empty buffer; the length
    // guard must catch it rather than letting timingSafeEqual throw.
    expect(() => verifySession(`${expiresAt}.zznothex`)).not.toThrow();
    expect(verifySession(`${expiresAt}.zznothex`)).toBe(false);
    expect(verifySession(`${expiresAt}.`)).toBe(false);
  });

  test("rejects when the signing secret changes", () => {
    const expiresAt = Date.now() + 60_000;
    const cookie = signSession(expiresAt);
    process.env.ADMIN_SESSION_SECRET =
      "different-secret-at-least-16-bytes-long-abcdef1234";
    expect(verifySession(cookie)).toBe(false);
  });

  test("throws when the secret is missing or too short (fail closed)", () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect(() => signSession(Date.now() + 60_000)).toThrow();
    expect(() =>
      verifySession(`${Date.now() + 60_000}.deadbeef`)
    ).toThrow();
  });
});

describe("newSession", () => {
  test("returns a valid cookie value + a ~30-day expiry", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const { value, expiresAt } = newSession(now);
    expect(verifySession(value, now + 1000)).toBe(true);
    expect(expiresAt.getTime() - now).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime() - now).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });
});

describe("verifyPassword", () => {
  test("accepts the exact configured password", () => {
    expect(verifyPassword("correct horse battery staple")).toBe(true);
  });

  test("rejects a wrong password", () => {
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  test("rejects when ADMIN_PASSWORD is unset (fail closed)", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(verifyPassword("anything")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  test("rejects a password of a different length without throwing", () => {
    // HMAC-both digests are always fixed length, so unequal-length inputs
    // don't hit timingSafeEqual's throw path.
    expect(() =>
      verifyPassword("correct horse battery staple ")
    ).not.toThrow();
    expect(verifyPassword("correct horse battery staple ")).toBe(false);
    expect(verifyPassword("short")).toBe(false);
  });
});

describe("isAdmin", () => {
  test("returns false when no session cookie is set", async () => {
    mockCookies.mockResolvedValue(cookieStore());
    expect(await isAdmin()).toBe(false);
  });

  test("returns true for a valid signed cookie", async () => {
    const { value } = newSession();
    mockCookies.mockResolvedValue(cookieStore({ [SESSION_COOKIE_NAME]: value }));
    expect(await isAdmin()).toBe(true);
  });

  test("returns false for a tampered cookie", async () => {
    const { value } = newSession();
    mockCookies.mockResolvedValue(
      cookieStore({ [SESSION_COOKIE_NAME]: value.slice(0, -2) + "00" })
    );
    expect(await isAdmin()).toBe(false);
  });

  test("returns false (not throws) when the secret is missing at read time", async () => {
    const { value } = newSession();
    mockCookies.mockResolvedValue(cookieStore({ [SESSION_COOKIE_NAME]: value }));
    delete process.env.ADMIN_SESSION_SECRET;
    expect(await isAdmin()).toBe(false);
  });
});
