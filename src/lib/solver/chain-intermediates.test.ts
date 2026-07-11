import { describe, expect, it } from "vitest";
import {
  chainIntermediariesForTargets,
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

describe("chainIntermediariesForTargets", () => {
  it("derives intermediaries from end products", () => {
    const ids = chainIntermediariesForTargets([{ item: "motor", minRate: 5, weight: 50 }]);
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
    expect(ids).not.toContain("iron-ingot");
  });

  it("returns empty when there are no targets", () => {
    expect(chainIntermediariesForTargets([])).toEqual([]);
  });

  it("keeps a stable order when only floor values change", () => {
    const targets = [{ item: "motor" as const, minRate: 1, weight: 50 }];
    const before = chainIntermediariesForTargets(targets);
    const after = chainIntermediariesForTargets(targets);
    expect(after).toEqual(before);
  });
});

describe("excessPanelItems", () => {
  it("lists only production-chain intermediaries", () => {
    const ids = excessPanelItems([{ item: "motor", minRate: 1, weight: 50 }]);
    expect(ids).toContain("rotor");
    expect(ids).toContain("stator");
    expect(ids).not.toContain("motor");
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
