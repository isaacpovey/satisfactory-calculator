import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import {
  getRecipeForProduct,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
} from "@/data/recipes";
import type { ItemId, Recipe } from "@/data/types";
import {
  ALLOWED_CLOCKS,
  ceilEffectiveMachines,
  isSplitterFriendlyCount,
  representMachinesMulti,
  SPLITTER_FRIENDLY_COUNTS,
  totalEffectiveMachines,
  type AllowedClock,
  type MachineConfig,
} from "./constraints";

const EPS = 1e-9;

export interface PackBanksOptions {
  maxBeltCapacity?: number;
}

/**
 * Max items/min this recipe moves on any single belt for one machine @ clock.
 * Caps banks so both primary output and every solid input fit the belt.
 */
export function recipeBeltLoadPerMachine(recipe: Recipe, clock: number): number {
  const cycles = recipeCyclesPerMinute(recipe) * clock;
  let max = 0;
  for (const output of recipe.outputs) {
    max = Math.max(max, output.amount * cycles);
  }
  for (const input of recipe.inputs) {
    max = Math.max(max, input.amount * cycles);
  }
  return max;
}

function bankFitsBelt(recipe: Recipe, machines: number, clock: number, maxBelt: number): boolean {
  return recipeBeltLoadPerMachine(recipe, clock) * machines <= maxBelt + EPS;
}

function maxMachinesOnBelt(recipe: Recipe, clock: number, maxBelt: number): number {
  const per = recipeBeltLoadPerMachine(recipe, clock);
  if (per <= EPS) return Number.POSITIVE_INFINITY;
  return Math.floor(maxBelt / per + EPS);
}

/** Machines in equal-split friendly banks running at 100% (clean input manifolds). */
function fullSpeedFriendlyMachines(groups: MachineConfig[]): number {
  return groups.reduce(
    (s, g) =>
      s +
      (g.clock >= 1 - EPS && g.machines > 1 && isSplitterFriendlyCount(g.machines)
        ? g.machines
        : 0),
    0,
  );
}

/** Multi-machine banks that are underclocked (awkward equal-split at partial clock). */
function underclockMultiBanks(groups: MachineConfig[]): number {
  return groups.filter((g) => g.machines > 1 && g.clock < 1 - EPS).length;
}

/**
 * Prefer packs that are easy to feed from upstream:
 * less overshoot → more full-speed equal-split machines → fewer underclocked
 * multi-machine banks → fewer banks → fewer physical machines → higher clock.
 */
function isBetterPack(
  candidate: MachineConfig[],
  best: MachineConfig[],
  effective: number,
): boolean {
  const cEff = totalEffectiveMachines(candidate);
  const bEff = totalEffectiveMachines(best);
  const cOver = cEff - effective;
  const bOver = bEff - effective;
  if (cOver < bOver - EPS) return true;
  if (cOver > bOver + EPS) return false;

  const cFull = fullSpeedFriendlyMachines(candidate);
  const bFull = fullSpeedFriendlyMachines(best);
  if (cFull > bFull + EPS) return true;
  if (cFull < bFull - EPS) return false;

  const cUnderMulti = underclockMultiBanks(candidate);
  const bUnderMulti = underclockMultiBanks(best);
  if (cUnderMulti < bUnderMulti) return true;
  if (cUnderMulti > bUnderMulti) return false;

  const cBanks = candidate.length;
  const bBanks = best.length;
  if (cBanks < bBanks) return true;
  if (cBanks > bBanks) return false;

  const cMach = candidate.reduce((s, g) => s + g.machines, 0);
  const bMach = best.reduce((s, g) => s + g.machines, 0);
  if (cMach < bMach) return true;
  if (cMach > bMach) return false;

  const cClock = cMach > 0 ? candidate.reduce((s, g) => s + g.clock * g.machines, 0) / cMach : 0;
  const bClock = bMach > 0 ? best.reduce((s, g) => s + g.clock * g.machines, 0) / bMach : 0;
  return cClock > bClock + EPS;
}

