import type { ItemId } from "@/data/types";
import { legalUnderclocks, recipeCyclesPerMinuteExact, recipeRatesAtClock } from "./underclocks";
import type { ExactRecipeBound } from "./bounds";
import { Rational, type RationalInput } from "./rational";

const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const TWO_BIGINT = BigInt(2);
const THREE_BIGINT = BigInt(3);

export interface ExactBankItemRate {
  readonly item: ItemId;
  readonly rate: Rational;
}

export interface ExactMachineBankPattern {
  readonly recipeId: string;
  readonly machines: bigint;
  readonly clock: Rational;
  readonly effectiveMachines: Rational;
  readonly cyclesPerMinute: Rational;
  readonly inputRates: readonly ExactBankItemRate[];
  readonly outputRates: readonly ExactBankItemRate[];
}

/**
 * All 2^a * 3^b counts up to a finite bound. Exponents have no fixed depth
 * limit; the recipe's machine/raw/belt bounds make generation finite.
 */
export function canonicalSplitterMachineCounts(maxMachines: bigint): readonly bigint[] {
  if (maxMachines < ZERO_BIGINT) {
    throw new RangeError("maxMachines cannot be negative");
  }
  if (maxMachines === ZERO_BIGINT) return [];

  const counts = new Set<bigint>();
  for (let powerOfTwo = ONE_BIGINT; powerOfTwo <= maxMachines; powerOfTwo *= TWO_BIGINT) {
    for (let count = powerOfTwo; count <= maxMachines; count *= THREE_BIGINT) {
      counts.add(count);
    }
  }
  return [...counts].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function isCanonicalSplitterMachineCount(count: bigint): boolean {
  if (count <= ZERO_BIGINT) return false;
  let remainder = count;
  while (remainder % TWO_BIGINT === ZERO_BIGINT) remainder /= TWO_BIGINT;
  while (remainder % THREE_BIGINT === ZERO_BIGINT) remainder /= THREE_BIGINT;
  return remainder === ONE_BIGINT;
}

/**
 * Minimum splitter (or merger) devices in a full equal-lane tree. Applying
 * binary stages before ternary stages minimizes the number of internal nodes.
 */
export function equalLaneTreeDevices(count: bigint): bigint {
  if (!isCanonicalSplitterMachineCount(count)) {
    throw new RangeError(`Machine count is not splitter-friendly: ${count}`);
  }
  if (count === ONE_BIGINT) return ZERO_BIGINT;

  let remaining = count;
  let lanes = ONE_BIGINT;
  let devices = ZERO_BIGINT;
  while (remaining % TWO_BIGINT === ZERO_BIGINT) {
    devices += lanes;
    lanes *= TWO_BIGINT;
    remaining /= TWO_BIGINT;
  }
  while (remaining % THREE_BIGINT === ZERO_BIGINT) {
    devices += lanes;
    lanes *= THREE_BIGINT;
    remaining /= THREE_BIGINT;
  }
  return devices;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

/**
 * Generates every legal equal-clock machine-bank pattern that fits one belt
 * for each recipe input and output and stays within the recipe's raw bound.
 */
export function generateMachineBankPatterns(
  bound: ExactRecipeBound,
  beltCapacity: RationalInput,
): readonly ExactMachineBankPattern[] {
  const capacity = Rational.from(beltCapacity);
  if (capacity.compare(0) <= 0) {
    throw new RangeError("Belt capacity must be positive");
  }

  const recipe = bound.recipe;
  const cyclesPerMachine = recipeCyclesPerMinuteExact(recipe);
  const patterns: ExactMachineBankPattern[] = [];

  for (const clock of legalUnderclocks(recipe)) {
    let countLimit = bound.maxEffectiveMachines.divide(clock).floor();
    const rates = recipeRatesAtClock(recipe, clock);
    for (const { rate } of [...rates.inputs, ...rates.outputs]) {
      if (rate.compare(0) <= 0) continue;
      countLimit = minimum(countLimit, capacity.divide(rate).floor());
    }
    countLimit = minimum(countLimit, bound.maxMachines);
    if (countLimit <= ZERO_BIGINT) continue;

    for (const machines of canonicalSplitterMachineCounts(countLimit)) {
      const machineFactor = new Rational(machines);
      const effectiveMachines = clock.multiply(machineFactor);
      patterns.push({
        recipeId: recipe.id,
        machines,
        clock,
        effectiveMachines,
        cyclesPerMinute: cyclesPerMachine.multiply(effectiveMachines),
        inputRates: rates.inputs.map(({ item, rate }) => ({
          item,
          rate: rate.multiply(machineFactor),
        })),
        outputRates: rates.outputs.map(({ item, rate }) => ({
          item,
          rate: rate.multiply(machineFactor),
        })),
      });
    }
  }

  return patterns.toSorted(
    (left, right) =>
      right.clock.compare(left.clock) ||
      (left.machines < right.machines ? -1 : left.machines > right.machines ? 1 : 0),
  );
}
