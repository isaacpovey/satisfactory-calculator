import { getRecipeForProduct, recipePrimaryOutputPerMinute } from "@/data/recipes";
import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";

export const ALLOWED_CLOCKS = [1, 0.75, 0.5, 0.25] as const;
export type AllowedClock = (typeof ALLOWED_CLOCKS)[number];

const EPS = 1e-9;

export interface MachineConfig {
  /** Physical building count */
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

/**
 * Represent an effective machine count using whole buildings at an allowed clock.
 * Prefers minimal overshoot, then fewer buildings, then higher clock.
 */
export function representMachines(effectiveMachines: number): MachineConfig {
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) {
    return { machines: 0, clock: 1, effectiveMachines: 0 };
  }

  let best: MachineConfig | null = null;
  for (const clock of ALLOWED_CLOCKS) {
    const machines = Math.ceil(effective / clock - EPS);
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
      (Math.abs(candidate.effectiveMachines - best.effectiveMachines) <= EPS &&
        candidate.machines < best.machines) ||
      (Math.abs(candidate.effectiveMachines - best.effectiveMachines) <= EPS &&
        candidate.machines === best.machines &&
        candidate.clock > best.clock)
    ) {
      best = candidate;
    }
  }

  const machines = Math.ceil(effective / 0.25 - EPS);
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

/** Next discrete step size (one 25% clock quantum) for an item. */
export function itemRateStep(itemId: ItemId): number {
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return 1;
  return recipePrimaryOutputPerMinute(recipe) * 0.25;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * True if `part/whole` reduces to a fraction whose denominator is 2^a * 3^b
 * (buildable with 1/2 and 1/3 splitters).
 */
export function isSplitterFriendlyRatio(part: number, whole: number): boolean {
  if (whole <= EPS) return part <= EPS;
  if (part <= EPS) return true;
  if (part > whole + EPS) return false;

  const scale = 1000;
  let p = Math.round(part * scale);
  let w = Math.round(whole * scale);
  if (p < 0 || w <= 0 || p > w) return false;

  const g = gcd(p, w);
  p /= g;
  w /= g;

  while (w % 2 === 0) w /= 2;
  while (w % 3 === 0) w /= 3;
  return w === 1;
}

/** Practical splitter-tree denominators (1/2 and 1/3 combinations). */
const SIMPLE_SPLIT_DENS = [
  1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27, 32, 36,
] as const;

/**
 * Snap a desired share of `whole` down to the largest whole-number rate that
 * is ≤ desired and forms a simple 2^a·3^b fraction of `whole`.
 */
export function snapSplitterShare(desired: number, whole: number): number {
  if (desired <= EPS || whole <= EPS) return 0;
  const target = Math.min(desired, whole);
  const wholeInt = Math.round(whole);
  // Prefer integer item/min shares when the pool is (near) integer
  const useInts = Math.abs(whole - wholeInt) < 1e-6;

  let best = 0;
  for (const den of SIMPLE_SPLIT_DENS) {
    for (let num = den; num >= 0; num--) {
      let share = (whole * num) / den;
      if (useInts) share = Math.round(share);
      if (share > target + EPS) continue;
      if (share > best + EPS && isSplitterFriendlyRatio(share, whole)) {
        best = share;
      }
      break;
    }
  }

  // Fallback: scan integer shares downward
  if (useInts) {
    for (let share = Math.floor(target + EPS); share >= 0; share--) {
      if (isSplitterFriendlyRatio(share, whole)) return share;
    }
  }

  return best;
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
