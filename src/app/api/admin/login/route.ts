/**
 * POST /api/admin/login
 * Body: { password: string }
 * 200: { ok: true }  — sets HttpOnly session cookie
 * 401: { error: string }
 * 500: { error: string }  — ADMIN_SESSION_SECRET missing/short (misconfig)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  newSession,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

const RequestSchema = z.object({ password: z.string() });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // verifyPassword and newSession both throw if ADMIN_SESSION_SECRET is
  // missing/short. Surface that as a clear 500 instead of an uncaught
  // exception → generic Next.js error page, which would look like the login
  // is broken rather than a config problem.
  let ok: boolean;
  let session: ReturnType<typeof newSession>;
  try {
    ok = verifyPassword(parsed.data.password);
    session = ok ? newSession() : (undefined as never);
  } catch (err) {
    console.error("Admin login misconfigured:", err);
    return NextResponse.json(
      { error: "Server misconfigured — check ADMIN_SESSION_SECRET" },
      { status: 500 }
    );
  }

  if (!ok) {
    // Unconditional delay on failure raises the cost of an online brute force
    // without any rate-limiting infra. Not a substitute for a real limiter,
    // but the whole attack surface here is a single shared password.
    await new Promise((r) => setTimeout(r, 300));
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE_NAME,
    session.value,
    sessionCookieOptions(session.expiresAt)
  );
  return res;
}
