/**
 * Section helpers — keep ingredient/instruction grouping coherent across the app.
 *
 * `Recipe.instructions` is now `InstructionStep[]`, but older DB rows and cached
 * localStorage recipes stored a plain `string[]`. `normalizeInstructions` coerces
 * any legacy/mixed shape at read boundaries so callers never branch on it.
 *
 * `groupBySection` turns a flat list carrying optional section labels into
 * consecutive groups for rendering — the source order is authoritative.
 */

import type { InstructionStep } from "@/types";

/**
 * Coerce an unknown `instructions` value into `InstructionStep[]`. Accepts:
 *   - the new shape: `[{ text, section? }]`
 *   - the legacy shape: `["step one", "step two"]`
 *   - a mix of the two (defensive)
 * Anything unparseable is dropped. Empty/whitespace-only step text is dropped.
 */
export function normalizeInstructions(raw: unknown): InstructionStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: InstructionStep[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) steps.push({ text, section: null });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as InstructionStep).text === "string") {
      const text = (item as InstructionStep).text.trim();
      if (!text) continue;
      const rawSection = (item as InstructionStep).section;
      const section = typeof rawSection === "string" && rawSection.trim() ? rawSection.trim() : null;
      steps.push({ text, section });
    }
  }
  return steps;
}

export interface SectionGroup<T> {
  /** Section label, or null for ungrouped items */
  section: string | null;
  items: T[];
}

/**
 * Group a flat list into consecutive runs sharing the same section label,
 * preserving source order. A run breaks whenever the label changes, so a
 * label that reappears later starts a new group (sections are contiguous in
 * practice). Empty-string / undefined labels are treated as null (ungrouped).
 */
export function groupBySection<T>(
  items: T[],
  getSection: (item: T) => string | null | undefined
): SectionGroup<T>[] {
  const groups: SectionGroup<T>[] = [];
  for (const item of items) {
    const raw = getSection(item);
    const section = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) {
      last.items.push(item);
    } else {
      groups.push({ section, items: [item] });
    }
  }
  return groups;
}

/** True when any item carries a non-empty section label. */
export function hasSections<T>(
  items: T[],
  getSection: (item: T) => string | null | undefined
): boolean {
  return items.some((item) => {
    const raw = getSection(item);
    return typeof raw === "string" && raw.trim().length > 0;
  });
}
