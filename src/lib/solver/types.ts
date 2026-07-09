import type { ItemId } from "@/data/types";

export interface TargetSpec {
  item: ItemId;
  /** Minimum items/min that must be produced */
  minRate: number;
  /** Relative leftover-allocation weight (0–100). Zero means no leftover share. */
  weight: number;
}

export interface ExcessSpec {
  item: ItemId;
  /**
   * User floor for spare intermediary items/min.
   * Solver may raise this further to soak leftover raws.
   */
  rate: number;
}

export interface PlannerInput {
  /** Available scarce raw rates (items/min) */
  rawAvailable: Partial<Record<ItemId, number>>;
  targets: TargetSpec[];
  excess: ExcessSpec[];
}

export interface RawUtilization {
  item: ItemId;
  available: number;
  used: number;
  leftover: number;
  utilization: number;
  shortfall: number;
}

export interface RecipeUsage {
  recipeId: string;
  recipeName: string;
  building: string;
  /** Physical buildings */
  machines: number;
  /** Uniform clock (0–1), always an allowed underclock */
  clock: number;
  /** machines * clock */
  effectiveMachines: number;
  /** Recipe crafts per minute across all machines */
  cyclesPerMinute: number;
  /** Primary output items/min */
  outputPerMinute: number;
  primaryOutput: ItemId;
}

export interface ItemFlow {
  item: ItemId;
  /** Produced by recipes (items/min) */
  produced: number;
  /** Consumed by recipes (items/min) */
  consumed: number;
  /** Net available as end product / excess / leftover raw */
  net: number;
}

export interface TargetResult {
  item: ItemId;
  minRate: number;
  /** Quantized minimum actually planned */
  plannedMinRate: number;
  extraRate: number;
  totalRate: number;
  weight: number;
}

export interface ExcessResult {
  item: ItemId;
  /** User-requested floor */
  requestedRate: number;
  /** Final spare rate after auto-fill */
  rate: number;
  /** How much the solver added beyond the floor */
  autoRate: number;
}

export interface SolveResult {
  feasible: boolean;
  targets: TargetResult[];
  /** All chain intermediaries with planned excess (auto + user) */
  excess: ExcessResult[];
  raws: RawUtilization[];
  recipes: RecipeUsage[];
  items: ItemFlow[];
  /** Overall scarce-raw utilization (weighted by available capacity) */
  overallUtilization: number;
}
