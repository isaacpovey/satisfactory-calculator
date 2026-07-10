export type BeltTierId = "mk1" | "mk2" | "mk3";

export interface BeltTier {
  id: BeltTierId;
  name: string;
  /** Solid items per minute */
  capacity: number;
}

/** Conveyor belt tiers used for packing machine banks and merges. */
export const BELT_TIERS: readonly BeltTier[] = [
  { id: "mk1", name: "Conveyor Mk.1", capacity: 60 },
  { id: "mk2", name: "Conveyor Mk.2", capacity: 120 },
  { id: "mk3", name: "Conveyor Mk.3", capacity: 270 },
] as const;

export const DEFAULT_MAX_BELT_CAPACITY = 270;

export function beltTierById(id: BeltTierId): BeltTier {
  return BELT_TIERS.find((t) => t.id === id)!;
}

/**
 * Lowest belt tier that can carry `rate`, not exceeding `maxCapacity`.
 * Returns null when rate exceeds the allowed max.
 */
export function beltTierForRate(
  rate: number,
  maxCapacity: number = DEFAULT_MAX_BELT_CAPACITY,
): BeltTier | null {
  if (rate <= 0) return BELT_TIERS[0]!;
  if (rate > maxCapacity + 1e-9) return null;
  for (const tier of BELT_TIERS) {
    if (tier.capacity > maxCapacity + 1e-9) continue;
    if (rate <= tier.capacity + 1e-9) return tier;
  }
  return null;
}

export function clampMaxBeltCapacity(capacity: number): number {
  const allowed = BELT_TIERS.map((t) => t.capacity);
  if (allowed.includes(capacity)) return capacity;
  // Snap to nearest allowed tier at or below, else default
  const below = [...allowed].reverse().find((c) => c <= capacity);
  return below ?? DEFAULT_MAX_BELT_CAPACITY;
}
