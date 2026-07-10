import {
  type BoolVar,
  CpModel,
  CpSat,
  CpSolver,
  CpSolverStatus,
  LinearExpr,
  type IntVar,
} from "or-tools-wasm/cp-sat";
import type { ItemId } from "@/data/types";
import {
  equalLaneTreeDevices,
  generateMachineBankPatterns,
  type ExactMachineBankPattern,
} from "./bank-patterns";
import { computeRecipeBounds } from "./bounds";
import {
  checkedSafeInteger,
  denominatorLcm,
  exactInteger,
  safeIntegerExpression,
  type RationalLinearTerm,
} from "./integer-linear";
import type {
  ExactExcessRate,
  ExactExcessSpec,
  ExactItemRate,
  ExactObjectiveVector,
  ExactOptimizerInput,
  ExactOptimizerResult,
  ExactRawRate,
  ExactSelectedBank,
  ExactTargetRate,
  ExactTargetSpec,
} from "./optimizer-types";
import { Rational, type RationalInput } from "./rational";
import { validateExactSolution } from "./validation";

const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const ZERO = new Rational(ZERO_BIGINT);
const MAX_SEARCH_WORKERS = 8;

/**
 * Uses all but one logical core for search, capped to avoid excessive browser
 * contention. Small/unknown machines retain the single-worker fallback.
 */
export function selectSearchWorkers(
  requested: number | undefined,
  hardwareConcurrency: number | undefined = globalThis.navigator?.hardwareConcurrency,
): number {
  const candidate =
    requested ??
    (hardwareConcurrency !== undefined && hardwareConcurrency > 2 ? hardwareConcurrency - 1 : 1);
  if (!Number.isFinite(candidate)) return 1;
  return Math.max(1, Math.min(MAX_SEARCH_WORKERS, Math.floor(candidate)));
}

interface NormalizedTarget {
  readonly item: ItemId;
  readonly minimum: Rational;
  readonly weight: Rational;
}

interface NormalizedExcess {
  readonly item: ItemId;
  readonly floor: Rational;
}

interface PatternVariable {
  readonly pattern: ExactMachineBankPattern;
  readonly variable: IntVar;
  readonly upperBound: bigint;
  readonly symmetryUpperBound: bigint;
  readonly order: number;
}

interface ProductionVariable {
  readonly pattern: ExactMachineBankPattern;
  readonly variable: IntVar;
  readonly upperBound: bigint;
}

interface BoundedPattern {
  readonly pattern: ExactMachineBankPattern;
  readonly upperBound: bigint;
}

interface WithdrawalVariable {
  readonly variable: IntVar;
  readonly scale: bigint;
  readonly upperBound: bigint;
}

interface RoutingVariable {
  readonly item: ItemId;
  readonly variable: IntVar;
  readonly upperBound: bigint;
}

interface ModelState {
  readonly model: CpModel;
  readonly production: readonly ProductionVariable[];
  readonly patterns: readonly PatternVariable[];
  readonly targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
  readonly excessVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
  readonly routingVariables: readonly RoutingVariable[];
  readonly objectives: readonly {
    readonly label: string;
    readonly maximize: boolean;
    readonly terms: readonly RationalLinearTerm[];
  }[];
}

function specifiedRate(
  primary: RationalInput | undefined,
  compatibility: RationalInput | undefined,
  label: string,
): Rational {
  if (primary !== undefined && compatibility !== undefined) {
    const left = Rational.from(primary);
    const right = Rational.from(compatibility);
    if (!left.equals(right)) {
      throw new RangeError(`${label} was provided with conflicting exact values`);
    }
    return left;
  }
  return Rational.from(primary ?? compatibility ?? 0);
}

function normalizeTargets(input: ExactOptimizerInput): readonly NormalizedTarget[] {
  const seen = new Set<ItemId>();
  return input.targets.map((target: ExactTargetSpec) => {
    if (seen.has(target.item)) throw new RangeError(`Duplicate exact target: ${target.item}`);
    seen.add(target.item);
    const item = input.graph.itemById.get(target.item);
    if (!item || item.isRaw || item.isIngot) {
      throw new RangeError(`Exact target must be a manufactured non-ingot: ${target.item}`);
    }
    const minimum = specifiedRate(target.minimum, target.minRate, `${target.item} target minimum`);
    const weight = Rational.from(target.weight);
    if (minimum.compare(0) < 0) {
      throw new RangeError(`Target minimum cannot be negative: ${target.item}`);
    }
    if (weight.compare(0) < 0) {
      throw new RangeError(`Target weight cannot be negative: ${target.item}`);
    }
    return { item: target.item, minimum, weight };
  });
}

function normalizeExcess(input: ExactOptimizerInput): readonly NormalizedExcess[] {
  const seen = new Set<ItemId>();
  return (input.excess ?? []).map((excess: ExactExcessSpec) => {
    if (seen.has(excess.item)) throw new RangeError(`Duplicate exact excess floor: ${excess.item}`);
    seen.add(excess.item);
    const item = input.graph.itemById.get(excess.item);
    if (!item || item.isRaw || item.isIngot) {
      throw new RangeError(`Exact excess must be a manufactured non-ingot: ${excess.item}`);
    }
    const floor = specifiedRate(excess.floor, excess.rate, `${excess.item} excess floor`);
    if (floor.compare(0) < 0) {
      throw new RangeError(`Excess floor cannot be negative: ${excess.item}`);
    }
    return { item: excess.item, floor };
  });
}

