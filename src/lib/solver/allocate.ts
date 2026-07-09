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
  expandDemandToMaps,
  type RateMap,
} from "./bom";
import {
  complexityScore,
  itemRateStep,
  nextExcessAbove,
  quantizeItemRate,
  representMachines,
  snapExcessBranch,
  snapSplitterShare,
} from "./constraints";
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
  const recipeCrafts = new Map<string, number>();
  const raws = emptyRawMap();
  for (const sink of sinks) {
    if (sink.rate <= EPS) continue;
    expandDemandToMaps(sink.item, sink.rate, recipeCrafts, raws);
  }
  return { recipeCrafts, raws };
}

function rawFits(needed: RateMap, budget: RateMap): boolean {
  for (const id of scarceRawIds) {
    if ((needed.get(id) ?? 0) > (budget.get(id) ?? 0) + EPS) return false;
  }
  return true;
}

function subtractRaws(budget: RateMap, used: RateMap): RateMap {
  const out: RateMap = new Map(budget);
  for (const id of scarceRawIds) {
    out.set(id, Math.max(0, (out.get(id) ?? 0) - (used.get(id) ?? 0)));
  }
  return out;
}

function demandRaws(itemId: ItemId, rate: number): RateMap {
  const raws = emptyRawMap();
  const crafts = new Map<string, number>();
  expandDemandToMaps(itemId, rate, crafts, raws);
  return raws;
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

/** Largest machine-quantized rate ≤ leftover capacity (and ≥ minRate if given). */
function maxAffordableQuantized(
  itemId: ItemId,
  leftover: RateMap,
  minRate = 0,
): number {
  const coeffs = exactRawCoefficients(itemId);
  let maxContinuous = Number.POSITIVE_INFINITY;
  for (const id of scarceRawIds) {
    const c = coeffs[id] ?? 0;
    if (c <= EPS) continue;
    maxContinuous = Math.min(maxContinuous, (leftover.get(id) ?? 0) / c);
  }
  if (!Number.isFinite(maxContinuous) || maxContinuous < 0) maxContinuous = 0;

  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return 0;
  const base = recipePrimaryOutputPerMinute(recipe);
  const step = base * 0.25;
  if (step <= EPS) return 0;

  let rate = Math.floor(maxContinuous / step + EPS) * step;
  const minQ = minRate > EPS ? quantizeItemRate(itemId, minRate) : 0;
  if (minQ > EPS && rate + EPS < minQ) return 0;

  while (rate > EPS) {
    if (rawFits(demandRaws(itemId, rate), leftover)) {
      if (minQ <= EPS || rate + EPS >= minQ) return rate;
    }
    rate = Math.max(0, rate - step);
  }
  return 0;
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
    const config = representMachines(exactMachines);
    const primary = recipe.outputs[0]!;
    usages.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      building: buildingName[recipe.building] ?? recipe.building,
      machines: config.machines,
      clock: config.clock,
      effectiveMachines: config.effectiveMachines,
      cyclesPerMinute: crafts,
      outputPerMinute: primary.amount * crafts,
      primaryOutput: primary.item,
    });
  }
  usages.sort((a, b) => a.recipeName.localeCompare(b.recipeName));
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
  let leftover = emptyRawMap();
  for (const r of phaseARaws) {
    leftover.set(r.item, feasible ? r.leftover : 0);
  }

  const targetExtra = new Map<ItemId, number>();
  const excessRates = new Map<ItemId, number>();
  for (const [item, rate] of userExcess) {
    excessRates.set(item, quantizeItemRate(item, rate));
  }

  // Phase B — leftover to targets independently by weight priority.
  // Each product only competes for the raws it actually uses, so limestone
  // can still feed Concrete when coal is already at 100%.
  if (feasible) {
    const weighted = targets
      .filter((t) => t.weight > EPS)
      .sort((a, b) => b.weight - a.weight || a.item.localeCompare(b.item));

    if (weighted.length > 0) {
      let guard = 0;
      while (guard++ < 500) {
        let progressed = false;
        for (const t of weighted) {
          const current = targetExtra.get(t.item) ?? 0;
          const affordable = maxAffordableQuantized(t.item, leftover);
          if (affordable <= current + EPS) continue;

          let candidate = quantizeItemRate(t.item, affordable);
          if (candidate <= current + EPS) continue;

          while (candidate > current + EPS) {
            const delta = candidate - current;
            if (rawFits(demandRaws(t.item, delta), leftover)) break;
            candidate = Math.max(current, candidate - itemRateStep(t.item));
            candidate = quantizeItemRate(t.item, candidate);
          }
          if (candidate <= current + EPS) continue;

          const delta = candidate - current;
          targetExtra.set(t.item, candidate);
          leftover = subtractRaws(leftover, demandRaws(t.item, delta));
          progressed = true;
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
    if (
      uses.some((r) => (leftover.get(r) ?? 0) > EPS && (coeffs[r] ?? 0) > EPS)
    ) {
      soakCandidates.add(id);
    }
  }

  const fillOrder = [...soakCandidates].sort(
    (a, b) => complexityScore(b) - complexityScore(a),
  );

  if (feasible) {
    let guard = 0;
    while (guard++ < 800) {
      let progressed = false;

      const currentSinks: { item: ItemId; rate: number }[] = [];
      for (const [item, rate] of plannedMins) {
        currentSinks.push({ item, rate: rate + (targetExtra.get(item) ?? 0) });
      }
      for (const [item, rate] of excessRates) {
        if (rate > EPS) currentSinks.push({ item, rate });
      }
      const currentExpand = expandSinks(currentSinks);
      const downstreamByItem = new Map<ItemId, number>();
      for (const recipe of allRecipes) {
        const crafts = currentExpand.recipeCrafts.get(recipe.id) ?? 0;
        if (crafts <= EPS) continue;
        for (const input of recipe.inputs) {
          if (itemById[input.item]?.isRaw) continue;
          downstreamByItem.set(
            input.item,
            (downstreamByItem.get(input.item) ?? 0) + input.amount * crafts,
          );
        }
      }

      for (const item of fillOrder) {
        const current = excessRates.get(item) ?? 0;
        const affordable = maxAffordableQuantized(item, leftover);
        if (affordable <= current + EPS) continue;

        const downstream = downstreamByItem.get(item) ?? 0;
        // Largest legal splitter-friendly excess ≤ leftover capacity
        let next = snapExcessBranch(affordable, downstream);
        next = quantizeItemRate(item, next);
        if (downstream > EPS) {
          next = snapExcessBranch(next, downstream);
          next = quantizeItemRate(item, next);
        }
        if (next <= current + EPS) {
          next = nextExcessAbove(current, affordable, downstream);
          next = quantizeItemRate(item, next);
        }
        if (next <= current + EPS) continue;

        if (!rawFits(demandRaws(item, next - current), leftover)) {
          let probe = snapExcessBranch(next - EPS, downstream);
          probe = quantizeItemRate(item, probe);
          let found = false;
          for (let i = 0; i < 40; i++) {
            if (probe <= current + EPS) break;
            if (rawFits(demandRaws(item, probe - current), leftover)) {
              next = probe;
              found = true;
              break;
            }
            probe = snapExcessBranch(probe - EPS, downstream);
            probe = quantizeItemRate(item, probe);
          }
          if (!found) continue;
        }

        const applied = next - current;
        if (applied <= EPS) continue;
        excessRates.set(item, next);
        leftover = subtractRaws(leftover, demandRaws(item, applied));
        progressed = true;
        break;
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
  for (const [item, rate] of finalSinkMap) {
    finalSinkMap.set(item, quantizeItemRate(item, rate));
  }

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

  return {
    feasible,
    targets: targetResults,
    excess: excessResults,
    raws: finalRaws,
    recipes: buildRecipeUsages(final.recipeCrafts),
    items: buildItemFlows(final.recipeCrafts, endRates),
    overallUtilization: overallUtil(finalRaws),
  };
}
