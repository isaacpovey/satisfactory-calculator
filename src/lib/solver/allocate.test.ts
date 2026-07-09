import { describe, expect, it } from "vitest";
import { rawCoefficients } from "@/lib/solver/bom";
import { solve } from "@/lib/solver/allocate";
import {
  isSplitterFriendlyRatio,
  quantizeItemRate,
  representMachines,
  snapSplitterShare,
} from "@/lib/solver/constraints";

describe("rawCoefficients", () => {
  it("maps iron plate to iron ore 1.5:1", () => {
    expect(rawCoefficients("iron-plate")["iron-ore"]).toBeCloseTo(1.5);
  });

  it("maps iron rod to iron ore 1:1", () => {
    expect(rawCoefficients("iron-rod")["iron-ore"]).toBeCloseTo(1);
  });

  it("maps screws to iron ore 0.25:1", () => {
    expect(rawCoefficients("screw")["iron-ore"]).toBeCloseTo(0.25);
  });

  it("maps steel beam to iron ore and coal", () => {
    const c = rawCoefficients("steel-beam");
    expect(c["iron-ore"]).toBeCloseTo(4);
    expect(c["coal"]).toBeCloseTo(4);
  });

  it("maps concrete to limestone 3:1", () => {
    expect(rawCoefficients("concrete")["limestone"]).toBeCloseTo(3);
  });

  it("maps quickwire to caterium ore 0.6:1", () => {
    expect(rawCoefficients("quickwire")["caterium-ore"]).toBeCloseTo(0.6);
  });
});

describe("constraints", () => {
  it("represents fractional machines with allowed clocks", () => {
    const c = representMachines(1.1);
    expect(c.effectiveMachines).toBeCloseTo(1.25);
    expect([1, 0.75, 0.5, 0.25]).toContain(c.clock);
    expect(c.machines * c.clock).toBeCloseTo(c.effectiveMachines);
  });

  it("quantizes iron plate rates to 5/min steps (25% of 20)", () => {
    expect(quantizeItemRate("iron-plate", 1)).toBeCloseTo(5);
    expect(quantizeItemRate("iron-plate", 20)).toBeCloseTo(20);
    expect(quantizeItemRate("iron-plate", 21)).toBeCloseTo(25);
  });

  it("accepts splitter-friendly ratios", () => {
    expect(isSplitterFriendlyRatio(30, 60)).toBe(true); // 1/2
    expect(isSplitterFriendlyRatio(20, 60)).toBe(true); // 1/3
    expect(isSplitterFriendlyRatio(15, 60)).toBe(true); // 1/4
    expect(isSplitterFriendlyRatio(10, 60)).toBe(true); // 1/6
    expect(isSplitterFriendlyRatio(7, 60)).toBe(false);
  });

  it("snaps shares to splitter-friendly amounts", () => {
    expect(snapSplitterShare(22, 60)).toBeCloseTo(20); // 1/3
    expect(snapSplitterShare(31, 60)).toBeCloseTo(30); // 1/2
  });
});

describe("solve", () => {
  it("reports infeasible when minima exceed ore", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 10 },
      targets: [{ item: "iron-rod", minRate: 20, weight: 50 }],
      excess: [],
    });
    expect(result.feasible).toBe(false);
    expect(
      result.raws.find((r) => r.item === "iron-ore")?.shortfall,
    ).toBeGreaterThan(0);
  });

  it("quantizes minima upward to whole/easy clocks", () => {
    // iron rod full = 15/min; min 10 → 11.25 (0.75 clock) or 15
    const result = solve({
      rawAvailable: { "iron-ore": 200 },
      targets: [{ item: "iron-rod", minRate: 10, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const rod = result.targets.find((t) => t.item === "iron-rod")!;
    expect(rod.plannedMinRate).toBeGreaterThanOrEqual(10);
    expect(rod.plannedMinRate % 3.75).toBeCloseTo(0); // 15 * 0.25
  });

  it("uses only allowed clocks on recipes", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-plate", minRate: 10, weight: 100 }],
      excess: [],
    });
    for (const recipe of result.recipes) {
      expect([1, 0.75, 0.5, 0.25]).toContain(recipe.clock);
      expect(recipe.machines).toBeGreaterThan(0);
      expect(Number.isInteger(recipe.machines)).toBe(true);
    }
  });

  it("auto-fills excess intermediaries toward high utilization", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-rod", minRate: 15, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    expect(result.excess.length).toBeGreaterThan(0);
    const iron = result.raws.find((r) => r.item === "iron-ore")!;
    // Should soak most leftover after the 15 rod min
    expect(iron.utilization).toBeGreaterThan(0.85);
  });

  it("prefers complex excess over base ingots when soaking", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 300,
        "copper-ore": 120,
        coal: 120,
      },
      targets: [{ item: "motor", minRate: 5, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const withAuto = result.excess.filter((e) => e.rate > 0);
    expect(withAuto.length).toBeGreaterThan(0);
    // Should not only dump into iron ingots if deeper parts can take ore
    const deepest = withAuto[0]!;
    // Most complex soakable part should rank above base ingots
    expect(deepest.item).not.toBe("iron-ingot");
    expect(deepest.item).not.toBe("copper-ingot");
  });

  it("respects user excess floors and may raise them", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-plate", minRate: 20, weight: 0 }],
      excess: [{ item: "iron-rod", rate: 15 }],
    });
    expect(result.feasible).toBe(true);
    const rod = result.excess.find((e) => e.item === "iron-rod")!;
    expect(rod.rate).toBeGreaterThanOrEqual(15);
  });

  it("lists chain intermediaries in excess results", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 480,
        "copper-ore": 120,
        coal: 120,
      },
      targets: [{ item: "motor", minRate: 5, weight: 50 }],
      excess: [],
    });
    const ids = result.excess.map((e) => e.item);
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
    expect(ids).toContain("iron-ingot");
  });

  it("plans crystal oscillator with manufacturer recipe", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 300,
        "copper-ore": 60,
        "raw-quartz": 200,
      },
      targets: [{ item: "crystal-oscillator", minRate: 1, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const osc = result.recipes.find((r) => r.recipeId === "crystal-oscillator")!;
    expect(osc.building).toBe("Manufacturer");
    expect([1, 0.75, 0.5, 0.25]).toContain(osc.clock);
  });
});
