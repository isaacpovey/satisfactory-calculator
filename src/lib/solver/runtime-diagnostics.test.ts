import { describe, expect, it } from "vitest";
import {
  branchesPerSecond,
  completedPhaseTiming,
  readSolverRuntimeInfo,
} from "./runtime-diagnostics";
import type { ExactSolveProgress } from "./exact/optimizer-types";

describe("runtime diagnostics", () => {
  it("reads solver runtime info in node", () => {
    const info = readSolverRuntimeInfo();
    expect(info.sharedArrayBuffer).toBe(true);
    expect(info.isFirefoxFamily).toBe(false);
  });

  it("computes branches per second for completed phases", () => {
    const progress: ExactSolveProgress = {
      phase: 3,
      phaseCount: 6,
      label: "physical machines",
      status: "complete",
      searchWorkers: 8,
      hardwareConcurrency: 4,
      phaseMs: 2000,
      numBranches: 10_000,
      numConflicts: 12,
    };
    const timing = completedPhaseTiming(progress);
    expect(timing).not.toBeNull();
    expect(timing?.branchesPerSec).toBe(branchesPerSecond(2000, 10_000));
  });
});
