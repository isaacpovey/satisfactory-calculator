import { describe, expect, it } from "vitest";
import { formatRational, Rational } from "./rational";

describe("Rational", () => {
  it("normalizes signs, common factors, and zero", () => {
    expect(new Rational(BigInt(6), BigInt(-8)).toFractionString()).toBe("-3/4");
    expect(new Rational(BigInt(-6), BigInt(-8)).toFractionString()).toBe("3/4");
    expect(new Rational(BigInt(0), BigInt(-99)).toFractionString()).toBe("0");
  });

  it("performs exact arithmetic", () => {
    const oneThird = new Rational(BigInt(1), BigInt(3));
    const oneSixth = new Rational(BigInt(1), BigInt(6));

    expect(oneThird.add(oneSixth).toString()).toBe("1/2");
    expect(oneThird.subtract(oneSixth).toString()).toBe("1/6");
    expect(oneThird.multiply("9/2").toString()).toBe("3/2");
    expect(oneThird.divide("2/5").toString()).toBe("5/6");
    expect(oneThird.compare("0.34")).toBeLessThan(0);
    expect(oneThird.reciprocal().toString()).toBe("3");
  });

  it("parses decimal and exponent strings exactly", () => {
    expect(Rational.parse("001.2500").toString()).toBe("5/4");
    expect(Rational.parse("-.125").toString()).toBe("-1/8");
    expect(Rational.parse("12.").toString()).toBe("12");
    expect(Rational.parse("1.2e-3").toString()).toBe("3/2500");
    expect(Rational.parse("-2.5E+2").toString()).toBe("-250");
    expect(Rational.parse(" 10 / -20 ").toString()).toBe("-1/2");
  });

  it("parses the decimal representation of finite numbers", () => {
    expect(Rational.fromNumber(0.125).toString()).toBe("1/8");
    expect(Rational.fromNumber(1e-7).toString()).toBe("1/10000000");
    expect(Rational.fromNumber(0.1 + 0.2).toString()).toBe("7500000000000001/25000000000000000");
  });

  it("formats rounded decimals without floating point", () => {
    expect(formatRational("1/8")).toBe("0.125");
    expect(formatRational("1/6", 4)).toBe("0.1667");
    expect(formatRational("-1995/1000", 2)).toBe("-2");
    expect(formatRational("999/1000", 2)).toBe("1");
    expect(formatRational("5/2", 0)).toBe("3");
  });

  it("implements mathematical floor and ceil for negatives", () => {
    const value = Rational.parse("-7/3");
    expect(value.floor()).toBe(BigInt(-3));
    expect(value.ceil()).toBe(BigInt(-2));
  });

  it("rejects invalid values and zero division", () => {
    expect(() => Rational.parse("")).toThrow(SyntaxError);
    expect(() => Rational.fromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => new Rational(BigInt(1), BigInt(0))).toThrow(RangeError);
    expect(() => Rational.parse("1/2").divide(0)).toThrow(RangeError);
  });
});
