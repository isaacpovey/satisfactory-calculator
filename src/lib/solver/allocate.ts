import { buildings, itemById, manufacturedItemIds, scarceRawIds } from "@/data/items";
import {
  getRecipeForProduct,
  recipes as allRecipes,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";
import {
  addRate,
  exactRawCoefficients,
  expandFactoryPlan,
  type RateMap,
} from "./bom";
import {
  ALLOWED_CLOCKS,
  complexityScore,
  quantizeItemRate,
  representMachinesMulti,
} from "./constraints";
import { buildFactoryNetwork } from "./network";
import type {
  ExcessResult,
  ItemFlow,
  PlannerInput,
  RawUtilization,
  RecipeUsage,
  SolveResult,
  TargetResult,
} from "./types";

const EPS = 1e-9;

const buildingName = Object.fromEntries(
  buildings.map((b) => [b.id, b.name]),
) as Record<string, string>;

function emptyRawMap(): RateMap {
  const map: RateMap = new Map();
  for (const id of scarceRawIds) map.set(id, 0);
  return map;
}

function expandSinks(
  sinks: { item: ItemId; rate: number }[],
): { recipeCrafts: Map<string, number>; raws: RateMap } {
  // Merge identical sink items, then expand as one factory so shared
  // intermediates are machine-quantized once (not once per sink).
  const merged = new Map<ItemId, number>();
  for (const sink of sinks) {
    if (sink.rate <= EPS) continue;
    merged.set(sink.item, (merged.get(sink.item) ?? 0) + sink.rate);
  }
  return expandFactoryPlan(
    [...merged.entries()].map(([item, rate]) => ({ item, rate })),
  );
}

function planFitsAvailable(
  sinks: { item: ItemId; rate: number }[],
  available: RateMap,
): boolean {
  const { raws } = expandSinks(sinks);
  for (const id of scarceRawIds) {
    if ((raws.get(id) ?? 0) > (available.get(id) ?? 0) + EPS) return false;
  }
  return true;
}

function leftoverFromPlan(
  sinks: { item: ItemId; rate: number }[],
  available: RateMap,
): RateMap {
  const { raws } = expandSinks(sinks);
  const leftover = emptyRawMap();
  for (const id of scarceRawIds) {
    leftover.set(
      id,
      Math.max(0, (available.get(id) ?? 0) - (raws.get(id) ?? 0)),
    );
  }
  return leftover;
}

function collectChainIntermediates(roots: ItemId[]): ItemId[] {
  const seen = new Set<ItemId>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const item = itemById[id];
    if (!item || item.isRaw) continue;
    const recipe = getRecipeForProduct(id);
    if (!recipe) continue;
    for (const input of recipe.inputs) {
      if (!itemById[input.item]?.isRaw) stack.push(input.item);
    }
  }
  const rootSet = new Set(roots);
  return [...seen].filter((id) => !itemById[id]?.isRaw && !rootSet.has(id));
}

function collectGrowthRates(
  itemId: ItemId,
  current: number,
  leftover: RateMap,
): number[] {
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return [];
  const base = recipePrimaryOutputPerMinute(recipe);
  if (base <= EPS) return [];

  const coeffs = exactRawCoefficients(itemId);
  let maxAdditional = Number.POSITIVE_INFINITY;
  for (const id of scarceRawIds) {
    const c = coeffs[id] ?? 0;
    if (c <= EPS) continue;
    maxAdditional = Math.min(maxAdditional, (leftover.get(id) ?? 0) / c);
  }
  if (!Number.isFinite(maxAdditional) || maxAdditional < 0) maxAdditional = 0;

  // Continuous leftover plus one full machine of headroom for quantization.
  const tryMax = current + maxAdditional + base;
  const minClock = Math.min(...ALLOWED_CLOCKS);
  const maxMachines = Math.max(
    1,
    Math.min(48, Math.ceil(tryMax / (base * minClock) + EPS)),
  );

  const rates = new Set<number>();
  // Multi-group achievable rates: enumerate effective machines via groups
  const maxEffective = tryMax / base;
  for (let machines = 1; machines <= maxMachines; machines++) {
    for (const clock of ALLOWED_CLOCKS) {
      const rate = machines * clock * base;
      if (rate > current + EPS && rate <= tryMax + EPS) rates.add(rate);
    }
  }
  // Also include multi-group combinations (k @ 100% + remainder)
  const fullMax = Math.min(maxMachines, Math.ceil(maxEffective + EPS));
  for (let k = 0; k <= fullMax; k++) {
    for (const clock of ALLOWED_CLOCKS) {
      for (let remMachines = 0; remMachines <= 8; remMachines++) {
        if (k === 0 && remMachines === 0) continue;
        const effective = k + remMachines * clock;
        const rate = effective * base;
        if (rate > current + EPS && rate <= tryMax + EPS) rates.add(rate);
      }
    }
  }
  return [...rates].sort((a, b) => a - b);
}

