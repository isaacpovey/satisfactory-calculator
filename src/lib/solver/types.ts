import type { ItemId } from "@/data/types";
import type { SplitterStep } from "./constraints";

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
  /** Physical buildings in this group */
  machines: number;
  /** Clock for this group (0–1), always an allowed underclock */
  clock: number;
  /** machines * clock */
  effectiveMachines: number;
  /** Recipe crafts per minute for this group */
  cyclesPerMinute: number;
  /** Primary output items/min for this group */
  outputPerMinute: number;
  primaryOutput: ItemId;
  /** Index among groups for the same recipe (0-based) */
  groupIndex: number;
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

export interface SplitPlan {
  /** Friendly fraction of parent, e.g. 1/3 — null if sole consumer / merge-only / unfriendly */
  ratio: { num: number; den: number } | null;
  /** Ordered nested splitters, e.g. ["1/2","1/3"] */
  steps: SplitterStep[];
  /** True when rate is a pure merge (no splitter needed) */
  mergeOnly: boolean;
}

export interface MachineGroupPlan {
  machines: number;
  clock: number;
  effectiveMachines: number;
  /** Nested 1/2 + 1/3 steps to feed this group equally */
  inputSplit: SplitPlan;
}

export interface ProductionStage {
  recipeId: string;
  recipeName: string;
  building: string;
  primaryOutput: ItemId;
  groups: MachineGroupPlan[];
  /** Total primary output items/min across groups */
  outputPerMinute: number;
}

export type FlowKind = "recipe" | "target" | "excess" | "raw";

export interface FlowEndpoint {
  kind: "stage" | "raw" | FlowKind;
  id: string;
}

export interface FlowEdge {
  item: ItemId;
  rate: number;
  from: { kind: "stage" | "raw"; id: string };
  to: { kind: FlowKind; id: string };
  /** How to take `rate` off the parent belt among sibling edges of the same item */
  outputSplit: SplitPlan;
}

export interface FactoryNetwork {
  stages: ProductionStage[];
  edges: FlowEdge[];
}

export interface SolveResult {
  feasible: boolean;
  targets: TargetResult[];
  /** All chain intermediaries with planned excess (auto + user) */
  excess: ExcessResult[];
  raws: RawUtilization[];
  recipes: RecipeUsage[];
  items: ItemFlow[];
  network: FactoryNetwork;
  /** Overall scarce-raw utilization (weighted by available capacity) */
  overallUtilization: number;
}
