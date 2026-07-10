import { describe, expect, it } from "vitest";
import { rawCoefficients } from "@/lib/solver/bom";
import { solve } from "@/lib/solver/allocate";
import {
  isSplitterFriendlyCount,
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
    const allowed = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25];
    expect(allowed.some((x) => Math.abs(x - c.clock) < 1e-9)).toBe(true);
    expect([1, 2, 3, 4, 6, 8, 9, 12]).toContain(c.machines);
    expect(c.machines * c.clock).toBeCloseTo(c.effectiveMachines);
  });

  it("quantizes iron plate rates to allowed machine groups", () => {
    expect(quantizeItemRate("iron-plate", 1)).toBeCloseTo(5);
    expect(quantizeItemRate("iron-plate", 20)).toBeCloseTo(20);
    // 21/min = 1.05 machines → multi-group 1@75% + 1@33.33% = 21.67/min
    expect(quantizeItemRate("iron-plate", 21)).toBeCloseTo(20 * (0.75 + 1 / 3));
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
    // iron rod full = 15/min; min 10 → next allowed clock config
    const result = solve({
      rawAvailable: { "iron-ore": 200 },
      targets: [{ item: "iron-rod", minRate: 10, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const rod = result.targets.find((t) => t.item === "iron-rod")!;
    expect(rod.plannedMinRate).toBeGreaterThanOrEqual(10);
    // 1 @ 75% = 11.25, or finer thirds
    expect(rod.plannedMinRate).toBeGreaterThanOrEqual(10);
  });

  it("uses only allowed clocks and integer machine counts", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-plate", minRate: 10, weight: 100 }],
      excess: [],
    });
    const allowed = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25];
    for (const recipe of result.recipes) {
      expect(allowed.some((c) => Math.abs(c - recipe.clock) < 1e-9)).toBe(true);
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
    expect(limestone.utilization).toBeGreaterThan(0.75);
  });

  it(
    "user factory: soaks limestone and caterium leftovers",
    () => {
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
        { item: "motor", minRate: 2, weight: 60 },
        { item: "encased-industrial-beam", minRate: 2, weight: 40 },
        { item: "versatile-framework", minRate: 2, weight: 50 },
        { item: "automated-wiring", minRate: 2, weight: 50 },
      ],
      excess: [
        { item: "ai-limiter", rate: 5 },
        { item: "cable", rate: 5 },
        { item: "iron-plate", rate: 5 },
        { item: "iron-rod", rate: 5 },
        { item: "reinforced-iron-plate", rate: 5 },
        { item: "rotor", rate: 5 },
        { item: "screw", rate: 5 },
        { item: "smart-plating", rate: 20 },
        { item: "stator", rate: 5 },
        { item: "steel-beam", rate: 5 },
        { item: "steel-pipe", rate: 5 },
      ],
    });
    expect(result.feasible).toBe(true);
    for (const r of result.raws) {
      expect(r.used).toBeLessThanOrEqual(r.available + 1e-6);
    }
    for (const flow of result.items) {
      expect(flow.net).toBeGreaterThanOrEqual(-1e-6);
    }
    const limestone = result.raws.find((r) => r.item === "limestone")!;
    const caterium = result.raws.find((r) => r.item === "caterium-ore")!;
    expect(limestone.utilization).toBeGreaterThan(0.95);
    expect(caterium.utilization).toBeGreaterThan(0.98);
    expect(result.overallUtilization).toBeGreaterThan(0.995);
  },
    10_000,
  );

  /** Snapshot of live planner localStorage (satisfactory-planner:v1). */
  it(
    "browser planner config: solves without negative nets",
    () => {
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
        { item: "motor", minRate: 2, weight: 20 },
        { item: "encased-industrial-beam", minRate: 2, weight: 60 },
        { item: "versatile-framework", minRate: 2, weight: 50 },
        { item: "automated-wiring", minRate: 2, weight: 50 },
      ],
      excess: [
        { item: "steel-beam", rate: 5 },
        { item: "steel-pipe", rate: 5 },
        { item: "iron-rod", rate: 5 },
        { item: "iron-plate", rate: 5 },
        { item: "screw", rate: 5 },
        { item: "cable", rate: 5 },
        { item: "stator", rate: 5 },
        { item: "ai-limiter", rate: 5 },
        { item: "rotor", rate: 5 },
        { item: "reinforced-iron-plate", rate: 5 },
        { item: "smart-plating", rate: 20 },
        { item: "wire", rate: 5 },
        { item: "quickwire", rate: 5 },
        { item: "modular-frame", rate: 5 },
        { item: "copper-sheet", rate: 5 },
        { item: "concrete", rate: 5 },
      ],
      maxBeltCapacity: 270,
    });
    expect(result.feasible).toBe(true);
    for (const r of result.raws) {
      expect(r.used).toBeLessThanOrEqual(r.available + 1e-6);
    }
    for (const flow of result.items) {
      expect(flow.net).toBeGreaterThanOrEqual(-1e-6);
    }
  },
    10_000,
  );

  it("maximizes useful ore before target weight tie-break", () => {
    const input = {
      rawAvailable: {
        "iron-ore": 240,
        coal: 180,
        limestone: 200,
      },
      targets: [
        { item: "steel-beam", minRate: 5, weight: 90 },
        { item: "concrete", minRate: 5, weight: 10 },
        { item: "iron-plate", minRate: 5, weight: 5 },
      ],
      excess: [],
    };
    const result = solve(input);
    expect(result.feasible).toBe(true);
    // Utilization-first allocation should consume most mixed raws, not just
    // the highest-weight steel target's share of iron/coal.
    expect(result.overallUtilization).toBeGreaterThan(0.92);
    const limestone = result.raws.find((r) => r.item === "limestone")!;
    const coal = result.raws.find((r) => r.item === "coal")!;
    expect(limestone.utilization).toBeGreaterThan(0.85);
    expect(coal.utilization).toBeGreaterThan(0.85);
  });

  it("never soaks leftover ore into ingots", () => {
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
    expect(withAuto.every((e) => !e.item.includes("ingot"))).toBe(true);
    const deepest = withAuto[0]!;
    expect(deepest.item).not.toBe("iron-ingot");
    expect(deepest.item).not.toBe("copper-ingot");
  });

  it("converts leftover steel ingots into useful parts", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 240, coal: 240 },
      targets: [{ item: "steel-beam", minRate: 10, weight: 0 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    // Never schedule ingots as excess sinks
    expect(
      result.excess.every((e) => e.rate < 1e-6 || !e.item.includes("ingot")),
    ).toBe(true);
    // Ore soak should land on useful parts (pipes/frames/etc.), not ingots
    expect(
      result.excess.some((e) => e.rate > 0 && !e.item.includes("ingot")),
    ).toBe(true);
    // Quantization may leave a tiny irreducible ingot residual, but not a
    // planned soak dump (previously ~27.5 steel ingot/min excess).
    const ingotFlow = result.items.find((i) => i.item === "steel-ingot");
    expect(ingotFlow).toBeDefined();
    expect(ingotFlow!.net).toBeLessThan(5);
  });

  it("does not count unused ingots toward ore utilization", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [
        { item: "iron-plate", minRate: 20, weight: 0 },
        { item: "iron-rod", minRate: 15, weight: 0 },
      ],
      excess: [],
    });
    const iron = result.raws.find((r) => r.item === "iron-ore")!;
    const ingotNet =
      result.items.find((i) => i.item === "iron-ingot")?.net ?? 0;
    // Any unused iron ingots (1:1 with ore) must be excluded from used
    expect(iron.used).toBeCloseTo(120 - Math.max(0, ingotNet), 6);
    expect(iron.leftover).toBeCloseTo(Math.max(0, ingotNet), 6);
    if (ingotNet > 1e-6) {
      expect(iron.utilization).toBeLessThan(1);
    }
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
    // Ingots are never excess sinks — only useful parts
    expect(ids).not.toContain("iron-ingot");
    expect(ids).not.toContain("copper-ingot");
    expect(ids).not.toContain("steel-ingot");
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
    const allowed = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25];
    expect(allowed.some((c) => Math.abs(c - osc.clock) < 1e-9)).toBe(true);
  });

  it("emits a factory network with stages and edges", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [
        { item: "iron-plate", minRate: 20, weight: 0 },
        { item: "iron-rod", minRate: 15, weight: 0 },
      ],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    expect(result.network.stages.length).toBeGreaterThan(0);
    expect(result.network.edges.length).toBeGreaterThan(0);

    const ingotStage = result.network.stages.find(
      (s) => s.recipeId === "iron-ingot",
    );
    expect(ingotStage).toBeDefined();
    const outgoing = result.network.edges.filter(
      (e) => e.from.kind === "stage" && e.from.id === "iron-ingot",
    );
    expect(outgoing.length).toBeGreaterThanOrEqual(2);
    const toPlate = outgoing.find((e) => e.to.id === "iron-plate");
    const toRod = outgoing.find((e) => e.to.id === "iron-rod");
    expect(toPlate).toBeDefined();
    expect(toRod).toBeDefined();
  });

  it("marks sole consumer edges as merge-only", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 60 },
      targets: [{ item: "iron-plate", minRate: 20, weight: 0 }],
      excess: [],
    });
    const oreToIngot = result.network.edges.find(
      (e) =>
        e.from.kind === "raw" &&
        e.from.id === "iron-ore" &&
        e.to.kind === "recipe" &&
        e.to.id === "iron-ingot",
    );
    // May share ore with excess soak — if sole, mergeOnly
    if (oreToIngot) {
      const siblings = result.network.edges.filter(
        (e) =>
          e.from.kind === "raw" &&
          e.from.id === "iron-ore" &&
          e.item === "iron-ore",
      );
      if (siblings.length === 1) {
        expect(oreToIngot.outputSplit.mergeOnly).toBe(true);
      }
    }
  });

  it("provides input split steps for splitter-friendly group sizes", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 480 },
      targets: [{ item: "iron-plate", minRate: 120, weight: 0 }],
      excess: [],
    });
    const stage = result.network.stages.find((s) => s.recipeId === "iron-plate");
    expect(stage).toBeDefined();
    const friendly = stage!.groups.find((g) => g.machines === 6);
    if (friendly) {
      expect(friendly.inputSplit.mergeOnly).toBe(false);
      expect(friendly.inputSplit.steps.length).toBeGreaterThan(0);
    } else {
      // Any friendly multi-machine group should have steps
      const multi = stage!.groups.find((g) => g.machines > 1);
      if (multi && isSplitterFriendlyCount(multi.machines)) {
        expect(multi.inputSplit.steps.length).toBeGreaterThan(0);
      }
    }
  });

  it("packs only splitter-friendly banks and never programmable production splits", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 480, "copper-ore": 120 },
      targets: [
        { item: "iron-plate", minRate: 40, weight: 0 },
        { item: "iron-rod", minRate: 30, weight: 0 },
      ],
      excess: [],
      maxBeltCapacity: 120,
    });
    expect(result.feasible).toBe(true);
    for (const stage of result.network.stages) {
      for (const g of stage.groups) {
        expect(g.machines === 1 || isSplitterFriendlyCount(g.machines)).toBe(
          true,
        );
        expect(g.inputSplit.overflowToStorage).toBeFalsy();
        if (!g.inputSplit.mergeOnly) {
          expect(g.inputSplit.ratio).not.toBeNull();
        }
      }
      expect(stage.outputMerges.length).toBeGreaterThan(0);
    }
    for (const edge of result.network.edges) {
      if (edge.to.kind === "recipe" || edge.to.kind === "target") {
        // Production never uses programmable overflow-to-storage
        expect(edge.outputSplit.overflowToStorage).toBeFalsy();
        // Shared production splits must be friendly (or sole / after-overflow)
        if (
          !edge.outputSplit.mergeOnly &&
          !edge.outputSplit.restAfterOverflow
        ) {
          expect(edge.outputSplit.ratio).not.toBeNull();
        }
      }
    }
  });

  it("assigns each destination its own output belts", () => {
    const result = solve({
      rawAvailable: { "copper-ore": 600 },
      targets: [
        { item: "copper-sheet", minRate: 90, weight: 0 },
        { item: "wire", minRate: 200, weight: 0 },
      ],
      excess: [],
      maxBeltCapacity: 270,
    });
    const stage = result.network.stages.find(
      (s) => s.recipeId === "copper-ingot",
    )!;
    expect(stage.outputMerges.length).toBeGreaterThan(1);
    // Each lane has at most one production destination (may span multiple belts)
    for (const lane of stage.outputMerges) {
      expect(lane.to).toBeDefined();
    }
    const destIds = new Set(
      stage.outputMerges
        .filter((m) => m.to && m.to.kind !== "excess")
        .map((m) => m.to!.id),
    );
    expect(destIds.size).toBeGreaterThanOrEqual(2);
    const outs = result.network.edges.filter(
      (e) =>
        e.from.kind === "stage" &&
        e.from.id === "copper-ingot" &&
        (e.to.kind === "recipe" || e.to.kind === "target"),
    );
    expect(outs.every((e) => e.fromLaneIndex != null)).toBe(true);
    for (const e of outs) {
      expect(
        e.outputSplit.mergeOnly || e.outputSplit.restAfterOverflow,
      ).toBe(true);
    }
  });

  it("may mark excess branches as overflow to storage", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 240 },
      targets: [{ item: "iron-plate", minRate: 20, weight: 0 }],
      excess: [],
    });
    const excessEdges = result.network.edges.filter(
      (e) => e.to.kind === "excess",
    );
    // Not required every solve, but when unfriendly the flag must be set
    for (const e of excessEdges) {
      if (!e.outputSplit.mergeOnly && e.outputSplit.ratio === null) {
        expect(e.outputSplit.overflowToStorage).toBe(true);
      }
    }
  });
});

