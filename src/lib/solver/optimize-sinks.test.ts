import { describe, expect, it } from "vitest";
import type { ItemId } from "@/data/types";
import type { RateMap } from "@/lib/solver/bom";
import {
  buildExcessProbeOrder,
  comparePlanScore,
  MAX_EXCESS_PROBE,
  MAX_RANKED_COLLECT,
  MAX_SOAK_ITERATIONS,
  MAX_TARGET_ITERATIONS,
  optimizeSinkRates,
  scorePlan,
  selectBestScoredMove,
  usefulOreUsed,
  type SinkMove,
  type SinkOptimizerDeps,
} from "@/lib/solver/optimize-sinks";

function makeRateMap(entries: Partial<Record<ItemId, number>>): RateMap {
  const map = new Map<ItemId, number>();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined) map.set(k as ItemId, v);
  }
  return map;
}

/** Legacy proxy ranking: ore-gain estimate, then weight bonus, then move key. */
function proxyRankScore(
  move: SinkMove,
  leftover: RateMap,
  coeffs: Partial<Record<ItemId, number>>,
  weight: number,
  currentRate: number,
): { proxy: number; weightBonus: number } {
  let proxy = 0;
  for (const [raw, c] of Object.entries(coeffs)) {
    const coeff = c ?? 0;
    if (coeff <= 0) continue;
    proxy += Math.min(coeff * (move.rate - currentRate), leftover.get(raw as ItemId) ?? 0);
  }
  const weightBonus = move.kind === "target" ? (move.rate - currentRate) * weight : 0;
  return { proxy, weightBonus };
}

describe("optimize-sinks scoring", () => {
  it("ranks useful ore ahead of weight bonus", () => {
    expect(
      comparePlanScore({ usefulOre: 200, weightBonus: 0 }, { usefulOre: 199, weightBonus: 10_000 }),
    ).toBe(1);
  });

  it("uses weight bonus only as a tie-breaker", () => {
    expect(
      comparePlanScore({ usefulOre: 100, weightBonus: 50 }, { usefulOre: 100, weightBonus: 40 }),
    ).toBe(1);
    expect(
      comparePlanScore({ usefulOre: 100, weightBonus: 40 }, { usefulOre: 100, weightBonus: 50 }),
    ).toBe(-1);
  });
});

describe("optimize-sinks bounds", () => {
  it("exports bounded iteration budgets for browser execution", () => {
    expect(MAX_TARGET_ITERATIONS).toBeLessThanOrEqual(64);
    expect(MAX_SOAK_ITERATIONS).toBeLessThanOrEqual(120);
    expect(MAX_EXCESS_PROBE).toBeLessThanOrEqual(12);
    expect(MAX_RANKED_COLLECT).toBeLessThanOrEqual(8);
  });
});

describe("optimize-sinks excess probe order", () => {
  it("reserves a probe slot per leftover raw before global value ranking", () => {
    const leftover = makeRateMap({
      "iron-ore": 1000,
      limestone: 300,
      "caterium-ore": 60,
    });
    const coeffs: Partial<Record<ItemId, Partial<Record<ItemId, number>>>> = {
      screw: { "iron-ore": 2 },
      "iron-plate": { "iron-ore": 1.5 },
      "iron-rod": { "iron-ore": 1.5 },
      "reinforced-iron-plate": { "iron-ore": 3 },
      concrete: { limestone: 3 },
      "ai-limiter": { "caterium-ore": 12 },
    };
    const fillOrder: ItemId[] = [
      "screw",
      "iron-plate",
      "iron-rod",
      "reinforced-iron-plate",
      "concrete",
      "ai-limiter",
    ];
    const deps: Pick<SinkOptimizerDeps, "fillOrder"> = { fillOrder };
    const exactRawCoefficients = (item: ItemId) => coeffs[item] ?? {};

    const order = buildExcessProbeOrder(
      deps as SinkOptimizerDeps,
      leftover,
      exactRawCoefficients,
      0,
    );

    const firstWindow = order.slice(0, MAX_EXCESS_PROBE);
    expect(firstWindow).toContain("concrete");
    expect(firstWindow).toContain("ai-limiter");

    const valueOnly = [...fillOrder].sort((a, b) => {
      const value = (item: ItemId) => {
        const c = exactRawCoefficients(item);
        return (
          (c["iron-ore"] ?? 0) * 1000 + (c.limestone ?? 0) * 300 + (c["caterium-ore"] ?? 0) * 60
        );
      };
      return value(b) - value(a);
    });
    expect(valueOnly.indexOf("concrete")).toBeGreaterThan(3);
    expect(valueOnly.indexOf("ai-limiter")).toBeGreaterThan(3);
  });
});

