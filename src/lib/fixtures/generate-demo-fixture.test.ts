import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { solveExact } from "@/lib/solver";
import { BROWSER_FACTORY_BENCHMARK_INPUT } from "@/lib/solver/benchmark-config";

describe("generate demo fixture", () => {
  it("writes demo factory snapshot", async () => {
    const result = await solveExact(BROWSER_FACTORY_BENCHMARK_INPUT, {
      searchWorkers: 8,
    });
    expect(result.feasible).toBe(true);

    const fixture = {
      name: "Demo factory (4 targets)",
      plannerInput: BROWSER_FACTORY_BENCHMARK_INPUT,
      result,
    };

    const outPath = resolve(__dirname, "../fixtures/demo-factory.json");
    writeFileSync(outPath, JSON.stringify(fixture));
  }, 1_800_000);
});
