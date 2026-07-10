import { clampMaxBeltCapacity, DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { buildings, items, scarceRawIds } from "@/data/items";
import { recipes } from "@/data/recipes";
import type { ItemId, Recipe } from "@/data/types";
import {
  Rational,
  solveExactProduction,
  validateRecipeGraph,
  type ExactObjectiveVector,
  type ExactOptimizerResult,
  type ExactSelectedBank,
  type ExactSolveProgress,
} from "./exact";
import { buildChainGroups } from "./stage-order";
import type {
  FlowEdge,
  LaneWithdrawal,
  MachineGroupPlan,
  MergePlan,
  PlannerInput,
  ProductionStage,
  RecipeUsage,
  SolveObjective,
  SolveResult,
  SplitPlan,
  StageInputBelt,
} from "./types";

const ZERO = Rational.from(0);

const buildingName = new Map(buildings.map((building) => [building.id, building.name] as const));

export interface ExactPlannerSolveOptions {
  signal?: AbortSignal;
  searchWorkers?: number;
  interleaveSearch?: boolean;
  onProgress?: (progress: ExactSolveProgress) => void;
}

interface ExpandedBank {
  bank: ExactSelectedBank;
  bankIndex: number;
}

interface ExactDestination {
  to: LaneWithdrawal["to"];
  toBankIndex?: number;
  rate: Rational;
}

interface ExactLane {
  stage: ProductionStage;
  merge: MergePlan;
  laneIndex: number;
  rate: Rational;
}

interface ExactAllocation extends ExactDestination {
  lane: ExactLane;
}

function exactNumber(value: Rational, label: string): number {
  const converted = value.toNumber();
  if (!Number.isFinite(converted)) {
    throw new RangeError(`${label} cannot be represented as a display number`);
  }
  return converted;
}

function exactInteger(value: bigint, label: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new RangeError(`${label} cannot be represented as a safe display integer`);
  }
  return converted;
}

function mergeOnlyPlan(): SplitPlan {
  return { ratio: { num: 1, den: 1 }, steps: [], mergeOnly: true };
}

function groupInputSplit(machines: number): SplitPlan {
  if (machines <= 1) return mergeOnlyPlan();
  let remaining = machines;
  const steps: SplitPlan["steps"] = [];
  while (remaining % 2 === 0) {
    steps.push("1/2");
    remaining /= 2;
  }
  while (remaining % 3 === 0) {
    steps.push("1/3");
    remaining /= 3;
  }
  if (remaining !== 1) {
    throw new Error(`Exact bank has a non-canonical machine count: ${machines}`);
  }
  return {
    ratio: { num: 1, den: machines },
    steps,
    mergeOnly: false,
  };
}

function sourceForInput(
  item: ItemId,
  graph: ReturnType<typeof validateRecipeGraph>,
): StageInputBelt["from"] {
  if (graph.itemById.get(item)?.isRaw) return { kind: "raw", id: item };
  const producer = graph.producerByItem.get(item);
  if (!producer) throw new Error(`Missing exact producer for stage input: ${item}`);
  return { kind: "stage", id: producer.id };
}

function expandSelectedBanks(
  selectedBanks: readonly ExactSelectedBank[],
): ReadonlyMap<string, readonly ExpandedBank[]> {
  const byRecipe = new Map<string, ExpandedBank[]>();
  for (const bank of selectedBanks) {
    const expanded = byRecipe.get(bank.recipeId) ?? [];
    const multiplicity = exactInteger(bank.multiplicity, `${bank.recipeId} bank multiplicity`);
    for (let index = 0; index < multiplicity; index++) {
      expanded.push({ bank, bankIndex: expanded.length });
    }
    byRecipe.set(bank.recipeId, expanded);
  }
  return byRecipe;
}

