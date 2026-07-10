import type { ItemAmount, Recipe } from "@/data/types";
import { Rational } from "./rational";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const SIXTY = new Rational(BigInt(60));

export interface ExactItemRate {
  readonly item: ItemAmount["item"];
  readonly rate: Rational;
}

export function recipeCyclesPerMinuteExact(recipe: Recipe): Rational {
  return SIXTY.divide(Rational.from(recipe.durationSec));
}

export function recipeRatesAtClock(
  recipe: Recipe,
  clock: Rational,
): { readonly inputs: readonly ExactItemRate[]; readonly outputs: readonly ExactItemRate[] } {
  if (clock.compare(0) <= 0 || clock.compare(1) > 0) {
    throw new RangeError(`Clock must be in (0, 1], received ${clock.toString()}`);
  }
  const cycles = recipeCyclesPerMinuteExact(recipe).multiply(clock);
  return {
    inputs: recipe.inputs.map((input) => ({
      item: input.item,
      rate: Rational.from(input.amount).multiply(cycles),
    })),
    outputs: recipe.outputs.map((output) => ({
      item: output.item,
      rate: Rational.from(output.amount).multiply(cycles),
    })),
  };
}

/**
 * Enumerates every reduced clock c in (0, 1] for which at least one input or
 * output rate of one machine is an integer number of items per minute.
 */
export function legalUnderclocks(recipe: Recipe): readonly Rational[] {
  const cycles = recipeCyclesPerMinuteExact(recipe);
  if (cycles.compare(0) <= 0) {
    throw new RangeError(`Recipe ${recipe.id} must have a positive cycle rate`);
  }

  const clocks = new Map<string, Rational>();
  for (const amount of [...recipe.inputs, ...recipe.outputs]) {
    const fullRate = Rational.from(amount.amount).multiply(cycles);
    if (fullRate.compare(0) <= 0) {
      throw new RangeError(`Recipe ${recipe.id} has a non-positive rate for ${amount.item}`);
    }

    const largestIntegerRate = fullRate.floor();
    for (let integerRate = ONE; integerRate <= largestIntegerRate; integerRate += ONE) {
      const clock = new Rational(integerRate).divide(fullRate);
      if (clock.compare(0) <= 0 || clock.compare(1) > 0) continue;
      clocks.set(clock.toFractionString(), clock);
    }
  }

  return [...clocks.values()].toSorted((left, right) => left.compare(right));
}

export function isLegalUnderclock(recipe: Recipe, clock: Rational): boolean {
  if (clock.compare(0) <= 0 || clock.compare(1) > 0) return false;
  const rates = recipeRatesAtClock(recipe, clock);
  return [...rates.inputs, ...rates.outputs].some(
    ({ rate }) => rate.numerator !== ZERO && rate.isInteger(),
  );
}
