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
  it("represents fractional machines with friendly counts and clocks", () => {
    const c = representMachines(1.1);
    expect(c.effectiveMachines).toBeGreaterThanOrEqual(1.1);
    expect([1, 0.75, 0.5, 0.25]).toContain(c.clock);
    expect([1, 2, 3, 4, 6, 8, 9, 12]).toContain(c.machines);
    expect(c.machines * c.clock).toBeCloseTo(c.effectiveMachines);
  });

  it("quantizes iron plate rates to allowed machine groups", () => {
    expect(quantizeItemRate("iron-plate", 1)).toBeCloseTo(5);
    expect(quantizeItemRate("iron-plate", 20)).toBeCloseTo(20);
    // 21/min needs >1 machine; next friendly is 2 @ 75% = 30/min
    expect(quantizeItemRate("iron-plate", 21)).toBeCloseTo(30);
  });

  it("accepts splitter-friendly ratios including 1/12", () => {
    expect(isSplitterFriendlyRatio(30, 60)).toBe(true);
    expect(isSplitterFriendlyRatio(20, 60)).toBe(true);
    expect(isSplitterFriendlyRatio(5, 60)).toBe(true);
    expect(isSplitterFriendlyRatio(7, 60)).toBe(false);
  });

  it("snaps shares to splitter-friendly amounts", () => {
    for (const [desired, whole] of [
      [22, 60],
      [31, 60],
      [6, 60],
    ] as const) {
      const share = snapSplitterShare(desired, whole);
      expect(share).toBeLessThanOrEqual(desired + 1e-9);
      expect(isSplitterFriendlyRatio(share, whole)).toBe(true);
    }
    // 1/12 of 60 must be reachable
    expect(snapSplitterShare(5, 60)).toBeCloseTo(5);
    expect(snapSplitterShare(30, 60)).toBeCloseTo(30);
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

  it("uses only allowed clocks and splitter-friendly machine counts", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-plate", minRate: 10, weight: 100 }],
      excess: [],
    });
    for (const recipe of result.recipes) {
      expect([1, 0.75, 0.5, 0.25]).toContain(recipe.clock);
      expect(recipe.machines).toBeGreaterThan(0);
      expect(Number.isInteger(recipe.machines)).toBe(true);
      // 2^a * 3^b only (no 5, 7, 10, 11, …)
      let n = recipe.machines;
      while (n % 2 === 0) n /= 2;
      while (n % 3 === 0) n /= 3;
      expect(n).toBe(1);
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
    expect(iron.utilization).toBeGreaterThan(0.5);
  });

  it("grows limestone-only targets when coal is already full", () => {
    // Coal enough for steel mins after quantization; limestone leftover for Concrete.
    const result = solve({
      rawAvailable: {
        "iron-ore": 400,
        "copper-ore": 100,
        limestone: 300,
        coal: 120,
      },
      targets: [
        { item: "steel-beam", minRate: 10, weight: 50 },
        { item: "concrete", minRate: 5, weight: 50 },
      ],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const concrete = result.targets.find((t) => t.item === "concrete")!;
    expect(concrete.extraRate).toBeGreaterThan(0);
    const limestone = result.raws.find((r) => r.item === "limestone")!;
    expect(limestone.utilization).toBeGreaterThan(0.5);
  });

  it("soaks leftover iron when coal is full via non-steel parts", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 500,
        limestone: 200,
        coal: 120,
      },
      targets: [
        { item: "steel-pipe", minRate: 10, weight: 50 },
        { item: "concrete", minRate: 5, weight: 50 },
        { item: "iron-plate", minRate: 10, weight: 50 },
      ],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const iron = result.raws.find((r) => r.item === "iron-ore")!;
    const limestone = result.raws.find((r) => r.item === "limestone")!;
    expect(iron.utilization).toBeGreaterThan(0.85);
    expect(limestone.utilization).toBeGreaterThan(0.85);
  });

  it("user factory: limestone grows when coal is exhausted", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 1860,
        "copper-ore": 540,
        limestone: 420,
        coal: 360,
        "caterium-ore": 120,
        "raw-quartz": 0,
        sulfur: 0,
      },
      targets: [
        { item: "versatile-framework", minRate: 5, weight: 50 },
        { item: "automated-wiring", minRate: 5, weight: 50 },
        { item: "smart-plating", minRate: 5, weight: 50 },
        { item: "encased-industrial-beam", minRate: 5, weight: 50 },
        { item: "ai-limiter", minRate: 5, weight: 50 },
        { item: "concrete", minRate: 5, weight: 50 },
        { item: "reinforced-iron-plate", minRate: 5, weight: 50 },
        { item: "modular-frame", minRate: 5, weight: 50 },
        { item: "steel-pipe", minRate: 5, weight: 50 },
        { item: "motor", minRate: 5, weight: 50 },
      ],
      excess: [
        { item: "stator", rate: 5 },
        { item: "copper-sheet", rate: 5 },
        { item: "iron-plate", rate: 5 },
        { item: "iron-rod", rate: 5 },
        { item: "quickwire", rate: 5 },
        { item: "steel-beam", rate: 5 },
      ],
    });
    expect(result.feasible).toBe(true);
    const limestone = result.raws.find((r) => r.item === "limestone")!;
    const concrete = result.targets.find((t) => t.item === "concrete")!;
    const eib = result.targets.find((t) => t.item === "encased-industrial-beam")!;
    expect(concrete.extraRate + eib.extraRate).toBeGreaterThan(0);
    expect(limestone.utilization).toBeGreaterThan(0.7);
    expect(result.overallUtilization).toBeGreaterThan(0.92);
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
