import type { PlannerInput } from "./types";

/** Saved browser planner snapshot used for solver performance regression checks. */
export const BROWSER_FACTORY_BENCHMARK_INPUT: PlannerInput = {
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
    { item: "motor", minRate: 2, weight: 20 },
    { item: "encased-industrial-beam", minRate: 2, weight: 60 },
    { item: "versatile-framework", minRate: 2, weight: 50 },
    { item: "automated-wiring", minRate: 2, weight: 50 },
  ],
  excess: [
    { item: "steel-beam", rate: 5 },
    { item: "steel-pipe", rate: 5 },
    { item: "iron-rod", rate: 5 },
    { item: "iron-plate", rate: 5 },
    { item: "screw", rate: 5 },
    { item: "cable", rate: 5 },
    { item: "stator", rate: 5 },
    { item: "ai-limiter", rate: 5 },
    { item: "rotor", rate: 5 },
    { item: "reinforced-iron-plate", rate: 5 },
    { item: "smart-plating", rate: 20 },
    { item: "wire", rate: 5 },
    { item: "quickwire", rate: 5 },
    { item: "modular-frame", rate: 5 },
    { item: "copper-sheet", rate: 5 },
    { item: "concrete", rate: 5 },
  ],
  maxBeltCapacity: 270,
};