function validateRawAvailability(input: ExactOptimizerInput): void {
  for (const [untypedItemId, value] of Object.entries(input.rawAvailability)) {
    if (value === undefined) continue;
    const itemId = untypedItemId as ItemId;
    const item = input.graph.itemById.get(itemId);
    if (!item?.isRaw) throw new RangeError(`Raw availability references a non-raw item: ${itemId}`);
    if (Rational.from(value).compare(0) < 0) {
      throw new RangeError(`Raw availability cannot be negative: ${itemId}`);
    }
  }
}

function addRate(target: Map<ItemId, Rational>, item: ItemId, amount: Rational): void {
  target.set(item, (target.get(item) ?? ZERO).add(amount));
}

function patternRate(
  pattern: ExactMachineBankPattern,
  itemId: ItemId,
  kind: "input" | "output",
): Rational {
  const rates = kind === "input" ? pattern.inputRates : pattern.outputRates;
  return rates
    .filter((entry) => entry.item === itemId)
    .reduce((total, entry) => total.add(entry.rate), ZERO);
}

function internalDevices(pattern: ExactMachineBankPattern, inputCount: number): bigint {
  return equalLaneTreeDevices(pattern.machines) * BigInt(inputCount + 1);
}

/**
 * Removes only strict single-bank dominance: equal effective production has
 * equal material rates and group count, so the representation with fewer
 * physical machines is better in every earlier lexicographic phase.
 */
function removeDominatedPatterns(
  patterns: readonly ExactMachineBankPattern[],
): readonly ExactMachineBankPattern[] {
  const bestByEffectiveRate = new Map<string, ExactMachineBankPattern>();
  for (const pattern of patterns) {
    const key = pattern.effectiveMachines.toFractionString();
    const incumbent = bestByEffectiveRate.get(key);
    if (!incumbent || pattern.machines < incumbent.machines) {
      bestByEffectiveRate.set(key, pattern);
    }
  }
  return patterns.filter(
    (pattern) => bestByEffectiveRate.get(pattern.effectiveMachines.toFractionString()) === pattern,
  );
}

/**
 * Bounds interchangeable copies of a smaller bank. If k copies have exactly
 * the rate of one available larger bank using no more physical machines, those
 * k copies are lexicographically dominated (same flow, fewer machines or
 * groups after replacement). Keeping at most k - 1 preserves every
 * non-dominated complete solution.
 */
function tightenMultiplicityBound(
  entry: BoundedPattern,
  recipePatterns: readonly BoundedPattern[],
): bigint {
  let upperBound = entry.upperBound;
  for (const replacement of recipePatterns) {
    if (replacement === entry) continue;
    const ratio = replacement.pattern.effectiveMachines.divide(entry.pattern.effectiveMachines);
    if (!ratio.isInteger()) continue;
    const copies = ratio.numerator;
    if (copies <= ONE_BIGINT) continue;
    if (replacement.pattern.machines > entry.pattern.machines * copies) continue;
    const canonicalUpperBound = copies - ONE_BIGINT;
    if (canonicalUpperBound < upperBound) upperBound = canonicalUpperBound;
  }
  return upperBound;
}

function createPatternVariables(
  input: ExactOptimizerInput,
  model: CpModel,
  beltCapacity: Rational,
): readonly PatternVariable[] {
  const bounds = computeRecipeBounds(input.graph, input.rawAvailability);
  const variables: PatternVariable[] = [];
  let order = 0;

  for (const recipe of input.graph.topologicalRecipes) {
    const bound = bounds.get(recipe.id);
    if (!bound) throw new Error(`Missing exact recipe bound: ${recipe.id}`);
    const generated = generateMachineBankPatterns(bound, beltCapacity);
    const nonDominated = removeDominatedPatterns(generated);
    const bounded = nonDominated.flatMap((pattern): readonly BoundedPattern[] => {
      const upperBound = bound.maxEffectiveMachines.divide(pattern.effectiveMachines).floor();
      return upperBound > ZERO_BIGINT ? [{ pattern, upperBound }] : [];
    });
    for (const entry of bounded) {
      const { pattern } = entry;
      const symmetryUpperBound = tightenMultiplicityBound(entry, bounded);
      const safeUpperBound = checkedSafeInteger(
        entry.upperBound,
        `${recipe.id} ${pattern.machines}@${pattern.clock.toFractionString()} multiplicity bound`,
      );
      variables.push({
        pattern,
        variable: model.newIntVar(
          0,
          safeUpperBound,
          `bank_${recipe.id}_${pattern.machines}_${pattern.clock.toFractionString()}`,
        ),
        upperBound: entry.upperBound,
        symmetryUpperBound,
        order,
      });
      order++;
    }
  }
  return variables;
}

