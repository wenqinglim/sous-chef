/**
 * Normalize a URL for dedupe: drop hash, tracking params, and trailing slash
 * so https://x.com/recipe/ and https://x.com/recipe?utm_source=y collapse
 * into one library entry.
 *
 * Lives outside src/lib/db so client components can share the exact
 * normalization the repository uses without pulling Prisma into the bundle.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      // Prefix-matches the tracking params; "ref" alone is exact ($)
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}
