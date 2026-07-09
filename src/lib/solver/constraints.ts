import { getRecipeForProduct, recipePrimaryOutputPerMinute } from "@/data/recipes";
import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";

export const ALLOWED_CLOCKS = [1, 0.75, 0.5, 0.25] as const;
export type AllowedClock = (typeof ALLOWED_CLOCKS)[number];

const EPS = 1e-9;

/** Machine group sizes that can be fed equally with nested 1/2 and 1/3 splitters. */
export const SPLITTER_FRIENDLY_COUNTS: readonly number[] = (() => {
  const set = new Set<number>();
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 4; b++) {
      const n = 2 ** a * 3 ** b;
      if (n <= 64) set.add(n);
    }
  }
  return [...set].sort((x, y) => x - y);
})();

export interface MachineConfig {
  /** Physical building count (always 2^a * 3^b) */
  machines: number;
  /** Uniform clock speed 0–1 */
  clock: AllowedClock;
  /** machines * clock */
  effectiveMachines: number;
}

/** Round effective machines up to the next multiple of 0.25 (25% clock quantum). */
export function ceilEffectiveMachines(exact: number): number {
  if (exact <= EPS) return 0;
  return Math.ceil(exact * 4 - EPS) / 4;
}

export function isSplitterFriendlyCount(n: number): boolean {
  if (n <= 0 || !Number.isFinite(n)) return false;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > EPS) return false;
  return SPLITTER_FRIENDLY_COUNTS.includes(rounded);
}

/**
 * Represent an effective machine count using a splitter-friendly building count
 * at an allowed clock. Prefers minimal overshoot, then fewer buildings, then
 * higher clock.
 */
export function representMachines(effectiveMachines: number): MachineConfig {
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) {
    return { machines: 0, clock: 1, effectiveMachines: 0 };
  }

  let best: MachineConfig | null = null;
  for (const machines of SPLITTER_FRIENDLY_COUNTS) {
    for (const clock of ALLOWED_CLOCKS) {
      const achieved = machines * clock;
      if (achieved + EPS < effective) continue;
      const candidate: MachineConfig = {
        machines,
        clock,
        effectiveMachines: achieved,
      };
      if (
        !best ||
        candidate.effectiveMachines < best.effectiveMachines - EPS ||
        (Math.abs(candidate.effectiveMachines - best.effectiveMachines) <=
          EPS &&
          candidate.machines < best.machines) ||
        (Math.abs(candidate.effectiveMachines - best.effectiveMachines) <=
          EPS &&
          candidate.machines === best.machines &&
          candidate.clock > best.clock)
      ) {
        best = candidate;
      }
    }
  }

  // Fallback: next friendly count at 25%
  const minMachines = Math.ceil(effective / 0.25 - EPS);
  const machines =
    SPLITTER_FRIENDLY_COUNTS.find((n) => n >= minMachines) ??
    SPLITTER_FRIENDLY_COUNTS[SPLITTER_FRIENDLY_COUNTS.length - 1]!;
  return (
    best ?? {
      machines,
      clock: 0.25,
      effectiveMachines: machines * 0.25,
    }
  );
}

/** Smallest valid output rate ≥ desired for an item's default recipe. */
export function quantizeItemRate(itemId: ItemId, desiredRate: number): number {
  if (desiredRate <= EPS) return 0;
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return desiredRate;
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return desiredRate;
  const exactMachines = desiredRate / base;
  const config = representMachines(exactMachines);
  return config.effectiveMachines * base;
}

/**
 * Next discrete step for an item: prefer growing by one splitter-friendly
 * machine quantum at the item's recipe rate.
 */
export function itemRateStep(itemId: ItemId): number {
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return 1;
  // Smallest positive increase from adding 0.25 effective on a friendly count
  // is still one 25% clock quantum of a single machine.
  return recipePrimaryOutputPerMinute(recipe) * 0.25;
}

/**
 * True if `part/whole` is (within float tolerance) a fraction whose denominator
 * is 2^a * 3^b — buildable with nested 1/2 and 1/3 splitters (e.g. 1/12).
 */
export function isSplitterFriendlyRatio(part: number, whole: number): boolean {
  if (whole <= EPS) return part <= EPS;
  if (part <= EPS) return true;
  if (part > whole + EPS) return false;

  const ratio = part / whole;
  for (const den of SPLITTER_FRIENDLY_COUNTS) {
    const num = Math.round(ratio * den);
    if (num < 0 || num > den) continue;
    if (Math.abs(ratio - num / den) <= 1e-9) return true;
  }
  return false;
}

/**
 * Snap a desired share of `whole` down to the largest amount ≤ desired that
 * forms a 2^a·3^b fraction of `whole` (nested 1/2 and 1/3 splitters, e.g. 1/12).
 */
export function snapSplitterShare(desired: number, whole: number): number {
  if (desired <= EPS || whole <= EPS) return 0;
  const target = Math.min(desired, whole);
  if (isSplitterFriendlyRatio(target, whole)) return target;

  let best = 0;
  for (const den of SPLITTER_FRIENDLY_COUNTS) {
    const maxNum = Math.min(den, Math.floor((target * den) / whole + EPS));
    for (let num = maxNum; num >= 1; num--) {
      const share = (whole * num) / den;
      if (share <= target + EPS) {
        if (share > best + EPS) best = share;
        break;
      }
    }
  }
  return best;
}

/**
 * Snap an excess branch so excess/(downstream+excess) is a 2^a·3^b fraction.
 * Chooses the largest excess ≤ desired that satisfies the ratio.
 */
export function snapExcessBranch(
  desiredExcess: number,
  downstreamDemand: number,
): number {
  if (desiredExcess <= EPS) return 0;
  const downstream = Math.max(0, downstreamDemand);

  // Pure excess with no shared downstream consumers — any rate is fine
  if (downstream <= EPS) return desiredExcess;

  let best = 0;
  for (const den of SPLITTER_FRIENDLY_COUNTS) {
    for (let num = 1; num < den; num++) {
      const excess = (num * downstream) / (den - num);
      if (excess <= desiredExcess + EPS && excess > best + EPS) {
        best = excess;
      }
    }
  }
  return best;
}

/**
 * Given a parent belt rate, return the largest child rate ≤ desired that can
 * be split with nested 1/2 and 1/3 splitters.
 */
export function snapChildFromParent(desired: number, parentRate: number): number {
  return snapSplitterShare(desired, parentRate);
}

export function recipeDepth(
  itemId: ItemId,
  memo = new Map<ItemId, number>(),
): number {
  if (memo.has(itemId)) return memo.get(itemId)!;
  const item = itemById[itemId];
  if (!item || item.isRaw) {
    memo.set(itemId, 0);
    return 0;
  }
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) {
    memo.set(itemId, 0);
    return 0;
  }
  let depth = 1;
  for (const input of recipe.inputs) {
    depth = Math.max(depth, 1 + recipeDepth(input.item, memo));
  }
  memo.set(itemId, depth);
  return depth;
}

/** Higher = more complex (prefer for leftover fill). */
export function complexityScore(itemId: ItemId): number {
  const depth = recipeDepth(itemId);
  const recipe = getRecipeForProduct(itemId);
  const inputs = recipe?.inputs.length ?? 0;
  return depth * 10 + inputs;
}

export function formatClock(clock: AllowedClock): string {
  return `${Math.round(clock * 100)}%`;
}
