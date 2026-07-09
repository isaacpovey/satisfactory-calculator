/** Fixed formatting so SSR and client always emit identical strings. */
function formatFixed(value: number, maxDigits: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-9) return "0";

  const fixed = value.toFixed(maxDigits);
  // Trim trailing zeros and a dangling decimal point (always uses `.`).
  return fixed.replace(/\.?0+$/, "");
}

export function formatRate(value: number, digits = 2): string {
  return formatFixed(value, digits);
}

export function formatMachines(value: number): string {
  return formatFixed(value, 3);
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${formatFixed(fraction * 100, 1)}%`;
}
