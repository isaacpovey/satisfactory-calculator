import type { ItemId } from "@/data/types";
import type { ExactRecipeGraph } from "./recipe-graph";
import type { Rational, RationalInput } from "./rational";

export interface ExactTargetSpec {
  readonly item: ItemId;
  /** Exact minimum withdrawal rate in items/min. */
  readonly minimum?: RationalInput;
  /** Compatibility spelling for planner-shaped callers. */
  readonly minRate?: RationalInput;
  readonly weight: RationalInput;
}

export interface ExactExcessSpec {
  readonly item: ItemId;
  /** Exact storage withdrawal floor in items/min. */
  readonly floor?: RationalInput;
  /** Compatibility spelling for planner-shaped callers. */
  readonly rate?: RationalInput;
}

export interface ExactSolveProgress {
  /** One-based index of the active lexicographic objective. */
  readonly phase: number;
  readonly phaseCount: number;
  readonly label: string;
  readonly status: "solving" | "complete";
}

export interface ExactOptimizerInput {
  readonly graph: ExactRecipeGraph;
  readonly rawAvailability: Partial<Record<ItemId, RationalInput>>;
  readonly targets: readonly ExactTargetSpec[];
  readonly excess?: readonly ExactExcessSpec[];
  readonly beltCapacity: RationalInput;
  readonly signal?: AbortSignal;
  /** Overrides the hardware-aware CP-SAT worker count. */
  readonly searchWorkers?: number;
  /** Uses CP-SAT's deterministic interleaved parallel search. */
  readonly interleaveSearch?: boolean;
  readonly onProgress?: (progress: ExactSolveProgress) => void;
}

export interface ExactSelectedBank {
  readonly recipeId: string;
  readonly machines: bigint;
  readonly clock: Rational;
  /** Number of identical bank groups selected. */
  readonly multiplicity: bigint;
  readonly effectiveMachinesPerBank: Rational;
  readonly cyclesPerMinutePerBank: Rational;
  readonly inputRatesPerBank: ReadonlyMap<ItemId, Rational>;
  readonly outputRatesPerBank: ReadonlyMap<ItemId, Rational>;
}

export interface ExactTargetRate {
  readonly item: ItemId;
  readonly minimum: Rational;
  readonly weight: Rational;
  readonly rate: Rational;
}

export interface ExactExcessRate {
  readonly item: ItemId;
  readonly floor: Rational;
  readonly rate: Rational;
}

export interface ExactRawRate {
  readonly item: ItemId;
  readonly unlimited: boolean;
  readonly available: Rational | null;
  readonly used: Rational;
  readonly leftover: Rational | null;
}

export interface ExactItemRate {
  readonly item: ItemId;
  readonly produced: Rational;
  readonly consumed: Rational;
  readonly targetWithdrawal: Rational;
  readonly excessWithdrawal: Rational;
}

export interface ExactObjectiveVector {
  readonly scarceRawItemsPerMinute: Rational;
  readonly weightedTargetOutput: Rational;
  readonly physicalMachines: bigint;
  readonly groups: bigint;
  readonly internalSplitterMergerDevices: bigint;
  readonly routingSplitterDevices: bigint;
  readonly totalSplitterMergerDevices: bigint;
}

export type ExactProofStatus = "OPTIMAL" | "INFEASIBLE" | "CANCELLED";

export interface ExactOptimizerResult {
  readonly feasible: boolean;
  readonly proofStatus: ExactProofStatus;
  readonly selectedBanks: readonly ExactSelectedBank[];
  readonly targets: readonly ExactTargetRate[];
  readonly excess: readonly ExactExcessRate[];
  readonly raws: readonly ExactRawRate[];
  readonly items: readonly ExactItemRate[];
  readonly objective: ExactObjectiveVector | null;
}

export interface ExactSolutionValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}
