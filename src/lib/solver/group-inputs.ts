import { recipes as allRecipes, recipeCyclesPerMinute } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import type { SplitterStep } from "./constraints";
import type { MachineGroupPlan, SplitPlan } from "./types";

export interface GroupInputRate {
  item: ItemId;
  totalRate: number;
  perMachineRate: number;
}

export interface SplitterStageRate {
  label: string;
  rate: number;
  step?: SplitterStep;
}

const recipeById = Object.fromEntries(allRecipes.map((r) => [r.id, r])) as Record<
  string,
  (typeof allRecipes)[number]
>;

/** Input item rates for one machine group at its clock. */
export function groupInputRates(
  recipeId: string,
  group: MachineGroupPlan,
): GroupInputRate[] {
  const recipe = recipeById[recipeId];
  if (!recipe) return [];
  const cyclesPerMin = recipeCyclesPerMinute(recipe);
  return recipe.inputs.map((input) => ({
    item: input.item,
    totalRate: input.amount * cyclesPerMin * group.effectiveMachines,
    perMachineRate: input.amount * cyclesPerMin * group.clock,
  }));
}

/**
 * Belt flow at each splitter stage when feeding a machine group equally.
 * Rates are per lane after each nested 1/2 or 1/3 split.
 */
export function splitterInputStageRates(
  totalRate: number,
  plan: SplitPlan,
): SplitterStageRate[] {
  if (totalRate <= 0) return [];

  if (plan.mergeOnly || plan.steps.length === 0) {
    return [{ label: "Belt in", rate: totalRate }];
  }

  const stages: SplitterStageRate[] = [{ label: "Belt in", rate: totalRate }];
  let rate = totalRate;
  for (const step of plan.steps) {
    const divisor = step === "1/2" ? 2 : 3;
    rate = rate / divisor;
    stages.push({
      label: `After ${step} split`,
      rate,
      step,
    });
  }
  return stages;
}