describe("optimize-sinks move selection", () => {
  it("chooses scorePlan winner over proxy/weight ordering", () => {
    const targetExtra = new Map<ItemId, number>([
      ["screw", 0],
      ["iron-rod", 0],
    ]);
    const excessRates = new Map<ItemId, number>();
    const leftover = makeRateMap({ "iron-ore": 100 });

    const coeffs: Partial<Record<ItemId, Partial<Record<ItemId, number>>>> = {
      screw: { "iron-ore": 2 },
      "iron-rod": { "iron-ore": 1.5 },
    };

    const deps: SinkOptimizerDeps = {
      available: makeRateMap({ "iron-ore": 100 }),
      maxBeltCapacity: 60,
      targets: [
        { item: "screw", minRate: 0, weight: 100 },
        { item: "iron-rod", minRate: 0, weight: 1 },
      ],
      soakCandidates: ["screw", "iron-rod"],
      fillOrder: ["screw", "iron-rod"],
      targetExtra,
      excessRates,
      buildSinks: () => [
        ...[...targetExtra.entries()]
          .filter(([, rate]) => rate > 0)
          .map(([item, rate]) => ({ item, rate })),
        ...[...excessRates.entries()]
          .filter(([, rate]) => rate > 0)
          .map(([item, rate]) => ({ item, rate })),
      ],
      planFitsAvailable: () => true,
      leftoverFromPlan: () => leftover,
      expandSinks: (sinks) => {
        const raws = makeRateMap({});
        for (const sink of sinks) {
          const itemCoeffs = coeffs[sink.item];
          if (!itemCoeffs) continue;
          for (const [raw, perUnit] of Object.entries(itemCoeffs)) {
            const rawId = raw as ItemId;
            raws.set(rawId, (raws.get(rawId) ?? 0) + sink.rate * perUnit);
          }
        }
        return { raws, recipeCrafts: new Map() };
      },
      rawsLockedInLeftoverIngots: (sinks) => {
        const screwRate = sinks.find((s) => s.item === "screw")?.rate ?? 0;
        return makeRateMap({ "iron-ore": screwRate * 1.5 });
      },
      leftoverIngotsFromPlan: () => makeRateMap({}),
      collectGrowthRates: () => [10],
      collectIngotConversionRates: () => [],
      consumesItem: () => false,
    };

    const exactRawCoefficients = (item: ItemId) => coeffs[item] ?? {};

    const screwMove: SinkMove = { kind: "target", item: "screw", rate: 10 };
    const rodMove: SinkMove = { kind: "target", item: "iron-rod", rate: 10 };

    const screwProxy = proxyRankScore(screwMove, leftover, coeffs.screw!, 100, 0);
    const rodProxy = proxyRankScore(rodMove, leftover, coeffs["iron-rod"]!, 1, 0);
    expect(screwProxy.proxy).toBeGreaterThan(rodProxy.proxy);
    expect(screwProxy.weightBonus).toBeGreaterThan(rodProxy.weightBonus);

    const baseline = scorePlan(deps)!;
    expect(baseline.usefulOre).toBe(0);

    const selected = selectBestScoredMove(deps, baseline, [screwMove, rodMove]);
    expect(selected?.move.item).toBe("iron-rod");
    expect(selected!.score.usefulOre).toBe(15);

    optimizeSinkRates(deps, exactRawCoefficients, {
      modes: ["target"],
      maxIterations: 1,
    });
    expect(targetExtra.get("iron-rod")).toBe(10);
    expect(targetExtra.get("screw") ?? 0).toBe(0);
    expect(usefulOreUsed(deps)).toBe(15);
  });

  it("picks improving rate by scorePlan, not largest fitting rate", () => {
    const targetExtra = new Map<ItemId, number>([["iron-rod", 0]]);
    const excessRates = new Map<ItemId, number>();
    const leftover = makeRateMap({ "iron-ore": 100 });

    const coeffs: Partial<Record<ItemId, Partial<Record<ItemId, number>>>> = {
      "iron-rod": { "iron-ore": 1.5 },
    };

    const deps: SinkOptimizerDeps = {
      available: makeRateMap({ "iron-ore": 100 }),
      maxBeltCapacity: 60,
      targets: [{ item: "iron-rod", minRate: 0, weight: 0 }],
      soakCandidates: ["iron-rod"],
      fillOrder: ["iron-rod"],
      targetExtra,
      excessRates,
      buildSinks: () =>
        [...targetExtra.entries()]
          .filter(([, rate]) => rate > 0)
          .map(([item, rate]) => ({ item, rate })),
      planFitsAvailable: () => true,
      leftoverFromPlan: () => leftover,
      expandSinks: (sinks) => {
        const raws = makeRateMap({});
        for (const sink of sinks) {
          const itemCoeffs = coeffs[sink.item];
          if (!itemCoeffs) continue;
          for (const [raw, perUnit] of Object.entries(itemCoeffs)) {
            const rawId = raw as ItemId;
            raws.set(rawId, (raws.get(rawId) ?? 0) + sink.rate * perUnit);
          }
        }
        return { raws, recipeCrafts: new Map() };
      },
      rawsLockedInLeftoverIngots: (sinks) => {
        const rodRate = sinks.find((s) => s.item === "iron-rod")?.rate ?? 0;
        // Quadratic lock: marginal high rates waste ore in unused ingots.
        return makeRateMap({ "iron-ore": rodRate * rodRate * 0.12 });
      },
      leftoverIngotsFromPlan: () => makeRateMap({}),
      collectGrowthRates: () => [5, 10],
      collectIngotConversionRates: () => [],
      consumesItem: () => false,
    };

    optimizeSinkRates(deps, (item) => coeffs[item] ?? {}, {
      modes: ["target"],
      maxIterations: 1,
    });

    // Rate 10 fits raw budget but wastes ore in ingots; rate 5 wins on usefulOre.
    expect(targetExtra.get("iron-rod")).toBe(5);
    expect(usefulOreUsed(deps)).toBeCloseTo(4.5, 6);
  });
});