function buildGroups(recipe: Recipe, expanded: readonly ExpandedBank[]): MachineGroupPlan[] {
  const primaryOutput = recipe.outputs[0]!.item;
  return expanded.map(({ bank }) => {
    const machines = exactInteger(bank.machines, `${recipe.id} machine count`);
    return {
      machines,
      clock: exactNumber(bank.clock, `${recipe.id} clock`),
      effectiveMachines: exactNumber(
        bank.effectiveMachinesPerBank,
        `${recipe.id} effective machines`,
      ),
      inputSplit: groupInputSplit(machines),
      outputPerMinute: exactNumber(
        bank.outputRatesPerBank.get(primaryOutput) ?? ZERO,
        `${recipe.id} bank output`,
      ),
    };
  });
}

function buildInputBelts(
  recipe: Recipe,
  expanded: readonly ExpandedBank[],
  graph: ReturnType<typeof validateRecipeGraph>,
): StageInputBelt[] {
  const belts: StageInputBelt[] = [];
  for (const input of recipe.inputs) {
    for (const { bank, bankIndex } of expanded) {
      const rate = bank.inputRatesPerBank.get(input.item) ?? ZERO;
      if (rate.isZero()) continue;
      belts.push({
        item: input.item,
        rate: exactNumber(rate, `${recipe.id} ${input.item} bank input`),
        split: mergeOnlyPlan(),
        feeds: [
          {
            bankIndex,
            rate: exactNumber(rate, `${recipe.id} ${input.item} bank feed`),
            machines: exactInteger(bank.machines, `${recipe.id} bank feed machines`),
          },
        ],
        from: sourceForInput(input.item, graph),
      });
    }
  }
  return belts;
}

function buildStagesAndRecipes(
  graph: ReturnType<typeof validateRecipeGraph>,
  expandedByRecipe: ReadonlyMap<string, readonly ExpandedBank[]>,
): {
  stages: ProductionStage[];
  recipeUsages: RecipeUsage[];
  lanesByItem: Map<ItemId, ExactLane[]>;
} {
  const stages: ProductionStage[] = [];
  const recipeUsages: RecipeUsage[] = [];
  const lanesByItem = new Map<ItemId, ExactLane[]>();

  for (const recipe of graph.topologicalRecipes) {
    const expanded = expandedByRecipe.get(recipe.id) ?? [];
    if (expanded.length === 0) continue;
    const primaryOutput = recipe.outputs[0]!.item;
    const groups = buildGroups(recipe, expanded);
    const outputMerges: MergePlan[] = expanded.map(({ bank, bankIndex }) => {
      const rate = exactNumber(
        bank.outputRatesPerBank.get(primaryOutput) ?? ZERO,
        `${recipe.id} output lane`,
      );
      return {
        beltCount: 1,
        steps: [],
        rate,
        mergeOnly: true,
        sourceRates: [rate],
        sourceBankIndexes: [bankIndex],
        withdrawals: [],
      };
    });
    const stage: ProductionStage = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      building: buildingName.get(recipe.building) ?? recipe.building,
      primaryOutput,
      groups,
      outputPerMinute: groups.reduce((total, group) => total + group.outputPerMinute, 0),
      outputMerges,
      inputBelts: buildInputBelts(recipe, expanded, graph),
    };
    stages.push(stage);

    const itemLanes = lanesByItem.get(primaryOutput) ?? [];
    expanded.forEach(({ bank }, bankIndex) => {
      const merge = outputMerges[bankIndex]!;
      itemLanes.push({
        stage,
        merge,
        laneIndex: bankIndex,
        rate: bank.outputRatesPerBank.get(primaryOutput) ?? ZERO,
      });
      recipeUsages.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        building: stage.building,
        machines: exactInteger(bank.machines, `${recipe.id} recipe machines`),
        clock: exactNumber(bank.clock, `${recipe.id} recipe clock`),
        effectiveMachines: exactNumber(
          bank.effectiveMachinesPerBank,
          `${recipe.id} recipe effective machines`,
        ),
        cyclesPerMinute: exactNumber(bank.cyclesPerMinutePerBank, `${recipe.id} recipe cycles`),
        outputPerMinute: merge.rate,
        primaryOutput,
        groupIndex: bankIndex,
      });
    });
    lanesByItem.set(primaryOutput, itemLanes);
  }

  recipeUsages.sort(
    (left, right) =>
      left.recipeName.localeCompare(right.recipeName) || left.groupIndex - right.groupIndex,
  );
  return { stages, recipeUsages, lanesByItem };
}

