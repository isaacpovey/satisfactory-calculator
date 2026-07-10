import type { ItemId, Recipe } from "@/data/types";
import { computeRecipeBounds } from "./bounds";
import type {
  ExactOptimizerInput,
  ExactOptimizerResult,
  ExactSelectedBank,
  ExactSolutionValidation,
} from "./optimizer-types";
import { Rational, type RationalInput } from "./rational";
import { isLegalUnderclock, recipeCyclesPerMinuteExact, recipeRatesAtClock } from "./underclocks";

const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const TWO_BIGINT = BigInt(2);
const THREE_BIGINT = BigInt(3);
const ZERO = new Rational(ZERO_BIGINT);

function addRate(target: Map<ItemId, Rational>, item: ItemId, amount: Rational): void {
  target.set(item, (target.get(item) ?? ZERO).add(amount));
}

function specifiedRate(
  primary: RationalInput | undefined,
  compatibility: RationalInput | undefined,
): Rational {
  if (primary !== undefined && compatibility !== undefined) {
    const left = Rational.from(primary);
    const right = Rational.from(compatibility);
    if (!left.equals(right)) throw new RangeError("Conflicting exact rate values");
    return left;
  }
  return Rational.from(primary ?? compatibility ?? 0);
}

function canonicalMachineCount(count: bigint): boolean {
  if (count <= ZERO_BIGINT) return false;
  let remaining = count;
  while (remaining % TWO_BIGINT === ZERO_BIGINT) remaining /= TWO_BIGINT;
  while (remaining % THREE_BIGINT === ZERO_BIGINT) remaining /= THREE_BIGINT;
  return remaining === ONE_BIGINT;
}

/** Independent implementation used to verify the reported device objective. */
function laneTreeDevices(count: bigint): bigint {
  let remaining = count;
  let lanes = ONE_BIGINT;
  let devices = ZERO_BIGINT;
  while (remaining % TWO_BIGINT === ZERO_BIGINT) {
    devices += lanes;
    lanes *= TWO_BIGINT;
    remaining /= TWO_BIGINT;
  }
  while (remaining % THREE_BIGINT === ZERO_BIGINT) {
    devices += lanes;
    lanes *= THREE_BIGINT;
    remaining /= THREE_BIGINT;
  }
  return devices;
}

function mapMatches(
  actual: ReadonlyMap<ItemId, Rational>,
  expectedEntries: readonly { readonly item: ItemId; readonly rate: Rational }[],
): boolean {
  const expected = new Map<ItemId, Rational>();
  for (const entry of expectedEntries) addRate(expected, entry.item, entry.rate);
  if (actual.size !== expected.size) return false;
  for (const [itemId, rate] of expected) {
    if (!actual.get(itemId)?.equals(rate)) return false;
  }
  return true;
}

function validateBank(
  input: ExactOptimizerInput,
  bank: ExactSelectedBank,
  beltCapacity: Rational,
  produced: Map<ItemId, Rational>,
  consumed: Map<ItemId, Rational>,
  issues: string[],
): Recipe | null {
  const recipe = input.graph.recipeById.get(bank.recipeId);
  if (!recipe) {
    issues.push(`Selected bank references unknown recipe: ${bank.recipeId}`);
    return null;
  }
  if (bank.multiplicity <= ZERO_BIGINT) {
    issues.push(`Selected bank ${bank.recipeId} has non-positive multiplicity`);
  }
  if (!canonicalMachineCount(bank.machines)) {
    issues.push(`Selected bank ${bank.recipeId} has non-canonical machine count ${bank.machines}`);
  }
  if (!isLegalUnderclock(recipe, bank.clock)) {
    issues.push(
      `Selected bank ${bank.recipeId} has illegal clock ${bank.clock.toFractionString()}`,
    );
  }

  let rates: ReturnType<typeof recipeRatesAtClock> | null = null;
  try {
    rates = recipeRatesAtClock(recipe, bank.clock);
  } catch {
    issues.push(`Selected bank ${bank.recipeId} clock cannot produce exact rates`);
    return recipe;
  }
  const machineFactor = new Rational(bank.machines);
  const expectedInputs = rates.inputs.map(({ item, rate }) => ({
    item,
    rate: rate.multiply(machineFactor),
  }));
  const expectedOutputs = rates.outputs.map(({ item, rate }) => ({
    item,
    rate: rate.multiply(machineFactor),
  }));
  if (!mapMatches(bank.inputRatesPerBank, expectedInputs)) {
    issues.push(`Selected bank ${bank.recipeId} reports incorrect input rates`);
  }
  if (!mapMatches(bank.outputRatesPerBank, expectedOutputs)) {
    issues.push(`Selected bank ${bank.recipeId} reports incorrect output rates`);
  }
  const expectedEffective = bank.clock.multiply(machineFactor);
  const expectedCycles = recipeCyclesPerMinuteExact(recipe).multiply(expectedEffective);
  if (!bank.effectiveMachinesPerBank.equals(expectedEffective)) {
    issues.push(`Selected bank ${bank.recipeId} reports incorrect effective machines`);
  }
  if (!bank.cyclesPerMinutePerBank.equals(expectedCycles)) {
    issues.push(`Selected bank ${bank.recipeId} reports incorrect cycle rate`);
  }

  const multiplicity = new Rational(bank.multiplicity);
  for (const entry of [...expectedInputs, ...expectedOutputs]) {
    if (entry.rate.compare(beltCapacity) > 0) {
      issues.push(`Selected bank ${bank.recipeId} exceeds belt capacity for ${entry.item}`);
    }
  }
  for (const { item, rate } of expectedInputs) addRate(consumed, item, rate.multiply(multiplicity));
  for (const { item, rate } of expectedOutputs)
    addRate(produced, item, rate.multiply(multiplicity));
  return recipe;
}

