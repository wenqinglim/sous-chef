/** Round a quantity up to a whole number for display. Never shows decimals or fractions. */
export function roundUpDisplay(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.ceil(qty);
}