function collectInputDestinations(
  graph: ReturnType<typeof validateRecipeGraph>,
  expandedByRecipe: ReadonlyMap<string, readonly ExpandedBank[]>,
): Map<ItemId, ExactDestination[]> {
  const byItem = new Map<ItemId, ExactDestination[]>();
  for (const recipe of graph.topologicalRecipes) {
    for (const { bank, bankIndex } of expandedByRecipe.get(recipe.id) ?? []) {
      for (const [item, rate] of bank.inputRatesPerBank) {
        if (rate.isZero()) continue;
        const destinations = byItem.get(item) ?? [];
        destinations.push({
          to: { kind: "recipe", id: recipe.id },
          toBankIndex: bankIndex,
          rate,
        });
        byItem.set(item, destinations);
      }
    }
  }
  return byItem;
}

function allocateLanes(
  item: ItemId,
  lanes: readonly ExactLane[],
  destinations: readonly ExactDestination[],
): ExactAllocation[] {
  const allocations: ExactAllocation[] = [];
  const remainingDestinations = destinations.map((destination) => ({
    ...destination,
    remaining: destination.rate,
  }));
  let destinationIndex = 0;

  for (const lane of lanes) {
    let remainingLane = lane.rate;
    while (!remainingLane.isZero()) {
      while (
        destinationIndex < remainingDestinations.length &&
        remainingDestinations[destinationIndex]!.remaining.isZero()
      ) {
        destinationIndex++;
      }
      const destination = remainingDestinations[destinationIndex];
      if (!destination) {
        throw new Error(`Exact output lane for ${item} has unallocated production`);
      }
      const withdrawal =
        remainingLane.compare(destination.remaining) <= 0 ? remainingLane : destination.remaining;
      allocations.push({
        lane,
        to: destination.to,
        toBankIndex: destination.toBankIndex,
        rate: withdrawal,
      });
      remainingLane = remainingLane.subtract(withdrawal);
      destination.remaining = destination.remaining.subtract(withdrawal);
    }
  }

  const unfilled = remainingDestinations.find((destination) => !destination.remaining.isZero());
  if (unfilled) {
    throw new Error(
      `Exact destination ${unfilled.to.kind}:${unfilled.to.id} is short ${unfilled.remaining.toFractionString()} ${item}/min`,
    );
  }
  return allocations;
}

function applyLaneRouting(allocations: readonly ExactAllocation[]): FlowEdge[] {
  const byLane = new Map<ExactLane, ExactAllocation[]>();
  for (const allocation of allocations) {
    const laneAllocations = byLane.get(allocation.lane) ?? [];
    laneAllocations.push(allocation);
    byLane.set(allocation.lane, laneAllocations);
  }

  const edges: FlowEdge[] = [];
  for (const [lane, laneAllocations] of byLane) {
    const withdrawals: LaneWithdrawal[] = laneAllocations.map((allocation) => ({
      to: allocation.to,
      rate: exactNumber(allocation.rate, `${lane.stage.recipeId} lane withdrawal`),
      ...(allocation.toBankIndex === undefined ? {} : { toBankIndex: allocation.toBankIndex }),
    }));
    lane.merge.withdrawals = withdrawals;
    if (withdrawals.length === 1) {
      lane.merge.routing = "dedicated";
      lane.merge.to = withdrawals[0]!.to;
      lane.merge.consumerRate = withdrawals[0]!.rate;
    } else {
      lane.merge.routing = "demand-balanced-manifold";
      lane.merge.backpressure = true;
    }

    for (const allocation of laneAllocations) {
      const shared = laneAllocations.length > 1;
      edges.push({
        item: lane.stage.primaryOutput,
        rate: exactNumber(allocation.rate, `${lane.stage.recipeId} routed edge`),
        from: { kind: "stage", id: lane.stage.recipeId },
        to: allocation.to,
        fromLaneIndex: lane.laneIndex,
        ...(allocation.toBankIndex === undefined ? {} : { toBankIndex: allocation.toBankIndex }),
        outputSplit: shared
          ? {
              ratio: null,
              steps: [],
              mergeOnly: false,
              demandBalanced: true,
              backpressure: true,
            }
          : mergeOnlyPlan(),
      });
    }
  }
  return edges;
}

