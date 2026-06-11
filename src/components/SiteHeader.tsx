/**
 * SiteHeader — shared top nav across all pages.
 *
 * The recipe library (/) is home; the grocery-list builder is one click away
 * but no longer front-and-center.
 */

import Link from "next/link";

export default function SiteHeader() {
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
        <Link
          href="/grocery-list"
          className="px-3 py-2 text-sm font-medium rounded-lg border border-amber-600 text-amber-700 hover:bg-amber-50 transition-colors whitespace-nowrap"
        >
          🛒 Grocery list
        </Link>
      </div>
    </header>
  );
}
