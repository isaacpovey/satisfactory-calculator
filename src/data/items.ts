import type { Building, Item, ItemId } from "./types";

export const buildings: Building[] = [
  { id: "smelter", name: "Smelter" },
  { id: "constructor", name: "Constructor" },
  { id: "assembler", name: "Assembler" },
  { id: "foundry", name: "Foundry" },
  { id: "manufacturer", name: "Manufacturer" },
  { id: "water-extractor", name: "Water Extractor" },
];

export const items: Item[] = [
  { id: "iron-ore", name: "Iron Ore", isRaw: true, tier: 0 },
  { id: "copper-ore", name: "Copper Ore", isRaw: true, tier: 0 },
  { id: "limestone", name: "Limestone", isRaw: true, tier: 0 },
  { id: "coal", name: "Coal", isRaw: true, tier: 3 },
  { id: "water", name: "Water", isRaw: true, isUnlimited: true, tier: 3 },
  { id: "caterium-ore", name: "Caterium Ore", isRaw: true, tier: 0 },
  { id: "raw-quartz", name: "Raw Quartz", isRaw: true, tier: 0 },
  { id: "sulfur", name: "Sulfur", isRaw: true, tier: 0 },
  { id: "iron-ingot", name: "Iron Ingot", isRaw: false, isIngot: true, tier: 0 },
  { id: "copper-ingot", name: "Copper Ingot", isRaw: false, isIngot: true, tier: 0 },
  { id: "iron-plate", name: "Iron Plate", isRaw: false, tier: 0 },
  { id: "iron-rod", name: "Iron Rod", isRaw: false, tier: 0 },
  { id: "screw", name: "Screws", isRaw: false, tier: 0 },
  { id: "wire", name: "Wire", isRaw: false, tier: 0 },
  { id: "cable", name: "Cable", isRaw: false, tier: 0 },
  { id: "concrete", name: "Concrete", isRaw: false, tier: 0 },
  { id: "copper-sheet", name: "Copper Sheet", isRaw: false, tier: 2 },
  {
    id: "reinforced-iron-plate",
    name: "Reinforced Iron Plate",
    isRaw: false,
    tier: 0,
  },
  { id: "rotor", name: "Rotor", isRaw: false, tier: 2 },
  { id: "modular-frame", name: "Modular Frame", isRaw: false, tier: 2 },
  { id: "smart-plating", name: "Smart Plating", isRaw: false, tier: 2 },
  { id: "steel-ingot", name: "Steel Ingot", isRaw: false, isIngot: true, tier: 3 },
  { id: "steel-beam", name: "Steel Beam", isRaw: false, tier: 3 },
  { id: "steel-pipe", name: "Steel Pipe", isRaw: false, tier: 3 },
  {
    id: "versatile-framework",
    name: "Versatile Framework",
    isRaw: false,
    tier: 3,
  },
  {
    id: "encased-industrial-beam",
    name: "Encased Industrial Beam",
    isRaw: false,
    tier: 4,
  },
  { id: "stator", name: "Stator", isRaw: false, tier: 4 },
  { id: "motor", name: "Motor", isRaw: false, tier: 4 },
  { id: "automated-wiring", name: "Automated Wiring", isRaw: false, tier: 4 },
  { id: "caterium-ingot", name: "Caterium Ingot", isRaw: false, isIngot: true, tier: 0 },
  { id: "quickwire", name: "Quickwire", isRaw: false, tier: 0 },
  { id: "ai-limiter", name: "AI Limiter", isRaw: false, tier: 0 },
  { id: "quartz-crystal", name: "Quartz Crystal", isRaw: false, tier: 0 },
  { id: "silica", name: "Silica", isRaw: false, tier: 0 },
  {
    id: "crystal-oscillator",
    name: "Crystal Oscillator",
    isRaw: false,
    tier: 0,
  },
  { id: "compacted-coal", name: "Compacted Coal", isRaw: false, tier: 0 },
  { id: "black-powder", name: "Black Powder", isRaw: false, tier: 0 },
  { id: "nobelisk", name: "Nobelisk", isRaw: false, tier: 0 },
];

export const itemById: Record<ItemId, Item> = Object.fromEntries(
  items.map((item) => [item.id, item]),
) as Record<ItemId, Item>;

/** Scarce raw resources the planner treats as capacity constraints */
export const scarceRawIds: ItemId[] = items
  .filter((item) => item.isRaw && !item.isUnlimited)
  .map((item) => item.id);

/** Smelted intermediates — never end products or excess sinks */
export const ingotIds: ItemId[] = items
  .filter((item) => item.isIngot)
  .map((item) => item.id);

/** Manufactured parts that can be selected as end products or excess sinks */
export const manufacturedItemIds: ItemId[] = items
  .filter((item) => !item.isRaw && !item.isIngot)
  .map((item) => item.id);
