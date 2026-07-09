import { describe, expect, it } from "vitest";
import {
  ceilEffectiveMachines,
  formatClock,
  isSplitterFriendlyRatio,
  quantizeItemRate,
  representMachines,
  snapSplitterShare,
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

describe("representMachines", () => {
  it("uses one building at 75% for 0.75 effective", () => {
    const c = representMachines(0.75);
    expect(c.machines).toBe(1);
    expect(c.clock).toBe(0.75);
  });
});

describe("quantize and splitters", () => {
  it("quantizes rods", () => {
    expect(quantizeItemRate("iron-rod", 1)).toBeCloseTo(3.75);
  });

  it("splitter helpers", () => {
    expect(isSplitterFriendlyRatio(40, 120)).toBe(true);
    expect(snapSplitterShare(41, 120)).toBeCloseTo(40);
  });
});
