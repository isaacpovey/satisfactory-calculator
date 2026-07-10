import { LinearExpr, type IntVar, type LinearExprLike } from "or-tools-wasm/cp-sat";
import type { Rational } from "./rational";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);

export interface RationalLinearTerm {
  readonly variable: IntVar;
  readonly coefficient: Rational;
  readonly upperBound: bigint;
}

export interface SafeIntegerExpression {
  readonly expression: LinearExprLike;
  /** Multiplier that converts the rational expression to this integer expression. */
  readonly scale: bigint;
  readonly maximumAbsoluteValue: bigint;
}

function abs(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left);
  let b = abs(right);
  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === ZERO ? ONE : a;
}

function lcm(left: bigint, right: bigint): bigint {
  return (left / gcd(left, right)) * right;
}

export function denominatorLcm(values: Iterable<Rational>): bigint {
  let result = ONE;
  for (const value of values) {
    result = lcm(result, value.denominator);
    checkedSafeInteger(result, "row denominator LCM");
  }
  return result;
}

export function checkedSafeInteger(value: bigint, label: string): number {
  if (value < SAFE_MIN || value > SAFE_MAX) {
    throw new RangeError(`${label} exceeds JavaScript's exact safe-integer range: ${value}`);
  }
  return Number(value);
}

export function exactInteger(value: Rational, scale: bigint, label: string): bigint {
  const scaledNumerator = value.numerator * scale;
  if (scaledNumerator % value.denominator !== ZERO) {
    throw new RangeError(`${label} is not integral at scale ${scale}`);
  }
  return scaledNumerator / value.denominator;
}

/**
 * Converts one rational row/objective at a time. The local LCM avoids a large
 * model-wide scale, while every coefficient and possible expression value is
 * checked before it reaches the number-based high-level CP-SAT API.
 */
export function safeIntegerExpression(
  terms: readonly RationalLinearTerm[],
  label: string,
): SafeIntegerExpression {
  const scale = denominatorLcm(terms.map((term) => term.coefficient));
  const variables: IntVar[] = [];
  const coefficients: number[] = [];
  let maximumAbsoluteValue = ZERO;

  for (const term of terms) {
    if (term.upperBound < ZERO) {
      throw new RangeError(`${label} has a negative variable upper bound`);
    }
    const coefficient = exactInteger(term.coefficient, scale, `${label} coefficient`);
    variables.push(term.variable);
    coefficients.push(checkedSafeInteger(coefficient, `${label} coefficient`));
    maximumAbsoluteValue += abs(coefficient) * term.upperBound;
  }

  checkedSafeInteger(maximumAbsoluteValue, `${label} maximum absolute value`);
  return {
    expression: LinearExpr.weightedSum(variables, coefficients),
    scale,
    maximumAbsoluteValue,
  };
}
