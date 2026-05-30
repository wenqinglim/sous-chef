import type { PurchaseItem } from "@/types";

export interface DeriveResult {
  items: PurchaseItem[];
  unresolvable: unknown[];
  grouped_by_aisle: Record<string, PurchaseItem[]>;
}

export const AISLE_ORDER = [
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

const UNIT_PLURAL: Record<string, string> = {
  bunch: "bunches",
  box: "boxes",
  loaf: "loaves",
  leaf: "leaves",
  dash: "dashes",
};

function pluralizeUnit(unit: string, qty: number): string {
  if (qty <= 1) return unit;
  return UNIT_PLURAL[unit] ?? (unit.endsWith("s") ? unit : `${unit}s`);
}

function formatItem(item: PurchaseItem): string {
  const qty = item.purchase_quantity;
  const unit = pluralizeUnit(item.purchase_unit, qty);
  return `  ${qty} ${unit}  ${item.display_name}`;
}

export function formatForKeep(result: DeriveResult, title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`🛒 ${title}`);
    lines.push("");
  }

  for (const aisle of AISLE_ORDER) {
    const aisleItems = result.grouped_by_aisle[aisle]?.filter(
      (i) => !i.is_staple
    );
    if (!aisleItems || aisleItems.length === 0) continue;

    lines.push(aisle.toUpperCase().replace(/_/g, " "));
    for (const item of aisleItems) {
      lines.push(formatItem(item));
    }
    lines.push("");
  }

  const staples = result.items.filter((i) => i.is_staple);
  if (staples.length > 0) {
    lines.push("PANTRY STAPLES (check stock)");
    for (const item of staples.sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    )) {
      lines.push(`  — ${item.display_name}`);
    }
  }

  return lines.join("\n");
}
