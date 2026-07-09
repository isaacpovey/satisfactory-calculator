import { describe, expect, it } from "vitest";
import { rawCoefficients } from "@/lib/solver/bom";
import { solve } from "@/lib/solver/allocate";

describe("rawCoefficients", () => {
  it("maps iron plate to iron ore 1.5:1", () => {
    // 3 ingot -> 2 plate => 1.5 ore per plate
    expect(rawCoefficients("iron-plate")["iron-ore"]).toBeCloseTo(1.5);
  });

  it("maps iron rod to iron ore 1:1", () => {
    expect(rawCoefficients("iron-rod")["iron-ore"]).toBeCloseTo(1);
  });

  it("maps screws to iron ore 0.25:1", () => {
    // 1 rod -> 4 screws => 0.25 ore per screw
    expect(rawCoefficients("screw")["iron-ore"]).toBeCloseTo(0.25);
  });

  it("maps steel beam to iron ore and coal", () => {
    // 4 steel ingot -> 1 beam; 1 steel = 1 ore + 1 coal
    const c = rawCoefficients("steel-beam");
    expect(c["iron-ore"]).toBeCloseTo(4);
    expect(c["coal"]).toBeCloseTo(4);
  });

  it("maps concrete to limestone 3:1", () => {
    expect(rawCoefficients("concrete")["limestone"]).toBeCloseTo(3);
  });
});

describe("solve min-then-balance", () => {
  it("meets minima and reports infeasible when ore is short", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 10 },
      targets: [{ item: "iron-rod", minRate: 20, weight: 50 }],
      excess: [],
    });
    expect(result.feasible).toBe(false);
    expect(result.raws.find((r) => r.item === "iron-ore")?.shortfall).toBeCloseTo(
      10,
    );
  });

  it("allocates leftover by equal weights between two products", () => {
    // 120 iron ore; min 10 rods + 10 plates = 10 + 15 = 25 ore
    // leftover 95; equal weights => same extra "share units"
    // rod coeff 1, plate coeff 1.5
    // normalized w=0.5 each: demand/t = 0.5*1 + 0.5*1.5 = 1.25
    // t = 95/1.25 = 76; extra rod = 38, extra plate = 38
    const result = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [
        { item: "iron-rod", minRate: 10, weight: 50 },
        { item: "iron-plate", minRate: 10, weight: 50 },
      ],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const rod = result.targets.find((t) => t.item === "iron-rod")!;
    const plate = result.targets.find((t) => t.item === "iron-plate")!;
    expect(rod.extraRate).toBeCloseTo(38);
    expect(plate.extraRate).toBeCloseTo(38);
    expect(rod.totalRate).toBeCloseTo(48);
    expect(plate.totalRate).toBeCloseTo(48);
    const iron = result.raws.find((r) => r.item === "iron-ore")!;
    expect(iron.leftover).toBeCloseTo(0);
    expect(iron.utilization).toBeCloseTo(1);
  });

  it("respects zero weight (no leftover share)", () => {
    const result = solve({
      rawAvailable: { "iron-ore": 100 },
      targets: [
        { item: "iron-rod", minRate: 10, weight: 100 },
        { item: "iron-plate", minRate: 10, weight: 0 },
      ],
      excess: [],
    });
    const rod = result.targets.find((t) => t.item === "iron-rod")!;
    const plate = result.targets.find((t) => t.item === "iron-plate")!;
    expect(plate.extraRate).toBeCloseTo(0);
    expect(plate.totalRate).toBeCloseTo(10);
    // min uses 10 + 15 = 25; leftover 75 all to rods
    expect(rod.extraRate).toBeCloseTo(75);
    expect(rod.totalRate).toBeCloseTo(85);
  });

  it("reserves excess intermediaries before leftover fill", () => {
    // 60 ore; excess 20 rods (=20 ore); min 10 plates (=15 ore); leftover 25 to rods
    const result = solve({
      rawAvailable: { "iron-ore": 60 },
      targets: [{ item: "iron-rod", minRate: 0, weight: 100 }],
      excess: [{ item: "iron-rod", rate: 20 }],
    });
    // Wait - excess rods AND target rods both expand. Excess is separate sink.
    // Phase A: excess 20 rods = 20 ore. leftover 40 all to target rods.
    expect(result.feasible).toBe(true);
    const rod = result.targets.find((t) => t.item === "iron-rod")!;
    expect(rod.totalRate).toBeCloseTo(40);
    const iron = result.raws.find((r) => r.item === "iron-ore")!;
    expect(iron.used).toBeCloseTo(60);
  });

  it("computes machine counts for iron plates", () => {
    // 20 plates/min = 1 constructor
    const result = solve({
      rawAvailable: { "iron-ore": 30 },
      targets: [{ item: "iron-plate", minRate: 20, weight: 0 }],
      excess: [],
    });
    const plateRecipe = result.recipes.find((r) => r.recipeId === "iron-plate")!;
    expect(plateRecipe.machines).toBeCloseTo(1);
    const ingot = result.recipes.find((r) => r.recipeId === "iron-ingot")!;
    expect(ingot.machines).toBeCloseTo(1); // 30 ore/min, smelter does 30/min
  });

  it("handles motor chain with multiple raws", () => {
    const result = solve({
      rawAvailable: {
        "iron-ore": 480,
        "copper-ore": 120,
        coal: 120,
        limestone: 0,
      },
      targets: [{ item: "motor", minRate: 5, weight: 100 }],
      excess: [],
    });
    expect(result.feasible).toBe(true);
    const motor = result.targets.find((t) => t.item === "motor")!;
    expect(motor.totalRate).toBeGreaterThanOrEqual(5);
    expect(result.recipes.some((r) => r.recipeId === "motor")).toBe(true);
    expect(result.recipes.some((r) => r.recipeId === "stator")).toBe(true);
    expect(result.recipes.some((r) => r.recipeId === "rotor")).toBe(true);
  });
});
