import { describe, expect, it } from "vitest";
import { excessPanelItems } from "./chain-intermediates";

const defaultTargets = [
  { item: "motor" as const, minRate: 2, weight: 60 },
  { item: "encased-industrial-beam" as const, minRate: 2, weight: 40 },
];

describe("hydration spare parts", () => {
  it("shows chain items for default targets", () => {
    const items = excessPanelItems(defaultTargets);
    expect(items.length).toBeGreaterThan(0);
  });

  it("shows chain items for concrete-only targets", () => {
    const items = excessPanelItems([{ item: "concrete", minRate: 5, weight: 50 }]);
    expect(items).toEqual([]);
  });

  it("shows chain items when targets use string rates from loose JSON", () => {
    const loose = [{ item: "motor", minRate: "2", weight: "60" }];
    const items = excessPanelItems(loose as never);
    expect(items.length).toBeGreaterThan(0);
  });
});