/** Largest rate in `rates` (ascending) that keeps the plan within `available`. */
function largestFittingRate(
  rates: number[],
  setRate: (rate: number) => void,
  restore: () => void,
  available: RateMap,
  buildSinks: () => { item: ItemId; rate: number }[],
): number | null {
  let lo = 0;
  let hi = rates.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rate = rates[mid]!;
    setRate(rate);
    if (planFitsAvailable(buildSinks(), available)) {
      best = rate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  restore();
  return best;
}

function buildItemFlows(
  recipeCrafts: Map<string, number>,
  endRates: Map<ItemId, number>,
): ItemFlow[] {
  const produced: RateMap = new Map();
  const consumed: RateMap = new Map();

  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      addRate(consumed, input.item, input.amount * crafts);
    }
    for (const output of recipe.outputs) {
      addRate(produced, output.item, output.amount * crafts);
    }
  }

  for (const rawId of scarceRawIds) {
    const used = consumed.get(rawId) ?? 0;
    if (used > EPS) addRate(produced, rawId, used);
  }

  const itemIds = new Set<ItemId>([
    ...produced.keys(),
    ...consumed.keys(),
    ...endRates.keys(),
    ...scarceRawIds,
  ]);

  const flows: ItemFlow[] = [];
  for (const item of itemIds) {
    const p = produced.get(item) ?? 0;
    const c = consumed.get(item) ?? 0;
    if (p <= EPS && c <= EPS && !endRates.has(item)) continue;
    flows.push({ item, produced: p, consumed: c, net: p - c });
  }

  flows.sort((a, b) =>
    (itemById[a.item]?.name ?? a.item).localeCompare(
      itemById[b.item]?.name ?? b.item,
    ),
  );
  return flows;
}

function buildRecipeUsages(recipeCrafts: Map<string, number>): RecipeUsage[] {
  const usages: RecipeUsage[] = [];
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    const exactMachines = crafts / recipeCyclesPerMinute(recipe);
    const groups = representMachinesMulti(exactMachines, {
      anyMachineCount: true,
    });
    const primary = recipe.outputs[0]!;
    const cyclesPerMachine = recipeCyclesPerMinute(recipe);
    groups.forEach((config, groupIndex) => {
      const groupCrafts = config.effectiveMachines * cyclesPerMachine;
      usages.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        building: buildingName[recipe.building] ?? recipe.building,
        machines: config.machines,
        clock: config.clock,
        effectiveMachines: config.effectiveMachines,
        cyclesPerMinute: groupCrafts,
        outputPerMinute: primary.amount * groupCrafts,
        primaryOutput: primary.item,
        groupIndex,
      });
    });
  }
  usages.sort(
    (a, b) =>
      a.recipeName.localeCompare(b.recipeName) || a.groupIndex - b.groupIndex,
  );
  return usages;
}

function overallUtil(raws: RawUtilization[]): number {
  let totalAvailable = 0;
  let totalUsed = 0;
  for (const r of raws) {
    totalAvailable += r.available;
    totalUsed += Math.min(r.used, r.available);
  }
  return totalAvailable > EPS ? totalUsed / totalAvailable : 0;
}

/**
 * Min-targets-then-balance with machine/clock quantization, splitter-friendly
 * leftover shares, and complexity-first auto excess toward 100% utilization.
 */
