import { describe, expect, it } from "vitest";
import {
  ceilEffectiveMachines,
  formatClock,
  friendlyRatio,
  isSplitterFriendlyCount,
  isSplitterFriendlyRatio,
  nextExcessAbove,
  quantizeItemRate,
  representMachines,
  representMachinesMulti,
  snapExcessBranch,
  snapSplitterShare,
  splitStepsForCount,
  splitStepsForRatio,
  SPLITTER_FRIENDLY_COUNTS,
  totalEffectiveMachines,
} from "./constraints";

describe("ceilEffectiveMachines", () => {
  it("ceils to the shared 1/12 clock quantum", () => {
    expect(ceilEffectiveMachines(1.01)).toBeCloseTo(1 + 1 / 12);
    expect(ceilEffectiveMachines(1)).toBeCloseTo(1);
    expect(ceilEffectiveMachines(0.76)).toBeCloseTo(0.75 + 1 / 12);
    expect(ceilEffectiveMachines(1 / 3)).toBeCloseTo(1 / 3);
  });
});

describe("formatClock", () => {
  it("formats percent including thirds", () => {
    expect(formatClock(0.75)).toBe("75%");
    expect(formatClock(1)).toBe("100%");
    expect(formatClock(2 / 3)).toBe("66.67%");
    expect(formatClock(1 / 3)).toBe("33.33%");
  });
});

describe("splitter-friendly machine counts", () => {
  it("includes depth≤5 counts and excludes deeper ones", () => {
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(1);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(2);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(3);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(4);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(6);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(12); // 2^2·3^1 depth 3
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(32); // 2^5 depth 5
    expect(SPLITTER_FRIENDLY_COUNTS).not.toContain(64); // 2^6 depth 6
    expect(isSplitterFriendlyCount(5)).toBe(false);
    expect(isSplitterFriendlyCount(7)).toBe(false);
    expect(isSplitterFriendlyCount(12)).toBe(true);
  });

  it("uses one building at 75% for 0.75 effective", () => {
    const c = representMachines(0.75);
    expect(c.machines).toBe(1);
    expect(c.clock).toBe(0.75);
  });

  it("uses one building at 33.33% for 1/3 effective", () => {
    const c = representMachines(1 / 3);
    expect(c.machines).toBe(1);
    expect(c.clock).toBeCloseTo(1 / 3);
  });

  it("never uses non-friendly machine counts", () => {
    for (const exact of [1.1, 2.3, 4.1, 5, 7, 11]) {
      const c = representMachines(exact);
      expect(isSplitterFriendlyCount(c.machines)).toBe(true);
      expect(c.effectiveMachines).toBeGreaterThanOrEqual(exact - 1e-9);
    }
  });
});

describe("representMachinesMulti", () => {
  it("splits 5.25 into 5@100% + 1@25% when any count allowed", () => {
    const groups = representMachinesMulti(5.25, { anyMachineCount: true });
    expect(totalEffectiveMachines(groups)).toBeCloseTo(5.25);
    expect(groups.reduce((s, g) => s + g.machines, 0)).toBe(6);
    expect(groups.some((g) => g.machines === 5 && g.clock === 1)).toBe(true);
    expect(groups.some((g) => g.machines === 1 && g.clock === 0.25)).toBe(true);
  });

  it("beats a single 6@100% group on overshoot", () => {
    const multi = representMachinesMulti(5.25, { anyMachineCount: true });
    const single = representMachines(5.25);
    expect(totalEffectiveMachines(multi)).toBeLessThan(
      single.effectiveMachines - 1e-9,
    );
  });

  it("keeps a single group when that is best", () => {
    const groups = representMachinesMulti(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.machines).toBe(2);
    expect(groups[0]!.clock).toBe(1);
  });
});

describe("split step helpers", () => {
  it("factors equal-feed counts into 1/2 and 1/3 steps", () => {
    expect(splitStepsForCount(1)).toEqual([]);
    expect(splitStepsForCount(2)).toEqual(["1/2"]);
    expect(splitStepsForCount(6)).toEqual(["1/2", "1/3"]);
    expect(splitStepsForCount(5)).toEqual([]);
  });

  it("factors ratios into nested splitter steps", () => {
    expect(splitStepsForRatio(1, 2)).toEqual(["1/2"]);
    expect(splitStepsForRatio(1, 6)).toEqual(["1/2", "1/3"]);
    expect(friendlyRatio(30, 60)).toEqual({ num: 1, den: 2 });
  });
});

describe("quantize and splitters", () => {
  it("quantizes rods to allowed machine groups", () => {
    // 1 rod/min → at least 0.25 machine (smallest allowed clock) → 3.75/min
    expect(quantizeItemRate("iron-rod", 1)).toBeCloseTo(3.75);
    // 1/3 clock is available for finer rates
    expect(quantizeItemRate("iron-rod", 4)).toBeCloseTo(5); // 1 @ 1/3
  });

  it("accepts nested 1/2 and 1/3 ratios including 1/12", () => {
    expect(isSplitterFriendlyRatio(5, 60)).toBe(true); // 1/12
    expect(isSplitterFriendlyRatio(10, 60)).toBe(true); // 1/6
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
    expect(snapSplitterShare(5, 60)).toBeCloseTo(5); // 1/12
    expect(snapSplitterShare(30, 60)).toBeCloseTo(30); // 1/2
  });

  it("snaps excess branches off downstream demand", () => {
    const e12 = snapExcessBranch(12, 30);
    expect(e12).toBeLessThanOrEqual(12 + 1e-9);
    expect(e12).toBeGreaterThanOrEqual(10);
    // excess/(30+excess) must be 2^a*3^b
    expect(isSplitterFriendlyRatio(e12, 30 + e12)).toBe(true);

    const e16 = snapExcessBranch(16, 30);
    expect(e16).toBeLessThanOrEqual(16 + 1e-9);
    expect(e16).toBeGreaterThanOrEqual(15);
    expect(isSplitterFriendlyRatio(e16, 30 + e16)).toBe(true);
  });

  it("finds the next legal excess branch above current", () => {
    // downstream 30: legal excesses include 10 (1/4), 15 (1/3), 30 (1/2), …
    expect(nextExcessAbove(0, 100, 30)).toBeCloseTo(10);
    expect(nextExcessAbove(10, 100, 30)).toBeCloseTo(15);
    expect(nextExcessAbove(15, 100, 30)).toBeCloseTo(30);
  });
});
