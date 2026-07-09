export function formatRate(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-9) return "0";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function formatMachines(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-9) return "0";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  });
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}
