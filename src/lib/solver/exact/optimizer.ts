import {
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
  readonly order: number;
}

interface WithdrawalVariable {
  readonly variable: IntVar;
  readonly scale: bigint;
  readonly upperBound: bigint;
}

interface ModelState {
  readonly model: CpModel;
  readonly patterns: readonly PatternVariable[];
  readonly targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
  readonly excessVariables: ReadonlyMap<ItemId, WithdrawalVariable>;
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
    for (const pattern of generateMachineBankPatterns(bound, beltCapacity)) {
      const upperBound = bound.maxEffectiveMachines.divide(pattern.effectiveMachines).floor();
      if (upperBound <= ZERO_BIGINT) continue;
      const safeUpperBound = checkedSafeInteger(
        upperBound,
        `${recipe.id} ${pattern.machines}@${pattern.clock.toFractionString()} multiplicity bound`,
      );
      variables.push({
        pattern,
        variable: model.newIntVar(
          0,
          safeUpperBound,
          `bank_${recipe.id}_${pattern.machines}_${pattern.clock.toFractionString()}`,
        ),
        upperBound,
        order,
      });
      order++;
    }
  }
  return variables;
}

function addRawConstraints(
  input: ExactOptimizerInput,
  model: CpModel,
  patterns: readonly PatternVariable[],
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
  patterns: readonly PatternVariable[],
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

function objectiveTerms(
  input: ExactOptimizerInput,
  patterns: readonly PatternVariable[],
  targets: readonly NormalizedTarget[],
  targetVariables: ReadonlyMap<ItemId, WithdrawalVariable>,
): ModelState["objectives"] {
  const scarceSet = new Set(input.graph.scarceRawIds);
  const scarceRawTerms = patterns.map((entry) => {
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
  const deviceTerms = patterns.map((entry) => {
    const recipe = input.graph.recipeById.get(entry.pattern.recipeId);
    if (!recipe) throw new Error(`Missing recipe for bank pattern: ${entry.pattern.recipeId}`);
    return {
      variable: entry.variable,
      coefficient: new Rational(internalDevices(entry.pattern, recipe.inputs.length)),
      upperBound: entry.upperBound,
    };
  });
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
    { label: "internal splitter and merger devices", maximize: false, terms: deviceTerms },
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
  const patterns = createPatternVariables(input, model, beltCapacity);
  addRawConstraints(input, model, patterns);
  const withdrawals = addConservationRows(input, model, patterns, targets, excess);
  return {
    model,
    patterns,
    ...withdrawals,
    objectives: objectiveTerms(input, patterns, targets, withdrawals.targetVariables),
  };
}

async function solveLexicographically(
  state: ModelState,
  signal: AbortSignal | undefined,
): Promise<{
  readonly solver: CpSolver | null;
  readonly status: "OPTIMAL" | "INFEASIBLE" | "CANCELLED";
}> {
  let lastSolver: CpSolver | null = null;
  for (let index = 0; index < state.objectives.length; index++) {
    if (signal?.aborted) return { solver: lastSolver, status: "CANCELLED" };
    const objective = state.objectives[index]!;
    const integer = safeIntegerExpression(objective.terms, objective.label);
    if (objective.maximize) state.model.maximize(integer.expression);
    else state.model.minimize(integer.expression);

    const solver = new CpSolver();
    const status = await solver.solve(state.model, {
      numSearchWorkers: 1,
      randomSeed: 1,
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
    internalSplitterMergerDevices: banks.reduce((total, bank) => {
      const recipe = input.graph.recipeById.get(bank.recipeId);
      if (!recipe) throw new Error(`Missing selected recipe: ${bank.recipeId}`);
      const perBank = equalLaneTreeDevices(bank.machines) * BigInt(recipe.inputs.length + 1);
      return total + perBank * bank.multiplicity;
    }, ZERO_BIGINT),
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
    const solved = await solveLexicographically(state, input.signal);
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
