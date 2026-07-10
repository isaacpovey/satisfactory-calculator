import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import {
  canonicalSplitterMachineCounts,
  generateMachineBankPatterns,
  isCanonicalSplitterMachineCount,
} from "./bank-patterns";
import { computeRecipeBounds } from "./bounds";
import { validateRecipeGraph } from "./recipe-graph";

const graph = validateRecipeGraph(items, recipes, scarceRawIds);

describe("computeRecipeBounds", () => {
  it("derives exact Quickwire bounds through its Caterium Ingot dependency", () => {
    const bounds = computeRecipeBounds(graph, { "caterium-ore": 300 });
    const quickwire = bounds.get("quickwire")!;

    expect(quickwire.rawPerCycle.get("caterium-ore")?.toString()).toBe("3");
    expect(quickwire.rawPerEffectiveMachine.get("caterium-ore")?.toString()).toBe("36");
    expect(quickwire.maxCyclesPerMinute.toString()).toBe("100");
    expect(quickwire.maxEffectiveMachines.toString()).toBe("25/3");
    expect(quickwire.minimumLegalClock.toString()).toBe("1/60");
    expect(quickwire.maxMachines).toBe(BigInt(500));
  });

  it("uses the tightest scarce input for multi-resource recipes", () => {
    const bounds = computeRecipeBounds(graph, {
      "iron-ore": 120,
      coal: 60,
    });
    const steel = bounds.get("steel-ingot")!;

    expect(steel.rawPerCycle.get("iron-ore")?.toString()).toBe("3");
    expect(steel.rawPerCycle.get("coal")?.toString()).toBe("3");
    expect(steel.maxCyclesPerMinute.toString()).toBe("20");
    expect(steel.maxEffectiveMachines.toString()).toBe("4/3");
  });

  it("produces finite bounds for every current recipe", () => {
    const availability = Object.fromEntries(
      scarceRawIds.map((itemId) => [itemId, 10_000]),
    ) as Partial<Record<ItemId, number>>;
    const bounds = computeRecipeBounds(graph, availability);

    expect(bounds.size).toBe(recipes.length);
    for (const bound of bounds.values()) {
      expect(bound.rawPerCycle.size).toBeGreaterThan(0);
      expect(bound.maxCyclesPerMinute.compare(0)).toBeGreaterThan(0);
      expect(bound.maxEffectiveMachines.compare(0)).toBeGreaterThan(0);
      expect(bound.maxMachines).toBeGreaterThan(BigInt(0));
    }
  });

  it("treats missing raw availability as zero", () => {
    const quickwire = computeRecipeBounds(graph, {}).get("quickwire")!;
    expect(quickwire.maxCyclesPerMinute.toString()).toBe("0");
    expect(quickwire.maxMachines).toBe(BigInt(0));
  });
});

describe("canonicalSplitterMachineCounts", () => {
  it("has no arbitrary splitter-depth cap", () => {
    const counts = canonicalSplitterMachineCounts(BigInt(10_000));

    expect(counts).toContain(BigInt(8192));
    expect(counts).toContain(BigInt(6561));
    expect(counts).not.toContain(BigInt(5));
    expect(counts.every((count) => isCanonicalSplitterMachineCount(count))).toBe(true);
    expect(counts.every((count) => count <= BigInt(10_000))).toBe(true);
  });
});

describe("generateMachineBankPatterns", () => {
  it("generates raw-bounded, belt-safe, splitter-friendly Quickwire banks", () => {
    const bound = computeRecipeBounds(graph, { "caterium-ore": 300 }).get("quickwire")!;
    const patterns = generateMachineBankPatterns(bound, 60);

    const fiveSixths = patterns.find(
      (pattern) => pattern.machines === BigInt(1) && pattern.clock.equals("5/6"),
    );
    expect(fiveSixths?.inputRates[0]?.rate.toString()).toBe("10");
    expect(fiveSixths?.outputRates[0]?.rate.toString()).toBe("50");

    expect(
      patterns.some((pattern) => pattern.machines === BigInt(2) && pattern.clock.equals(1)),
    ).toBe(false);

    for (const pattern of patterns) {
      expect(isCanonicalSplitterMachineCount(pattern.machines)).toBe(true);
      expect(pattern.machines).toBeLessThanOrEqual(bound.maxMachines);
      expect(pattern.effectiveMachines.compare(bound.maxEffectiveMachines)).toBeLessThanOrEqual(0);
      for (const { rate } of [...pattern.inputRates, ...pattern.outputRates]) {
        expect(rate.compare(60)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("supports the current maximum belt without floating point rates", () => {
    const bound = computeRecipeBounds(graph, { "iron-ore": 300 }).get("iron-plate")!;
    const patterns = generateMachineBankPatterns(bound, DEFAULT_MAX_BELT_CAPACITY);

    expect(patterns.length).toBeGreaterThan(0);
    expect(
      patterns.every(({ inputRates, outputRates }) =>
        [...inputRates, ...outputRates].every(
          ({ rate }) => rate.compare(DEFAULT_MAX_BELT_CAPACITY) <= 0,
        ),
      ),
    ).toBe(true);
  });
});
