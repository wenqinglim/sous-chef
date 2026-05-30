"use client";

/**
 * CopyButton — formats the grocery list as plain text and copies to clipboard.
 *
 * Google Keep automatically turns each line break into a checklist item when
 * you paste plain text into a list note.
 *
 * Falls back to a <textarea> select-all for browsers without clipboard API.
 */

import { useState } from "react";
import type { PurchaseItem } from "@/types";
import { formatForKeep } from "@/lib/derive";
import type { DeriveResult } from "@/lib/derive";

interface Props {
  items: PurchaseItem[];
  grouped_by_aisle: Record<string, PurchaseItem[]>;
}

export default function CopyButton({ items, grouped_by_aisle }: Props) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const result: DeriveResult = {
    items,
    unresolvable: [],
    grouped_by_aisle,
  };

  const text = formatForKeep(result, "Grocery List");

  async function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Fall through to textarea fallback
      }
    }
    setShowFallback(true);
  }

  return (
    <div>
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
      >
        {copied ? (
          <>✓ Copied!</>
        ) : (
          <>📋 Copy for Google Keep</>
        )}
      </button>

      {showFallback && (
        <div className="mt-3">
          <p className="text-xs text-stone-500 mb-1">
            Select all and copy (Ctrl+A, Ctrl+C):
          </p>
          <textarea
            readOnly
            value={text}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="w-full h-40 text-xs font-mono border border-stone-300 rounded p-2 resize-none focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