function buildNetwork(
  result: ExactOptimizerResult,
  graph: ReturnType<typeof validateRecipeGraph>,
  stages: ProductionStage[],
  lanesByItem: ReadonlyMap<ItemId, readonly ExactLane[]>,
  expandedByRecipe: ReadonlyMap<string, readonly ExpandedBank[]>,
): SolveResult["network"] {
  const inputDestinations = collectInputDestinations(graph, expandedByRecipe);
  const targetByItem = new Map(result.targets.map((target) => [target.item, target.rate] as const));
  const excessByItem = new Map(result.excess.map((excess) => [excess.item, excess.rate] as const));
  const edges: FlowEdge[] = [];

  for (const item of graph.items) {
    const destinations = [...(inputDestinations.get(item.id) ?? [])];
    if (!item.isRaw) {
      const target = targetByItem.get(item.id) ?? ZERO;
      if (!target.isZero()) {
        destinations.push({ to: { kind: "target", id: item.id }, rate: target });
      }
      const excess = excessByItem.get(item.id) ?? ZERO;
      if (!excess.isZero()) {
        destinations.push({ to: { kind: "excess", id: item.id }, rate: excess });
      }
      edges.push(
        ...applyLaneRouting(allocateLanes(item.id, lanesByItem.get(item.id) ?? [], destinations)),
      );
      continue;
    }

    for (const destination of destinations) {
      edges.push({
        item: item.id,
        rate: exactNumber(destination.rate, `${item.id} raw edge`),
        from: { kind: "raw", id: item.id },
        to: destination.to,
        fromLaneIndex: null,
        ...(destination.toBankIndex === undefined ? {} : { toBankIndex: destination.toBankIndex }),
        outputSplit: mergeOnlyPlan(),
      });
    }
  }

  edges.sort(
    (left, right) =>
      left.item.localeCompare(right.item) ||
      left.from.id.localeCompare(right.from.id) ||
      (left.fromLaneIndex ?? -1) - (right.fromLaneIndex ?? -1) ||
      left.to.kind.localeCompare(right.to.kind) ||
      left.to.id.localeCompare(right.to.id) ||
      (left.toBankIndex ?? -1) - (right.toBankIndex ?? -1),
  );
  const targetItems = result.targets
    .filter((target) => !target.rate.isZero())
    .map((target) => target.item);
  return { stages, edges, chains: buildChainGroups(stages, targetItems) };
}

function objectiveMetadata(objective: ExactObjectiveVector | null): SolveObjective | null {
  if (!objective) return null;
  return {
    scarceRawItemsPerMinute: exactNumber(objective.scarceRawItemsPerMinute, "scarce raw objective"),
    weightedTargetOutput: exactNumber(objective.weightedTargetOutput, "weighted target objective"),
    physicalMachines: exactInteger(objective.physicalMachines, "physical machine objective"),
    groups: exactInteger(objective.groups, "group objective"),
    internalSplitterMergerDevices: exactInteger(
      objective.internalSplitterMergerDevices,
      "internal device objective",
    ),
    routingSplitterDevices: exactInteger(
      objective.routingSplitterDevices,
      "routing device objective",
    ),
    totalSplitterMergerDevices: exactInteger(
      objective.totalSplitterMergerDevices,
      "total device objective",
    ),
  };
}

