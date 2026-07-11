import { itemById } from "@/data/items";
import { getRecipeForProduct } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import { recipeDepth } from "./constraints";
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

function compareChainItems(a: ItemId, b: ItemId): number {
  const depthDiff = recipeDepth(a) - recipeDepth(b);
  if (depthDiff !== 0) return depthDiff;
  return (itemById[a]?.name ?? a).localeCompare(itemById[b]?.name ?? b);
}

/** Manufactured upstream parts for the current end-product chains (stable order). */
export function chainIntermediariesForTargets(targets: TargetSpec[]): ItemId[] {
  const roots = targets.map((t) => t.item);
  return collectChainIntermediates(roots)
    .filter((id) => !itemById[id]?.isIngot)
    .toSorted(compareChainItems);
}

/** Items shown in the excess panel: production-chain intermediaries only. */
export function excessPanelItems(targets: TargetSpec[]): ItemId[] {
  return chainIntermediariesForTargets(targets);
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
