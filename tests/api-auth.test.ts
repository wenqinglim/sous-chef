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
      findMany: jest.fn(),
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
  PATCH as recipePATCH,
  PUT as recipePUT,
  GET as recipeGET,
} from "@/app/api/recipes/[id]/route";
import { GET as recipesListGET } from "@/app/api/recipes/route";
import { prisma } from "@/lib/db/client";
import { SESSION_COOKIE_NAME, newSession } from "@/lib/auth";

const mockCookies = cookies as unknown as jest.Mock;
const mockRecipe = prisma.recipe as unknown as {
  findMany: jest.Mock;
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

// Minimal valid DB row for handlers whose success path maps via rowToRecipe.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "xyz",
    url: "https://example.com/recipe",
    title: "Test Recipe",
    baseServings: 4,
    cuisineSource: "western",
    ingredients: [],
    instructions: [],
    notes: null,
    edited: false,
    status: "tried_and_tested",
    parsedAt: new Date("2026-06-10T00:00:00.000Z"),
    userId: null,
    createdAt: new Date("2026-06-10T01:00:00.000Z"),
    updatedAt: new Date("2026-06-10T01:00:00.000Z"),
    ...overrides,
  };
}

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

  test("a status-only body is rejected — status can't sneak in and flip `edited`", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await recipePUT(
      jsonRequest("http://localhost/api/recipes/xyz", "PUT", {
        status: "tried_and_tested",
      }),
      paramsFor("xyz")
    );
    // Zod strips the unknown key, leaving an empty (no-op) patch → 400.
    expect(res.status).toBe(400);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/recipes/[id] (status/tags)", () => {
  test("returns 403 for anonymous callers", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        status: "tried_and_tested",
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(403);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });

  test("returns 403 for anonymous callers with a tags-only body", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        tags: ["curry"],
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(403);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });

  test("admin can set the status; the write never touches `edited`", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    mockRecipe.update.mockResolvedValue(makeRow({ status: "saved_for_later" }));
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        status: "saved_for_later",
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recipe.status).toBe("saved_for_later");
    expect(mockRecipe.update).toHaveBeenCalledWith({
      where: { id: "xyz" },
      data: { status: "saved_for_later" },
    });
  });

  test("rejects an invalid status value with 400", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        status: "delicious",
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(400);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });

  test("admin can set tags only; the write never touches `edited`", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    mockRecipe.update.mockResolvedValue(makeRow({ tags: ["curry"] }));
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        tags: ["curry"],
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recipe.tags).toEqual(["curry"]);
    expect(mockRecipe.update).toHaveBeenCalledWith({
      where: { id: "xyz" },
      data: { tags: ["curry"] },
    });
  });

  test("admin can set status and tags together in one atomic write", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    mockRecipe.update.mockResolvedValue(
      makeRow({ status: "tried_and_tested", tags: ["curry"] })
    );
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        status: "tried_and_tested",
        tags: ["curry"],
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recipe.status).toBe("tried_and_tested");
    expect(data.recipe.tags).toEqual(["curry"]);
    // A single prisma call carrying both fields, not two sequential writes.
    expect(mockRecipe.update).toHaveBeenCalledTimes(1);
    expect(mockRecipe.update).toHaveBeenCalledWith({
      where: { id: "xyz" },
      data: { status: "tried_and_tested", tags: ["curry"] },
    });
  });

  test("rejects an empty body with 400 (neither status nor tags)", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {}),
      paramsFor("xyz")
    );
    expect(res.status).toBe(400);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });

  test("rejects a tags array longer than 20 with 400", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    const res = await recipePATCH(
      jsonRequest("http://localhost/api/recipes/xyz", "PATCH", {
        tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      }),
      paramsFor("xyz")
    );
    expect(res.status).toBe(400);
    expect(mockRecipe.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/recipes (status filtering)", () => {
  test("anonymous callers only get tried_and_tested recipes", async () => {
    mockCookies.mockResolvedValue(anonymousCookies());
    mockRecipe.findMany.mockResolvedValue([makeRow()]);
    const res = await recipesListGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockRecipe.findMany).toHaveBeenCalledWith({
      where: { status: "tried_and_tested" },
      orderBy: { createdAt: "desc" },
    });
  });

  test("admin callers get the full library (no status filter)", async () => {
    mockCookies.mockResolvedValue(adminCookies());
    mockRecipe.findMany.mockResolvedValue([
      makeRow({ status: "saved_for_later" }),
    ]);
    const res = await recipesListGET();
    expect(res.status).toBe(200);
    expect(mockRecipe.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: "desc" },
    });
    const data = await res.json();
    expect(data.recipes[0].status).toBe("saved_for_later");
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
