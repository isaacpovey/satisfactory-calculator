import type { ItemId, Recipe } from "./types";

/**
 * Standard (non-alternate) recipes through Tier 4, plus early MAM chains
 * (Caterium, Quartz, Sulfur). Rates match Satisfactory wiki craft times / amounts.
 */
export const recipes: Recipe[] = [
  {
    id: "iron-ingot",
    name: "Iron Ingot",
    building: "smelter",
    durationSec: 2,
    inputs: [{ item: "iron-ore", amount: 1 }],
    outputs: [{ item: "iron-ingot", amount: 1 }],
    tier: 0,
  },
  {
    id: "copper-ingot",
    name: "Copper Ingot",
    building: "smelter",
    durationSec: 2,
    inputs: [{ item: "copper-ore", amount: 1 }],
    outputs: [{ item: "copper-ingot", amount: 1 }],
    tier: 0,
  },
  {
    id: "iron-plate",
    name: "Iron Plate",
    building: "constructor",
    durationSec: 6,
    inputs: [{ item: "iron-ingot", amount: 3 }],
    outputs: [{ item: "iron-plate", amount: 2 }],
    tier: 0,
  },
  {
    id: "iron-rod",
    name: "Iron Rod",
    building: "constructor",
    durationSec: 4,
    inputs: [{ item: "iron-ingot", amount: 1 }],
    outputs: [{ item: "iron-rod", amount: 1 }],
    tier: 0,
  },
  {
    id: "screw",
    name: "Screws",
    building: "constructor",
    durationSec: 6,
    inputs: [{ item: "iron-rod", amount: 1 }],
    outputs: [{ item: "screw", amount: 4 }],
    tier: 0,
  },
  {
    id: "wire",
    name: "Wire",
    building: "constructor",
    durationSec: 4,
    inputs: [{ item: "copper-ingot", amount: 1 }],
    outputs: [{ item: "wire", amount: 2 }],
    tier: 0,
  },
  {
    id: "cable",
    name: "Cable",
    building: "constructor",
    durationSec: 2,
    inputs: [{ item: "wire", amount: 2 }],
    outputs: [{ item: "cable", amount: 1 }],
    tier: 0,
  },
  {
    id: "concrete",
    name: "Concrete",
    building: "constructor",
    durationSec: 4,
    inputs: [{ item: "limestone", amount: 3 }],
    outputs: [{ item: "concrete", amount: 1 }],
    tier: 0,
  },
  {
    id: "copper-sheet",
    name: "Copper Sheet",
    building: "constructor",
    durationSec: 6,
    inputs: [{ item: "copper-ingot", amount: 2 }],
    outputs: [{ item: "copper-sheet", amount: 1 }],
    tier: 2,
  },
  {
    id: "reinforced-iron-plate",
    name: "Reinforced Iron Plate",
    building: "assembler",
    durationSec: 12,
    inputs: [
      { item: "iron-plate", amount: 6 },
      { item: "screw", amount: 12 },
    ],
    outputs: [{ item: "reinforced-iron-plate", amount: 1 }],
    tier: 0,
  },
  {
    id: "rotor",
    name: "Rotor",
    building: "assembler",
    durationSec: 15,
    inputs: [
      { item: "iron-rod", amount: 5 },
      { item: "screw", amount: 25 },
    ],
    outputs: [{ item: "rotor", amount: 1 }],
    tier: 2,
  },
  {
    id: "modular-frame",
    name: "Modular Frame",
    building: "assembler",
    durationSec: 60,
    inputs: [
      { item: "reinforced-iron-plate", amount: 3 },
      { item: "iron-rod", amount: 12 },
    ],
    outputs: [{ item: "modular-frame", amount: 2 }],
    tier: 2,
  },
  {
    id: "smart-plating",
    name: "Smart Plating",
    building: "assembler",
    durationSec: 30,
    inputs: [
      { item: "reinforced-iron-plate", amount: 1 },
      { item: "rotor", amount: 1 },
    ],
    outputs: [{ item: "smart-plating", amount: 1 }],
    tier: 2,
  },
  {
    id: "steel-ingot",
    name: "Steel Ingot",
    building: "foundry",
    durationSec: 4,
    inputs: [
      { item: "iron-ore", amount: 3 },
      { item: "coal", amount: 3 },
    ],
    outputs: [{ item: "steel-ingot", amount: 3 }],
    tier: 3,
  },
  {
    id: "steel-beam",
    name: "Steel Beam",
    building: "constructor",
    durationSec: 4,
    inputs: [{ item: "steel-ingot", amount: 4 }],
    outputs: [{ item: "steel-beam", amount: 1 }],
    tier: 3,
  },
  {
    id: "steel-pipe",
    name: "Steel Pipe",
    building: "constructor",
    durationSec: 6,
    inputs: [{ item: "steel-ingot", amount: 3 }],
    outputs: [{ item: "steel-pipe", amount: 2 }],
    tier: 3,
  },
  {
    id: "versatile-framework",
    name: "Versatile Framework",
    building: "assembler",
    durationSec: 24,
    inputs: [
      { item: "modular-frame", amount: 1 },
      { item: "steel-beam", amount: 12 },
    ],
    outputs: [{ item: "versatile-framework", amount: 2 }],
    tier: 3,
  },
  {
    id: "encased-industrial-beam",
    name: "Encased Industrial Beam",
    building: "assembler",
    durationSec: 10,
    inputs: [
      { item: "steel-beam", amount: 3 },
      { item: "concrete", amount: 6 },
    ],
    outputs: [{ item: "encased-industrial-beam", amount: 1 }],
    tier: 4,
  },
  {
    id: "stator",
    name: "Stator",
    building: "assembler",
    durationSec: 12,
    inputs: [
      { item: "steel-pipe", amount: 3 },
      { item: "wire", amount: 8 },
    ],
    outputs: [{ item: "stator", amount: 1 }],
    tier: 4,
  },
  {
    id: "motor",
    name: "Motor",
    building: "assembler",
    durationSec: 12,
    inputs: [
      { item: "rotor", amount: 2 },
      { item: "stator", amount: 2 },
    ],
    outputs: [{ item: "motor", amount: 1 }],
    tier: 4,
  },
  {
    id: "automated-wiring",
    name: "Automated Wiring",
    building: "assembler",
    durationSec: 24,
    inputs: [
      { item: "stator", amount: 1 },
      { item: "cable", amount: 20 },
    ],
    outputs: [{ item: "automated-wiring", amount: 1 }],
    tier: 4,
  },
  // --- MAM: Caterium ---
  {
    id: "caterium-ingot",
    name: "Caterium Ingot",
    building: "smelter",
    durationSec: 4,
    inputs: [{ item: "caterium-ore", amount: 3 }],
    outputs: [{ item: "caterium-ingot", amount: 1 }],
    tier: 0,
  },
  {
    id: "quickwire",
    name: "Quickwire",
    building: "constructor",
    durationSec: 5,
    inputs: [{ item: "caterium-ingot", amount: 1 }],
    outputs: [{ item: "quickwire", amount: 5 }],
    tier: 0,
  },
  {
    id: "ai-limiter",
    name: "AI Limiter",
    building: "assembler",
    durationSec: 12,
    inputs: [
      { item: "copper-sheet", amount: 5 },
      { item: "quickwire", amount: 20 },
    ],
    outputs: [{ item: "ai-limiter", amount: 1 }],
    tier: 0,
  },
  // --- MAM: Quartz ---
  {
    id: "quartz-crystal",
    name: "Quartz Crystal",
    building: "constructor",
    durationSec: 8,
    inputs: [{ item: "raw-quartz", amount: 5 }],
    outputs: [{ item: "quartz-crystal", amount: 3 }],
    tier: 0,
  },
  {
    id: "silica",
    name: "Silica",
    building: "constructor",
    durationSec: 8,
    inputs: [{ item: "raw-quartz", amount: 3 }],
    outputs: [{ item: "silica", amount: 5 }],
    tier: 0,
  },
  {
    id: "crystal-oscillator",
    name: "Crystal Oscillator",
    building: "manufacturer",
    durationSec: 120,
    inputs: [
      { item: "quartz-crystal", amount: 36 },
      { item: "cable", amount: 28 },
      { item: "reinforced-iron-plate", amount: 5 },
    ],
    outputs: [{ item: "crystal-oscillator", amount: 2 }],
    tier: 0,
  },
  // --- MAM: Sulfur ---
  {
    id: "compacted-coal",
    name: "Compacted Coal",
    building: "assembler",
    durationSec: 12,
    inputs: [
      { item: "coal", amount: 5 },
      { item: "sulfur", amount: 5 },
    ],
    outputs: [{ item: "compacted-coal", amount: 5 }],
    tier: 0,
  },
  {
    id: "black-powder",
    name: "Black Powder",
    building: "assembler",
    durationSec: 4,
    inputs: [
      { item: "coal", amount: 1 },
      { item: "sulfur", amount: 1 },
    ],
    outputs: [{ item: "black-powder", amount: 2 }],
    tier: 0,
  },
  {
    id: "nobelisk",
    name: "Nobelisk",
    building: "assembler",
    durationSec: 6,
    inputs: [
      { item: "black-powder", amount: 2 },
      { item: "steel-pipe", amount: 2 },
    ],
    outputs: [{ item: "nobelisk", amount: 1 }],
    tier: 0,
  },
];

/** Default recipe that produces each manufactured item (primary output). */
export const recipeByProduct: Partial<Record<ItemId, Recipe>> = {};
for (const recipe of recipes) {
  const primary = recipe.outputs[0];
  if (primary && !recipeByProduct[primary.item]) {
    recipeByProduct[primary.item] = recipe;
  }
}

export function getRecipeForProduct(itemId: ItemId): Recipe | undefined {
  return recipeByProduct[itemId];
}

/** Cycles per minute for a recipe at 100% clock. */
export function recipeCyclesPerMinute(recipe: Recipe): number {
  return 60 / recipe.durationSec;
}

/** Output items/min for the primary product of one machine. */
export function recipePrimaryOutputPerMinute(recipe: Recipe): number {
  const primary = recipe.outputs[0];
  if (!primary) return 0;
  return primary.amount * recipeCyclesPerMinute(recipe);
}
