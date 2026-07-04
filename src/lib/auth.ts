/**
 * Shared-password admin auth.
 *
 * Only writes (add/edit/delete) are gated; browsing is fully public. A single
 * ADMIN_PASSWORD unlocks a stateless, HMAC-signed cookie — no session store,
 * no per-user identity, no auth deps.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "sc_admin";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET is not set (or too short) — refusing to sign/verify sessions"
    );
  }
  return s;
}

function hmac(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function signSession(expiresAt: number): string {
  return `${expiresAt}.${hmac(String(expiresAt)).toString("hex")}`;
}

export function newSession(now: number = Date.now()): {
  value: string;
  expiresAt: Date;
} {
  const expiresAt = now + SESSION_TTL_MS;
  return { value: signSession(expiresAt), expiresAt: new Date(expiresAt) };
}

export function verifySession(
  cookieValue: string | undefined,
  now: number = Date.now()
): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;

  const expiresAtStr = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const expected = hmac(expiresAtStr);
  const provided = Buffer.from(providedSig, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Constant-time password check. We HMAC both sides so the timing profile is
 * independent of the input length, and only a fixed-length digest ever hits
 * timingSafeEqual — no early return on length mismatch to leak a size oracle.
 */
export function verifyPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = hmac(input);
  const b = hmac(expected);
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/**
 * Reads the session cookie once per request (React `cache` scope) so multiple
 * server components / handlers in the same request share the result. Fails
 * closed on any error (missing secret, bad cookie API), returning false.
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  try {
    const store = await cookies();
    return verifySession(store.get(SESSION_COOKIE_NAME)?.value);
  } catch {
    return false;
  }
});

/**
 * Route-handler guard. Call at the top of a write handler:
 *   const forbidden = await requireAdmin();
 *   if (forbidden) return forbidden;
 * Returns a 403 NextResponse when not admin, null otherwise.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
