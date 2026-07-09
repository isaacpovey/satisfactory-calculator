import { describe, expect, it } from "vitest";
import {
  ceilEffectiveMachines,
  formatClock,
  isSplitterFriendlyCount,
  isSplitterFriendlyRatio,
  quantizeItemRate,
  representMachines,
  snapExcessBranch,
  snapSplitterShare,
  SPLITTER_FRIENDLY_COUNTS,
} from "./constraints";

describe("ceilEffectiveMachines", () => {
  it("ceils to quarter machines", () => {
    expect(ceilEffectiveMachines(1.01)).toBeCloseTo(1.25);
    expect(ceilEffectiveMachines(1)).toBeCloseTo(1);
    expect(ceilEffectiveMachines(0.76)).toBeCloseTo(1);
  });
});

describe("formatClock", () => {
  it("formats percent", () => {
    expect(formatClock(0.75)).toBe("75%");
    expect(formatClock(1)).toBe("100%");
  });
});

describe("splitter-friendly machine counts", () => {
  it("includes 1/12-style counts", () => {
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(1);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(2);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(3);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(4);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(6);
    expect(SPLITTER_FRIENDLY_COUNTS).toContain(12);
    expect(isSplitterFriendlyCount(5)).toBe(false);
    expect(isSplitterFriendlyCount(7)).toBe(false);
    expect(isSplitterFriendlyCount(12)).toBe(true);
  });

  it("uses one building at 75% for 0.75 effective", () => {
    const c = representMachines(0.75);
    expect(c.machines).toBe(1);
    expect(c.clock).toBe(0.75);
  });

  it("never uses non-friendly machine counts", () => {
    for (const exact of [1.1, 2.3, 4.1, 5, 7, 11]) {
      const c = representMachines(exact);
      expect(isSplitterFriendlyCount(c.machines)).toBe(true);
      expect(c.effectiveMachines).toBeGreaterThanOrEqual(exact - 1e-9);
    }
  });
});

describe("quantize and splitters", () => {
  it("quantizes rods to allowed machine groups", () => {
    // 1 rod/min → at least 0.25 machine → 3.75/min
    expect(quantizeItemRate("iron-rod", 1)).toBeCloseTo(3.75);
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
});