function createProductionVariables(
  input: ExactOptimizerInput,
  model: CpModel,
  beltCapacity: Rational,
): readonly ProductionVariable[] {
  const bounds = computeRecipeBounds(input.graph, input.rawAvailability);
  const variables: ProductionVariable[] = [];
  for (const recipe of input.graph.topologicalRecipes) {
    const bound = bounds.get(recipe.id);
    if (!bound) throw new Error(`Missing exact recipe bound: ${recipe.id}`);
    const oneMachinePatterns = generateMachineBankPatterns(bound, beltCapacity)
      .filter((pattern) => pattern.machines === ONE_BIGINT)
      .toSorted((left, right) => left.effectiveMachines.compare(right.effectiveMachines));
    const generators: ExactMachineBankPattern[] = [];
    for (const pattern of oneMachinePatterns) {
      const isRedundant = generators.some((generator) =>
        pattern.effectiveMachines.divide(generator.effectiveMachines).isInteger(),
      );
      if (!isRedundant) generators.push(pattern);
    }
    for (const pattern of generators) {
      const upperBound = bound.maxEffectiveMachines.divide(pattern.effectiveMachines).floor();
      if (upperBound <= ZERO_BIGINT) continue;
      variables.push({
        pattern,
        variable: model.newIntVar(
          0,
          checkedSafeInteger(upperBound, `${recipe.id} production-rate multiplicity bound`),
          `production_${recipe.id}_${pattern.clock.toFractionString()}`,
        ),
        upperBound,
      });
    }
  }
  return variables;
}

function addRawConstraints(
  input: ExactOptimizerInput,
  model: CpModel,
  patterns: readonly ProductionVariable[],
): void {
  for (const itemId of input.graph.scarceRawIds) {
    const available = Rational.from(input.rawAvailability[itemId] ?? 0);
    const consuming = patterns
      .map((entry) => ({
        entry,
        rate: patternRate(entry.pattern, itemId, "input"),
      }))
      .filter(({ rate }) => !rate.isZero());
    const scale = denominatorLcm([available, ...consuming.map(({ rate }) => rate)]);
    const coefficients = consuming.map(({ rate }) =>
      checkedSafeInteger(
        exactInteger(rate, scale, `${itemId} raw coefficient`),
        `${itemId} raw coefficient`,
      ),
    );
    const upperBound = exactInteger(available, scale, `${itemId} raw availability`);
    checkedSafeInteger(upperBound, `${itemId} scaled raw availability`);

    let maximum = ZERO_BIGINT;
    for (let index = 0; index < consuming.length; index++) {
      maximum += BigInt(coefficients[index]!) * consuming[index]!.entry.upperBound;
    }
    checkedSafeInteger(maximum, `${itemId} raw row maximum`);
    model.addLinearConstraint(
      LinearExpr.weightedSum(
        consuming.map(({ entry }) => entry.variable),
        coefficients,
      ),
      0,
      Number(upperBound),
    );
  }
}

function addConservationRows(
  input: ExactOptimizerInput,
  model: CpModel,
  patterns: readonly ProductionVariable[],
  targets: readonly NormalizedTarget[],
  excess: readonly NormalizedExcess[],
): {
  readonly targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
  readonly excessVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
} {
  const targetByItem = new Map(targets.map((target) => [target.item, target] as const));
  const floorByItem = new Map(excess.map((entry) => [entry.item, entry.floor] as const));
  const targetVariables = new Map<ItemId, WithdrawalVariable>();
  const excessVariables = new Map<ItemId, WithdrawalVariable>();

  for (const item of input.graph.items) {
    if (item.isRaw) continue;
    const patternTerms = patterns
      .map((entry) => ({
        entry,
        rate: patternRate(entry.pattern, item.id, "output").subtract(
          patternRate(entry.pattern, item.id, "input"),
        ),
      }))
      .filter(({ rate }) => !rate.isZero());
    const target = targetByItem.get(item.id);
    const floor = floorByItem.get(item.id) ?? ZERO;
    const scale = denominatorLcm([
      ...patternTerms.map(({ rate }) => rate),
      target?.minimum ?? ZERO,
      floor,
    ]);
    const variables = patternTerms.map(({ entry }) => entry.variable);
    const coefficients = patternTerms.map(({ rate }) =>
      checkedSafeInteger(
        exactInteger(rate, scale, `${item.id} conservation coefficient`),
        `${item.id} conservation coefficient`,
      ),
    );

    let maximumProduced = ZERO_BIGINT;
    let maximumAbsoluteRow = ZERO_BIGINT;
    for (let index = 0; index < patternTerms.length; index++) {
      const coefficient = BigInt(coefficients[index]!);
      const contribution = coefficient * patternTerms[index]!.entry.upperBound;
      if (coefficient > ZERO_BIGINT) maximumProduced += contribution;
      maximumAbsoluteRow += contribution < ZERO_BIGINT ? -contribution : contribution;
    }
    checkedSafeInteger(maximumProduced, `${item.id} maximum production`);

    let expression = LinearExpr.weightedSum(variables, coefficients);
    if (target) {
      const lowerBound = exactInteger(target.minimum, scale, `${item.id} target minimum`);
      const upperBound = lowerBound > maximumProduced ? lowerBound : maximumProduced;
      if (lowerBound > maximumProduced) model.add(false);
      const targetVariable = model.newIntVar(
        checkedSafeInteger(lowerBound, `${item.id} target minimum`),
        checkedSafeInteger(upperBound, `${item.id} target upper bound`),
        `target_${item.id}`,
      );
      targetVariables.set(item.id, { variable: targetVariable, scale, upperBound });
      expression = LinearExpr.from(expression).minus(targetVariable);
      maximumAbsoluteRow += upperBound;
    }
    if (!item.isIngot) {
      const lowerBound = exactInteger(floor, scale, `${item.id} excess floor`);
      const upperBound = lowerBound > maximumProduced ? lowerBound : maximumProduced;
      if (lowerBound > maximumProduced) model.add(false);
      const excessVariable = model.newIntVar(
        checkedSafeInteger(lowerBound, `${item.id} excess floor`),
        checkedSafeInteger(upperBound, `${item.id} excess upper bound`),
        `excess_${item.id}`,
      );
      excessVariables.set(item.id, { variable: excessVariable, scale, upperBound });
      expression = LinearExpr.from(expression).minus(excessVariable);
      maximumAbsoluteRow += upperBound;
    }
    checkedSafeInteger(maximumAbsoluteRow, `${item.id} conservation row maximum`);
    model.addEquality(expression, 0);
  }
  return { targetVariables, excessVariables };
}

