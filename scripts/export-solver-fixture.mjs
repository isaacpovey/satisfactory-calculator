// Exports the game data and benchmark input as a JSON fixture consumed by the
// Rust solver's native tests (rust/solver/tests/).
// Usage: node --experimental-strip-types scripts/export-solver-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { items, scarceRawIds } = await import(join(root, "src/data/items.ts"));
const { recipes } = await import(join(root, "src/data/recipes.ts"));
const { BROWSER_FACTORY_BENCHMARK_INPUT } = await import(
  join(root, "src/lib/solver/benchmark-config.ts")
);

const gameData = {
  items: items.map((item) => ({
    id: item.id,
    isRaw: item.isRaw ?? false,
    isUnlimited: item.isUnlimited ?? false,
    isIngot: item.isIngot ?? false,
  })),
  recipes: recipes.map((recipe) => ({
    id: recipe.id,
    durationSec: recipe.durationSec,
    inputs: recipe.inputs,
    outputs: recipe.outputs,
  })),
  scarceRawIds,
};

const benchmark = {
  ...gameData,
  rawAvailability: BROWSER_FACTORY_BENCHMARK_INPUT.rawAvailable,
  targets: BROWSER_FACTORY_BENCHMARK_INPUT.targets.map((target) => ({
    item: target.item,
    minimum: target.minRate,
    weight: target.weight,
  })),
  excess: BROWSER_FACTORY_BENCHMARK_INPUT.excess.map((entry) => ({
    item: entry.item,
    floor: entry.rate,
  })),
  beltCapacity: BROWSER_FACTORY_BENCHMARK_INPUT.maxBeltCapacity,
};

const fixtureDir = join(root, "rust/solver/fixtures");
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(join(fixtureDir, "game-data.json"), `${JSON.stringify(gameData, null, 2)}\n`);
writeFileSync(
  join(fixtureDir, "browser-factory-benchmark.json"),
  `${JSON.stringify(benchmark, null, 2)}\n`,
);
console.log("Wrote rust/solver/fixtures/game-data.json and browser-factory-benchmark.json");
