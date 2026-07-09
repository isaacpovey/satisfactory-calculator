import { describe, expect, it } from "vitest";
import { solve } from "./allocate";
import { diffSolveResults, emptyChanges } from "./diff";

describe("diffSolveResults", () => {
  it("returns empty changes when prev is null", () => {
    const next = solve({
      rawAvailable: { "iron-ore": 60 },
      targets: [{ item: "iron-rod", minRate: 15, weight: 0 }],
      excess: [],
    });
    const d = diffSolveResults(null, next);
    expect(d.overall).toBe(false);
    expect(d.raws.size).toBe(0);
    expect(d.targets.size).toBe(0);
  });

  it("flags changed targets and raws when ore increases", () => {
    const a = solve({
      rawAvailable: { "iron-ore": 30 },
      targets: [{ item: "iron-rod", minRate: 15, weight: 100 }],
      excess: [],
    });
    const b = solve({
      rawAvailable: { "iron-ore": 120 },
      targets: [{ item: "iron-rod", minRate: 15, weight: 100 }],
      excess: [],
    });
    const d = diffSolveResults(a, b);
    expect(d.raws.has("iron-ore")).toBe(true);
    expect(emptyChanges().raws.size).toBe(0);
  });
});
