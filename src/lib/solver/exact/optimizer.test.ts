import { describe, expect, it } from "vitest";
import { items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import type { Item, Recipe } from "@/data/types";
import {
  equalLaneTreeDevices,
  generateMachineBankPatterns,
  type ExactMachineBankPattern,
} from "./bank-patterns";
import { computeRecipeBounds } from "./bounds";
import { solveExactProduction } from "./optimizer";
import type { ExactObjectiveVector, ExactOptimizerInput } from "./optimizer-types";
import { Rational } from "./rational";
import { validateRecipeGraph } from "./recipe-graph";
import { validateExactSolution } from "./validation";

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

interface BrutePattern {
  readonly pattern: ExactMachineBankPattern;
  readonly upperBound: number;
  readonly input: Rational;
  readonly weightedOutput: Rational;
}

function compareObjectives(left: ExactObjectiveVector, right: ExactObjectiveVector): number {
  return (
    left.scarceRawItemsPerMinute.compare(right.scarceRawItemsPerMinute) ||
    left.weightedTargetOutput.compare(right.weightedTargetOutput) ||
    (left.physicalMachines < right.physicalMachines
      ? 1
      : left.physicalMachines > right.physicalMachines
        ? -1
        : 0) ||
    (left.groups < right.groups ? 1 : left.groups > right.groups ? -1 : 0) ||
    (left.totalSplitterMergerDevices < right.totalSplitterMergerDevices
      ? 1
      : left.totalSplitterMergerDevices > right.totalSplitterMergerDevices
        ? -1
        : 0)
  );
}

function bruteForceTiny(input: ExactOptimizerInput): ExactObjectiveVector {
  const bounds = computeRecipeBounds(input.graph, input.rawAvailability);
  const weights = new Map(
    input.targets.map((target) => [target.item, Rational.from(target.weight)]),
  );
  const patterns: BrutePattern[] = [];
  for (const recipe of input.graph.topologicalRecipes) {
    const bound = bounds.get(recipe.id)!;
    for (const pattern of generateMachineBankPatterns(bound, input.beltCapacity)) {
      const upperBound = Number(
        bound.maxEffectiveMachines.divide(pattern.effectiveMachines).floor(),
      );
      if (upperBound === 0) continue;
      const inputRate = pattern.inputRates[0]?.rate ?? Rational.from(0);
      const output = pattern.outputRates[0]!;
      patterns.push({
        pattern,
        upperBound,
        input: inputRate,
        weightedOutput: output.rate.multiply(weights.get(output.item) ?? 0),
      });
    }
  }

  let best: ExactObjectiveVector | null = null;
  const visit = (
    index: number,
    raw: Rational,
    weighted: Rational,
    machines: bigint,
    groups: bigint,
    devices: bigint,
  ) => {
    if (raw.compare(input.rawAvailability["iron-ore"] ?? 0) > 0) return;
    if (index === patterns.length) {
      const candidate: ExactObjectiveVector = {
        scarceRawItemsPerMinute: raw,
        weightedTargetOutput: weighted,
        physicalMachines: machines,
        groups,
        internalSplitterMergerDevices: devices,
        routingSplitterDevices: BigInt(0),
        totalSplitterMergerDevices: devices,
      };
      if (best === null || compareObjectives(candidate, best) > 0) best = candidate;
      return;
    }
    const entry = patterns[index]!;
    const perBankDevices = equalLaneTreeDevices(entry.pattern.machines) * BigInt(2);
    for (let count = 0; count <= entry.upperBound; count++) {
      const multiplicity = BigInt(count);
      visit(
        index + 1,
        raw.add(entry.input.multiply(multiplicity)),
        weighted.add(entry.weightedOutput.multiply(multiplicity)),
        machines + entry.pattern.machines * multiplicity,
        groups + multiplicity,
        devices + perBankDevices * multiplicity,
      );
    }
  };
  visit(0, Rational.from(0), Rational.from(0), BigInt(0), BigInt(0), BigInt(0));
  return best!;
}

describe("solveExactProduction", () => {
  it("matches brute force across the complete objective hierarchy", async () => {
    const input = tinyInput();
    const result = await solveExactProduction(input);
    const brute = bruteForceTiny(input);

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.objective).not.toBeNull();
    expect(result.objective?.scarceRawItemsPerMinute.toString()).toBe(
      brute.scarceRawItemsPerMinute.toString(),
    );
    expect(result.objective?.weightedTargetOutput.toString()).toBe(
      brute.weightedTargetOutput.toString(),
    );
    expect(result.objective?.physicalMachines).toBe(brute.physicalMachines);
    expect(result.objective?.groups).toBe(brute.groups);
    expect(result.objective?.internalSplitterMergerDevices).toBe(
      brute.internalSplitterMergerDevices,
    );
    expect(result.objective?.routingSplitterDevices).toBe(brute.routingSplitterDevices);
    expect(result.objective?.totalSplitterMergerDevices).toBe(brute.totalSplitterMergerDevices);
    expect(validateExactSolution(input, result)).toEqual({ valid: true, issues: [] });

    const tampered = {
      ...result,
      objective: { ...result.objective!, groups: result.objective!.groups + BigInt(1) },
    };
    expect(validateExactSolution(input, tampered)).toMatchObject({
      valid: false,
      issues: ["Reported group objective is incorrect"],
    });

    const tamperedRouting = {
      ...result,
      objective: {
        ...result.objective!,
        routingSplitterDevices: result.objective!.routingSplitterDevices + BigInt(1),
      },
    };
    expect(validateExactSolution(input, tamperedRouting)).toMatchObject({
      valid: false,
      issues: ["Reported routing-device objective is incorrect"],
    });
  });

  it("proves an impossible exact target minimum infeasible", async () => {
    const input = tinyInput({
      rawAvailability: { "iron-ore": 0 },
      targets: [{ item: "iron-plate", minimum: 1, weight: 1 }],
    });

    const result = await solveExactProduction(input);

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

    const result = await solveExactProduction(input);

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.objective?.scarceRawItemsPerMinute.toString()).toBe("2");
    expect(result.raws.find((raw) => raw.item === "iron-ore")?.leftover?.toString()).toBe("1/2");
  });

  it("uses one four-machine 5/6 Quickwire bank for exactly 200/min", async () => {
    const input: ExactOptimizerInput = {
      graph: validateRecipeGraph(items, recipes, scarceRawIds),
      rawAvailability: { "caterium-ore": 120 },
      targets: [{ item: "quickwire", minimum: 200, weight: 1 }],
      beltCapacity: 270,
    };

    const result = await solveExactProduction(input);
    const quickwireBanks = result.selectedBanks.filter((bank) => bank.recipeId === "quickwire");

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.targets[0]?.rate.toString()).toBe("200");
    expect(quickwireBanks).toHaveLength(1);
    expect(quickwireBanks[0]).toMatchObject({
      machines: BigInt(4),
      multiplicity: BigInt(1),
    });
    expect(quickwireBanks[0]?.clock.toString()).toBe("5/6");
  });

  it("breaks equal machine and group ties with fewer active routing branches", async () => {
    const routingItems: readonly Item[] = [
      { id: "iron-ore", name: "Iron Ore", isRaw: true, tier: 0 },
      { id: "iron-plate", name: "Intermediate", isRaw: false, tier: 0 },
      { id: "iron-rod", name: "Product A", isRaw: false, tier: 0 },
      { id: "wire", name: "Product B", isRaw: false, tier: 0 },
    ];
    const routingRecipes: readonly Recipe[] = [
      {
        id: "routing-source",
        name: "Routing Source",
        building: "constructor",
        durationSec: 60,
        inputs: [{ item: "iron-ore", amount: 2 }],
        outputs: [{ item: "iron-plate", amount: 2 }],
        tier: 0,
      },
      {
        id: "routing-consumer-a",
        name: "Routing Consumer A",
        building: "constructor",
        durationSec: 60,
        inputs: [{ item: "iron-plate", amount: 1 }],
        outputs: [{ item: "iron-rod", amount: 2 }],
        tier: 0,
      },
      {
        id: "routing-consumer-b",
        name: "Routing Consumer B",
        building: "constructor",
        durationSec: 60,
        inputs: [{ item: "iron-plate", amount: 1 }],
        outputs: [{ item: "wire", amount: 2 }],
        tier: 0,
      },
    ];
    const input: ExactOptimizerInput = {
      graph: validateRecipeGraph(routingItems, routingRecipes, ["iron-ore"]),
      rawAvailability: { "iron-ore": 2 },
      targets: [
        { item: "iron-rod", minimum: 0, weight: 1 },
        { item: "wire", minimum: 0, weight: 1 },
      ],
      beltCapacity: 2,
    };

    const result = await solveExactProduction(input);
    const consumerBanks = result.selectedBanks.filter((bank) =>
      bank.recipeId.startsWith("routing-consumer"),
    );

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.objective).toMatchObject({
      physicalMachines: BigInt(3),
      groups: BigInt(3),
      internalSplitterMergerDevices: BigInt(0),
      routingSplitterDevices: BigInt(0),
      totalSplitterMergerDevices: BigInt(0),
    });
    expect(consumerBanks).toHaveLength(1);
    expect(consumerBanks[0]?.multiplicity).toBe(BigInt(2));
    expect(result.targets.filter((target) => target.rate.compare(0) > 0)).toHaveLength(1);
    expect(validateExactSolution(input, result)).toEqual({ valid: true, issues: [] });
  });

  it("counts positive consumer, target, and excess destinations exactly", async () => {
    const routingItems: readonly Item[] = [
      { id: "iron-ore", name: "Iron Ore", isRaw: true, tier: 0 },
      { id: "iron-plate", name: "Intermediate", isRaw: false, tier: 0 },
      { id: "iron-rod", name: "Product", isRaw: false, tier: 0 },
    ];
    const routingRecipes: readonly Recipe[] = [
      {
        id: "activity-source",
        name: "Activity Source",
        building: "constructor",
        durationSec: 60,
        inputs: [{ item: "iron-ore", amount: 3 }],
        outputs: [{ item: "iron-plate", amount: 3 }],
        tier: 0,
      },
      {
        id: "activity-consumer",
        name: "Activity Consumer",
        building: "constructor",
        durationSec: 60,
        inputs: [{ item: "iron-plate", amount: 1 }],
        outputs: [{ item: "iron-rod", amount: 1 }],
        tier: 0,
      },
    ];
    const input: ExactOptimizerInput = {
      graph: validateRecipeGraph(routingItems, routingRecipes, ["iron-ore"]),
      rawAvailability: { "iron-ore": 3 },
      targets: [
        { item: "iron-plate", minimum: 1, weight: 0 },
        { item: "iron-rod", minimum: 1, weight: 0 },
      ],
      excess: [{ item: "iron-plate", floor: 1 }],
      beltCapacity: 3,
    };

    const result = await solveExactProduction(input);

    expect(result.proofStatus).toBe("OPTIMAL");
    expect(result.targets.find((target) => target.item === "iron-plate")?.rate.toString()).toBe(
      "1",
    );
    expect(result.excess.find((entry) => entry.item === "iron-plate")?.rate.toString()).toBe("1");
    expect(result.objective).toMatchObject({
      routingSplitterDevices: BigInt(1),
      totalSplitterMergerDevices: BigInt(1),
    });
    expect(validateExactSolution(input, result)).toEqual({ valid: true, issues: [] });
  });
});
