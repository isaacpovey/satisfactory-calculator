import { describe, expect, it } from "vitest";
import { getRecipeForProduct, recipes } from "@/data/recipes";
import { isLegalUnderclock, legalUnderclocks, recipeRatesAtClock } from "./underclocks";
import { Rational } from "./rational";

describe("legalUnderclocks", () => {
  it("includes Quickwire 5/6 and gives exact 10 input / 50 output rates", () => {
    const recipe = getRecipeForProduct("quickwire")!;
    const clocks = legalUnderclocks(recipe);
    const fiveSixths = clocks.find((clock) => clock.equals("5/6"));

    expect(clocks).toHaveLength(60);
    expect(fiveSixths?.toString()).toBe("5/6");

    const rates = recipeRatesAtClock(recipe, fiveSixths!);
    expect(rates.inputs).toEqual([{ item: "caterium-ingot", rate: new Rational(BigInt(10)) }]);
    expect(rates.outputs).toEqual([{ item: "quickwire", rate: new Rational(BigInt(50)) }]);
  });

  it("unions clocks made integral by either an input or output", () => {
    const recipe = getRecipeForProduct("iron-plate")!;
    const clocks = legalUnderclocks(recipe);

    expect(clocks.some((clock) => clock.equals("1/30"))).toBe(true);
    expect(clocks.some((clock) => clock.equals("1/20"))).toBe(true);
    expect(recipeRatesAtClock(recipe, Rational.parse("1/30")).inputs[0]!.rate.toString()).toBe("1");
    expect(recipeRatesAtClock(recipe, Rational.parse("1/20")).outputs[0]!.rate.toString()).toBe(
      "1",
    );
    expect(isLegalUnderclock(recipe, Rational.parse("1/7"))).toBe(false);
  });

  it("returns unique, reduced, ascending, legal clocks for every current recipe", () => {
    for (const recipe of recipes) {
      const clocks = legalUnderclocks(recipe);
      expect(clocks.length).toBeGreaterThan(0);
      expect(new Set(clocks.map((clock) => clock.toString())).size).toBe(clocks.length);

      for (let index = 0; index < clocks.length; index++) {
        const clock = clocks[index]!;
        expect(isLegalUnderclock(recipe, clock)).toBe(true);
        expect(clock.compare(0)).toBeGreaterThan(0);
        expect(clock.compare(1)).toBeLessThanOrEqual(0);
        if (index > 0) {
          expect(clocks[index - 1]!.compare(clock)).toBeLessThan(0);
        }
      }
    }
  });
});
