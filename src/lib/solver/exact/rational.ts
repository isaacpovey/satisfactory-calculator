const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

export type RationalInput = Rational | bigint | number | string;

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

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError(`Invalid decimal exponent: ${exponent}`);
  }
  return TEN ** BigInt(exponent);
}

/**
 * An immutable, normalized rational number backed by BigInt.
 *
 * The denominator is always positive, zero is always 0/1, and numerator and
 * denominator are always coprime.
 */
export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(numerator: bigint, denominator: bigint = ONE) {
    if (denominator === ZERO) {
      throw new RangeError("Rational denominator cannot be zero");
    }

    if (numerator === ZERO) {
      this.numerator = ZERO;
      this.denominator = ONE;
      return;
    }

    const sign = denominator < ZERO ? -ONE : ONE;
    const divisor = gcd(numerator, denominator);
    this.numerator = (numerator / divisor) * sign;
    this.denominator = abs(denominator) / divisor;
  }

  static from(value: RationalInput): Rational {
    if (value instanceof Rational) return value;
    if (typeof value === "bigint") return new Rational(value);
    if (typeof value === "number") return Rational.fromNumber(value);
    return Rational.parse(value);
  }

  static fromNumber(value: number): Rational {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Cannot convert non-finite number to Rational: ${value}`);
    }
    return Rational.parse(value.toString());
  }

  static parse(value: string): Rational {
    const text = value.trim();
    const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/u.exec(text);
    if (fraction) {
      return new Rational(BigInt(fraction[1]!), BigInt(fraction[2]!));
    }

    const decimal = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(text);
    if (!decimal) {
      throw new SyntaxError(`Invalid rational value: "${value}"`);
    }

    const sign = decimal[1] === "-" ? -ONE : ONE;
    const integerDigits = decimal[2] ?? "0";
    const fractionalDigits = decimal[3] ?? decimal[4] ?? "";
    const exponent = Number(decimal[5] ?? "0");
    if (!Number.isSafeInteger(exponent)) {
      throw new RangeError(`Invalid decimal exponent: ${decimal[5]}`);
    }

    const digits = BigInt(`${integerDigits}${fractionalDigits}` || "0") * sign;
    const scale = fractionalDigits.length - exponent;
    return scale >= 0
      ? new Rational(digits, powerOfTen(scale))
      : new Rational(digits * powerOfTen(-scale));
  }

  add(other: RationalInput): Rational {
    const right = Rational.from(other);
    return new Rational(
      this.numerator * right.denominator + right.numerator * this.denominator,
      this.denominator * right.denominator,
    );
  }

  subtract(other: RationalInput): Rational {
    const right = Rational.from(other);
    return new Rational(
      this.numerator * right.denominator - right.numerator * this.denominator,
      this.denominator * right.denominator,
    );
  }

  multiply(other: RationalInput): Rational {
    const right = Rational.from(other);
    return new Rational(this.numerator * right.numerator, this.denominator * right.denominator);
  }

  divide(other: RationalInput): Rational {
    const right = Rational.from(other);
    if (right.numerator === ZERO) {
      throw new RangeError("Cannot divide by zero");
    }
    return new Rational(this.numerator * right.denominator, this.denominator * right.numerator);
  }

  negate(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  abs(): Rational {
    return this.numerator < ZERO ? this.negate() : this;
  }

  reciprocal(): Rational {
    if (this.numerator === ZERO) {
      throw new RangeError("Zero has no reciprocal");
    }
    return new Rational(this.denominator, this.numerator);
  }

  compare(other: RationalInput): number {
    const right = Rational.from(other);
    const difference = this.numerator * right.denominator - right.numerator * this.denominator;
    return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
  }

  equals(other: RationalInput): boolean {
    return this.compare(other) === 0;
  }

  isInteger(): boolean {
    return this.denominator === ONE;
  }

  isZero(): boolean {
    return this.numerator === ZERO;
  }

  floor(): bigint {
    const quotient = this.numerator / this.denominator;
    const remainder = this.numerator % this.denominator;
    return remainder < ZERO ? quotient - ONE : quotient;
  }

  ceil(): bigint {
    const quotient = this.numerator / this.denominator;
    const remainder = this.numerator % this.denominator;
    return remainder > ZERO ? quotient + ONE : quotient;
  }

  toNumber(): number {
    return Number(this.numerator) / Number(this.denominator);
  }

  toFractionString(): string {
    return this.denominator === ONE
      ? this.numerator.toString()
      : `${this.numerator}/${this.denominator}`;
  }

  /**
   * Formats as a rounded decimal with at most `maxFractionDigits` digits.
   * Ties are rounded away from zero and trailing zeroes are omitted.
   */
  toDecimal(maxFractionDigits = 6): string {
    if (!Number.isSafeInteger(maxFractionDigits) || maxFractionDigits < 0) {
      throw new RangeError("maxFractionDigits must be a non-negative safe integer");
    }

    const negative = this.numerator < ZERO;
    const positiveNumerator = abs(this.numerator);
    const integerPart = positiveNumerator / this.denominator;
    let remainder = positiveNumerator % this.denominator;
    if (maxFractionDigits === 0) {
      const rounded = remainder * BigInt(2) >= this.denominator ? integerPart + ONE : integerPart;
      return `${negative && rounded !== ZERO ? "-" : ""}${rounded}`;
    }

    const digits: number[] = [];
    for (let index = 0; index < maxFractionDigits && remainder !== ZERO; index++) {
      remainder *= TEN;
      digits.push(Number(remainder / this.denominator));
      remainder %= this.denominator;
    }

    if (remainder !== ZERO && remainder * BigInt(2) >= this.denominator) {
      let index = digits.length - 1;
      while (index >= 0 && digits[index] === 9) {
        digits[index] = 0;
        index--;
      }
      if (index >= 0) {
        digits[index] = (digits[index] ?? 0) + 1;
      } else {
        const roundedInteger = integerPart + ONE;
        const suffix = digits.map(String).join("").replace(/0+$/u, "");
        return `${negative ? "-" : ""}${roundedInteger}${suffix ? `.${suffix}` : ""}`;
      }
    }

    const suffix = digits.map(String).join("").replace(/0+$/u, "");
    const sign = negative && (integerPart !== ZERO || suffix !== "") ? "-" : "";
    return `${sign}${integerPart}${suffix ? `.${suffix}` : ""}`;
  }

  toString(): string {
    return this.toFractionString();
  }
}

export function rational(value: RationalInput): Rational {
  return Rational.from(value);
}

export function formatRational(value: RationalInput, maxFractionDigits = 6): string {
  return Rational.from(value).toDecimal(maxFractionDigits);
}
