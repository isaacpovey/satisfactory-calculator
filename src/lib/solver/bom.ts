import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { itemById, scarceRawIds } from "@/data/items";
import {
  getRecipeForProduct,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
  recipes as allRecipes,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";
import { totalEffectiveMachines } from "./constraints";
import { packMachineBanks } from "./pack-banks";

const EPS = 1e-9;

export type RateMap = Map<ItemId, number>;

export interface ExpandOptions {
  maxBeltCapacity?: number;
}

export function addRate(map: RateMap, item: ItemId, amount: number): void {
  if (Math.abs(amount) < EPS) return;
  map.set(item, (map.get(item) ?? 0) + amount);
}

/**
 * Expand demand for `itemId` at `rate` items/min into recipe crafts/min
 * and scarce raw consumption. Each stage is packed into belt-capped,
 * splitter-friendly machine banks.
 *
 * Prefer {@link expandFactoryPlan} when combining multiple sinks so shared
 * intermediates are quantized once.
 */
export function expandDemandToMaps(
  itemId: ItemId,
  rate: number,
  recipeCraftsPerMin: Map<string, number>,
  rawConsumption: RateMap,
  stack: Set<ItemId> = new Set(),
  opts: ExpandOptions = {},
): void {
  if (rate <= EPS) return;

  const item = itemById[itemId];
  if (!item) {
    throw new Error(`Unknown item: ${itemId}`);
  }

  if (item.isRaw) {
    if (!item.isUnlimited) {
      addRate(rawConsumption, itemId, rate);
    }
    return;
  }

  if (stack.has(itemId)) {
    throw new Error(`Cyclic recipe dependency involving ${itemId}`);
  }

  const recipe = getRecipeForProduct(itemId);
  if (!recipe) {
    throw new Error(`No recipe produces ${itemId}`);
  }

  const primary = recipe.outputs.find((o) => o.item === itemId);
  if (!primary) {
    throw new Error(`Recipe ${recipe.id} does not output ${itemId}`);
  }

  const outputPerMinutePerMachine = recipePrimaryOutputPerMinute(recipe);
  const exactMachines = rate / outputPerMinutePerMachine;
  const groups = packMachineBanks(recipe, exactMachines, {
    maxBeltCapacity: opts.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY,
  });
  const craftsPerMinute = totalEffectiveMachines(groups) * recipeCyclesPerMinute(recipe);

  recipeCraftsPerMin.set(recipe.id, (recipeCraftsPerMin.get(recipe.id) ?? 0) + craftsPerMinute);

  stack.add(itemId);
  for (const input of recipe.inputs) {
    const itemsPerMin = input.amount * craftsPerMinute;
    expandDemandToMaps(input.item, itemsPerMin, recipeCraftsPerMin, rawConsumption, stack, opts);
  }
  stack.delete(itemId);
}

/**
 * Exact (continuous) demand for every item needed to produce `rate` of `itemId`.
 */
function addExactDemand(
  itemId: ItemId,
  rate: number,
  demand: RateMap,
  stack: Set<ItemId> = new Set(),
): void {
  if (rate <= EPS) return;
  addRate(demand, itemId, rate);

  const item = itemById[itemId];
  if (!item || item.isRaw) return;
  if (stack.has(itemId)) {
    throw new Error(`Cyclic recipe dependency involving ${itemId}`);
  }

  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return;
  const primary = recipe.outputs.find((o) => o.item === itemId);
  if (!primary) return;

  const craftsPerMin = rate / primary.amount;
  stack.add(itemId);
  for (const input of recipe.inputs) {
    addExactDemand(input.item, input.amount * craftsPerMin, demand, stack);
  }
  stack.delete(itemId);
}

/**
 * Expand a whole factory plan: merge all sinks, then quantize each
 * manufactured item once. Shared intermediates are not double-rounded.
 */
export function expandFactoryPlan(
  sinks: { item: ItemId; rate: number }[],
  opts: ExpandOptions = {},
): { recipeCrafts: Map<string, number>; raws: RateMap; demand: RateMap } {
  const maxBelt = opts.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY;
  const sinkRates: RateMap = new Map();
  for (const sink of sinks) {
    if (sink.rate > EPS) addRate(sinkRates, sink.item, sink.rate);
  }

  // Continuous baseline demand (sinks + exact recipe tree).
  const demand: RateMap = new Map();
  for (const [item, rate] of sinkRates) {
    addExactDemand(item, rate, demand);
  }

  // Fixed-point: recompute intermediate demand as sink rate + sum of all
  // quantized consumer input needs (not max-of-one-consumer — that under-
  // produced shared parts like iron ingots and showed negative nets).
  for (let iter = 0; iter < 32; iter++) {
    const craftsByItem = new Map<ItemId, number>();
    for (const [itemId, rate] of demand) {
      const item = itemById[itemId];
      if (!item || item.isRaw || rate <= EPS) continue;
      const recipe = getRecipeForProduct(itemId);
      if (!recipe) continue;
      const base = recipePrimaryOutputPerMinute(recipe);
      const groups = packMachineBanks(recipe, rate / base, {
        maxBeltCapacity: maxBelt,
      });
      craftsByItem.set(itemId, totalEffectiveMachines(groups) * recipeCyclesPerMinute(recipe));
    }

    const needed: RateMap = new Map(sinkRates);
    for (const [itemId, crafts] of craftsByItem) {
      const recipe = getRecipeForProduct(itemId);
      if (!recipe || crafts <= EPS) continue;
      for (const input of recipe.inputs) {
        addRate(needed, input.item, input.amount * crafts);
      }
    }

    let changed = false;
    for (const [itemId, rate] of needed) {
      const current = demand.get(itemId) ?? 0;
      if (rate > current + EPS) {
        demand.set(itemId, rate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const recipeCrafts = new Map<string, number>();
  const raws: RateMap = new Map();
  for (const id of scarceRawIds) raws.set(id, 0);

  for (const [itemId, rate] of demand) {
    const item = itemById[itemId];
    if (!item) continue;
    if (item.isRaw) {
      if (!item.isUnlimited) addRate(raws, itemId, rate);
      continue;
    }
    const recipe = getRecipeForProduct(itemId);
    if (!recipe) continue;
    const base = recipePrimaryOutputPerMinute(recipe);
    const groups = packMachineBanks(recipe, rate / base, {
      maxBeltCapacity: maxBelt,
    });
    const crafts = totalEffectiveMachines(groups) * recipeCyclesPerMinute(recipe);
    recipeCrafts.set(recipe.id, (recipeCrafts.get(recipe.id) ?? 0) + crafts);
  }

  // Raw consumption from quantized crafts (authoritative)
  for (const id of scarceRawIds) raws.set(id, 0);
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      const child = itemById[input.item];
      if (child?.isRaw && !child.isUnlimited) {
        addRate(raws, input.item, input.amount * crafts);
      }
    }
  }

  return { recipeCrafts, raws, demand };
}

/**
 * Exact (non-quantized) scarce raw items/min for 1 item/min of `itemId`.
 * Used for continuous leftover scaling before quantization.
 */
export function exactRawCoefficients(itemId: ItemId): Partial<Record<ItemId, number>> {
  return exactExpandCoeffs(itemId, 1);
}

function exactExpandCoeffs(
  itemId: ItemId,
  rate: number,
  stack: Set<ItemId> = new Set(),
): Partial<Record<ItemId, number>> {
  const item = itemById[itemId];
  if (!item) return {};
  if (item.isRaw) {
    if (item.isUnlimited) return {};
    return { [itemId]: rate };
  }
  if (stack.has(itemId)) {
    throw new Error(`Cyclic recipe dependency involving ${itemId}`);
  }
  const recipe = getRecipeForProduct(itemId);
  if (!recipe) return {};
  const primary = recipe.outputs.find((o) => o.item === itemId);
  if (!primary) return {};

  const craftsPerMin = rate / primary.amount;

  stack.add(itemId);
  const out: Partial<Record<ItemId, number>> = {};
  for (const input of recipe.inputs) {
    const child = exactExpandCoeffs(input.item, input.amount * craftsPerMin, stack);
    for (const [k, v] of Object.entries(child) as [ItemId, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  stack.delete(itemId);
  return out;
}

export function rawCoefficients(itemId: ItemId): Partial<Record<ItemId, number>> {
  return exactRawCoefficients(itemId);
}

export function mergeRateMaps(...maps: RateMap[]): RateMap {
  const out: RateMap = new Map();
  for (const map of maps) {
    for (const [k, v] of map) {
      addRate(out, k, v);
    }
  }
  return out;
}

export function scaleRateMap(map: RateMap, factor: number): RateMap {
  const out: RateMap = new Map();
  for (const [k, v] of map) {
    out.set(k, v * factor);
  }
  return out;
}

export { scarceRawIds };
