import type { Item, ItemId, Recipe } from "@/data/types";

export type RecipeGraphIssueCode =
  | "duplicate-item"
  | "duplicate-recipe"
  | "unknown-scarce-resource"
  | "invalid-scarce-resource"
  | "invalid-recipe"
  | "unknown-item-reference"
  | "single-output-required"
  | "missing-primary-producer"
  | "duplicate-primary-producer"
  | "cycle"
  | "no-scarce-resource-path";

export interface RecipeGraphIssue {
  code: RecipeGraphIssueCode;
  message: string;
  recipeId?: string;
  itemId?: string;
}

export interface ExactRecipeGraph {
  readonly items: readonly Item[];
  readonly recipes: readonly Recipe[];
  readonly scarceRawIds: readonly ItemId[];
  readonly itemById: ReadonlyMap<ItemId, Item>;
  readonly recipeById: ReadonlyMap<string, Recipe>;
  readonly producerByItem: ReadonlyMap<ItemId, Recipe>;
  /** Recipes ordered from raw-adjacent producers toward downstream consumers. */
  readonly topologicalRecipes: readonly Recipe[];
  /** Manufactured items whose dependency tree contains a scarce raw resource. */
  readonly scarceReachableItems: ReadonlySet<ItemId>;
}

export class RecipeGraphValidationError extends Error {
  readonly issues: readonly RecipeGraphIssue[];

  constructor(issues: readonly RecipeGraphIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "RecipeGraphValidationError";
    this.issues = issues;
  }
}

/**
 * Validates the exact solver's graph assumptions and returns indexed,
 * topologically ordered metadata.
 */
export function validateRecipeGraph(
  items: readonly Item[],
  recipes: readonly Recipe[],
  scarceRawIds: readonly ItemId[],
): ExactRecipeGraph {
  const issues: RecipeGraphIssue[] = [];
  const itemById = new Map<ItemId, Item>();
  const recipeById = new Map<string, Recipe>();
  const producerByItem = new Map<ItemId, Recipe>();

  for (const item of items) {
    if (itemById.has(item.id)) {
      issues.push({
        code: "duplicate-item",
        itemId: item.id,
        message: `Duplicate item id: ${item.id}`,
      });
    } else {
      itemById.set(item.id, item);
    }
  }

  const scarceSet = new Set<ItemId>();
  for (const itemId of scarceRawIds) {
    const item = itemById.get(itemId);
    if (!item) {
      issues.push({
        code: "unknown-scarce-resource",
        itemId,
        message: `Scarce resource references unknown item: ${itemId}`,
      });
      continue;
    }
    if (!item.isRaw || item.isUnlimited) {
      issues.push({
        code: "invalid-scarce-resource",
        itemId,
        message: `Scarce resource must be a limited raw item: ${itemId}`,
      });
      continue;
    }
    scarceSet.add(itemId);
  }

  for (const recipe of recipes) {
    if (recipeById.has(recipe.id)) {
      issues.push({
        code: "duplicate-recipe",
        recipeId: recipe.id,
        message: `Duplicate recipe id: ${recipe.id}`,
      });
    } else {
      recipeById.set(recipe.id, recipe);
    }

    if (!Number.isFinite(recipe.durationSec) || recipe.durationSec <= 0) {
      issues.push({
        code: "invalid-recipe",
        recipeId: recipe.id,
        message: `Recipe ${recipe.id} must have a positive finite duration`,
      });
    }
    if (recipe.inputs.length === 0) {
      issues.push({
        code: "invalid-recipe",
        recipeId: recipe.id,
        message: `Recipe ${recipe.id} must have at least one input`,
      });
    }
    if (recipe.outputs.length !== 1) {
      issues.push({
        code: "single-output-required",
        recipeId: recipe.id,
        message: `Recipe ${recipe.id} must have exactly one output`,
      });
    }

    for (const amount of [...recipe.inputs, ...recipe.outputs]) {
      if (!itemById.has(amount.item)) {
        issues.push({
          code: "unknown-item-reference",
          recipeId: recipe.id,
          itemId: amount.item,
          message: `Recipe ${recipe.id} references unknown item: ${amount.item}`,
        });
      }
      if (!Number.isFinite(amount.amount) || amount.amount <= 0) {
        issues.push({
          code: "invalid-recipe",
          recipeId: recipe.id,
          itemId: amount.item,
          message: `Recipe ${recipe.id} has a non-positive or non-finite amount for ${amount.item}`,
        });
      }
    }

    const primary = recipe.outputs[0];
    if (primary) {
      const existing = producerByItem.get(primary.item);
      if (existing) {
        issues.push({
          code: "duplicate-primary-producer",
          recipeId: recipe.id,
          itemId: primary.item,
          message: `Item ${primary.item} has multiple primary producers: ${existing.id}, ${recipe.id}`,
        });
      } else {
        producerByItem.set(primary.item, recipe);
      }
    }
  }

  for (const item of items) {
    if (!item.isRaw && !producerByItem.has(item.id)) {
      issues.push({
        code: "missing-primary-producer",
        itemId: item.id,
        message: `Manufactured item has no primary producer: ${item.id}`,
      });
    }
  }

  const indegree = new Map<string, number>();
  const consumers = new Map<string, Set<string>>();
  for (const recipe of recipes) {
    indegree.set(recipe.id, 0);
    consumers.set(recipe.id, new Set());
  }
  for (const recipe of recipes) {
    const dependencies = new Set<string>();
    for (const input of recipe.inputs) {
      const producer = producerByItem.get(input.item);
      if (producer && producer.id !== recipe.id) dependencies.add(producer.id);
      if (producer?.id === recipe.id) dependencies.add(producer.id);
    }
    indegree.set(recipe.id, dependencies.size);
    for (const dependency of dependencies) {
      consumers.get(dependency)?.add(recipe.id);
    }
  }

  const ready = recipes.filter((recipe) => indegree.get(recipe.id) === 0);
  const topologicalRecipes: Recipe[] = [];
  for (let index = 0; index < ready.length; index++) {
    const recipe = ready[index]!;
    topologicalRecipes.push(recipe);
    for (const consumerId of consumers.get(recipe.id) ?? []) {
      const next = (indegree.get(consumerId) ?? 0) - 1;
      indegree.set(consumerId, next);
      if (next === 0) {
        const consumer = recipeById.get(consumerId);
        if (consumer) ready.push(consumer);
      }
    }
  }

  const uniqueRecipeCount = recipeById.size;
  if (topologicalRecipes.length !== uniqueRecipeCount) {
    const cyclicRecipeIds = [...recipeById.keys()].filter((id) => (indegree.get(id) ?? 0) > 0);
    issues.push({
      code: "cycle",
      message: `Recipe graph contains a cycle: ${cyclicRecipeIds.join(", ")}`,
    });
  }

  const scarceReachableItems = new Set<ItemId>(scarceSet);
  if (topologicalRecipes.length === uniqueRecipeCount) {
    for (const recipe of topologicalRecipes) {
      const primary = recipe.outputs[0];
      if (!primary) continue;
      if (recipe.inputs.some((input) => scarceReachableItems.has(input.item))) {
        scarceReachableItems.add(primary.item);
      } else {
        issues.push({
          code: "no-scarce-resource-path",
          recipeId: recipe.id,
          itemId: primary.item,
          message: `Recipe ${recipe.id} has no dependency path to a scarce raw resource`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new RecipeGraphValidationError(issues);
  }

  return {
    items,
    recipes,
    scarceRawIds: [...scarceSet],
    itemById,
    recipeById,
    producerByItem,
    topologicalRecipes,
    scarceReachableItems,
  };
}
