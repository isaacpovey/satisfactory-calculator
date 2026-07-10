import { describe, expect, it } from "vitest";
import {
  groupInputRates,
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
    expect(stages.map((s) => s.label)).toEqual([
      "Belt in",
      "After 1/2 split",
      "After 1/3 split",
    ]);
  });

  it("returns single stage for merge-only", () => {
    const plan = inputSplitForGroup(1);
    expect(splitterInputStageRates(30, plan)).toEqual([
      { label: "Belt in", rate: 30 },
    ]);
  });
});
