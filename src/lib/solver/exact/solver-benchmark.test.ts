import { describe, expect, it } from "vitest";
import { items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import { solveExact } from "../index";
import { BROWSER_FACTORY_BENCHMARK_INPUT } from "../benchmark-config";
import { computeRecipeBounds } from "./bounds";
import { generateMachineBankPatterns } from "./bank-patterns";
import { Rational } from "./rational";
import { validateRecipeGraph } from "./recipe-graph";

const runFullBenchmark = process.env.SOLVER_BENCHMARK === "1";

describe("solver benchmark", () => {
  it("reports bank-pattern domain size for browser factory", () => {
    const graph = validateRecipeGraph(items, recipes, scarceRawIds);
    const bounds = computeRecipeBounds(graph, BROWSER_FACTORY_BENCHMARK_INPUT.rawAvailable);
    const beltCapacity = Rational.from(BROWSER_FACTORY_BENCHMARK_INPUT.maxBeltCapacity!);
    let totalGenerated = 0;

    for (const recipe of graph.topologicalRecipes) {
      const bound = bounds.get(recipe.id);
      if (!bound) continue;
      totalGenerated += generateMachineBankPatterns(bound, beltCapacity).length;
    }

    expect(totalGenerated).toBeGreaterThan(1000);
  });
});

(runFullBenchmark ? describe : describe.skip)("solver benchmark timing", () => {
  it("times each lexicographic phase for browser factory", async () => {
    const phases: { label: string; phaseMs: number; numBranches: number }[] = [];
    const result = await solveExact(BROWSER_FACTORY_BENCHMARK_INPUT, {
      searchWorkers: 8,
      onProgress: (progress) => {
        if (progress.status === "complete" && progress.phaseMs !== undefined) {
          phases.push({
            label: progress.label,
            phaseMs: progress.phaseMs,
            numBranches: progress.numBranches ?? 0,
          });
        }
      },
    });

    expect(result.feasible).toBe(true);
    expect(phases).toHaveLength(6);
  }, 1_800_000);
});
