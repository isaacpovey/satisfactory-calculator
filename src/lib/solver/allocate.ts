import {
  clampMaxBeltCapacity,
  DEFAULT_MAX_BELT_CAPACITY,
} from "@/data/belts";
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
} from "./constraints";
import { buildFactoryNetwork } from "./network";
import { quantizeItemRateBeltAware } from "./pack-banks";
import { reconcileProductionShares } from "./reconcile";
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
  maxBeltCapacity: number,
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
    { maxBeltCapacity },
  );
}

function planFitsAvailable(
  sinks: { item: ItemId; rate: number }[],
  available: RateMap,
  maxBeltCapacity: number,
): boolean {
  const { raws } = expandSinks(sinks, maxBeltCapacity);
  for (const id of scarceRawIds) {
    if ((raws.get(id) ?? 0) > (available.get(id) ?? 0) + EPS) return false;
  }
  return true;
}

function leftoverFromPlan(
  sinks: { item: ItemId; rate: number }[],
  available: RateMap,
  maxBeltCapacity: number,
): RateMap {
  const { raws } = expandSinks(sinks, maxBeltCapacity);
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
  maxBeltCapacity: number,
): number | null {
  let lo = 0;
  let hi = rates.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rate = rates[mid]!;
    setRate(rate);
    if (planFitsAvailable(buildSinks(), available, maxBeltCapacity)) {
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

function buildRecipeUsagesFromNetwork(
  network: ReturnType<typeof buildFactoryNetwork>,
): RecipeUsage[] {
  const usages: RecipeUsage[] = [];
  for (const stage of network.stages) {
    const cyclesPerMachine =
      stage.groups[0] != null && stage.groups[0].effectiveMachines > EPS
        ? stage.outputPerMinute /
          stage.groups.reduce((s, g) => s + g.effectiveMachines, 0)
        : 0;
    stage.groups.forEach((g, groupIndex) => {
      const groupCrafts =
        cyclesPerMachine > EPS
          ? g.effectiveMachines * cyclesPerMachine
          : g.outputPerMinute;
      usages.push({
        recipeId: stage.recipeId,
        recipeName: stage.recipeName,
        building: stage.building,
        machines: g.machines,
        clock: g.clock,
        effectiveMachines: g.effectiveMachines,
        cyclesPerMinute: groupCrafts,
        outputPerMinute: g.outputPerMinute,
        primaryOutput: stage.primaryOutput,
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
 * Min-targets-then-balance with machine/clock quantization, belt-capped
 * friendly banks, splitter-friendly production shares, and complexity-first
 * auto excess toward 100% utilization.
 */
export function solve(input: PlannerInput): SolveResult {
  const maxBeltCapacity = clampMaxBeltCapacity(
    input.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY,
  );
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

  const quantize = (item: ItemId, rate: number) =>
    quantizeItemRateBeltAware(item, rate, { maxBeltCapacity });

  // Phase A — quantized minima + user excess floors
  const plannedMins = new Map<ItemId, number>();
  for (const t of targets) {
    const q = quantize(t.item, Math.max(0, t.minRate));
    if (q > EPS) plannedMins.set(t.item, q);
  }

  const phaseAMerged = new Map<ItemId, number>();
  for (const [item, rate] of plannedMins) {
    phaseAMerged.set(item, (phaseAMerged.get(item) ?? 0) + rate);
  }
  for (const [item, rate] of userExcess) {
    const q = quantize(item, rate);
    phaseAMerged.set(item, (phaseAMerged.get(item) ?? 0) + q);
  }
  for (const [item, rate] of phaseAMerged) {
    phaseAMerged.set(item, quantize(item, rate));
  }

  const phaseA = expandSinks(
    [...phaseAMerged.entries()].map(([item, rate]) => ({ item, rate })),
    maxBeltCapacity,
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
    excessRates.set(item, quantize(item, rate));
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
          const leftover = leftoverFromPlan(
            buildSinks(),
            available,
            maxBeltCapacity,
          );
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
            maxBeltCapacity,
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

  const targetRateMap = new Map<ItemId, number>();
  for (const t of targets) {
    const plannedMin = plannedMins.get(t.item) ?? 0;
    const extra = targetExtra.get(t.item) ?? 0;
    const total = plannedMin + extra;
    if (total > EPS) targetRateMap.set(t.item, total);
  }

  const applyShareabilityExcess = (maxIter: number): void => {
    let plan = expandSinks(buildSinks(), maxBeltCapacity);
    for (let iter = 0; iter < maxIter; iter++) {
      const reconciled = reconcileProductionShares(
        plan.recipeCrafts,
        targetRateMap,
        excessRates,
        maxBeltCapacity,
      );
      let bumped = false;
      for (const [item, rate] of reconciled) {
        const prev = excessRates.get(item) ?? 0;
        if (rate <= prev + EPS) continue;
        excessRates.set(item, rate);
        if (planFitsAvailable(buildSinks(), available, maxBeltCapacity)) {
          bumped = true;
        } else {
          excessRates.set(item, prev);
        }
      }
      if (!bumped) break;
      plan = expandSinks(buildSinks(), maxBeltCapacity);
    }
  };

  // Phase C0 — sync excess with destination-pack surplus before soak.
  if (feasible) {
    applyShareabilityExcess(4);
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
      const leftover = leftoverFromPlan(
        buildSinks(),
        available,
        maxBeltCapacity,
      );
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
          maxBeltCapacity,
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

  // Phase D — re-sync surplus excess after soak reshapes crafts/destinations.
  if (feasible) {
    applyShareabilityExcess(4);
  }

  let final = expandSinks(buildSinks(), maxBeltCapacity);

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
      const requestedQ = requested > EPS ? quantize(item, requested) : 0;
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

  const excessRateMap = new Map<ItemId, number>();
  for (const e of excessResults) {
    if (e.rate > EPS) excessRateMap.set(e.item, e.rate);
  }

  const network = buildFactoryNetwork(
    final.recipeCrafts,
    targetRateMap,
    excessRateMap,
    maxBeltCapacity,
  );

  return {
    feasible,
    targets: targetResults,
    excess: excessResults,
    raws: finalRaws,
    recipes: buildRecipeUsagesFromNetwork(network),
    items: buildItemFlows(final.recipeCrafts, endRates),
    network,
    overallUtilization: overallUtil(finalRaws),
    maxBeltCapacity,
  };
}
