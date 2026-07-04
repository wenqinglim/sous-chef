/**
 * POST /api/admin/logout
 * Clears the admin session cookie and redirects home so the layout re-renders
 * without the admin session. Always redirects (drives the header sign-out
 * form and any JS caller — the JS caller can follow the redirect or ignore it
 * via `redirect: "manual"`).
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
  return res;
}
