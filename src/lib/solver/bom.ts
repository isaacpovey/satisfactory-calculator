import { itemById, scarceRawIds } from "@/data/items";
import {
  getRecipeForProduct,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";

const EPS = 1e-9;

export type RateMap = Map<ItemId, number>;

export function addRate(map: RateMap, item: ItemId, amount: number): void {
  if (Math.abs(amount) < EPS) return;
  map.set(item, (map.get(item) ?? 0) + amount);
}

/**
 * Expand demand for `itemId` at `rate` items/min into recipe crafts/min
 * and scarce raw consumption. Unlimited raws are ignored as constraints.
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
  const machinesNeeded = rate / outputPerMinutePerMachine;
  const craftsPerMinute = machinesNeeded * recipeCyclesPerMinute(recipe);

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

/** Scarce raw items/min required to produce 1 item/min of `itemId`. */
export function rawCoefficients(
  itemId: ItemId,
): Partial<Record<ItemId, number>> {
  const raws: RateMap = new Map();
  const recipeCrafts = new Map<string, number>();
  expandDemandToMaps(itemId, 1, recipeCrafts, raws);
  const result: Partial<Record<ItemId, number>> = {};
  for (const id of scarceRawIds) {
    const v = raws.get(id) ?? 0;
    if (v > EPS) result[id] = v;
  }
  return result;
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
