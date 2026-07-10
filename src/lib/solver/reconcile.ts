import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { getRecipeForProduct, recipes as allRecipes } from "@/data/recipes";
import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";
import { buildStages } from "./network";

const EPS = 1e-9;

/**
 * For each manufactured item, raise excess so total production covers every
 * destination demand; leftover machine output becomes overflow to storage.
 * Destination-first routing no longer needs shared-lane shareability bumps.
 */
export function reconcileProductionShares(
  recipeCrafts: Map<string, number>,
  targetRates: Map<ItemId, number>,
  excessRates: Map<ItemId, number>,
  maxBeltCapacity: number = DEFAULT_MAX_BELT_CAPACITY,
): Map<ItemId, number> {
  const nextExcess = new Map(excessRates);
  const stages = buildStages(
    recipeCrafts,
    maxBeltCapacity,
    targetRates,
    excessRates,
  );

  const productionByItem = new Map<ItemId, number>();

  const addDemand = (item: ItemId, rate: number) => {
    if (rate <= EPS) return;
    productionByItem.set(item, (productionByItem.get(item) ?? 0) + rate);
  };

  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      const item = itemById[input.item];
      if (!item || item.isRaw) continue;
      addDemand(input.item, input.amount * crafts);
    }
  }
  for (const [item, rate] of targetRates) {
    addDemand(item, rate);
  }

  for (const stage of stages) {
    const item = stage.primaryOutput;
    if (!getRecipeForProduct(item)) continue;

    const demand = productionByItem.get(item) ?? 0;
    const produced = stage.outputPerMinute;
    const current = nextExcess.get(item) ?? 0;

    if (demand <= EPS) {
      // Pure excess / unused production — whole stage can overflow
      if (produced > current + EPS) nextExcess.set(item, produced);
      continue;
    }

    // Surplus production beyond destinations is excess → storage
    const surplus = Math.max(0, produced - demand);
    if (surplus > current + EPS) {
      nextExcess.set(item, surplus);
    }
  }

  return nextExcess;
}
