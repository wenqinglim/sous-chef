"use client";

/**
 * GroceryList — Step 3 of the UI.
 *
 * Renders the final grocery list grouped by aisle.
 * Staples are shown in a separate section at the bottom.
 */

import type { PurchaseItem, UnresolvableIngredient } from "@/types";
import CopyButton from "./CopyButton";

interface Props {
  items: PurchaseItem[];
  unresolvable: UnresolvableIngredient[];
  grouped_by_aisle: Record<string, PurchaseItem[]>;
  onBack: () => void;
  onReset: () => void;
}

const AISLE_ORDER = [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "deli",
  "bakery",
  "frozen",
  "asian_grocery",
  "pantry",
  "condiments",
  "beverages",
  "other",
];

const AISLE_LABELS: Record<string, string> = {
  produce: "🥦 Produce",
  meat: "🥩 Meat",
  seafood: "🐟 Seafood",
  dairy: "🥛 Dairy & Eggs",
  deli: "🧀 Deli",
  bakery: "🍞 Bakery",
  frozen: "🧊 Frozen",
  asian_grocery: "🥢 Asian Grocery",
  pantry: "🫙 Pantry",
  condiments: "🍶 Condiments",
  beverages: "🥤 Beverages",
  other: "📦 Other",
};

function formatQuantity(item: PurchaseItem): string {
  const qty = item.purchase_quantity;
  const unit = item.purchase_unit;
  // "each" is redundant for countable items — just show the number
  if (unit === "each") return `${qty}`;
  const noPlural = new Set(["g", "ml", "oz", "lb", "kg"]);
  const unitStr = qty === 1 || noPlural.has(unit) ? unit : unit + "s";
  return `${qty} ${unitStr}`;
}

export default function GroceryList({
  items,
  unresolvable,
  grouped_by_aisle,
  onBack,
  onReset,
}: Props) {
  const nonStaples = items.filter((i) => !i.is_staple);
  const staples = items.filter((i) => i.is_staple);

  return (
    <div className="space-y-4">
      {/* Copy button at top */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-500">
          {nonStaples.length} item{nonStaples.length !== 1 ? "s" : ""}
          {staples.length > 0 && ` + ${staples.length} pantry staple${staples.length !== 1 ? "s" : ""}`}
        </span>
        <CopyButton items={items} grouped_by_aisle={grouped_by_aisle} />
      </div>

      {/* Grocery items by aisle */}
      <div className="space-y-5">
        {AISLE_ORDER.map((aisle) => {
          const aisleItems = (grouped_by_aisle[aisle] ?? []).filter(
            (i) => !i.is_staple
          );
          if (aisleItems.length === 0) return null;

          return (
            <div key={aisle}>
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
                {AISLE_LABELS[aisle] ?? aisle}
              </h3>
              <ul className="space-y-1.5">
                {aisleItems.map((item) => (
                  <li
                    key={item.canonical_id}
                    className="flex items-baseline gap-3 group"
                  >
                    <span className="w-20 text-right text-sm font-mono text-stone-500 shrink-0">
                      {formatQuantity(item)}
                    </span>
                    <span className="text-sm text-stone-800 flex-1">
                      {item.display_name}
                    </span>
                    {item.leftover_quantity > 0 && (
                      <span className="text-xs text-stone-400 hidden group-hover:inline">
                        ~{Math.round(item.leftover_quantity)} {item.recipe_unit} leftover
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Pantry staples */}
      {staples.length > 0 && (
        <div className="border-t border-stone-200 pt-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
            🫙 Pantry Staples — check your stock
          </h3>
          <ul className="space-y-1">
            {staples
              .sort((a, b) => a.display_name.localeCompare(b.display_name))
              .map((item) => (
                <li key={item.canonical_id} className="text-sm text-stone-500">
                  — {item.display_name}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Unresolvable ingredients */}
      {unresolvable.length > 0 && (
        <div className="border-t border-stone-200 pt-4">
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
            ⚠️ Couldn&apos;t categorise — add manually
          </h3>
          <ul className="space-y-1">
            {unresolvable.map((item, i) => (
              <li key={i} className="text-sm text-stone-600">
                {item.quantity !== null && `${item.quantity} ${item.unit ?? ""} `}
                {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Navigation */}
      <div className="pt-2 border-t border-stone-100 flex gap-4">
        <button
          onClick={onBack}
          className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
        >
          ← Edit ingredients
        </button>
        <button
          onClick={onReset}
          className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
        >
          Start a new list
        </button>
      </div>
    </div>
  );
}
