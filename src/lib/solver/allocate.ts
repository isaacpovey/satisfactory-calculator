import { buildings } from "@/data/items";
import { itemById, scarceRawIds } from "@/data/items";
import { recipes as allRecipes } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import {
  addRate,
  expandDemandToMaps,
  rawCoefficients,
  type RateMap,
} from "./bom";
import type {
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

/**
 * Max scalar t such that sum_i (t * weight_i * coeff_i[r]) <= leftover[r]
 * for every scarce raw r. Extra output of product i is t * weight_i.
 */
function leftoverScale(
  weights: number[],
  coeffs: Partial<Record<ItemId, number>>[],
  leftover: RateMap,
): number {
  let t = Number.POSITIVE_INFINITY;

  for (const rawId of scarceRawIds) {
    const available = leftover.get(rawId) ?? 0;
    let demandPerT = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] ?? 0;
      if (w <= EPS) continue;
      demandPerT += w * (coeffs[i]?.[rawId] ?? 0);
    }
    if (demandPerT <= EPS) continue;
    t = Math.min(t, available / demandPerT);
  }

  if (!Number.isFinite(t) || t < 0) return 0;
  return t;
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

  // Treat scarce raw extraction as production equal to consumption
  for (const rawId of scarceRawIds) {
    const used = consumed.get(rawId) ?? 0;
    if (used > EPS) {
      addRate(produced, rawId, used);
    }
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
    flows.push({
      item,
      produced: p,
      consumed: c,
      // End sinks (targets / excess) appear as positive net
      net: p - c,
    });
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
    const cyclesPerMinute = crafts;
    const machines = crafts / (60 / recipe.durationSec);
    const primary = recipe.outputs[0]!;
    usages.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      building: buildingName[recipe.building] ?? recipe.building,
      machines,
      machinesCeil: Math.ceil(machines - EPS),
      cyclesPerMinute,
      outputPerMinute: primary.amount * crafts,
      primaryOutput: primary.item,
    });
  }
  usages.sort((a, b) => a.recipeName.localeCompare(b.recipeName));
  return usages;
}

/**
 * Min-targets-then-balance solver.
 *
 * Phase A: satisfy all minimum end-product rates + excess intermediary sinks.
 * Phase B: allocate leftover scarce raws proportionally to target weights.
 */
export function solve(input: PlannerInput): SolveResult {
  const targets = input.targets.filter(
    (t) => t.minRate > EPS || t.weight > EPS,
  );
  const excess = input.excess.filter((e) => e.rate > EPS);

  // Phase A sinks: minima + excess
  const phaseASinks = [
    ...targets.map((t) => ({ item: t.item, rate: Math.max(0, t.minRate) })),
    ...excess.map((e) => ({ item: e.item, rate: e.rate })),
  ];

  const phaseA = expandSinks(phaseASinks);

  const raws: RawUtilization[] = scarceRawIds.map((item) => {
    const available = Math.max(0, input.rawAvailable[item] ?? 0);
    const usedForMin = phaseA.raws.get(item) ?? 0;
    const shortfall = Math.max(0, usedForMin - available);
    return {
      item,
      available,
      used: usedForMin,
      leftover: Math.max(0, available - usedForMin),
      utilization: available > EPS ? Math.min(1, usedForMin / available) : 0,
      shortfall,
    };
  });

  const feasible = raws.every((r) => r.shortfall <= EPS);

  const leftover: RateMap = new Map();
  for (const r of raws) {
    leftover.set(r.item, feasible ? r.leftover : 0);
  }

  // Phase B: proportional leftover fill by weights
  const weights = targets.map((t) => Math.max(0, t.weight));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const coeffs = targets.map((t) => rawCoefficients(t.item));

  let extras = targets.map(() => 0);
  if (feasible && weightSum > EPS) {
    const normalized = weights.map((w) => w / weightSum);
    const t = leftoverScale(normalized, coeffs, leftover);
    extras = normalized.map((w) => w * t);
  }

  const targetResults: TargetResult[] = targets.map((t, i) => ({
    item: t.item,
    minRate: Math.max(0, t.minRate),
    extraRate: extras[i] ?? 0,
    totalRate: Math.max(0, t.minRate) + (extras[i] ?? 0),
    weight: t.weight,
  }));

  // Final expansion: minima + extras + excess
  const finalSinks = [
    ...targetResults.map((t) => ({ item: t.item, rate: t.totalRate })),
    ...excess.map((e) => ({ item: e.item, rate: e.rate })),
  ];
  const final = expandSinks(finalSinks);

  const finalRaws: RawUtilization[] = scarceRawIds.map((item) => {
    const available = Math.max(0, input.rawAvailable[item] ?? 0);
    const used = final.raws.get(item) ?? 0;
    const shortfall = Math.max(0, (phaseA.raws.get(item) ?? 0) - available);
    return {
      item,
      available,
      used,
      leftover: Math.max(0, available - used),
      utilization: available > EPS ? Math.min(1, used / available) : 0,
      shortfall,
    };
  });

  const endRates = new Map<ItemId, number>();
  for (const t of targetResults) {
    addRate(endRates, t.item, t.totalRate);
  }
  for (const e of excess) {
    addRate(endRates, e.item, e.rate);
  }

  let totalAvailable = 0;
  let totalUsed = 0;
  for (const r of finalRaws) {
    totalAvailable += r.available;
    totalUsed += Math.min(r.used, r.available);
  }
  const overallUtilization =
    totalAvailable > EPS ? totalUsed / totalAvailable : 0;

  return {
    feasible,
    targets: targetResults,
    raws: finalRaws,
    recipes: buildRecipeUsages(final.recipeCrafts),
    items: buildItemFlows(final.recipeCrafts, endRates),
    overallUtilization,
  };
}
