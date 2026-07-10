import { describe, expect, it } from "vitest";
import { getRecipeForProduct } from "@/data/recipes";
import { isSplitterFriendlyCount, totalEffectiveMachines } from "./constraints";
import { buildOutputMerges, packDestinationOutputs } from "./network";
import { packMachineBanks, recipeBeltLoadPerMachine } from "./pack-banks";

describe("recipeBeltLoadPerMachine", () => {
  it("uses the hotter of input/output for iron plate", () => {
    const recipe = getRecipeForProduct("iron-plate")!;
    // 20 plates/min out, 30 ingots/min in @ 100%
    expect(recipeBeltLoadPerMachine(recipe, 1)).toBeCloseTo(30);
  });
});

describe("packMachineBanks", () => {
  it("keeps each bank splitter-friendly", () => {
    const recipe = getRecipeForProduct("iron-plate")!;
    const banks = packMachineBanks(recipe, 5.25, { maxBeltCapacity: 270 });
    expect(totalEffectiveMachines(banks)).toBeGreaterThanOrEqual(5.25 - 1e-9);
    for (const b of banks) {
      expect(b.machines === 1 || isSplitterFriendlyCount(b.machines)).toBe(true);
      expect(recipeBeltLoadPerMachine(recipe, b.clock) * b.machines).toBeLessThanOrEqual(
        270 + 1e-9,
      );
    }
  });

  it("splits across belts when load would exceed Mk2", () => {
    const recipe = getRecipeForProduct("iron-plate")!;
    // 7 machines @ 100% → 210 ingot/min in — over 120
    const banks = packMachineBanks(recipe, 7, { maxBeltCapacity: 120 });
    expect(banks.length).toBeGreaterThan(1);
    for (const b of banks) {
      expect(recipeBeltLoadPerMachine(recipe, b.clock) * b.machines).toBeLessThanOrEqual(
        120 + 1e-9,
      );
      expect(b.machines === 1 || isSplitterFriendlyCount(b.machines)).toBe(true);
    }
    expect(totalEffectiveMachines(banks)).toBeGreaterThanOrEqual(7 - 1e-9);
  });

  it("allows unfriendly stage totals as sum of friendly banks", () => {
    const recipe = getRecipeForProduct("iron-rod")!;
    const banks = packMachineBanks(recipe, 5, { maxBeltCapacity: 270 });
    for (const b of banks) {
      expect(b.machines === 1 || isSplitterFriendlyCount(b.machines)).toBe(true);
    }
    expect(totalEffectiveMachines(banks)).toBeGreaterThanOrEqual(5 - 1e-9);
  });

  it("prefers full-speed equal-split banks plus a singleton underclock remainder", () => {
    const recipe = getRecipeForProduct("iron-rod")!;
    // 10.5 effective: 9@100% (friendly) + 1@100% + 1@50% (direct feeds)
    const banks = packMachineBanks(recipe, 10.5, { maxBeltCapacity: 270 });
    expect(totalEffectiveMachines(banks)).toBeGreaterThanOrEqual(10.5 - 1e-9);
    for (const b of banks) {
      expect(b.machines === 1 || isSplitterFriendlyCount(b.machines)).toBe(true);
    }
    const underclockMulti = banks.filter((b) => b.machines > 1 && b.clock < 1 - 1e-9);
    expect(underclockMulti).toHaveLength(0);
    const singletons = banks.filter((b) => b.machines === 1);
    expect(singletons.some((b) => Math.abs(b.clock - 0.5) < 1e-9)).toBe(true);
    const fullFriendly = banks
      .filter((b) => b.machines > 1 && b.clock >= 1 - 1e-9)
      .reduce((s, b) => s + b.machines, 0);
    expect(fullFriendly).toBeGreaterThanOrEqual(9);
  });
});

describe("buildOutputMerges", () => {
  it("merges two bank belts under capacity", () => {
    const merges = buildOutputMerges([40, 40], 120);
    expect(merges).toHaveLength(1);
    expect(merges[0]!.beltCount).toBe(2);
    expect(merges[0]!.steps).toContain("2→1");
    expect(merges[0]!.rate).toBeCloseTo(80);
    expect(merges[0]!.sourceBankIndexes).toEqual([0, 1]);
  });

  it("preserves bank index order in sourceRates", () => {
    // Bank0=60, Bank1=80 — packing sorts by rate but labels stay Bank 1 then Bank 2
    const merges = buildOutputMerges([60, 80], 270);
    expect(merges).toHaveLength(1);
    expect(merges[0]!.sourceBankIndexes).toEqual([0, 1]);
    expect(merges[0]!.sourceRates).toEqual([60, 80]);
  });

  it("keeps separate lanes when sum exceeds max belt", () => {
    const merges = buildOutputMerges([100, 100], 120);
    expect(merges.length).toBeGreaterThanOrEqual(2);
    for (const m of merges) {
      expect(m.rate).toBeLessThanOrEqual(120 + 1e-9);
    }
  });
});

describe("packDestinationOutputs", () => {
  it("gives each destination its own belts (no shared production lane)", () => {
    const recipe = getRecipeForProduct("iron-rod")!;
    const { outputMerges } = packDestinationOutputs(
      recipe,
      [
        { to: { kind: "recipe", id: "screw" }, rate: 60 },
        { to: { kind: "recipe", id: "modular-frame" }, rate: 88 },
        { to: { kind: "recipe", id: "rotor" }, rate: 115 },
      ],
      270,
    );
    const productionLanes = outputMerges.filter((m) => m.to && m.to.kind !== "excess");
    const destKeys = productionLanes.map((m) => `${m.to!.kind}:${m.to!.id}`);
    // Each production lane is sole-destination
    expect(new Set(destKeys).size).toBeGreaterThanOrEqual(3);
    for (const lane of productionLanes) {
      expect(lane.consumerRate ?? 0).toBeGreaterThan(0);
      expect(lane.consumerRate!).toBeLessThanOrEqual(lane.rate + 1e-9);
    }
    const mf = productionLanes.find((m) => m.to?.id === "modular-frame");
    expect(mf).toBeDefined();
    // 88 demand → pack ≥ 90 (6×15) with overflow on that belt
    expect(mf!.rate).toBeGreaterThanOrEqual(88 - 1e-9);
  });
});
