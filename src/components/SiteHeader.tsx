/**
 * SiteHeader — shared top nav across all pages.
 *
 * The recipe library (/) is home; the grocery-list builder is one click away
 * but no longer front-and-center. Admin affordances (badge + sign out) render
 * only when the layout resolves an authenticated admin session.
 */

import Link from "next/link";

export default function SiteHeader({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <header className="bg-white border-b border-stone-200">
      <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="text-2xl">🍳</span>
          <div>
            <h1 className="text-lg font-semibold text-stone-900 leading-tight group-hover:text-amber-700 transition-colors">
              Sous-Chef
            </h1>
            <p className="text-xs text-stone-400">Your recipe library</p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                Admin
              </span>
              <form action="/api/admin/logout" method="post">
                <button
                  type="submit"
                  className="px-2 py-1 text-xs font-medium rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors whitespace-nowrap"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/admin/login"
              className="px-2 py-1 text-xs font-medium rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors whitespace-nowrap"
            >
              Admin sign in
            </Link>
          )}
          <Link
            href="/grocery-list"
            className="px-3 py-2 text-sm font-medium rounded-lg border border-amber-600 text-amber-700 hover:bg-amber-50 transition-colors whitespace-nowrap"
          >
            🛒 Grocery list
          </Link>
        </div>
      </div>
    </header>
  );
}