function sortBanks(groups: MachineConfig[]): MachineConfig[] {
  return [...groups].sort(
    (a, b) =>
      b.clock - a.clock || b.machines - a.machines || b.effectiveMachines - a.effectiveMachines,
  );
}

/**
 * Pack required effective machines into belt-capped, splitter-friendly banks.
 * Stage totals may be unfriendly; each bank is 2^a·3^b (or 1) and fits the belt.
 */
export function packMachineBanks(
  recipe: Recipe,
  effectiveMachines: number,
  opts: PackBanksOptions = {},
): MachineConfig[] {
  const maxBelt = opts.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY;
  const effective = ceilEffectiveMachines(effectiveMachines);
  if (effective <= EPS) return [];

  // Baseline without belt: friendly multi groups, then split any that exceed belt.
  const baseline = representMachinesMulti(effective, { anyMachineCount: false });
  const splitBaseline = splitGroupsToBelt(recipe, baseline, maxBelt);
  if (
    totalEffectiveMachines(splitBaseline) + EPS >= effective &&
    splitBaseline.every((g) => bankFitsBelt(recipe, g.machines, g.clock, maxBelt))
  ) {
    // Still search for a better belt-aware pack; keep as initial best.
  }

  let best: MachineConfig[] = splitBaseline.length > 0 ? splitBaseline : [];

  const consider = (groups: MachineConfig[]) => {
    const filtered = sortBanks(
      groups.filter(
        (g) =>
          g.machines > 0 &&
          bankFitsBelt(recipe, g.machines, g.clock, maxBelt) &&
          (g.machines === 1 || isSplitterFriendlyCount(g.machines)),
      ),
    );
    if (filtered.length === 0) return;
    if (totalEffectiveMachines(filtered) + EPS < effective) return;
    if (best.length === 0 || isBetterPack(filtered, best, effective)) {
      best = filtered;
    }
  };

  // Greedy fill: largest friendly banks @ 100% that fit the belt, then remainder.
  const greedy = greedyPack(recipe, effective, maxBelt);
  consider(greedy);

  // Enumerate: k full-speed friendly banks + remainder (prefer singletons).
  const fullSpeedMax = maxMachinesOnBelt(recipe, 1, maxBelt);
  const friendlyFull = SPLITTER_FRIENDLY_COUNTS.filter(
    (n) => n <= fullSpeedMax && n <= Math.ceil(effective + EPS) + 8,
  );

  for (const bankSize of [...friendlyFull].reverse()) {
    const maxBanks = Math.ceil(effective / bankSize + EPS) + 2;
    for (let n = 0; n <= maxBanks; n++) {
      const used = n * bankSize;
      if (used > effective + 8) break;
      const rem = effective - used;
      const fullGroups: MachineConfig[] = Array.from({ length: n }, () => ({
        machines: bankSize,
        clock: 1 as AllowedClock,
        effectiveMachines: bankSize,
      }));
      if (rem <= EPS) {
        consider(fullGroups);
        continue;
      }
      const remGroups = findBeltRemainderGroups(recipe, rem, maxBelt);
      if (remGroups.length === 0) continue;
      consider([...fullGroups, ...remGroups]);
    }
  }

  // Also: mix of largest friendly full-speed banks covering floor(effective),
  // with singleton remainder — e.g. 9@100% + 1@100% + 1@50% for 10.5.
  {
    const floorEff = Math.floor(effective + EPS);
    const remFrac = effective - floorEff;
    const fullPack = greedyFullSpeedOnly(recipe, floorEff, maxBelt);
    if (totalEffectiveMachines(fullPack) + EPS >= floorEff && remFrac > EPS) {
      const remGroups = findBeltRemainderGroups(recipe, remFrac, maxBelt);
      if (remGroups.length > 0) consider([...fullPack, ...remGroups]);
    } else if (remFrac <= EPS && fullPack.length > 0) {
      consider(fullPack);
    }
  }

  // Single-bank search across friendly counts and clocks
  for (const machines of SPLITTER_FRIENDLY_COUNTS) {
    for (const clock of ALLOWED_CLOCKS) {
      if (!bankFitsBelt(recipe, machines, clock, maxBelt)) continue;
      const achieved = machines * clock;
      if (achieved + EPS < effective) continue;
      consider([{ machines, clock, effectiveMachines: achieved }]);
    }
  }

  if (best.length === 0) {
    // Last resort: one machine per bank at lowest clock that covers demand.
    return fallbackOnePerBelt(recipe, effective, maxBelt);
  }
  return sortBanks(best);
}

