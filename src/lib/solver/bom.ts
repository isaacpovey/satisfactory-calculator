import { itemById, scarceRawIds } from "@/data/items";
import {
  getRecipeForProduct,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";
import { representMachines } from "./constraints";

const EPS = 1e-9;

export type RateMap = Map<ItemId, number>;

export function addRate(map: RateMap, item: ItemId, amount: number): void {
  if (Math.abs(amount) < EPS) return;
  map.set(item, (map.get(item) ?? 0) + amount);
}

/**
 * Expand demand for `itemId` at `rate` items/min into recipe crafts/min
 * and scarce raw consumption. Each stage is rounded up to a splitter-friendly
 * machine count (2^a·3^b) at an allowed clock (100/75/50/25%).
 */
export function expandDemandToMaps(
  itemId: ItemId,
  rate: number,
  recipeCraftsPerMin: Map<string, number>,
  rawConsumption: RateMap,
  stack: Set<ItemId> = new Set(),
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
  const config = representMachines(exactMachines);
  const craftsPerMinute =
    config.effectiveMachines * recipeCyclesPerMinute(recipe);

  recipeCraftsPerMin.set(
    recipe.id,
    (recipeCraftsPerMin.get(recipe.id) ?? 0) + craftsPerMinute,
  );

  stack.add(itemId);
  for (const input of recipe.inputs) {
    const itemsPerMin = input.amount * craftsPerMinute;
    expandDemandToMaps(
      input.item,
      itemsPerMin,
      recipeCraftsPerMin,
      rawConsumption,
      stack,
    );
  }
  stack.delete(itemId);
}

/**
 * Exact (non-quantized) scarce raw items/min for 1 item/min of `itemId`.
 * Used for continuous leftover scaling before quantization.
 */
export function exactRawCoefficients(
  itemId: ItemId,
): Partial<Record<ItemId, number>> {
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
    const child = exactExpandCoeffs(
      input.item,
      input.amount * craftsPerMin,
      stack,
    );
    for (const [k, v] of Object.entries(child) as [ItemId, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  stack.delete(itemId);
  return out;
}

export function rawCoefficients(
  itemId: ItemId,
): Partial<Record<ItemId, number>> {
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