function addPositiveActivity(
  model: CpModel,
  variable: IntVar,
  upperBound: bigint,
  name: string,
): BoolVar {
  const activity = model.newBoolVar(name);
  if (upperBound === ZERO_BIGINT) {
    model.addEquality(activity, 0);
    return activity;
  }
  const safeUpperBound = checkedSafeInteger(upperBound, `${name} activity upper bound`);
  model.addLinearConstraint(variable, 1, safeUpperBound).onlyEnforceIf(activity);
  model.addEquality(variable, 0).onlyEnforceIf(activity.not());
  return activity;
}

function addRoutingVariables(
  input: ExactOptimizerInput,
  model: CpModel,
  patterns: readonly PatternVariable[],
  targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>,
  excessVariables: ReadonlyMap<ItemId, WithdrawalVariable>,
): readonly RoutingVariable[] {
  const recipeActivities = new Map<string, BoolVar>();
  for (const recipe of input.graph.recipes) {
    const recipePatterns = patterns.filter((entry) => entry.pattern.recipeId === recipe.id);
    const activity = model.newBoolVar(`recipe_active_${recipe.id}`);
    const laneExpression = LinearExpr.sum(recipePatterns.map((entry) => entry.variable));
    const laneUpperBound = recipePatterns.reduce(
      (total, entry) => total + entry.upperBound,
      ZERO_BIGINT,
    );
    if (laneUpperBound === ZERO_BIGINT) {
      model.addEquality(activity, 0);
    } else {
      model
        .addLinearConstraint(
          laneExpression,
          1,
          checkedSafeInteger(laneUpperBound, `${recipe.id} selected-bank upper bound`),
        )
        .onlyEnforceIf(activity);
      model.addEquality(laneExpression, 0).onlyEnforceIf(activity.not());
    }
    recipeActivities.set(recipe.id, activity);
  }

  const targetActivities = new Map<ItemId, BoolVar>();
  for (const [itemId, withdrawal] of targetVariables) {
    targetActivities.set(
      itemId,
      addPositiveActivity(
        model,
        withdrawal.variable,
        withdrawal.upperBound,
        `target_active_${itemId}`,
      ),
    );
  }
  const excessActivities = new Map<ItemId, BoolVar>();
  for (const [itemId, withdrawal] of excessVariables) {
    excessActivities.set(
      itemId,
      addPositiveActivity(
        model,
        withdrawal.variable,
        withdrawal.upperBound,
        `excess_active_${itemId}`,
      ),
    );
  }

  const routingVariables: RoutingVariable[] = [];
  for (const item of input.graph.items) {
    if (item.isRaw) continue;
    const producer = input.graph.producerByItem.get(item.id);
    if (!producer) throw new Error(`Missing producer for routed item: ${item.id}`);
    const outputPatterns = patterns.filter((entry) => entry.pattern.recipeId === producer.id);
    const outputLaneExpression = LinearExpr.sum(outputPatterns.map((entry) => entry.variable));
    const outputLaneUpperBound = outputPatterns.reduce(
      (total, entry) => total + entry.upperBound,
      ZERO_BIGINT,
    );
    const destinations: BoolVar[] = input.graph.recipes
      .filter((recipe) => recipe.inputs.some((inputRate) => inputRate.item === item.id))
      .map((recipe) => {
        const activity = recipeActivities.get(recipe.id);
        if (!activity) throw new Error(`Missing activity variable for recipe: ${recipe.id}`);
        return activity;
      });
    const targetActivity = targetActivities.get(item.id);
    if (targetActivity) destinations.push(targetActivity);
    const excessActivity = excessActivities.get(item.id);
    if (excessActivity) destinations.push(excessActivity);

    const destinationUpperBound = BigInt(destinations.length);
    const routingUpperBound = (destinationUpperBound + ONE_BIGINT) / BigInt(2);
    const routing = model.newIntVar(
      0,
      checkedSafeInteger(routingUpperBound, `${item.id} routing-device upper bound`),
      `routing_devices_${item.id}`,
    );
    const routingNeeded = model.newBoolVar(`routing_needed_${item.id}`);
    if (destinationUpperBound === ZERO_BIGINT) {
      model.addEquality(routingNeeded, 0);
      model.addEquality(routing, 0);
    } else {
      const destinationExpression = LinearExpr.sum(destinations);
      const destinationLaneDifference =
        LinearExpr.from(destinationExpression).minus(outputLaneExpression);
      model
        .addLinearConstraint(
          destinationLaneDifference,
          1,
          checkedSafeInteger(destinationUpperBound, `${item.id} destination upper bound`),
        )
        .onlyEnforceIf(routingNeeded);
      model
        .addLinearConstraint(
          destinationLaneDifference,
          checkedSafeInteger(-outputLaneUpperBound, `${item.id} lane-difference lower bound`),
          0,
        )
        .onlyEnforceIf(routingNeeded.not());
      model.addEquality(routing, 0).onlyEnforceIf(routingNeeded.not());
      model
        .addLinearConstraint(LinearExpr.term(routing, 2).minus(destinationLaneDifference), 0, 1)
        .onlyEnforceIf(routingNeeded);
    }
    routingVariables.push({ item: item.id, variable: routing, upperBound: routingUpperBound });
  }
  return routingVariables;
}