/**
 * Recomputes every rate and objective from recipe data and selected banks using
 * BigInt-backed rationals. It does not trust CP-SAT row scaling or reported
 * bank/item/objective totals.
 */
export function validateExactSolution(
  input: ExactOptimizerInput,
  result: ExactOptimizerResult,
): ExactSolutionValidation {
  const issues: string[] = [];
  if (!result.feasible || result.proofStatus !== "OPTIMAL" || !result.objective) {
    return { valid: false, issues: ["Only a proven OPTIMAL feasible solution can be validated"] };
  }
  const beltCapacity = Rational.from(input.beltCapacity);
  const produced = new Map<ItemId, Rational>();
  const consumed = new Map<ItemId, Rational>();
  const effectiveByRecipe = new Map<string, Rational>();
  const selectedKeys = new Set<string>();
  let physicalMachines = ZERO_BIGINT;
  let groups = ZERO_BIGINT;
  let devices = ZERO_BIGINT;

  for (const bank of result.selectedBanks) {
    const key = `${bank.recipeId}|${bank.machines}|${bank.clock.toFractionString()}`;
    if (selectedKeys.has(key)) issues.push(`Duplicate selected bank pattern: ${key}`);
    selectedKeys.add(key);
    const recipe = validateBank(input, bank, beltCapacity, produced, consumed, issues);
    if (!recipe) continue;
    const totalEffective = bank.clock
      .multiply(new Rational(bank.machines))
      .multiply(new Rational(bank.multiplicity));
    effectiveByRecipe.set(
      recipe.id,
      (effectiveByRecipe.get(recipe.id) ?? ZERO).add(totalEffective),
    );
    physicalMachines += bank.machines * bank.multiplicity;
    groups += bank.multiplicity;
    devices +=
      laneTreeDevices(bank.machines) *
      BigInt(recipe.inputs.length + recipe.outputs.length) *
      bank.multiplicity;
  }

  const bounds = computeRecipeBounds(input.graph, input.rawAvailability);
  for (const [recipeId, effective] of effectiveByRecipe) {
    const bound = bounds.get(recipeId);
    if (!bound || effective.compare(bound.maxEffectiveMachines) > 0) {
      issues.push(`Selected activity exceeds the raw-derived bound for ${recipeId}`);
    }
  }

  const targetByItem = new Map<ItemId, (typeof result.targets)[number]>();
  for (const target of result.targets) {
    if (targetByItem.has(target.item)) issues.push(`Duplicate reported target: ${target.item}`);
    targetByItem.set(target.item, target);
  }
  if (targetByItem.size !== input.targets.length) {
    issues.push("Reported target set does not match the requested target set");
  }
  for (const spec of input.targets) {
    const target = targetByItem.get(spec.item);
    const minimum = specifiedRate(spec.minimum, spec.minRate);
    const weight = Rational.from(spec.weight);
    if (!target) {
      issues.push(`Missing reported target: ${spec.item}`);
      continue;
    }
    if (!target.minimum.equals(minimum) || !target.weight.equals(weight)) {
      issues.push(`Reported target metadata is incorrect for ${spec.item}`);
    }
    if (target.rate.compare(minimum) < 0) {
      issues.push(`Target minimum is not met for ${spec.item}`);
    }
  }

  const requestedFloors = new Map(
    (input.excess ?? []).map((spec) => [spec.item, specifiedRate(spec.floor, spec.rate)] as const),
  );
  const eligibleExcessIds = input.graph.items
    .filter((item) => !item.isRaw && !item.isIngot)
    .map((item) => item.id);
  const excessByItem = new Map<ItemId, (typeof result.excess)[number]>();
  for (const excess of result.excess) {
    if (excessByItem.has(excess.item)) issues.push(`Duplicate reported excess: ${excess.item}`);
    excessByItem.set(excess.item, excess);
  }
  if (
    excessByItem.size !== eligibleExcessIds.length ||
    eligibleExcessIds.some((itemId) => !excessByItem.has(itemId))
  ) {
    issues.push("Reported excess set must contain every manufactured non-ingot");
  }
  for (const item of input.graph.items) {
    const excess = excessByItem.get(item.id);
    if (item.isIngot && excess !== undefined && excess.rate.compare(0) !== 0) {
      issues.push(`Ingot storage is forbidden: ${item.id}`);
    }
    if (item.isRaw || item.isIngot) continue;
    const floor = requestedFloors.get(item.id) ?? ZERO;
    if (!excess) continue;
    if (!excess.floor.equals(floor))
      issues.push(`Reported excess floor is incorrect for ${item.id}`);
    if (excess.rate.compare(floor) < 0) issues.push(`Excess floor is not met for ${item.id}`);
  }

  for (const item of input.graph.items) {
    if (item.isRaw) continue;
    const target = targetByItem.get(item.id)?.rate ?? ZERO;
    const excess = excessByItem.get(item.id)?.rate ?? ZERO;
    const left = produced.get(item.id) ?? ZERO;
    const right = (consumed.get(item.id) ?? ZERO).add(target).add(excess);
    if (!left.equals(right)) {
      issues.push(
        `Exact conservation fails for ${item.id}: ${left.toFractionString()} != ${right.toFractionString()}`,
      );
    }
    if (item.isIngot && !excess.isZero()) issues.push(`Ingot has non-zero excess: ${item.id}`);
  }

  const rawByItem = new Map<ItemId, (typeof result.raws)[number]>();
  for (const raw of result.raws) {
    if (rawByItem.has(raw.item)) issues.push(`Duplicate reported raw: ${raw.item}`);
    rawByItem.set(raw.item, raw);
  }
  const rawItems = input.graph.items.filter((item) => item.isRaw);
  if (rawByItem.size !== rawItems.length) issues.push("Reported raw set is incomplete");
  for (const item of rawItems) {
    const raw = rawByItem.get(item.id);
    const used = consumed.get(item.id) ?? ZERO;
    if (!raw) {
      issues.push(`Missing reported raw: ${item.id}`);
      continue;
    }
    if (!raw.used.equals(used) || raw.unlimited !== !!item.isUnlimited) {
      issues.push(`Reported raw use is incorrect for ${item.id}`);
    }
    if (item.isUnlimited) {
      if (raw.available !== null || raw.leftover !== null) {
        issues.push(`Unlimited raw ${item.id} must not report a finite bound`);
      }
      continue;
    }
    const available = Rational.from(input.rawAvailability[item.id] ?? 0);
    if (used.compare(available) > 0) issues.push(`Raw availability exceeded for ${item.id}`);
    if (
      raw.available === null ||
      raw.leftover === null ||
      !raw.available.equals(available) ||
      !raw.leftover.equals(available.subtract(used))
    ) {
      issues.push(`Reported raw availability/leftover is incorrect for ${item.id}`);
    }
  }

  const itemByItem = new Map<ItemId, (typeof result.items)[number]>();
  for (const itemRate of result.items) {
    if (itemByItem.has(itemRate.item))
      issues.push(`Duplicate reported item rate: ${itemRate.item}`);
    itemByItem.set(itemRate.item, itemRate);
  }
  if (itemByItem.size !== input.graph.items.length)
    issues.push("Reported item-rate set is incomplete");
  for (const item of input.graph.items) {
    const rate = itemByItem.get(item.id);
    if (!rate) {
      issues.push(`Missing reported item rate: ${item.id}`);
      continue;
    }
    if (
      !rate.produced.equals(produced.get(item.id) ?? ZERO) ||
      !rate.consumed.equals(consumed.get(item.id) ?? ZERO) ||
      !rate.targetWithdrawal.equals(targetByItem.get(item.id)?.rate ?? ZERO) ||
      !rate.excessWithdrawal.equals(excessByItem.get(item.id)?.rate ?? ZERO)
    ) {
      issues.push(`Reported item rates are incorrect for ${item.id}`);
    }
  }

  const scarceRawItemsPerMinute = input.graph.scarceRawIds.reduce(
    (total, itemId) => total.add(consumed.get(itemId) ?? ZERO),
    ZERO,
  );
  const weightedTargetOutput = result.targets.reduce(
    (total, target) => total.add(target.rate.multiply(target.weight)),
    ZERO,
  );
  if (!result.objective.scarceRawItemsPerMinute.equals(scarceRawItemsPerMinute)) {
    issues.push("Reported scarce-raw objective is incorrect");
  }
  if (!result.objective.weightedTargetOutput.equals(weightedTargetOutput)) {
    issues.push("Reported weighted-target objective is incorrect");
  }
  if (result.objective.physicalMachines !== physicalMachines) {
    issues.push("Reported physical-machine objective is incorrect");
  }
  if (result.objective.groups !== groups) issues.push("Reported group objective is incorrect");
  if (result.objective.internalSplitterMergerDevices !== devices) {
    issues.push("Reported internal-device objective is incorrect");
  }

  return { valid: issues.length === 0, issues };
}