function overallUtilization(raws: SolveResult["raws"]): number {
  const available = raws.reduce((total, raw) => total + raw.available, 0);
  const used = raws.reduce((total, raw) => total + raw.used, 0);
  return available > 0 ? used / available : 0;
}

function emptyPlannerResult(exact: ExactOptimizerResult, maxBeltCapacity: number): SolveResult {
  return {
    feasible: false,
    proofStatus: exact.proofStatus,
    objective: null,
    targets: [],
    excess: [],
    raws: [],
    recipes: [],
    items: [],
    network: { stages: [], chains: [], edges: [] },
    overallUtilization: 0,
    maxBeltCapacity,
  };
}

/**
 * Runs the exact optimizer and projects its selected banks and withdrawals
 * directly into planner-facing structures without quantizing or repacking.
 */
export async function solveExact(
  input: PlannerInput,
  options: ExactPlannerSolveOptions = {},
): Promise<SolveResult> {
  const graph = validateRecipeGraph(items, recipes, scarceRawIds);
  const maxBeltCapacity = clampMaxBeltCapacity(input.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY);
  const exact = await solveExactProduction({
    graph,
    rawAvailability: input.rawAvailable,
    targets: input.targets.map((target) => ({
      item: target.item,
      minimum: target.minRate,
      weight: target.weight,
    })),
    excess: input.excess.map((entry) => ({ item: entry.item, floor: entry.rate })),
    beltCapacity: maxBeltCapacity,
    signal: options.signal,
    searchWorkers: options.searchWorkers,
    interleaveSearch: options.interleaveSearch,
    onProgress: options.onProgress,
  });
  if (!exact.feasible) return emptyPlannerResult(exact, maxBeltCapacity);

  const expandedByRecipe = expandSelectedBanks(exact.selectedBanks);
  const { stages, recipeUsages, lanesByItem } = buildStagesAndRecipes(graph, expandedByRecipe);
  const network = buildNetwork(exact, graph, stages, lanesByItem, expandedByRecipe);
  const targetResults = exact.targets.map((target) => {
    const minimum = exactNumber(target.minimum, `${target.item} target minimum`);
    const totalRate = exactNumber(target.rate, `${target.item} target rate`);
    return {
      item: target.item,
      minRate: minimum,
      plannedMinRate: minimum,
      extraRate: totalRate - minimum,
      totalRate,
      weight: exactNumber(target.weight, `${target.item} target weight`),
    };
  });
  const excessResults = exact.excess.map((entry) => {
    const requestedRate = exactNumber(entry.floor, `${entry.item} excess floor`);
    const rate = exactNumber(entry.rate, `${entry.item} excess rate`);
    return {
      item: entry.item,
      requestedRate,
      rate,
      autoRate: rate - requestedRate,
    };
  });
  const rawResults = exact.raws
    .filter((raw) => !raw.unlimited)
    .map((raw) => {
      if (!raw.available || !raw.leftover) {
        throw new Error(`Finite raw ${raw.item} is missing exact availability metadata`);
      }
      const available = exactNumber(raw.available, `${raw.item} raw availability`);
      const used = exactNumber(raw.used, `${raw.item} raw use`);
      return {
        item: raw.item,
        available,
        used,
        leftover: exactNumber(raw.leftover, `${raw.item} raw leftover`),
        utilization: available > 0 ? used / available : 0,
        shortfall: Math.max(0, used - available),
      };
    });

  return {
    feasible: true,
    proofStatus: exact.proofStatus,
    objective: objectiveMetadata(exact.objective),
    targets: targetResults,
    excess: excessResults,
    raws: rawResults,
    recipes: recipeUsages,
    items: exact.items.map((item) => {
      const produced = exactNumber(item.produced, `${item.item} produced`);
      const consumed = exactNumber(item.consumed, `${item.item} consumed`);
      return { item: item.item, produced, consumed, net: produced - consumed };
    }),
    network,
    overallUtilization: overallUtilization(rawResults),
    maxBeltCapacity,
  };
}

export const solveExactPlanner = solveExact;
