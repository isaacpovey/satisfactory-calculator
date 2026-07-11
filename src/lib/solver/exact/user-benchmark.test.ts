import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { solveExact } from "../index";

const USER_INPUT = {
  rawAvailable: {
    "iron-ore": 1860,
    "copper-ore": 540,
    limestone: 420,
    coal: 360,
    "caterium-ore": 120,
    "raw-quartz": 0,
    sulfur: 0,
  },
  targets: [
    { item: "motor" as const, minRate: 1, weight: 20 },
    { item: "encased-industrial-beam" as const, minRate: 1, weight: 60 },
    { item: "smart-plating" as const, minRate: 10, weight: 60 },
    { item: "versatile-framework" as const, minRate: 1, weight: 50 },
    { item: "automated-wiring" as const, minRate: 1, weight: 50 },
    { item: "ai-limiter" as const, minRate: 2, weight: 30 },
  ],
  excess: [
    { item: "iron-plate" as const, rate: 5 },
    { item: "screw" as const, rate: 2 },
    { item: "wire" as const, rate: 2 },
    { item: "reinforced-iron-plate" as const, rate: 3 },
    { item: "modular-frame" as const, rate: 3 },
    { item: "steel-beam" as const, rate: 5 },
    { item: "iron-rod" as const, rate: 5 },
    { item: "concrete" as const, rate: 2 },
    { item: "rotor" as const, rate: 2 },
    { item: "smart-plating" as const, rate: 2 },
    { item: "steel-pipe" as const, rate: 2 },
    { item: "versatile-framework" as const, rate: 2 },
    { item: "stator" as const, rate: 2 },
    { item: "cable" as const, rate: 2 },
    { item: "motor" as const, rate: 2 },
    { item: "automated-wiring" as const, rate: 2 },
    { item: "copper-sheet" as const, rate: 2 },
    { item: "quickwire" as const, rate: 2 },
  ],
  maxBeltCapacity: 270,
};

const runBenchmark = process.env.SOLVER_BENCHMARK === "1";

(runBenchmark ? describe : describe.skip)("user factory benchmark timing", () => {
  it("times each lexicographic phase for the reported slow factory", async () => {
    writeFileSync("/tmp/user-benchmark-result.json", "[]\n");
    const phases: { label: string; phaseMs: number; numBranches: number }[] = [];
    const started = performance.now();
    const result = await solveExact(USER_INPUT, {
      searchWorkers: 8,
      onProgress: (progress) => {
        if (progress.status === "complete" && progress.phaseMs !== undefined) {
          const entry = {
            phase: progress.phase,
            label: progress.label,
            phaseMs: progress.phaseMs,
            numBranches: progress.numBranches ?? 0,
          };
          phases.push(entry);
          appendFileSync("/tmp/user-benchmark-result.json", `${JSON.stringify(entry)}\n`);
        }
      },
    });
    const payload = {
      totalMs: performance.now() - started,
      feasible: result.feasible,
      phases,
    };
    writeFileSync("/tmp/user-benchmark-result.json", JSON.stringify(payload, null, 2));

    expect(result.feasible).toBe(true);
    expect(phases).toHaveLength(6);
  }, 1_800_000);
});
