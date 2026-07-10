import { describe, expect, it } from "vitest";
import { items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import type { ItemId, Recipe } from "@/data/types";
import {
  RecipeGraphValidationError,
  validateRecipeGraph,
  type RecipeGraphIssueCode,
} from "./recipe-graph";

function issueCodes(candidateRecipes: readonly Recipe[]): RecipeGraphIssueCode[] {
  try {
    validateRecipeGraph(items, candidateRecipes, scarceRawIds);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeGraphValidationError);
    return (error as RecipeGraphValidationError).issues.map((issue) => issue.code);
  }
}

function replaceRecipe(id: string, replacement: (recipe: Recipe) => Recipe): Recipe[] {
  return recipes.map((recipe) => (recipe.id === id ? replacement(recipe) : recipe));
}

describe("validateRecipeGraph", () => {
  it("validates and topologically indexes the current data", () => {
    const graph = validateRecipeGraph(items, recipes, scarceRawIds);

    expect(graph.recipeById.size).toBe(recipes.length);
    expect(graph.producerByItem.size).toBe(items.filter((item) => !item.isRaw).length);
    expect(graph.topologicalRecipes).toHaveLength(recipes.length);
    expect(graph.scarceReachableItems.has("nobelisk")).toBe(true);

    const position = new Map(
      graph.topologicalRecipes.map((recipe, index) => [recipe.id, index] as const),
    );
    for (const recipe of graph.topologicalRecipes) {
      for (const input of recipe.inputs) {
        const producer = graph.producerByItem.get(input.item);
        if (producer) {
          expect(position.get(producer.id)).toBeLessThan(position.get(recipe.id)!);
        }
      }
    }
  });

  it("rejects unknown item references", () => {
    const changed = replaceRecipe("iron-ingot", (recipe) => ({
      ...recipe,
      inputs: [{ item: "missing-item" as ItemId, amount: 1 }],
    }));
    expect(issueCodes(changed)).toContain("unknown-item-reference");
  });

  it("requires exactly one output", () => {
    const changed = replaceRecipe("iron-ingot", (recipe) => ({
      ...recipe,
      outputs: [...recipe.outputs, { item: "iron-plate", amount: 1 }],
    }));
    expect(issueCodes(changed)).toContain("single-output-required");
  });

  it("requires a unique primary producer", () => {
    const duplicate: Recipe = {
      ...recipes.find((recipe) => recipe.id === "iron-ingot")!,
      id: "duplicate-iron-ingot",
    };
    expect(issueCodes([...recipes, duplicate])).toContain("duplicate-primary-producer");
  });

  it("requires every manufactured item to have a producer", () => {
    expect(issueCodes(recipes.filter((recipe) => recipe.id !== "quickwire"))).toContain(
      "missing-primary-producer",
    );
  });

  it("rejects recipe dependency cycles", () => {
    const changed = replaceRecipe("iron-ingot", (recipe) => ({
      ...recipe,
      inputs: [{ item: "iron-plate", amount: 1 }],
    }));
    expect(issueCodes(changed)).toContain("cycle");
  });

  it("requires manufactured chains to reach a scarce raw resource", () => {
    const changed = replaceRecipe("iron-ingot", (recipe) => ({
      ...recipe,
      inputs: [{ item: "water", amount: 1 }],
    }));
    expect(issueCodes(changed)).toContain("no-scarce-resource-path");
  });
});