export function solve(input: PlannerInput): SolveResult {
  const targets = input.targets.filter(
    (t) => t.minRate > EPS || t.weight > EPS,
  );

  const userExcess = new Map<ItemId, number>();
  for (const e of input.excess) {
    if (e.rate > EPS) {
      userExcess.set(e.item, Math.max(userExcess.get(e.item) ?? 0, e.rate));
    }
  }

  const available: RateMap = emptyRawMap();
  for (const id of scarceRawIds) {
    available.set(id, Math.max(0, input.rawAvailable[id] ?? 0));
  }

  // Phase A — quantized minima + user excess floors
  const plannedMins = new Map<ItemId, number>();
  for (const t of targets) {
    const q = quantizeItemRate(t.item, Math.max(0, t.minRate));
    if (q > EPS) plannedMins.set(t.item, q);
  }

  const phaseAMerged = new Map<ItemId, number>();
  for (const [item, rate] of plannedMins) {
    phaseAMerged.set(item, (phaseAMerged.get(item) ?? 0) + rate);
  }
  for (const [item, rate] of userExcess) {
    const q = quantizeItemRate(item, rate);
    phaseAMerged.set(item, (phaseAMerged.get(item) ?? 0) + q);
  }
  for (const [item, rate] of phaseAMerged) {
    phaseAMerged.set(item, quantizeItemRate(item, rate));
  }

  const phaseA = expandSinks(
    [...phaseAMerged.entries()].map(([item, rate]) => ({ item, rate })),
  );

  const phaseARaws: RawUtilization[] = scarceRawIds.map((item) => {
    const avail = available.get(item) ?? 0;
    const usedForMin = phaseA.raws.get(item) ?? 0;
    return {
      item,
      available: avail,
      used: usedForMin,
      leftover: Math.max(0, avail - usedForMin),
      utilization: avail > EPS ? Math.min(1, usedForMin / avail) : 0,
      shortfall: Math.max(0, usedForMin - avail),
    };
  });

  const feasible = phaseARaws.every((r) => r.shortfall <= EPS);

  const targetExtra = new Map<ItemId, number>();
  const excessRates = new Map<ItemId, number>();
  for (const [item, rate] of userExcess) {
    excessRates.set(item, quantizeItemRate(item, rate));
  }

  const buildSinks = (): { item: ItemId; rate: number }[] => {
    const sinks: { item: ItemId; rate: number }[] = [];
    for (const [item, rate] of plannedMins) {
      sinks.push({ item, rate: rate + (targetExtra.get(item) ?? 0) });
    }
    for (const [item, rate] of excessRates) {
      if (rate > EPS) sinks.push({ item, rate });
    }
    return sinks;
  };

  // Phase B — leftover to targets independently by weight priority.
  // Each product only competes for the raws it actually uses, so limestone
  // can still feed Concrete when coal is already at 100%.
  // Growth is validated against the full expanded plan (not continuous coeffs),
  // because per-stage machine quantization makes delta costs underestimate.
  if (feasible) {
    const weighted = targets
      .filter((t) => t.weight > EPS)
      .sort((a, b) => b.weight - a.weight || a.item.localeCompare(b.item));

    if (weighted.length > 0) {
      let guard = 0;
      while (guard++ < 200) {
        let progressed = false;
        for (const t of weighted) {
          const current = targetExtra.get(t.item) ?? 0;
          const leftover = leftoverFromPlan(buildSinks(), available);
          const coeffs = exactRawCoefficients(t.item);
          const canUseLeftover = (Object.keys(coeffs) as ItemId[]).some(
            (r) => (leftover.get(r) ?? 0) > EPS && (coeffs[r] ?? 0) > EPS,
          );
          if (!canUseLeftover) continue;

          const rates = collectGrowthRates(t.item, current, leftover);
          if (rates.length === 0) continue;

          const best = largestFittingRate(
            rates,
            (rate) => targetExtra.set(t.item, rate),
            () => targetExtra.set(t.item, current),
            available,
            buildSinks,
          );
          if (best !== null && best > current + EPS) {
            targetExtra.set(t.item, best);
            progressed = true;
          }
        }
        if (!progressed) break;
      }
    }
  }

  // Phase C — complexity-first auto excess to soak leftover raws.
  const chainRoots = [
    ...targets.map((t) => t.item),
    ...userExcess.keys(),
  ];
  const intermediates = collectChainIntermediates(chainRoots);

  const soakCandidates = new Set<ItemId>(intermediates);
  for (const id of manufacturedItemIds) {
    if (targets.some((t) => t.item === id)) continue;
    const coeffs = exactRawCoefficients(id);
    const uses = Object.keys(coeffs) as ItemId[];
    if (uses.length === 0) continue;
    soakCandidates.add(id);
  }

  const fillOrder = [...soakCandidates].sort(
    (a, b) => complexityScore(b) - complexityScore(a),
  );

  if (feasible) {
    let guard = 0;
    while (guard++ < 400) {
      let progressed = false;
      const leftover = leftoverFromPlan(buildSinks(), available);
      const hasLeftover = [...leftover.values()].some((v) => v > EPS);
      if (!hasLeftover) break;

      for (const item of fillOrder) {
        const coeffs = exactRawCoefficients(item);
        const canUseLeftover = (Object.keys(coeffs) as ItemId[]).some(
          (r) => (leftover.get(r) ?? 0) > EPS && (coeffs[r] ?? 0) > EPS,
        );
        if (!canUseLeftover) continue;

        const current = excessRates.get(item) ?? 0;
        const rates = collectGrowthRates(item, current, leftover);
        if (rates.length === 0) continue;

        const best = largestFittingRate(
          rates,
          (rate) => excessRates.set(item, rate),
          () => excessRates.set(item, current),
          available,
          buildSinks,
        );
        if (best !== null && best > current + EPS) {
          excessRates.set(item, best);
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }
  }

  // Final sinks
  const finalSinkMap = new Map<ItemId, number>();
  for (const [item, rate] of plannedMins) {
    finalSinkMap.set(item, (finalSinkMap.get(item) ?? 0) + rate);
  }
  for (const [item, rate] of targetExtra) {
    finalSinkMap.set(item, (finalSinkMap.get(item) ?? 0) + rate);
  }
  for (const [item, rate] of excessRates) {
    finalSinkMap.set(item, (finalSinkMap.get(item) ?? 0) + rate);
  }
  // Rates are already machine-quantized per sink; do not re-ceil the sum
  // (that was overshooting scarce raw budgets).

  const final = expandSinks(
    [...finalSinkMap.entries()].map(([item, rate]) => ({ item, rate })),
  );

  const finalRaws: RawUtilization[] = scarceRawIds.map((item) => {
    const avail = available.get(item) ?? 0;
    const used = final.raws.get(item) ?? 0;
    return {
      item,
      available: avail,
      used,
      leftover: Math.max(0, avail - used),
      utilization: avail > EPS ? Math.min(1, used / avail) : 0,
      shortfall: Math.max(0, (phaseA.raws.get(item) ?? 0) - avail),
    };
  });

  const targetResults: TargetResult[] = targets.map((t) => {
    const plannedMin = plannedMins.get(t.item) ?? 0;
    const extra = targetExtra.get(t.item) ?? 0;
    return {
      item: t.item,
      minRate: Math.max(0, t.minRate),
      plannedMinRate: plannedMin,
      extraRate: extra,
      totalRate: plannedMin + extra,
      weight: t.weight,
    };
  });

  const excessItemSet = new Set<ItemId>([
    ...intermediates,
    ...userExcess.keys(),
    ...[...excessRates.keys()].filter((id) => (excessRates.get(id) ?? 0) > EPS),
  ]);

  const excessResults: ExcessResult[] = [...excessItemSet]
    .map((item) => {
      const requested = userExcess.get(item) ?? 0;
      const requestedQ = requested > EPS ? quantizeItemRate(item, requested) : 0;
      const rate = excessRates.get(item) ?? 0;
      return {
        item,
        requestedRate: requested,
        rate,
        autoRate: Math.max(0, rate - requestedQ),
      };
    })
    .sort(
      (a, b) =>
        complexityScore(b.item) - complexityScore(a.item) ||
        (itemById[a.item]?.name ?? "").localeCompare(
          itemById[b.item]?.name ?? "",
        ),
    );

  const endRates = new Map<ItemId, number>();
  for (const t of targetResults) addRate(endRates, t.item, t.totalRate);
  for (const e of excessResults) addRate(endRates, e.item, e.rate);

  const targetRateMap = new Map<ItemId, number>();
  for (const t of targetResults) {
    if (t.totalRate > EPS) targetRateMap.set(t.item, t.totalRate);
  }
  const excessRateMap = new Map<ItemId, number>();
  for (const e of excessResults) {
    if (e.rate > EPS) excessRateMap.set(e.item, e.rate);
  }

  return {
    feasible,
    targets: targetResults,
    excess: excessResults,
    raws: finalRaws,
    recipes: buildRecipeUsages(final.recipeCrafts),
    items: buildItemFlows(final.recipeCrafts, endRates),
    network: buildFactoryNetwork(
      final.recipeCrafts,
      targetRateMap,
      excessRateMap,
    ),
    overallUtilization: overallUtil(finalRaws),
  };
}
