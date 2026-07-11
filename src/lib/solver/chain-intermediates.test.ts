import { describe, expect, it } from "vitest";
import {
  chainIntermediariesForPlanner,
  collectChainIntermediates,
  excessPanelItems,
  pruneExcessFloors,
} from "./chain-intermediates";

describe("collectChainIntermediates", () => {
  it("returns upstream manufactured parts for a motor target", () => {
    const ids = collectChainIntermediates(["motor"]);
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
    expect(ids).not.toContain("motor");
    expect(ids).not.toContain("iron-ore");
  });

  it("excludes root items from the result", () => {
    const ids = collectChainIntermediates(["motor", "rotor"]);
    expect(ids).toContain("stator");
    expect(ids).not.toContain("motor");
    expect(ids).not.toContain("rotor");
  });
});

describe("chainIntermediariesForPlanner", () => {
  it("derives intermediaries from end products", () => {
    const ids = chainIntermediariesForPlanner([{ item: "motor", minRate: 5, weight: 50 }], {});
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
    expect(ids).not.toContain("iron-ingot");
  });

  it("walks upstream from excess floor roots", () => {
    const ids = chainIntermediariesForPlanner([], { rotor: 10 });
    expect(ids).not.toContain("rotor");
    expect(ids).toContain("screw");
  });

  it("returns empty when there are no roots", () => {
    expect(chainIntermediariesForPlanner([], {})).toEqual([]);
  });
});

describe("excessPanelItems", () => {
  it("keeps floored roots visible even when excluded from intermediaries", () => {
    const ids = excessPanelItems([{ item: "motor", minRate: 1, weight: 50 }], { rotor: 10 });
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
  });
});

describe("pruneExcessFloors", () => {
  it("removes floors for items no longer on the target chain", () => {
    const pruned = pruneExcessFloors([{ item: "iron-rod", minRate: 1, weight: 50 }], {
      rotor: 10,
      stator: 5,
    });
    expect(pruned).toEqual({});
  });

  it("keeps floors for items still on the target chain", () => {
    const pruned = pruneExcessFloors([{ item: "motor", minRate: 1, weight: 50 }], {
      rotor: 10,
      stator: 0,
    });
    expect(pruned).toEqual({ rotor: 10 });
  });

  it("drops zero floors", () => {
    const pruned = pruneExcessFloors([{ item: "motor", minRate: 1, weight: 50 }], { stator: 0 });
    expect(pruned).toEqual({});
  });
});