function objectiveTerms(
  input: ExactOptimizerInput,
  production: readonly ProductionVariable[],
  patterns: readonly PatternVariable[],
  targets: readonly NormalizedTarget[],
  targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>,
  routingVariables: readonly RoutingVariable[],
): ModelState["objectives"] {
  const scarceSet = new Set(input.graph.scarceRawIds);
  const scarceRawTerms = production.map((entry) => {
    const rate = entry.pattern.inputRates.reduce(
      (total, inputRate) => (scarceSet.has(inputRate.item) ? total.add(inputRate.rate) : total),
      ZERO,
    );
    return { variable: entry.variable, coefficient: rate, upperBound: entry.upperBound };
  });
  const weightedTargetTerms = targets.map((target) => {
    const withdrawal = targetVariables.get(target.item);
    if (!withdrawal) throw new Error(`Missing target variable: ${target.item}`);
    return {
      variable: withdrawal.variable,
      coefficient: target.weight.divide(new Rational(withdrawal.scale)),
      upperBound: withdrawal.upperBound,
    };
  });
  const machineTerms = patterns.map((entry) => ({
    variable: entry.variable,
    coefficient: new Rational(entry.pattern.machines),
    upperBound: entry.upperBound,
  }));
  const groupTerms = patterns.map((entry) => ({
    variable: entry.variable,
    coefficient: new Rational(ONE_BIGINT),
    upperBound: entry.upperBound,
  }));
  const internalDeviceTerms = patterns.map((entry) => {
    const recipe = input.graph.recipeById.get(entry.pattern.recipeId);
    if (!recipe) throw new Error(`Missing recipe for bank pattern: ${entry.pattern.recipeId}`);
    return {
      variable: entry.variable,
      coefficient: new Rational(internalDevices(entry.pattern, recipe.inputs.length)),
      upperBound: entry.upperBound,
    };
  });
  const routingDeviceTerms = routingVariables.map((entry) => ({
    variable: entry.variable,
    coefficient: new Rational(ONE_BIGINT),
    upperBound: entry.upperBound,
  }));
  const stableTerms = patterns.map((entry) => ({
    variable: entry.variable,
    coefficient: new Rational(BigInt(entry.order + 1)),
    upperBound: entry.upperBound,
  }));
  return [
    { label: "scarce raw use", maximize: true, terms: scarceRawTerms },
    { label: "weighted target output", maximize: true, terms: weightedTargetTerms },
    { label: "physical machines", maximize: false, terms: machineTerms },
    { label: "groups", maximize: false, terms: groupTerms },
    {
      label: "total splitter and merger devices",
      maximize: false,
      terms: [...internalDeviceTerms, ...routingDeviceTerms],
    },
    { label: "stable bank order", maximize: false, terms: stableTerms },
  ];
}

function buildModel(
  input: ExactOptimizerInput,
  beltCapacity: Rational,
  targets: readonly NormalizedTarget[],
  excess: readonly NormalizedExcess[],
): ModelState {
  const model = new CpModel();
  model.name = "exact-production-optimizer";
  const production = createProductionVariables(input, model, beltCapacity);
  const patterns = createPatternVariables(input, model, beltCapacity);
  addRawConstraints(input, model, production);
  const withdrawals = addConservationRows(input, model, production, targets, excess);
  const routingVariables = addRoutingVariables(
    input,
    model,
    patterns,
    withdrawals.targetVariables,
    withdrawals.excessVariables,
  );
  return {
    model,
    production,
    patterns,
    ...withdrawals,
    routingVariables,
    objectives: objectiveTerms(
      input,
      production,
      patterns,
      targets,
      withdrawals.targetVariables,
      routingVariables,
    ),
  };
}

function installCompleteSolutionHint(model: CpModel, solver: CpSolver): number {
  const solution = solver.response()?.solution;
  if (!solution) throw new Error("OPTIMAL solve did not expose a complete solution hint");
  const proto = model.proto();
  proto.solutionHint = {
    vars: solution.map((_, index) => index),
    values: [...solution],
  };
  return solution.length;
}

