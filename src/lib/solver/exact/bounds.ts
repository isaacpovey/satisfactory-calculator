import type { ItemId, Recipe } from "@/data/types";
import { legalUnderclocks, recipeCyclesPerMinuteExact } from "./underclocks";
import type { ExactRecipeGraph } from "./recipe-graph";
import { Rational, type RationalInput } from "./rational";

const ZERO = new Rational(BigInt(0));

export type ExactRawAvailability = Partial<Record<ItemId, RationalInput>>;

export interface ExactRecipeBound {
  readonly recipe: Recipe;
  /** Scarce raw items consumed by one cycle of this recipe and its dependencies. */
  readonly rawPerCycle: ReadonlyMap<ItemId, Rational>;
  /** Scarce raw items consumed by one machine at 100% clock for one minute. */
  readonly rawPerEffectiveMachine: ReadonlyMap<ItemId, Rational>;
  readonly maxCyclesPerMinute: Rational;
  readonly maxEffectiveMachines: Rational;
  readonly minimumLegalClock: Rational;
  /**
   * Maximum physical machine count if every active machine uses the recipe's
   * smallest legal clock.
   */
  readonly maxMachines: bigint;
}

function addRate(target: Map<ItemId, Rational>, itemId: ItemId, amount: Rational): void {
  target.set(itemId, (target.get(itemId) ?? ZERO).add(amount));
}

function expandItemToScarceRaws(
  graph: ExactRecipeGraph,
  itemId: ItemId,
  amount: Rational,
  target: Map<ItemId, Rational>,
): void {
  const item = graph.itemById.get(itemId);
  if (!item) {
    throw new Error(`Unknown item in validated recipe graph: ${itemId}`);
  }
  if (item.isRaw) {
    if (!item.isUnlimited) addRate(target, itemId, amount);
    return;
  }

  const producer = graph.producerByItem.get(itemId);
  const output = producer?.outputs[0];
  if (!producer || !output) {
    throw new Error(`No primary producer in validated recipe graph for ${itemId}`);
  }

  const cycles = amount.divide(output.amount);
  for (const input of producer.inputs) {
    expandItemToScarceRaws(graph, input.item, Rational.from(input.amount).multiply(cycles), target);
  }
}

export function rawRequirementsPerRecipeCycle(
  graph: ExactRecipeGraph,
  recipe: Recipe,
): ReadonlyMap<ItemId, Rational> {
  const requirements = new Map<ItemId, Rational>();
  for (const input of recipe.inputs) {
    expandItemToScarceRaws(graph, input.item, Rational.from(input.amount), requirements);
  }
  return requirements;
}

/**
 * Computes finite per-recipe activity and machine bounds from scarce raw
 * availability. Missing scarce resources have zero availability.
 */
export function computeRecipeBounds(
  graph: ExactRecipeGraph,
  rawAvailability: ExactRawAvailability,
): ReadonlyMap<string, ExactRecipeBound> {
  const available = new Map<ItemId, Rational>();
  for (const itemId of graph.scarceRawIds) {
    const amount = Rational.from(rawAvailability[itemId] ?? 0);
    if (amount.compare(0) < 0) {
      throw new RangeError(`Raw availability cannot be negative: ${itemId}`);
    }
    available.set(itemId, amount);
  }

  const bounds = new Map<string, ExactRecipeBound>();
  for (const recipe of graph.topologicalRecipes) {
    const rawPerCycle = rawRequirementsPerRecipeCycle(graph, recipe);
    let maxCyclesPerMinute: Rational | null = null;
    for (const [itemId, requirement] of rawPerCycle) {
      if (requirement.compare(0) <= 0) continue;
      const candidate = (available.get(itemId) ?? ZERO).divide(requirement);
      if (maxCyclesPerMinute === null || candidate.compare(maxCyclesPerMinute) < 0) {
        maxCyclesPerMinute = candidate;
      }
    }
    if (maxCyclesPerMinute === null) {
      throw new Error(`Recipe ${recipe.id} has no scarce raw requirement`);
    }

    const cyclesPerMinute = recipeCyclesPerMinuteExact(recipe);
    const maxEffectiveMachines = maxCyclesPerMinute.divide(cyclesPerMinute);
    const rawPerEffectiveMachine = new Map<ItemId, Rational>();
    for (const [itemId, requirement] of rawPerCycle) {
      rawPerEffectiveMachine.set(itemId, requirement.multiply(cyclesPerMinute));
    }

    const clocks = legalUnderclocks(recipe);
    const minimumLegalClock = clocks[0];
    if (!minimumLegalClock) {
      throw new Error(`Recipe ${recipe.id} has no legal underclock`);
    }

    bounds.set(recipe.id, {
      recipe,
      rawPerCycle,
      rawPerEffectiveMachine,
      maxCyclesPerMinute,
      maxEffectiveMachines,
      minimumLegalClock,
      maxMachines: maxEffectiveMachines.divide(minimumLegalClock).floor(),
    });
  }
  return bounds;
}
