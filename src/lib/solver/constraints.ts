import { getRecipeForProduct, recipePrimaryOutputPerMinute } from "@/data/recipes";
import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";

/** Easy underclocks: quarters plus thirds (100 / 75 / 66.67 / 50 / 33.33 / 25%). */
export const ALLOWED_CLOCKS = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25] as const;
export type AllowedClock = (typeof ALLOWED_CLOCKS)[number];

/** Finest shared quantum of allowed clocks (lcm of 1/4 and 1/3). */
export const CLOCK_QUANTUM = 1 / 12;

const EPS = 1e-9;

/**
 * Max nested 1/2 + 1/3 splitter depth (a + b for denominator 2^a·3^b).
 * Depth 5 keeps manifolds practical (e.g. 1/12 is depth 3; 1/32 is depth 5).
 */
export const MAX_SPLITTER_DEPTH = 5;

/** Machine group sizes that can be fed equally with nested 1/2 and 1/3 splitters. */
export const SPLITTER_FRIENDLY_COUNTS: readonly number[] = (() => {
  const set = new Set<number>();
  for (let a = 0; a <= MAX_SPLITTER_DEPTH; a++) {
    for (let b = 0; b <= MAX_SPLITTER_DEPTH - a; b++) {
      set.add(2 ** a * 3 ** b);
    }
  }
  return [...set].sort((x, y) => x - y);
})();

export interface MachineConfig {
  /** Physical building count (splitter-friendly unless anyMachineCount) */
  machines: number;
  /** Uniform clock speed 0–1 within this group */
  clock: AllowedClock;
  /** machines * clock */
  effectiveMachines: number;
}

export type SplitterStep = "1/2" | "1/3";
/** Nested merger topology (same 2/3 branching as splitters). */
export type MergerStep = "2→1" | "3→1";

/** Round effective machines up to the next shared clock quantum (1/12). */
export function ceilEffectiveMachines(exact: number): number {
  if (exact <= EPS) return 0;
  return Math.ceil(exact / CLOCK_QUANTUM - EPS) * CLOCK_QUANTUM;
}

export function isSplitterFriendlyCount(n: number): boolean {
  if (n <= 0 || !Number.isFinite(n)) return false;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > EPS) return false;
  return SPLITTER_FRIENDLY_COUNTS.includes(rounded);
}

function machineCountOptions(
  maxMachines: number,
  anyMachineCount: boolean,
): readonly number[] {
  if (anyMachineCount) {
    return Array.from({ length: Math.max(1, maxMachines) }, (_, i) => i + 1);
  }
  return SPLITTER_FRIENDLY_COUNTS.filter((n) => n <= Math.max(maxMachines, 48));
}

/**
 * Represent an effective machine count using a splitter-friendly building count
 * at an allowed clock. Prefers minimal overshoot, then fewer buildings, then
 * higher clock.
 */
export function representMachines(effectiveMachines: number): MachineConfig {
  return representMachinesWithCounts(
    effectiveMachines,
    SPLITTER_FRIENDLY_COUNTS,
  );
}

/**
 * Like {@link representMachines}, but allows any integer building count.
 * Used when soaking leftover ore so we are not forced over budget by the next
 * 2ᵃ·3ᵇ jump (e.g. 7→8 constructors).
 */
export function representMachinesAny(effectiveMachines: number): MachineConfig {
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) {
    return { machines: 0, clock: 1, effectiveMachines: 0 };
  }
  const maxMachines = Math.max(
    1,
    Math.ceil(effective / CLOCK_QUANTUM + EPS),
  );
  const counts = Array.from({ length: maxMachines }, (_, i) => i + 1);
  return representMachinesWithCounts(effectiveMachines, counts);
}

function representMachinesWithCounts(
  effectiveMachines: number,
  counts: readonly number[],
): MachineConfig {
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) {
    return { machines: 0, clock: 1, effectiveMachines: 0 };
  }

  let best: MachineConfig | null = null;
  for (const machines of counts) {
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

  const minMachines = Math.ceil(effective / CLOCK_QUANTUM - EPS);
  return (
    best ?? {
      machines: minMachines,
      clock: 0.25,
      effectiveMachines: minMachines * 0.25,
    }
  );
}