function addBankRepresentationLinks(state: ModelState): void {
  const recipeIds = new Set(state.production.map((entry) => entry.pattern.recipeId));
  for (const recipeId of recipeIds) {
    const production = state.production.filter((entry) => entry.pattern.recipeId === recipeId);
    const banks = state.patterns.filter((entry) => entry.pattern.recipeId === recipeId);
    const scale = denominatorLcm([
      ...production.map((entry) => entry.pattern.effectiveMachines),
      ...banks.map((entry) => entry.pattern.effectiveMachines),
    ]);
    const variables = [
      ...production.map((entry) => entry.variable),
      ...banks.map((entry) => entry.variable),
    ];
    const coefficients = [
      ...production.map((entry) =>
        checkedSafeInteger(
          exactInteger(entry.pattern.effectiveMachines, scale, `${recipeId} production link`),
          `${recipeId} production link`,
        ),
      ),
      ...banks.map((entry) =>
        checkedSafeInteger(
          -exactInteger(entry.pattern.effectiveMachines, scale, `${recipeId} bank link`),
          `${recipeId} bank link`,
        ),
      ),
    ];
    let maximumAbsoluteRow = ZERO_BIGINT;
    const entries: readonly ProductionVariable[] = [...production, ...banks];
    for (let index = 0; index < entries.length; index++) {
      const coefficient = BigInt(coefficients[index]!);
      const contribution = coefficient * entries[index]!.upperBound;
      maximumAbsoluteRow += contribution < ZERO_BIGINT ? -contribution : contribution;
    }
    checkedSafeInteger(maximumAbsoluteRow, `${recipeId} bank-link row maximum`);
    state.model.addEquality(LinearExpr.weightedSum(variables, coefficients), 0);
  }
}

function tightenPatternDomains(state: ModelState, physicalMachineOptimum: bigint): void {
  const protoVariables = state.model.proto().variables;
  if (!protoVariables) throw new Error("CP-SAT model has no variables to tighten");
  for (const pattern of state.patterns) {
    const physicalUpperBound = physicalMachineOptimum / pattern.pattern.machines;
    const upperBound =
      pattern.symmetryUpperBound < physicalUpperBound
        ? pattern.symmetryUpperBound
        : physicalUpperBound;
    const proto = protoVariables[pattern.variable.index];
    if (!proto) throw new Error(`Missing bank variable proto: ${pattern.pattern.recipeId}`);
    proto.domain = [
      0,
      checkedSafeInteger(
        upperBound,
        `${pattern.pattern.recipeId} post-machine multiplicity upper bound`,
      ),
    ];
  }
}

function physicalOptimumAsBigInt(optimum: number): bigint {
  if (!Number.isSafeInteger(optimum) || optimum < 0) {
    throw new RangeError(`Physical-machine optimum is not a non-negative safe integer: ${optimum}`);
  }
  return BigInt(optimum);
}

function addPostMachineReductions(state: ModelState, optimum: number): void {
  tightenPatternDomains(state, physicalOptimumAsBigInt(optimum));
}

function addCoreHints(
  state: ModelState,
  solver: CpSolver,
  bankValues: ReadonlyMap<PatternVariable, number>,
): number {
  const proto = state.model.proto();
  proto.solutionHint = { vars: [], values: [] };
  let count = 0;
  for (const entry of state.production) {
    state.model.addHint(entry.variable, solver.value(entry.variable));
    count++;
  }
  for (const entry of state.patterns) {
    state.model.addHint(entry.variable, bankValues.get(entry) ?? 0);
    count++;
  }
  for (const withdrawal of [...state.targetVariables.values(), ...state.excessVariables.values()]) {
    state.model.addHint(withdrawal.variable, solver.value(withdrawal.variable));
    count++;
  }
  return count;
}

function installInitialBankHint(state: ModelState, solver: CpSolver): number {
  const banksByRate = new Map(
    state.patterns
      .filter((entry) => entry.pattern.machines === ONE_BIGINT)
      .map((entry) => [
        `${entry.pattern.recipeId}:${entry.pattern.effectiveMachines.toFractionString()}`,
        entry,
      ]),
  );
  const bankValues = new Map<PatternVariable, number>();
  for (const entry of state.production) {
    const value = solver.value(entry.variable);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Non-integral production hint for ${entry.pattern.recipeId}: ${value}`);
    }
    const bank = banksByRate.get(
      `${entry.pattern.recipeId}:${entry.pattern.effectiveMachines.toFractionString()}`,
    );
    if (!bank) {
      throw new Error(`Missing one-machine bank representation for ${entry.pattern.recipeId}`);
    }
    bankValues.set(bank, (bankValues.get(bank) ?? 0) + value);
  }
  return addCoreHints(state, solver, bankValues);
}

function installCanonicalBankHint(state: ModelState, solver: CpSolver): number {
  const bankValues = new Map<PatternVariable, number>();
  for (const entry of state.patterns) {
    const value = solver.value(entry.variable);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Non-integral bank hint for ${entry.pattern.recipeId}: ${value}`);
    }
    bankValues.set(entry, value);
  }
  const ascendingRates = state.patterns.toSorted((left, right) =>
    left.pattern.effectiveMachines.compare(right.pattern.effectiveMachines),
  );
  for (const entry of ascendingRates) {
    if (entry.symmetryUpperBound >= entry.upperBound) continue;
    const copies = entry.symmetryUpperBound + ONE_BIGINT;
    const replacement = state.patterns.find(
      (candidate) =>
        candidate.pattern.recipeId === entry.pattern.recipeId &&
        candidate.pattern.effectiveMachines.equals(
          entry.pattern.effectiveMachines.multiply(new Rational(copies)),
        ) &&
        candidate.pattern.machines <= entry.pattern.machines * copies,
    );
    if (!replacement) {
      throw new Error(`Missing canonical replacement bank for ${entry.pattern.recipeId}`);
    }
    const safeCopies = checkedSafeInteger(copies, `${entry.pattern.recipeId} symmetry radix`);
    const value = bankValues.get(entry) ?? 0;
    const transfers = Math.floor(value / safeCopies);
    bankValues.set(entry, value % safeCopies);
    bankValues.set(replacement, (bankValues.get(replacement) ?? 0) + transfers);
  }
  return addCoreHints(state, solver, bankValues);
}

