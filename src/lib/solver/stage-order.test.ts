import { describe, expect, it } from "vitest";
import { solve } from "@/lib/solver/allocate";
import { buildStages } from "@/lib/solver/network";
import { buildChainGroups, orderStagesByDependency } from "@/lib/solver/stage-order";
import type { ProductionStage } from "@/lib/solver/types";

function stageIndex(stages: ProductionStage[], recipeId: string): number {
  return stages.findIndex((s) => s.recipeId === recipeId);
}

describe("orderStagesByDependency", () => {
  it("orders iron ingot before iron plate before motor", () => {
    const plateResult = solve({
      rawAvailable: { "iron-ore": 480 },
      targets: [{ item: "iron-plate", minRate: 120, weight: 100 }],
      excess: [],
    });
    const plateStages = plateResult.network.stages;
    expect(stageIndex(plateStages, "iron-ingot")).toBeLessThan(
      stageIndex(plateStages, "iron-plate"),
    );

    const motorResult = solve({
      rawAvailable: { "iron-ore": 480, "copper-ore": 480, limestone: 120 },
      targets: [{ item: "motor", minRate: 2, weight: 100 }],
      excess: [],
    });
    const motorStages = motorResult.network.stages;
    expect(stageIndex(motorStages, "iron-ingot")).toBeLessThan(stageIndex(motorStages, "motor"));
  });

  it("places raw-only stages before downstream consumers", () => {
    const stages = buildStages(
      new Map([
        ["motor", 1],
        ["iron-plate", 10],
        ["iron-ingot", 20],
      ]),
    );
    const ordered = orderStagesByDependency(stages);
    expect(stageIndex(ordered, "iron-ingot")).toBeLessThan(stageIndex(ordered, "iron-plate"));
    expect(stageIndex(ordered, "iron-plate")).toBeLessThan(stageIndex(ordered, "motor"));
  });
});

describe("buildChainGroups", () => {
  it("produces separate chains for disconnected target trees", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 120,
        "copper-ore": 120,
        limestone: 120,
        coal: 120,
      },
      targets: [
        { item: "motor", minRate: 1, weight: 50 },
        { item: "concrete", minRate: 30, weight: 50 },
      ],
      excess: [],
    });

    const { chains } = result.network;
    expect(chains.length).toBeGreaterThanOrEqual(2);

    const motorChain = chains.find((c) => c.stageIds.includes("motor"));
    const concreteChain = chains.find((c) => c.stageIds.includes("concrete"));

    expect(motorChain).toBeDefined();
    expect(concreteChain).toBeDefined();
    expect(motorChain!.stageIds).not.toEqual(concreteChain!.stageIds);
  });

  it("labels chains from target items when available", () => {
    const stages = buildStages(
      new Map([
        ["iron-ingot", 30],
        ["concrete", 10],
      ]),
    );
    const chains = buildChainGroups(stages, ["concrete"]);
    const concreteChain = chains.find((c) => c.stageIds.includes("concrete"));
    expect(concreteChain?.label).toContain("Concrete");
  });

  it("preserves dependency order within each chain", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 480, "copper-ore": 480, limestone: 120 },
      targets: [{ item: "motor", minRate: 2, weight: 100 }],
      excess: [],
    });

    for (const chain of result.network.chains) {
      const positions = new Map(chain.stageIds.map((id, i) => [id, i]));
      for (const stageId of chain.stageIds) {
        const stage = result.network.stages.find((s) => s.recipeId === stageId);
        expect(stage).toBeDefined();
      }
      const ingot = positions.get("iron-ingot");
      const plate = positions.get("iron-plate");
      if (ingot !== undefined && plate !== undefined) {
        expect(ingot).toBeLessThan(plate);
      }
    }
  });
});
