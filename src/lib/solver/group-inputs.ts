import { recipes as allRecipes, recipeCyclesPerMinute } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import type { MergerStep, SplitterStep } from "./constraints";
import type { MachineGroupPlan, MergePlan, SplitPlan } from "./types";

export interface GroupInputRate {
  item: ItemId;
  totalRate: number;
  perMachineRate: number;
}

export interface SplitterStageRate {
  label: string;
  /** Items/min on each lane at this stage */
  rate: number;
  /** How many parallel lanes exist at this stage */
  lanes: number;
  step?: SplitterStep;
}

export interface MergerStageRate {
  label: string;
  /** Combined items/min after this merge stage */
  rate: number;
  /** How many belts enter this stage */
  beltsIn: number;
  step?: MergerStep;
}

const recipeById = Object.fromEntries(allRecipes.map((r) => [r.id, r])) as Record<
  string,
  (typeof allRecipes)[number]
>;

/** Input item rates for one machine group at its clock. */
export function groupInputRates(recipeId: string, group: MachineGroupPlan): GroupInputRate[] {
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
export function splitterInputStageRates(totalRate: number, plan: SplitPlan): SplitterStageRate[] {
  if (totalRate <= 0) return [];

  if (plan.mergeOnly || plan.steps.length === 0) {
    return [{ label: "Belt in", rate: totalRate, lanes: 1 }];
  }

  const stages: SplitterStageRate[] = [{ label: "Belt in", rate: totalRate, lanes: 1 }];
  let rate = totalRate;
  let lanes = 1;
  for (const step of plan.steps) {
    const divisor = step === "1/2" ? 2 : 3;
    rate = rate / divisor;
    lanes *= divisor;
    stages.push({
      label: `After ${step}`,
      rate,
      lanes,
      step,
    });
  }
  return stages;
}

/**
 * Belt flow at each merger stage when combining bank output belts.
 * `rate` is items/min on each resulting belt after that stage
 * (total ÷ remaining belts when sources are packed evenly).
 */
export function mergerOutputStageRates(plan: MergePlan): MergerStageRate[] {
  const sources = plan.sourceRates.filter((r) => r > 0);
  if (sources.length === 0) return [];

  const total = sources.reduce((a, b) => a + b, 0);
  if (plan.mergeOnly || plan.steps.length === 0 || sources.length === 1) {
    return [
      {
        label: "Bank belt",
        rate: total,
        beltsIn: 1,
      },
    ];
  }

  // steps ordered outer-first (same as splitters): e.g. 6 → ["2→1","3→1"]
  const stages: MergerStageRate[] = [
    {
      label: "Bank belts in",
      rate: total / sources.length,
      beltsIn: sources.length,
    },
  ];

  let belts = sources.length;
  for (const step of plan.steps) {
    const factor = step === "2→1" ? 2 : 3;
    if (belts % factor !== 0) break;
    belts = belts / factor;
    stages.push({
      label: `After ${step}`,
      rate: total / belts,
      beltsIn: belts,
      step,
    });
  }

  return stages;
}
