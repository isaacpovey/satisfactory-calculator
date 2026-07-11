import type { ItemId } from "@/data/types";
import { Rational, type RationalInput } from "../exact/rational";
import type {
  ExactOptimizerInput,
  ExactOptimizerResult,
  ExactProofStatus,
  ExactSelectedBank,
} from "../exact/optimizer-types";

/** JSON payload consumed by the Rust solver (rust/solver/src/data.rs). */
export interface RustSolverInput {
  items: {
    id: ItemId;
    isRaw: boolean;
    isUnlimited: boolean;
    isIngot: boolean;
  }[];
  recipes: {
    id: string;
    durationSec: number;
    inputs: { item: ItemId; amount: number }[];
    outputs: { item: ItemId; amount: number }[];
  }[];
  scarceRawIds: ItemId[];
  rawAvailability: Record<string, string>;
  targets: { item: ItemId; minimum: string; weight: string }[];
  excess: { item: ItemId; floor: string }[];
  beltCapacity: string;
  timeLimitMs?: number;
}

interface RustRatesMap {
  [item: string]: string;
}

interface RustSelectedBank {
  recipeId: string;
  machines: string;
  clock: string;
  multiplicity: string;
  effectiveMachinesPerBank: string;
  cyclesPerMinutePerBank: string;
  inputRatesPerBank: RustRatesMap;
  outputRatesPerBank: RustRatesMap;
}

export interface RustSolverResult {
  feasible: boolean;
  proofStatus: ExactProofStatus;
  selectedBanks: RustSelectedBank[];
  targets: { item: ItemId; minimum: string; weight: string; rate: string }[];
  excess: { item: ItemId; floor: string; rate: string }[];
  raws: {
    item: ItemId;
    unlimited: boolean;
    available: string | null;
    used: string;
    leftover: string | null;
  }[];
  items: {
    item: ItemId;
    produced: string;
    consumed: string;
    targetWithdrawal: string;
    excessWithdrawal: string;
  }[];
  objective: {
    scarceRawItemsPerMinute: string;
    weightedTargetOutput: string;
    physicalMachines: string;
    groups: string;
    internalSplitterMergerDevices: string;
    routingSplitterDevices: string;
    totalSplitterMergerDevices: string;
  } | null;
  phaseTimings: { phase: number; label: string; phaseMs: number }[];
}

function fraction(value: RationalInput | undefined, fallback: RationalInput = 0): string {
  return Rational.from(value ?? fallback).toFractionString();
}

/** Builds the Rust solver JSON payload from the exact optimizer input. */
export function toRustSolverInput(
  input: ExactOptimizerInput,
  timeLimitMs?: number,
): RustSolverInput {
  const rawAvailability: Record<string, string> = {};
  for (const [itemId, value] of Object.entries(input.rawAvailability)) {
    if (value === undefined) continue;
    rawAvailability[itemId] = fraction(value);
  }
  return {
    items: input.graph.items.map((item) => ({
      id: item.id,
      isRaw: !!item.isRaw,
      isUnlimited: !!item.isUnlimited,
      isIngot: !!item.isIngot,
    })),
    recipes: input.graph.recipes.map((recipe) => ({
      id: recipe.id,
      durationSec: recipe.durationSec,
      inputs: recipe.inputs.map((entry) => ({ item: entry.item, amount: entry.amount })),
      outputs: recipe.outputs.map((entry) => ({ item: entry.item, amount: entry.amount })),
    })),
    scarceRawIds: [...input.graph.scarceRawIds],
    rawAvailability,
    targets: input.targets.map((target) => ({
      item: target.item,
      minimum: fraction(target.minimum ?? target.minRate),
      weight: fraction(target.weight),
    })),
    excess: (input.excess ?? []).map((entry) => ({
      item: entry.item,
      floor: fraction(entry.floor ?? entry.rate),
    })),
    beltCapacity: fraction(input.beltCapacity),
    ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
  };
}

function parseRatesMap(rates: RustRatesMap): ReadonlyMap<ItemId, Rational> {
  return new Map(
    Object.entries(rates).map(([item, rate]) => [item as ItemId, Rational.parse(rate)] as const),
  );
}

/** Parses the Rust solver JSON result into the exact optimizer result shape. */
export function fromRustSolverResult(result: RustSolverResult): ExactOptimizerResult {
  const selectedBanks: ExactSelectedBank[] = result.selectedBanks.map((bank) => ({
    recipeId: bank.recipeId,
    machines: BigInt(bank.machines),
    clock: Rational.parse(bank.clock),
    multiplicity: BigInt(bank.multiplicity),
    effectiveMachinesPerBank: Rational.parse(bank.effectiveMachinesPerBank),
    cyclesPerMinutePerBank: Rational.parse(bank.cyclesPerMinutePerBank),
    inputRatesPerBank: parseRatesMap(bank.inputRatesPerBank),
    outputRatesPerBank: parseRatesMap(bank.outputRatesPerBank),
  }));
  return {
    feasible: result.feasible,
    proofStatus: result.proofStatus,
    selectedBanks,
    targets: result.targets.map((target) => ({
      item: target.item,
      minimum: Rational.parse(target.minimum),
      weight: Rational.parse(target.weight),
      rate: Rational.parse(target.rate),
    })),
    excess: result.excess.map((entry) => ({
      item: entry.item,
      floor: Rational.parse(entry.floor),
      rate: Rational.parse(entry.rate),
    })),
    raws: result.raws.map((raw) => ({
      item: raw.item,
      unlimited: raw.unlimited,
      available: raw.available === null ? null : Rational.parse(raw.available),
      used: Rational.parse(raw.used),
      leftover: raw.leftover === null ? null : Rational.parse(raw.leftover),
    })),
    items: result.items.map((item) => ({
      item: item.item,
      produced: Rational.parse(item.produced),
      consumed: Rational.parse(item.consumed),
      targetWithdrawal: Rational.parse(item.targetWithdrawal),
      excessWithdrawal: Rational.parse(item.excessWithdrawal),
    })),
    objective:
      result.objective === null
        ? null
        : {
            scarceRawItemsPerMinute: Rational.parse(result.objective.scarceRawItemsPerMinute),
            weightedTargetOutput: Rational.parse(result.objective.weightedTargetOutput),
            physicalMachines: BigInt(result.objective.physicalMachines),
            groups: BigInt(result.objective.groups),
            internalSplitterMergerDevices: BigInt(result.objective.internalSplitterMergerDevices),
            routingSplitterDevices: BigInt(result.objective.routingSplitterDevices),
            totalSplitterMergerDevices: BigInt(result.objective.totalSplitterMergerDevices),
          },
  };
}
