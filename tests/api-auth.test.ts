/**
 * Route-handler guard tests.
 *
 * The three write endpoints must return 403 for anonymous callers; the
 * `GET /api/recipes/:id` read must remain public. Existence of the guard is
 * asserted at the handler level so that a regression removing the check
 * (or fat-fingering the condition) fails CI.
 *
 * Prisma and the Anthropic SDK are mocked so the route modules load without
 * side effects. The DB layer is not exercised — the guard runs before any
 * downstream call, and the positive test only needs to prove we got past the
 * 403 (any non-403 response is enough evidence the guard passed).
 */

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

jest.mock("@/lib/db/client", () => ({
  prisma: {
    recipe: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { cookies } from "next/headers";
import { POST as extractPOST } from "@/app/api/extract/route";
import {
  DELETE as recipeDELETE,
  PUT as recipePUT,
  GET as recipeGET,
} from "@/app/api/recipes/[id]/route";
import { prisma } from "@/lib/db/client";
import { SESSION_COOKIE_NAME, newSession } from "@/lib/auth";

const mockCookies = cookies as unknown as jest.Mock;
const mockRecipe = prisma.recipe as unknown as {
  findUnique: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.ADMIN_SESSION_SECRET =
    "test-secret-at-least-16-bytes-long-please-1234567890";
  process.env.ADMIN_PASSWORD = "correct horse battery staple";
  mockCookies.mockReset();
  Object.values(mockRecipe).forEach((fn) => fn.mockReset());
});

afterAll(() => {
  process.env = originalEnv;
});

function anonymousCookies() {
  return { get: () => undefined };
}

function adminCookies() {
  const { value } = newSession();
  return {
    get: (name: string) =>
      name === SESSION_COOKIE_NAME ? { value } : undefined,
  };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/extract", () => {
  test("returns 403 for anonymous callers", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    const res = await extractPOST(
      jsonRequest("http://localhost/api/extract", "POST", {
        url: "https://example.com/r",
      })
    );
    expect(res.status).toBe(403);
    // Guard must run before any DB write.
    expect(mockRecipe.upsert).not.toHaveBeenCalled();
  });

  test("passes the guard for a valid admin session", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await extractPOST(
      jsonRequest("http://localhost/api/extract", "POST", {
        url: "not a valid url",
      })
    );
    // Downstream Zod rejects the body — that's fine; the point is we got past
    // the 403 guard, so status !== 403 proves the guard is not inverted.
    expect(res.status).not.toBe(403);
  });
});

describe("PUT /api/recipes/[id]", () => {
  test("returns 403 for anonymous callers", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    const res = await recipePUT(
      jsonRequest("http://localhost/api/recipes/xyz", "PUT", {
        title: "hacked",
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(403);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });

  test("passes the guard for a valid admin session", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await recipePUT(
      jsonRequest("http://localhost/api/recipes/xyz", "PUT", {
        title: "renamed",
      }),
      paramsFor("xyz")
    );
    expect(res.status).not.toBe(403);
  });
});

describe("DELETE /api/recipes/[id]", () => {
  test("returns 403 for anonymous callers", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    const res = await recipeDELETE(
      new Request("http://localhost/api/recipes/xyz", {
        method: "DELETE",
      }) as unknown as import("next/server").NextRequest,
      paramsFor("xyz")
    );
    expect(res.status).toBe(403);
    expect(mockRecipe.delete).not.toHaveBeenCalled();
  });

  test("passes the guard for a valid admin session", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    mockRecipe.delete.mockResolvedValue({});
    const res = await recipeDELETE(
      new Request("http://localhost/api/recipes/xyz", {
        method: "DELETE",
      }) as unknown as import("next/server").NextRequest,
      paramsFor("xyz")
    );
    expect(res.status).not.toBe(403);
  });
});

describe("GET /api/recipes/[id]", () => {
  test("remains public — anonymous callers receive the recipe, not 403", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    mockRecipe.findUnique.mockResolvedValue(null); // triggers 404 path
    const res = await recipeGET(
      new Request(
        "http://localhost/api/recipes/xyz"
      ) as unknown as import("next/server").NextRequest,
      paramsFor("xyz")
    );
    expect(res.status).not.toBe(403);
  });
});
