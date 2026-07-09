export type ItemId =
  | "iron-ore"
  | "copper-ore"
  | "limestone"
  | "coal"
  | "water"
  | "iron-ingot"
  | "copper-ingot"
  | "iron-plate"
  | "iron-rod"
  | "screw"
  | "wire"
  | "cable"
  | "concrete"
  | "copper-sheet"
  | "reinforced-iron-plate"
  | "rotor"
  | "modular-frame"
  | "smart-plating"
  | "steel-ingot"
  | "steel-beam"
  | "steel-pipe"
  | "versatile-framework"
  | "encased-industrial-beam"
  | "stator"
  | "motor"
  | "automated-wiring";

export type BuildingId =
  | "smelter"
  | "constructor"
  | "assembler"
  | "foundry"
  | "water-extractor";

export interface ItemAmount {
  item: ItemId;
  amount: number;
}

export interface Item {
  id: ItemId;
  name: string;
  /** Raw resource nodes / extractors */
  isRaw: boolean;
  /** Unlimited inputs (e.g. water) are not scarce constraints */
  isUnlimited?: boolean;
  tier: number;
}

export interface Building {
  id: BuildingId;
  name: string;
}

export interface Recipe {
  id: string;
  name: string;
  building: BuildingId;
  /** Craft duration in seconds */
  durationSec: number;
  inputs: ItemAmount[];
  outputs: ItemAmount[];
  tier: number;
}
