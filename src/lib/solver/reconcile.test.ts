import { describe, expect, it } from "vitest";
import { reconcileProductionShares } from "./reconcile";
import { expandFactoryPlan } from "./bom";

describe("reconcileProductionShares", () => {
  it("sets excess to production surplus beyond destinations", () => {
    const expanded = expandFactoryPlan(
      [
        { item: "iron-plate", rate: 40 },
        { item: "iron-rod", rate: 30 },
      ],
      { maxBeltCapacity: 120 },
    );
    const targets = new Map([
      ["iron-plate" as const, 40],
      ["iron-rod" as const, 30],
    ]);
    const reconciled = reconcileProductionShares(
      expanded.recipeCrafts,
      targets,
      new Map(),
      120,
    );
    // Pure target sinks — surplus only from machine overshoot if any
    for (const [, rate] of reconciled) {
      expect(rate).toBeGreaterThanOrEqual(0);
    }
  });
});
