import type { ItemId } from "@/data/types";
import type { MergerStep, SplitterStep } from "./constraints";

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
  /** Max conveyor capacity (60 / 120 / 270). Default Mk.3 = 270. */
  maxBeltCapacity?: number;
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
  /** Friendly fraction of parent, e.g. 1/3 — null if sole consumer / merge-only / overflow */
  ratio: { num: number; den: number } | null;
  /** Ordered nested splitters, e.g. ["1/2","1/3"] */
  steps: SplitterStep[];
  /** True when rate is a pure merge (no splitter needed) */
  mergeOnly: boolean;
  /**
   * Excess branch using programmable/smart overflow to storage.
   * Never used for production (recipe/target) custom splits.
   */
  overflowToStorage?: boolean;
  /**
   * Production takes this rate from a lane; the remainder is overflow to
   * storage (programmable/smart). Ratio need not be nested-splitter-friendly.
   */
  restAfterOverflow?: boolean;
}

export interface MergePlan {
  /** Number of bank output belts being combined into this parent lane */
  beltCount: number;
  /** Nested 2→1 / 3→1 merger steps */
  steps: MergerStep[];
  /** Combined items/min on the parent lane after merges */
  rate: number;
  /** True when a single bank belt — no merger needed */
  mergeOnly: boolean;
  /** Per-bank output rates feeding this merge (items/min) */
  sourceRates: number[];
  /** 0-based bank indices matching `sourceRates` (stable Bank 1, Bank 2, …) */
  sourceBankIndexes: number[];
  /**
   * Sole production/excess destination for this lane. Destination-first
   * routing never shares one output belt across production consumers.
   */
  to?: { kind: FlowKind; id: string };
  /** Items/min this destination takes from the lane (≤ rate); rest → overflow */
  consumerRate?: number;
}

export interface MachineGroupPlan {
  machines: number;
  clock: number;
  effectiveMachines: number;
  /** Nested 1/2 + 1/3 steps to feed this group equally (within the bank) */
  inputSplit: SplitPlan;
  /** Primary output items/min from this bank alone */
  outputPerMinute: number;
}

/** One belt of an input item feeding one or more banks (≤ max belt capacity). */
export interface StageInputBeltFeed {
  bankIndex: number;
  /** Items/min this belt delivers to the bank */
  rate: number;
  /** How many machines in that bank this belt feeds */
  machines: number;
}

export interface StageInputBelt {
  item: ItemId;
  /** Items/min on this belt (≤ max belt capacity) */
  rate: number;
  /** How this belt splits among its feeds (equal N-way when shared) */
  split: SplitPlan;
  feeds: StageInputBeltFeed[];
  from: { kind: "stage" | "raw"; id: string };
}

export interface ProductionStage {
  recipeId: string;
  recipeName: string;
  building: string;
  primaryOutput: ItemId;
  groups: MachineGroupPlan[];
  /** Total primary output items/min across groups */
  outputPerMinute: number;
  /**
   * Per-destination output belts (belt-capped). Each lane feeds one
   * destination; leftovers on a lane overflow to storage.
   */
  outputMerges: MergePlan[];
  /**
   * Belt-capped input lanes into this stage (not one illegal mega-belt).
   * Each lane feeds one or more banks.
   */
  inputBelts: StageInputBelt[];
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
  /**
   * When `from` is a stage with multiple output lanes, which lane this edge
   * draws from (0-based). Null/undefined = whole stage / single lane / raw.
   */
  fromLaneIndex?: number | null;
}

export interface ProductionChainGroup {
  id: string;
  label: string;
  stageIds: string[];
}

export interface FactoryNetwork {
  stages: ProductionStage[];
  chains: ProductionChainGroup[];
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
  /** Max belt capacity used for packing */
  maxBeltCapacity: number;
}
