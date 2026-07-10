import { describe, expect, it } from "vitest";
import { getRecipeForProduct } from "@/data/recipes";
import { inputSplitForGroup } from "./network";
import { buildStageInputBelts, packInputBeltsForItem, packSharedMachineSlots } from "./input-belts";
import type { MachineGroupPlan } from "./types";

function bank(machines: number, clock: number, outputPerMinute: number): MachineGroupPlan {
  return {
    machines,
    clock,
    effectiveMachines: machines * clock,
    inputSplit: inputSplitForGroup(machines),
    outputPerMinute,
  };
}

describe("packInputBeltsForItem", () => {
  it("gives each under-capacity bank its own limestone belt", () => {
    const belts = packInputBeltsForItem(
      "limestone",
      [
        { bankIndex: 0, rate: 180, machines: 4, perMachine: 45 },
        { bankIndex: 1, rate: 240, machines: 8, perMachine: 30 },
      ],
      270,
    );
    expect(belts).toHaveLength(2);
    expect(belts.every((b) => b.rate <= 270)).toBe(true);
    expect(belts[0]!.rate + belts[1]!.rate).toBeCloseTo(420);
    expect(belts[0]!.feeds).toEqual([{ bankIndex: 0, rate: 180, machines: 4 }]);
    expect(belts[1]!.feeds).toEqual([{ bankIndex: 1, rate: 240, machines: 8 }]);
  });

  it("peels oversized banks into per-machine slots under Mk2", () => {
    const belts = packInputBeltsForItem(
      "limestone",
      [{ bankIndex: 0, rate: 180, machines: 4, perMachine: 45 }],
      120,
    );
    expect(belts.length).toBeGreaterThan(1);
    for (const b of belts) {
      expect(b.rate).toBeLessThanOrEqual(120 + 1e-9);
    }
    expect(belts.reduce((s, b) => s + b.rate, 0)).toBeCloseTo(180);
  });
});

describe("packSharedMachineSlots", () => {
  it("can put one machine from each bank on a shared belt", () => {
    const belts = packSharedMachineSlots(
      "limestone",
      [
        { bankIndex: 0, rate: 45 },
        { bankIndex: 1, rate: 45 },
      ],
      120,
    );
    expect(belts).toHaveLength(1);
    expect(belts[0]!.rate).toBeCloseTo(90);
    expect(belts[0]!.feeds).toHaveLength(2);
    expect(belts[0]!.feeds.map((f) => f.bankIndex)).toEqual([0, 1]);
    expect(belts[0]!.split.ratio).toEqual({ num: 1, den: 2 });
  });
});

describe("buildStageInputBelts", () => {
  it("builds limestone belts for concrete banks", () => {
    const recipe = getRecipeForProduct("concrete")!;
    // 4@100% → 60 concrete → 180 limestone; 8@2/3 → 80 concrete → 240 limestone
    const groups = [bank(4, 1, 60), bank(8, 2 / 3, 80)];
    const belts = buildStageInputBelts(recipe, groups, 270);
    expect(belts.length).toBe(2);
    expect(belts.every((b) => b.item === "limestone")).toBe(true);
    expect(belts.reduce((s, b) => s + b.rate, 0)).toBeCloseTo(420);
  });
});
