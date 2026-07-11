import { itemById } from "@/data/items";
import { getRecipeForProduct } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import type { TargetSpec } from "./types";

/** Walk recipe trees from `roots` and return manufactured upstream parts (not roots). */
export function collectChainIntermediates(roots: ItemId[]): ItemId[] {
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

/** Chain intermediaries for excess floors: upstream parts of targets and excess roots. */
export function chainIntermediariesForPlanner(
  targets: TargetSpec[],
  excessFloors: Partial<Record<ItemId, number>>,
): ItemId[] {
  const roots = [...targets.map((t) => t.item), ...(Object.keys(excessFloors) as ItemId[])];
  return collectChainIntermediates(roots)
    .filter((id) => !itemById[id]?.isIngot)
    .toSorted((a, b) => (itemById[a]?.name ?? a).localeCompare(itemById[b]?.name ?? b));
}

function sortItemIds(ids: Iterable<ItemId>): ItemId[] {
  return [...ids].toSorted((a, b) =>
    (itemById[a]?.name ?? a).localeCompare(itemById[b]?.name ?? b),
  );
}

/** Items shown in the excess panel: chain intermediaries plus floored roots. */
export function excessPanelItems(
  targets: TargetSpec[],
  excessFloors: Partial<Record<ItemId, number>>,
): ItemId[] {
  const ids = new Set<ItemId>(chainIntermediariesForPlanner(targets, excessFloors));
  for (const id of Object.keys(excessFloors) as ItemId[]) {
    ids.add(id);
  }
  return sortItemIds(ids);
}

/** Drop spare-part floors for items no longer on any target chain. */
export function pruneExcessFloors(
  targets: TargetSpec[],
  floors: Partial<Record<ItemId, number>>,
): Partial<Record<ItemId, number>> {
  const onChain = new Set<ItemId>(
    [
      ...targets.map((t) => t.item),
      ...collectChainIntermediates(targets.map((t) => t.item)),
    ].filter((id) => !itemById[id]?.isIngot),
  );
  return Object.fromEntries(
    Object.entries(floors).filter(([id, rate]) => (rate ?? 0) > 0 && onChain.has(id as ItemId)),
  );
}
