/**
 * POST /api/admin/login
 * Body: { password: string }
 * 200: { ok: true }  — sets HttpOnly session cookie
 * 401: { error: string }
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

  if (!verifyPassword(parsed.data.password)) {
    // Unconditional delay on failure raises the cost of an online brute force
    // without any rate-limiting infra. Not a substitute for a real limiter,
    // but the whole attack surface here is a single shared password.
    await new Promise((r) => setTimeout(r, 300));
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const session = newSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE_NAME,
    session.value,
    sessionCookieOptions(session.expiresAt)
  );
  return res;
}
