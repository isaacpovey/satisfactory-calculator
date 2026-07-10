import { itemById } from "@/data/items";
import { getRecipeForProduct, recipes as allRecipes } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import { recipeDepth } from "./constraints";
import type { ProductionChainGroup, ProductionStage } from "./types";

const recipeById = Object.fromEntries(allRecipes.map((r) => [r.id, r])) as Record<
  string,
  (typeof allRecipes)[number]
>;

/** Upstream stage recipe IDs that supply inputs to this stage. */
function stageDependencies(
  stage: ProductionStage,
  activeIds: Set<string>,
): string[] {
  const recipe = recipeById[stage.recipeId];
  if (!recipe) return [];
  const deps: string[] = [];
  for (const input of recipe.inputs) {
    const item = itemById[input.item];
    if (!item || item.isRaw) continue;
    const producer = getRecipeForProduct(input.item);
    if (producer && activeIds.has(producer.id) && producer.id !== stage.recipeId) {
      deps.push(producer.id);
    }
  }
  return deps;
}

function compareStages(a: ProductionStage, b: ProductionStage): number {
  const depthA = recipeDepth(a.primaryOutput);
  const depthB = recipeDepth(b.primaryOutput);
  if (depthA !== depthB) return depthA - depthB;
  return a.recipeName.localeCompare(b.recipeName);
}

/** Topological sort: upstream producers before downstream consumers. */
export function orderStagesByDependency(stages: ProductionStage[]): ProductionStage[] {
  if (stages.length <= 1) return [...stages];

  const byId = new Map(stages.map((s) => [s.recipeId, s]));
  const activeIds = new Set(byId.keys());

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const stage of stages) {
    inDegree.set(stage.recipeId, 0);
    dependents.set(stage.recipeId, []);
  }

  for (const stage of stages) {
    for (const depId of stageDependencies(stage, activeIds)) {
      inDegree.set(stage.recipeId, (inDegree.get(stage.recipeId) ?? 0) + 1);
      dependents.get(depId)!.push(stage.recipeId);
    }
  }

  const ready = stages
    .filter((s) => (inDegree.get(s.recipeId) ?? 0) === 0)
    .sort(compareStages);

  const sorted: ProductionStage[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    sorted.push(next);
    for (const childId of dependents.get(next.recipeId) ?? []) {
      const deg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, deg);
      if (deg === 0) {
        ready.push(byId.get(childId)!);
        ready.sort(compareStages);
      }
    }
  }

  if (sorted.length < stages.length) {
    const seen = new Set(sorted.map((s) => s.recipeId));
    const rest = stages.filter((s) => !seen.has(s.recipeId)).sort(compareStages);
    sorted.push(...rest);
  }

  return sorted;
}

function connectedComponents(stages: ProductionStage[]): string[][] {
  const activeIds = new Set(stages.map((s) => s.recipeId));
  const adj = new Map<string, Set<string>>();

  for (const stage of stages) {
    if (!adj.has(stage.recipeId)) adj.set(stage.recipeId, new Set());
    for (const depId of stageDependencies(stage, activeIds)) {
      adj.get(stage.recipeId)!.add(depId);
      if (!adj.has(depId)) adj.set(depId, new Set());
      adj.get(depId)!.add(stage.recipeId);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const stage of stages) {
    if (visited.has(stage.recipeId)) continue;
    const stack = [stage.recipeId];
    const component: string[] = [];
    visited.add(stage.recipeId);

    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  return components;
}

function rawOresForComponent(stageIds: Set<string>): ItemId[] {
  const ores = new Set<ItemId>();
  for (const id of stageIds) {
    const recipe = recipeById[id];
    if (!recipe) continue;
    for (const input of recipe.inputs) {
      const item = itemById[input.item];
      if (item?.isRaw && !item.isUnlimited) ores.add(input.item);
    }
  }
  return [...ores].sort((a, b) =>
    (itemById[a]?.name ?? a).localeCompare(itemById[b]?.name ?? b),
  );
}

function chainLabel(
  stageIds: Set<string>,
  targetItems: ItemId[],
  index: number,
): string {
  const targetsInChain = targetItems.filter((t) => {
    const producer = getRecipeForProduct(t);
    return producer && stageIds.has(producer.id);
  });
  if (targetsInChain.length > 0) {
    return targetsInChain
      .map((t) => itemById[t]?.name ?? t)
      .sort((a, b) => a.localeCompare(b))
      .join(" · ");
  }

  const ores = rawOresForComponent(stageIds);
  if (ores.length > 0) {
    return ores.map((o) => itemById[o]?.name ?? o).join(" · ");
  }

  return `Production chain ${index + 1}`;
}

/**
 * Group sorted stages into connected production chains and preserve
 * dependency order within each chain.
 */
export function buildChainGroups(
  stages: ProductionStage[],
  targetItems: ItemId[] = [],
): ProductionChainGroup[] {
  if (stages.length === 0) return [];

  const byId = new Map(stages.map((s) => [s.recipeId, s]));
  const components = connectedComponents(stages);

  const groups: ProductionChainGroup[] = components.map((ids, i) => {
    const idSet = new Set(ids);
    const orderedIds = stages
      .filter((s) => idSet.has(s.recipeId))
      .map((s) => s.recipeId);
    return {
      id: `chain-${i}`,
      label: chainLabel(idSet, targetItems, i),
      stageIds: orderedIds,
    };
  });

  groups.sort((a, b) => {
    const minDepth = (ids: string[]) => {
      const depths = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((s) => recipeDepth(s!.primaryOutput));
      return depths.length ? Math.min(...depths) : 0;
    };
    const d = minDepth(a.stageIds) - minDepth(b.stageIds);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });

  return groups;
}