async function solveLexicographically(
  state: ModelState,
  input: ExactOptimizerInput,
): Promise<{
  readonly solver: CpSolver | null;
  readonly status: "OPTIMAL" | "INFEASIBLE" | "CANCELLED";
}> {
  let lastSolver: CpSolver | null = null;
  const searchWorkers = selectSearchWorkers(input.searchWorkers);
  for (let index = 0; index < state.objectives.length; index++) {
    if (input.signal?.aborted) return { solver: lastSolver, status: "CANCELLED" };
    const objective = state.objectives[index]!;
    const progress = {
      phase: index + 1,
      phaseCount: state.objectives.length,
      label: objective.label,
    } as const;
    input.onProgress?.({ ...progress, status: "solving" });
    const integer = safeIntegerExpression(objective.terms, objective.label);
    if (objective.maximize) state.model.maximize(integer.expression);
    else state.model.minimize(integer.expression);

    const solver = new CpSolver();
    const status = await solver.solve(state.model, {
      numWorkers: searchWorkers,
      randomSeed: 1,
      repairHint: true,
    });
    const statusName = solver.statusName(status);
    if (status === CpSolverStatus.INFEASIBLE || statusName === "INFEASIBLE") {
      if (index !== 0) throw new Error(`Lexicographic phase became infeasible: ${objective.label}`);
      return { solver: null, status: "INFEASIBLE" };
    }
    if (status !== CpSolverStatus.OPTIMAL && statusName !== "OPTIMAL") {
      if (statusName === "MODEL_INVALID") {
        throw new Error(`CP-SAT rejected the exact optimizer model during ${objective.label}`);
      }
      return { solver, status: "CANCELLED" };
    }

    const optimum = solver.value(integer.expression);
    if (!Number.isSafeInteger(optimum)) {
      throw new RangeError(`${objective.label} optimum is not an exact safe integer: ${optimum}`);
    }
    state.model.addEquality(integer.expression, optimum);
    if (index === 1) {
      addBankRepresentationLinks(state);
      installInitialBankHint(state, solver);
    } else if (index === 2) {
      addPostMachineReductions(state, optimum);
      installCanonicalBankHint(state, solver);
    } else {
      installCompleteSolutionHint(state.model, solver);
    }
    input.onProgress?.({ ...progress, status: "complete" });
    lastSolver = solver;
  }
  return { solver: lastSolver, status: "OPTIMAL" };
}

function selectedBanks(state: ModelState, solver: CpSolver): readonly ExactSelectedBank[] {
  return state.patterns.flatMap(({ pattern, variable }) => {
    const value = solver.value(variable);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `Non-integral bank multiplicity returned for ${pattern.recipeId}: ${value}`,
      );
    }
    const multiplicity = BigInt(value);
    if (multiplicity === ZERO_BIGINT) return [];
    return [
      {
        recipeId: pattern.recipeId,
        machines: pattern.machines,
        clock: pattern.clock,
        multiplicity,
        effectiveMachinesPerBank: pattern.effectiveMachines,
        cyclesPerMinutePerBank: pattern.cyclesPerMinute,
        inputRatesPerBank: new Map(
          pattern.inputRates.map(({ item, rate }) => [item, rate] as const),
        ),
        outputRatesPerBank: new Map(
          pattern.outputRates.map(({ item, rate }) => [item, rate] as const),
        ),
      },
    ];
  });
}

