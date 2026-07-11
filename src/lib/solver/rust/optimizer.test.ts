import { describe, expect, it } from "vitest";
import { items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import type { Item, Recipe } from "@/data/types";
import { solveExact } from "../index";
import { solveExactProduction } from "../exact/optimizer";
import type {
  ExactOptimizerInput,
  ExactOptimizerResult,
  ExactSolveProgress,
} from "../exact/optimizer-types";
import { validateRecipeGraph } from "../exact/recipe-graph";
import { validateExactSolution } from "../exact/validation";
import { solveExactProductionRust } from "./optimizer";

const tinyItems: readonly Item[] = [
  { id: "iron-ore", name: "Iron Ore", isRaw: true, tier: 0 },
  { id: "iron-plate", name: "Iron Plate", isRaw: false, tier: 0 },
  { id: "iron-rod", name: "Iron Rod", isRaw: false, tier: 0 },
];

const tinyRecipes: readonly Recipe[] = [
  {
    id: "tiny-plate",
    name: "Tiny Plate",
    building: "constructor",
    durationSec: 60,
    inputs: [{ item: "iron-ore", amount: 1 }],
    outputs: [{ item: "iron-plate", amount: 1 }],
    tier: 0,
  },
  {
    id: "tiny-rod",
    name: "Tiny Rod",
    building: "constructor",
    durationSec: 30,
    inputs: [{ item: "iron-ore", amount: 1 }],
    outputs: [{ item: "iron-rod", amount: 1 }],
    tier: 0,
  },
];

function tinyInput(overrides: Partial<ExactOptimizerInput> = {}): ExactOptimizerInput {
  return {
    graph: validateRecipeGraph(tinyItems, tinyRecipes, ["iron-ore"]),
    rawAvailability: { "iron-ore": 2 },
    targets: [
      { item: "iron-plate", minimum: 0, weight: 1 },
      { item: "iron-rod", minimum: 0, weight: 2 },
    ],
    beltCapacity: 10,
    ...overrides,
  };
}

function objectiveStrings(result: ExactOptimizerResult) {
  const objective = result.objective;
  expect(objective).not.toBeNull();
  return {
    scarceRawItemsPerMinute: objective!.scarceRawItemsPerMinute.toString(),
    weightedTargetOutput: objective!.weightedTargetOutput.toString(),
    physicalMachines: objective!.physicalMachines,
    groups: objective!.groups,
    internalSplitterMergerDevices: objective!.internalSplitterMergerDevices,
    routingSplitterDevices: objective!.routingSplitterDevices,
    totalSplitterMergerDevices: objective!.totalSplitterMergerDevices,
  };
}

describe("solveExactProductionRust", () => {
  it("matches the CP-SAT objective vector on the tiny model", { timeout: 60_000 }, async () => {
    const rust = await solveExactProductionRust(tinyInput());
    const cpSat = await solveExactProduction(tinyInput({ searchWorkers: 1 }));

    expect(rust.proofStatus).toBe("OPTIMAL");
    expect(cpSat.proofStatus).toBe("OPTIMAL");
    expect(objectiveStrings(rust)).toEqual(objectiveStrings(cpSat));
    expect(validateExactSolution(tinyInput(), rust)).toEqual({ valid: true, issues: [] });
  });

  it("reports all six phases through the progress callback", async () => {
    const progress: ExactSolveProgress[] = [];
    const result = await solveExactProductionRust(
      tinyInput({ onProgress: (update) => progress.push(update) }),
    );

    expect(result.proofStatus).toBe("OPTIMAL");
    const solving = progress.filter((update) => update.status === "solving");
    expect(solving.map(({ phase, label }) => ({ phase, label }))).toEqual([
      { phase: 1, label: "scarce raw use" },
      { phase: 2, label: "weighted target output" },
      { phase: 3, label: "physical machines" },
      { phase: 4, label: "groups" },
      { phase: 5, label: "total splitter and merger devices" },
      { phase: 6, label: "stable bank order" },
    ]);
    expect(progress.filter((update) => update.status === "complete")).toHaveLength(6);
  });

  it("proves an impossible exact target minimum infeasible", async () => {
    const result = await solveExactProductionRust(
      tinyInput({
        rawAvailability: { "iron-ore": 0 },
        targets: [{ item: "iron-plate", minimum: 1, weight: 1 }],
      }),
    );

    expect(result).toMatchObject({
      feasible: false,
      proofStatus: "INFEASIBLE",
      objective: null,
      selectedBanks: [],
    });
  });

  it("maximizes feasible raw use when full availability is impossible", async () => {
    const constrainedRecipe: Recipe = {
      id: "three-ore-plate",
      name: "Three Ore Plate",
      building: "constructor",
      durationSec: 60,
      inputs: [{ item: "iron-ore", amount: 3 }],
      outputs: [{ item: "iron-plate", amount: 1 }],
      tier: 0,
    };
    const constrainedItems = tinyItems.filter((item) => item.id !== "iron-rod");
    const input: ExactOptimizerInput = {
      graph: validateRecipeGraph(constrainedItems, [constrainedRecipe], ["iron-ore"]),
      rawAvailability: { "iron-ore": "5/2" },
      targets: [],
      beltCapacity: 10,
    };

    const result = await solveExactProductionRust(input);

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.objective?.scarceRawItemsPerMinute.toString()).toBe("2");
    expect(result.raws.find((raw) => raw.item === "iron-ore")?.leftover?.toString()).toBe("1/2");
  });

  it(
    "uses one four-machine 5/6 Quickwire bank for exactly 200/min",
    { timeout: 120_000 },
    async () => {
      const input: ExactOptimizerInput = {
        graph: validateRecipeGraph(items, recipes, scarceRawIds),
        rawAvailability: { "caterium-ore": 120 },
        targets: [{ item: "quickwire", minimum: 200, weight: 1 }],
        beltCapacity: 270,
      };

      const result = await solveExactProductionRust(input);
      const quickwireBanks = result.selectedBanks.filter((bank) => bank.recipeId === "quickwire");

      expect(result.proofStatus).toBe("OPTIMAL");
      expect(result.targets[0]?.rate.toString()).toBe("200");
      expect(quickwireBanks).toHaveLength(1);
      expect(quickwireBanks[0]).toMatchObject({
        machines: BigInt(4),
        multiplicity: BigInt(1),
      });
      expect(quickwireBanks[0]?.clock.toString()).toBe("5/6");
      expect(validateExactSolution(input, result)).toEqual({ valid: true, issues: [] });
    },
  );

  it("matches the CP-SAT engine end-to-end through the planner", { timeout: 120_000 }, async () => {
    const plannerInput = {
      rawAvailable: { "iron-ore": 30 },
      targets: [
        { item: "iron-plate" as const, minRate: 10, weight: 0 },
        { item: "iron-rod" as const, minRate: 10, weight: 0 },
      ],
      excess: [],
      maxBeltCapacity: 60,
    };

    const rust = await solveExact(plannerInput, { engine: "rust" });
    const cpSat = await solveExact(plannerInput, { engine: "cp-sat", searchWorkers: 1 });

    expect(rust.feasible).toBe(true);
    expect(rust.proofStatus).toBe("OPTIMAL");
    expect(rust.objective).toEqual(cpSat.objective);
    expect(rust.raws).toEqual(cpSat.raws);
    expect(rust.targets).toEqual(cpSat.targets);
  });
});