function totalMachines(groups: MachineConfig[]): number {
  return groups.reduce((s, g) => s + g.machines, 0);
}

function totalEffective(groups: MachineConfig[]): number {
  return groups.reduce((s, g) => s + g.effectiveMachines, 0);
}

function avgClock(groups: MachineConfig[]): number {
  const m = totalMachines(groups);
  if (m <= 0) return 0;
  return groups.reduce((s, g) => s + g.clock * g.machines, 0) / m;
}

function isBetterMulti(
  candidate: MachineConfig[],
  best: MachineConfig[],
  effective: number,
): boolean {
  const cOver = totalEffective(candidate) - effective;
  const bOver = totalEffective(best) - effective;
  if (cOver < bOver - EPS) return true;
  if (cOver > bOver + EPS) return false;
  const cMach = totalMachines(candidate);
  const bMach = totalMachines(best);
  if (cMach < bMach) return true;
  if (cMach > bMach) return false;
  if (candidate.length < best.length) return true;
  if (candidate.length > best.length) return false;
  return avgClock(candidate) > avgClock(best) + EPS;
}

function sortGroups(groups: MachineConfig[]): MachineConfig[] {
  return [...groups].sort(
    (a, b) =>
      b.clock - a.clock ||
      b.machines - a.machines ||
      b.effectiveMachines - a.effectiveMachines,
  );
}