function extractWithdrawal(
  variables: ReadonlyMap<ItemId, WithdrawalVariable>,
  itemId: ItemId,
  solver: CpSolver,
): Rational {
  const withdrawal = variables.get(itemId);
  if (!withdrawal) return ZERO;
  const value = solver.value(withdrawal.variable);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Non-integral withdrawal returned for ${itemId}: ${value}`);
  }
  return new Rational(BigInt(value), withdrawal.scale);
}

function createResult(
  input: ExactOptimizerInput,
  state: ModelState,
  solver: CpSolver,
  targets: readonly NormalizedTarget[],
  excess: readonly NormalizedExcess[],
): ExactOptimizerResult {
  const banks = selectedBanks(state, solver);
  const produced = new Map<ItemId, Rational>();
  const consumed = new Map<ItemId, Rational>();
  for (const bank of banks) {
    const factor = new Rational(bank.multiplicity);
    for (const [itemId, rate] of bank.inputRatesPerBank) {
      addRate(consumed, itemId, rate.multiply(factor));
    }
    for (const [itemId, rate] of bank.outputRatesPerBank) {
      addRate(produced, itemId, rate.multiply(factor));
    }
  }

  const targetResults: ExactTargetRate[] = targets.map((target) => ({
    ...target,
    rate: extractWithdrawal(state.targetVariables, target.item, solver),
  }));
  const targetRateByItem = new Map(
    targetResults.map((target) => [target.item, target.rate] as const),
  );
  const floorByItem = new Map(excess.map((entry) => [entry.item, entry.floor] as const));
  const excessResults: ExactExcessRate[] = input.graph.items
    .filter((item) => !item.isRaw && !item.isIngot)
    .map((item) => ({
      item: item.id,
      floor: floorByItem.get(item.id) ?? ZERO,
      rate: extractWithdrawal(state.excessVariables, item.id, solver),
    }));
  const excessRateByItem = new Map(excessResults.map((entry) => [entry.item, entry.rate] as const));
  const itemResults: ExactItemRate[] = input.graph.items.map((item) => ({
    item: item.id,
    produced: produced.get(item.id) ?? ZERO,
    consumed: consumed.get(item.id) ?? ZERO,
    targetWithdrawal: targetRateByItem.get(item.id) ?? ZERO,
    excessWithdrawal: excessRateByItem.get(item.id) ?? ZERO,
  }));
  const rawResults: ExactRawRate[] = input.graph.items
    .filter((item) => item.isRaw)
    .map((item) => {
      const used = consumed.get(item.id) ?? ZERO;
      if (item.isUnlimited) {
        return { item: item.id, unlimited: true, available: null, used, leftover: null };
      }
      const available = Rational.from(input.rawAvailability[item.id] ?? 0);
      return {
        item: item.id,
        unlimited: false,
        available,
        used,
        leftover: available.subtract(used),
      };
    });
  const rawByItem = new Map(rawResults.map((raw) => [raw.item, raw] as const));
  const internalSplitterMergerDevices = banks.reduce((total, bank) => {
    const recipe = input.graph.recipeById.get(bank.recipeId);
    if (!recipe) throw new Error(`Missing selected recipe: ${bank.recipeId}`);
    const perBank = equalLaneTreeDevices(bank.machines) * BigInt(recipe.inputs.length + 1);
    return total + perBank * bank.multiplicity;
  }, ZERO_BIGINT);
  const routingSplitterDevices = state.routingVariables.reduce((total, entry) => {
    const value = solver.value(entry.variable);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `Non-integral routing-device count returned for ${entry.item}: ${value}`,
      );
    }
    return total + BigInt(value);
  }, ZERO_BIGINT);
  const objective: ExactObjectiveVector = {
    scarceRawItemsPerMinute: input.graph.scarceRawIds.reduce(
      (total, itemId) => total.add(rawByItem.get(itemId)?.used ?? ZERO),
      ZERO,
    ),
    weightedTargetOutput: targetResults.reduce(
      (total, target) => total.add(target.rate.multiply(target.weight)),
      ZERO,
    ),
    physicalMachines: banks.reduce(
      (total, bank) => total + bank.machines * bank.multiplicity,
      ZERO_BIGINT,
    ),
    groups: banks.reduce((total, bank) => total + bank.multiplicity, ZERO_BIGINT),
    internalSplitterMergerDevices,
    routingSplitterDevices,
    totalSplitterMergerDevices: internalSplitterMergerDevices + routingSplitterDevices,
  };
  return {
    feasible: true,
    proofStatus: "OPTIMAL",
    selectedBanks: banks,
    targets: targetResults,
    excess: excessResults,
    raws: rawResults,
    items: itemResults,
    objective,
  };
}

function emptyResult(status: "INFEASIBLE" | "CANCELLED"): ExactOptimizerResult {
  return {
    feasible: false,
    proofStatus: status,
    selectedBanks: [],
    targets: [],
    excess: [],
    raws: [],
    items: [],
    objective: null,
  };
}

/** Cancels the active or-tools-wasm CP-SAT solve, if any. */
export function cancelExactSolve(): Promise<void> {
  return CpSat.cancelSolve();
}

/**
 * Finds and proves the complete lexicographic optimum. No time limit or gap is
 * accepted: a feasible result is returned only after every phase is OPTIMAL.
 */
export async function solveExactProduction(
  input: ExactOptimizerInput,
): Promise<ExactOptimizerResult> {
  validateRawAvailability(input);
  const beltCapacity = Rational.from(input.beltCapacity);
  if (beltCapacity.compare(0) <= 0) throw new RangeError("Belt capacity must be positive");
  const targets = normalizeTargets(input);
  const excess = normalizeExcess(input);
  const state = buildModel(input, beltCapacity, targets, excess);

  const onAbort = () => {
    void cancelExactSolve();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const solved = await solveLexicographically(state, input);
    if (solved.status !== "OPTIMAL") return emptyResult(solved.status);
    if (!solved.solver) throw new Error("OPTIMAL solve did not return a CP-SAT solution");
    const result = createResult(input, state, solved.solver, targets, excess);
    const validation = validateExactSolution(input, result);
    if (!validation.valid) {
      throw new Error(
        `Exact solution failed independent validation:\n${validation.issues.join("\n")}`,
      );
    }
    return result;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export const optimizeExactProduction = solveExactProduction;