/**
 * Cover a remainder with as many direct-feed singletons as needed, falling
 * back to one multi-machine bank only when singletons cannot cover cleanly.
 */
function findBeltRemainderGroups(
  recipe: Recipe,
  remainder: number,
  maxBelt: number,
): MachineConfig[] {
  if (remainder <= EPS) return [];

  // Greedy singletons: full-speed ones first, then one underclock for the frac
  const groups: MachineConfig[] = [];
  let left = remainder;
  while (left > 1 + EPS) {
    if (!bankFitsBelt(recipe, 1, 1, maxBelt)) break;
    groups.push({ machines: 1, clock: 1, effectiveMachines: 1 });
    left -= 1;
  }
  if (left > EPS) {
    let bestClock: AllowedClock | null = null;
    for (const clock of ALLOWED_CLOCKS) {
      if (!bankFitsBelt(recipe, 1, clock, maxBelt)) continue;
      if (clock + EPS < left) continue;
      if (bestClock == null || clock < bestClock - EPS) bestClock = clock;
    }
    if (bestClock != null) {
      groups.push({
        machines: 1,
        clock: bestClock,
        effectiveMachines: bestClock,
      });
      return groups;
    }
  } else if (groups.length > 0) {
    return groups;
  }

  // Fallback: one multi-machine bank
  let best: MachineConfig | null = null;
  for (const machines of SPLITTER_FRIENDLY_COUNTS) {
    if (machines <= 1) continue;
    for (const clock of ALLOWED_CLOCKS) {
      if (!bankFitsBelt(recipe, machines, clock, maxBelt)) continue;
      const achieved = machines * clock;
      if (achieved + EPS < remainder) continue;
      if (achieved > remainder + 1 + EPS) continue;
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
  }
  return best ? [best] : [];
}

/** Pack only full-speed friendly (+ singleton @100%) banks covering `effective`. */
function greedyFullSpeedOnly(recipe: Recipe, effective: number, maxBelt: number): MachineConfig[] {
  const groups: MachineConfig[] = [];
  let remaining = effective;
  const fullMax = maxMachinesOnBelt(recipe, 1, maxBelt);
  const sizes = [...SPLITTER_FRIENDLY_COUNTS]
    .filter((n) => n <= fullMax && n > 1)
    .sort((a, b) => b - a);

  while (remaining > EPS) {
    let placed = false;
    for (const size of sizes) {
      if (size <= remaining + EPS && bankFitsBelt(recipe, size, 1, maxBelt)) {
        groups.push({
          machines: size,
          clock: 1,
          effectiveMachines: size,
        });
        remaining -= size;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (remaining >= 1 - EPS && bankFitsBelt(recipe, 1, 1, maxBelt)) {
      groups.push({ machines: 1, clock: 1, effectiveMachines: 1 });
      remaining -= 1;
      continue;
    }
    break;
  }
  return groups;
}

function greedyPack(recipe: Recipe, effective: number, maxBelt: number): MachineConfig[] {
  const groups: MachineConfig[] = [];
  let remaining = effective;
  const fullMax = maxMachinesOnBelt(recipe, 1, maxBelt);
  const sizes = [...SPLITTER_FRIENDLY_COUNTS].filter((n) => n <= fullMax).sort((a, b) => b - a);

  while (remaining > EPS) {
    let placed = false;
    for (const size of sizes) {
      if (size <= remaining + EPS && bankFitsBelt(recipe, size, 1, maxBelt)) {
        groups.push({
          machines: size,
          clock: 1,
          effectiveMachines: size,
        });
        remaining -= size;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    const rem = findBeltRemainderGroups(recipe, remaining, maxBelt);
    if (rem.length > 0) {
      groups.push(...rem);
      remaining = 0;
      break;
    }
    // Cannot place — break and let caller fall back
    break;
  }
  return groups;
}

function splitGroupsToBelt(
  recipe: Recipe,
  groups: MachineConfig[],
  maxBelt: number,
): MachineConfig[] {
  const out: MachineConfig[] = [];
  for (const g of groups) {
    if (bankFitsBelt(recipe, g.machines, g.clock, maxBelt)) {
      out.push(g);
      continue;
    }
    const maxM = maxMachinesOnBelt(recipe, g.clock, maxBelt);
    if (maxM < 1) {
      // Clock too high for even one machine — drop clock
      for (const clock of [...ALLOWED_CLOCKS].sort((a, b) => a - b)) {
        if (bankFitsBelt(recipe, 1, clock, maxBelt)) {
          let left = g.effectiveMachines;
          while (left > EPS) {
            const use = Math.min(1, left);
            // Find clock covering `use` on one machine
            let c: AllowedClock = 0.25;
            for (const cand of ALLOWED_CLOCKS) {
              if (cand + EPS >= use) {
                c = cand;
                break;
              }
            }
            out.push({ machines: 1, clock: c, effectiveMachines: c });
            left -= c;
          }
          break;
        }
      }
      continue;
    }
    const friendlyMax = [...SPLITTER_FRIENDLY_COUNTS]
      .filter((n) => n <= maxM)
      .sort((a, b) => b - a);
    let leftMachines = g.machines;
    while (leftMachines > 0) {
      const size =
        friendlyMax.find((n) => n <= leftMachines) ??
        (leftMachines === 1 ? 1 : (friendlyMax[friendlyMax.length - 1] ?? 1));
      const take = Math.min(size, leftMachines);
      if (!isSplitterFriendlyCount(take) && take !== 1) {
        // Peel ones
        out.push({
          machines: 1,
          clock: g.clock,
          effectiveMachines: g.clock,
        });
        leftMachines -= 1;
        continue;
      }
      out.push({
        machines: take,
        clock: g.clock,
        effectiveMachines: take * g.clock,
      });
      leftMachines -= take;
    }
  }
  return out;
}

function fallbackOnePerBelt(recipe: Recipe, effective: number, maxBelt: number): MachineConfig[] {
  const groups: MachineConfig[] = [];
  let left = effective;
  while (left > EPS) {
    let placed = false;
    for (const clock of ALLOWED_CLOCKS) {
      if (!bankFitsBelt(recipe, 1, clock, maxBelt)) continue;
      if (clock + EPS < left && clock < 1 - EPS) continue;
      const use = Math.min(clock, Math.ceil(left / CLOCK_STEP) * CLOCK_STEP);
      const c = ALLOWED_CLOCKS.find((x) => x + EPS >= Math.min(left, use)) ?? 0.25;
      if (!bankFitsBelt(recipe, 1, c, maxBelt)) continue;
      groups.push({ machines: 1, clock: c, effectiveMachines: c });
      left -= c;
      placed = true;
      break;
    }
    if (!placed) {
      groups.push({ machines: 1, clock: 0.25, effectiveMachines: 0.25 });
      left -= 0.25;
    }
  }
  return sortBanks(groups);
}

const CLOCK_STEP = 1 / 12;

/** Pack banks for an item's default recipe given a desired output rate. */
export function packBanksForItemRate(
  itemId: ItemId,
  desiredRate: number,
  opts: PackBanksOptions = {},
): MachineConfig[] {
  if (desiredRate <= EPS) return [];
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return [];
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return [];
  return packMachineBanks(recipe, desiredRate / base, opts);
}

/** Smallest belt-packed output rate ≥ desired for an item's default recipe. */
export function quantizeItemRateBeltAware(
  itemId: ItemId,
  desiredRate: number,
  opts: PackBanksOptions = {},
): number {
  if (desiredRate <= EPS) return 0;
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return desiredRate;
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return desiredRate;
  const groups = packMachineBanks(recipe, desiredRate / base, opts);
  return totalEffectiveMachines(groups) * base;
}

export function totalEffectiveFromBanks(groups: MachineConfig[]): number {
  return totalEffectiveMachines(groups);
}