function findRemainderGroup(
  remainder: number,
  counts: readonly number[],
): MachineConfig | null {
  if (remainder <= EPS) return null;
  let best: MachineConfig | null = null;
  for (const machines of counts) {
    for (const clock of ALLOWED_CLOCKS) {
      const achieved = machines * clock;
      if (achieved + EPS < remainder) continue;
      // Prefer exact or near-exact small remainder groups
      if (achieved > remainder + 1 + EPS && machines > 1) continue;
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
  return best;
}

/**
 * Represent effective machines as 1–3 groups with independent clocks.
 * Prefers least overshoot, then fewest buildings, then fewer groups, then
 * higher clocks. Always considers a single-group baseline.
 *
 * Search is O(maxMachines × clocks): k @ 100% + one remainder group, plus a
 * small two-underclock pass for remainders when k=0.
 */
export function representMachinesMulti(
  effectiveMachines: number,
  opts: { anyMachineCount?: boolean } = {},
): MachineConfig[] {
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) return [];

  const maxMachines = Math.max(
    1,
    Math.ceil(effective / Math.min(...ALLOWED_CLOCKS) + EPS),
  );
  const counts = machineCountOptions(maxMachines, !!opts.anyMachineCount);
  const countSet = new Set(counts);

  const single = representMachinesWithCounts(effectiveMachines, counts);
  let best: MachineConfig[] = single.machines > 0 ? [single] : [];

  const consider = (groups: MachineConfig[]) => {
    const filtered = sortGroups(groups.filter((g) => g.machines > 0));
    if (filtered.length === 0) return;
    if (isBetterMulti(filtered, best, effective)) best = filtered;
  };

  // Heuristic: k machines @ 100% + one remainder underclock group
  const fullMax = Math.floor(effective + EPS);
  for (let k = fullMax; k >= 0; k--) {
    if (k > 0 && !countSet.has(k)) continue;
    const rem = effective - k;
    if (rem <= EPS) {
      if (k > 0) consider([{ machines: k, clock: 1, effectiveMachines: k }]);
      continue;
    }
    const remGroup = findRemainderGroup(rem, counts);
    if (!remGroup) continue;
    if (k <= 0) {
      consider([remGroup]);
      continue;
    }
    consider([
      { machines: k, clock: 1, effectiveMachines: k },
      remGroup,
    ]);
  }

  // Two underclock groups when a single remainder cannot hit exactly and
  // full-speed banks are not enough — only try small machine counts.
  const smallCounts = counts.filter((n) => n <= Math.min(8, maxMachines));
  for (const m1 of smallCounts) {
    for (const c1 of ALLOWED_CLOCKS) {
      if (c1 >= 1 - EPS) continue; // full-speed covered above
      const e1 = m1 * c1;
      if (e1 + EPS > effective) continue;
      const rem = effective - e1;
      const g2 = findRemainderGroup(rem, counts);
      if (!g2) continue;
      consider([
        { machines: m1, clock: c1, effectiveMachines: e1 },
        g2,
      ]);
    }
  }

  return best;
}

export function totalEffectiveMachines(groups: MachineConfig[]): number {
  return totalEffective(groups);
}

/** Smallest valid output rate ≥ desired for an item's default recipe. */
export function quantizeItemRate(
  itemId: ItemId,
  desiredRate: number,
  opts: { anyMachineCount?: boolean } = {},
): number {
  if (desiredRate <= EPS) return 0;
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return desiredRate;
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return desiredRate;
  const exactMachines = desiredRate / base;
  // Friendly multi-groups (no belt). Belt-aware packing lives in pack-banks /
  // expandFactoryPlan; allocate uses packBanksForItemRate when needed.
  const groups = representMachinesMulti(exactMachines, opts);
  return totalEffective(groups) * base;
}

/**
 * Largest valid output rate ≤ desired (floor to an allowed multi-group config).
 * Used when growing into a leftover budget so we never overshoot.
 */
export function floorQuantizeItemRate(
  itemId: ItemId,
  desiredRate: number,
  opts: { anyMachineCount?: boolean } = {},
): number {
  if (desiredRate <= EPS) return 0;
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return desiredRate;
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return desiredRate;

  const exact = desiredRate / base;
  let best = 0;

  const maxMachines = Math.max(
    1,
    Math.ceil(exact / CLOCK_QUANTUM + EPS),
  );
  const counts = machineCountOptions(maxMachines, !!opts.anyMachineCount);

  // Single-group floors
  for (const machines of counts) {
    for (const clock of ALLOWED_CLOCKS) {
      const achieved = machines * clock;
      if (achieved <= exact + EPS && achieved > best + EPS) {
        best = achieved;
      }
    }
  }

  // Multi-group floors: k @ 100% + remainder group
  const fullMax = Math.floor(exact + EPS);
  for (let k = fullMax; k >= 0; k--) {
    if (k > 0 && !opts.anyMachineCount && !counts.includes(k)) continue;
    const rem = exact - k;
    if (rem <= EPS) {
      if (k > best + EPS) best = k;
      continue;
    }
    for (const machines of counts) {
      for (const clock of ALLOWED_CLOCKS) {
        const achieved = k + machines * clock;
        if (achieved <= exact + EPS && achieved > best + EPS) {
          best = achieved;
        }
      }
    }
  }

  return best * base;
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

function isPowerOf2And3(n: number): boolean {
  if (n <= 0 || !Number.isInteger(n)) return false;
  let v = n;
  while (v % 2 === 0) v /= 2;
  while (v % 3 === 0) v /= 3;
  return v === 1;
}

/**
 * Nested 1/2 and 1/3 steps that factor `n` for an equal N-way manifold.
 * Empty when n ≤ 1 or n is not splitter-friendly.
 */
export function splitStepsForCount(n: number): SplitterStep[] {
  if (n <= 1 || !isSplitterFriendlyCount(n)) return [];
  const steps: SplitterStep[] = [];
  let rem = Math.round(n);
  while (rem > 1) {
    if (rem % 2 === 0) {
      steps.push("1/2");
      rem /= 2;
    } else if (rem % 3 === 0) {
      steps.push("1/3");
      rem /= 3;
    } else {
      return [];
    }
  }
  return steps;
}

export function mergerStepsForCount(n: number): MergerStep[] {
  return splitStepsForCount(n).map((s) => (s === "1/2" ? "2→1" : "3→1"));
}

/**
 * Nested splitter path that yields a single lane of 1/den (then take `num`
 * lanes for num/den). Empty when the denominator is not 2^a·3^b.
 */
export function splitStepsForRatio(num: number, den: number): SplitterStep[] {
  if (den <= 0 || num <= 0) return [];
  const g = gcd(num, den);
  const d = Math.round(den / g);
  const n = Math.round(num / g);
  if (n >= d) return [];
  if (!isPowerOf2And3(d)) return [];
  return splitStepsForCount(d);
}

/**
 * Best reduced 2^a·3^b fraction matching part/whole, or null if none.
 */
export function friendlyRatio(
  part: number,
  whole: number,
): { num: number; den: number } | null {
  if (whole <= EPS) return part <= EPS ? { num: 0, den: 1 } : null;
  if (part <= EPS) return { num: 0, den: 1 };
  if (Math.abs(part - whole) <= EPS) return { num: 1, den: 1 };
  if (part > whole + EPS) return null;

  const ratio = part / whole;
  for (const den of SPLITTER_FRIENDLY_COUNTS) {
    const num = Math.round(ratio * den);
    if (num < 0 || num > den) continue;
    if (Math.abs(ratio - num / den) <= 1e-9) {
      const g = gcd(num, den);
      return { num: num / g, den: den / g };
    }
  }
  return null;
}

/**
 * Next discrete step for an item: one shared clock quantum of a single machine.
 */
export function itemRateStep(itemId: ItemId): number {
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return 1;
  return recipePrimaryOutputPerMinute(recipe) * CLOCK_QUANTUM;
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
 * Smallest parent belt rate P ≥ sum(demands) such that every demand is a
 * splitter-friendly fraction of P. Extra P − sum is overflow/excess capacity.
 */
export function minParentForFriendlyShares(demands: number[]): number {
  const parts = demands.filter((d) => d > EPS);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (parts.length === 0) return 0;
  if (parts.length === 1) return sum;
  if (parts.every((d) => isSplitterFriendlyRatio(d, sum))) return sum;

  let best = Number.POSITIVE_INFINITY;
  for (const den of SPLITTER_FRIENDLY_COUNTS) {
    for (const di of parts) {
      for (let num = 1; num <= den; num++) {
        const parent = (di * den) / num;
        if (parent + EPS < sum) continue;
        if (parts.every((dj) => isSplitterFriendlyRatio(dj, parent))) {
          if (parent < best) best = parent;
        }
      }
    }
  }
  return Number.isFinite(best) ? best : sum;
}

/**
 * Next legal excess branch strictly above `current`, up to `desiredMax`.
 * Prefers practical manifolds (reduced den ≤ 4: 1/2, 1/3, 1/4, 2/3, 3/4)
 * so soak steps are useful — e.g. 1/4 before 1/12.
 */
export function nextExcessAbove(
  current: number,
  desiredMax: number,
  downstreamDemand: number,
): number {
  if (desiredMax <= current + EPS) return current;
  const downstream = Math.max(0, downstreamDemand);

  if (downstream <= EPS) {
    return desiredMax;
  }

  const findBest = (maxDen: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const den of SPLITTER_FRIENDLY_COUNTS) {
      if (den > maxDen) continue;
      for (let num = 1; num < den; num++) {
        const excess = (num * downstream) / (den - num);
        if (
          excess > current + EPS &&
          excess <= desiredMax + EPS &&
          excess < best
        ) {
          best = excess;
        }
      }
    }
    return best;
  };

  // Practical first (den ≤ 4), then fall back to any splitter-friendly den.
  let best = findBest(4);
  if (!Number.isFinite(best)) best = findBest(Number.POSITIVE_INFINITY);
  return Number.isFinite(best) ? best : current;
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

export function formatClock(clock: AllowedClock | number): string {
  // Exact thirds display as repeating decimals players type in-game
  if (Math.abs(clock - 2 / 3) < 1e-9) return "66.67%";
  if (Math.abs(clock - 1 / 3) < 1e-9) return "33.33%";
  return `${Math.round(clock * 100)}%`;
}
