import { describe, expect, it } from "vitest";
import {
  groupInputRates,
  mergerOutputStageRates,
  splitterInputStageRates,
} from "@/lib/solver/group-inputs";
import { inputSplitForGroup } from "@/lib/solver/network";

describe("groupInputRates", () => {
  it("computes total and per-machine rates for iron plate", () => {
    const group = {
      machines: 6,
      clock: 1,
      effectiveMachines: 6,
      inputSplit: inputSplitForGroup(6),
      outputPerMinute: 120,
    };
    const rates = groupInputRates("iron-plate", group);
    const ingot = rates.find((r) => r.item === "iron-ingot");
    expect(ingot).toBeDefined();
    // 3 ingots per craft @ 10 crafts/min per machine × 6 machines
    expect(ingot!.totalRate).toBeCloseTo(180);
    expect(ingot!.perMachineRate).toBeCloseTo(30);
  });

  it("scales per-machine rate with underclock", () => {
    const group = {
      machines: 2,
      clock: 0.5,
      effectiveMachines: 1,
      inputSplit: inputSplitForGroup(2),
      outputPerMinute: 20,
    };
    const rates = groupInputRates("iron-plate", group);
    const ingot = rates.find((r) => r.item === "iron-ingot");
    expect(ingot!.totalRate).toBeCloseTo(30);
    expect(ingot!.perMachineRate).toBeCloseTo(15);
  });
});

describe("splitterInputStageRates", () => {
  it("steps down rates for a 6-machine manifold", () => {
    const plan = inputSplitForGroup(6);
    const stages = splitterInputStageRates(180, plan);
    expect(stages.map((s) => s.rate)).toEqual([180, 90, 30]);
    expect(stages.map((s) => s.lanes)).toEqual([1, 2, 6]);
    expect(stages.map((s) => s.label)).toEqual(["Belt in", "After 1/2", "After 1/3"]);
  });

  it("returns single stage for merge-only", () => {
    const plan = inputSplitForGroup(1);
    expect(splitterInputStageRates(30, plan)).toEqual([{ label: "Belt in", rate: 30, lanes: 1 }]);
  });
});

describe("mergerOutputStageRates", () => {
  it("shows per-belt rates through nested merges", () => {
    const stages = mergerOutputStageRates({
      beltCount: 4,
      steps: ["2→1", "2→1"],
      rate: 80,
      mergeOnly: false,
      sourceRates: [20, 20, 20, 20],
      sourceBankIndexes: [0, 1, 2, 3],
    });
    expect(stages[0]!.beltsIn).toBe(4);
    expect(stages[0]!.rate).toBeCloseTo(20);
    expect(stages[stages.length - 1]!.beltsIn).toBe(1);
    expect(stages[stages.length - 1]!.rate).toBeCloseTo(80);
  });
});
