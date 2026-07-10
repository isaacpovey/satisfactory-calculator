import { describe, expect, it } from "vitest";
import {
  comparePlanScore,
  MAX_EXCESS_PROBE,
  MAX_SOAK_ITERATIONS,
  MAX_TARGET_ITERATIONS,
} from "@/lib/solver/optimize-sinks";

describe("optimize-sinks scoring", () => {
  it("ranks useful ore ahead of weight bonus", () => {
    expect(
      comparePlanScore(
        { usefulOre: 200, weightBonus: 0 },
        { usefulOre: 199, weightBonus: 10_000 },
      ),
    ).toBe(1);
  });

  it("uses weight bonus only as a tie-breaker", () => {
    expect(
      comparePlanScore(
        { usefulOre: 100, weightBonus: 50 },
        { usefulOre: 100, weightBonus: 40 },
      ),
    ).toBe(1);
    expect(
      comparePlanScore(
        { usefulOre: 100, weightBonus: 40 },
        { usefulOre: 100, weightBonus: 50 },
      ),
    ).toBe(-1);
  });
});

describe("optimize-sinks bounds", () => {
  it("exports bounded iteration budgets for browser execution", () => {
    expect(MAX_TARGET_ITERATIONS).toBeLessThanOrEqual(64);
    expect(MAX_SOAK_ITERATIONS).toBeLessThanOrEqual(120);
    expect(MAX_EXCESS_PROBE).toBeLessThanOrEqual(12);
  });
});
