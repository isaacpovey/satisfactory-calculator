import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { buildings, itemById } from "@/data/items";
import {
  recipes as allRecipes,
  recipeCyclesPerMinute,
  recipePrimaryOutputPerMinute,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";
import {
  friendlyRatio,
  isSplitterFriendlyCount,
  mergerStepsForCount,
  splitStepsForCount,
  splitStepsForRatio,
  type MachineConfig,
} from "./constraints";
import { buildStageInputBelts } from "./input-belts";
import { packMachineBanks } from "./pack-banks";
import { buildChainGroups, orderStagesByDependency } from "./stage-order";
import type {
  FactoryNetwork,
  FlowEdge,
  FlowKind,
  MachineGroupPlan,
  MergePlan,
  ProductionStage,
  SplitPlan,
} from "./types";
import type { Recipe } from "@/data/types";

const EPS = 1e-9;

const buildingName = Object.fromEntries(
  buildings.map((b) => [b.id, b.name]),
) as Record<string, string>;

function mergeOnlyPlan(): SplitPlan {
  return { ratio: { num: 1, den: 1 }, steps: [], mergeOnly: true };
}

function overflowPlan(): SplitPlan {
  return {
    ratio: null,
    steps: [],
    mergeOnly: false,
    overflowToStorage: true,
  };
}

export function inputSplitForGroup(machines: number): SplitPlan {
  if (machines <= 1) return mergeOnlyPlan();
  if (!isSplitterFriendlyCount(machines)) {
    // Should not happen with belt packing — treat as single-belt full feed
    return mergeOnlyPlan();
  }
  const steps = splitStepsForCount(machines);
  return {
    ratio: { num: 1, den: machines },
    steps,
    mergeOnly: false,
  };
}

type BankBelt = { index: number; rate: number };

export type DestinationDemand = {
  to: { kind: FlowKind; id: string };
  rate: number;
};

/**
 * Combine bank output rates into parent lanes that each fit `maxBelt`.
 * Prefer merging as many friendly-count belts as fit under the cap.
 * Preserves original bank indexes so UI labels stay Bank 1, Bank 2, …
 */
export function buildOutputMerges(
  bankOutputRates: number[],
  maxBelt: number,
): MergePlan[] {
  const belts: BankBelt[] = bankOutputRates
    .map((rate, index) => ({ index, rate }))
    .filter((b) => b.rate > EPS);
  if (belts.length === 0) return [];
  if (belts.length === 1) {
    const only = belts[0]!;
    return [
      {
        beltCount: 1,
        steps: [],
        rate: only.rate,
        mergeOnly: true,
        sourceRates: [only.rate],
        sourceBankIndexes: [only.index],
      },
    ];
  }

  // Pack largest-first for capacity, but emit sources sorted by bank index.
  const remaining = [...belts].sort(
    (a, b) => b.rate - a.rate || a.index - b.index,
  );
  const merges: MergePlan[] = [];

  const toPlan = (lane: BankBelt[]): MergePlan => {
    const ordered = [...lane].sort((a, b) => a.index - b.index);
    return {
      beltCount: ordered.length,
      steps: mergerStepsForCount(ordered.length),
      rate: ordered.reduce((s, b) => s + b.rate, 0),
      mergeOnly: ordered.length <= 1,
      sourceRates: ordered.map((b) => b.rate),
      sourceBankIndexes: ordered.map((b) => b.index),
    };
  };

  while (remaining.length > 0) {
    const lane: BankBelt[] = [];
    let laneSum = 0;
    for (let i = 0; i < remaining.length; ) {
      const next = remaining[i]!;
      if (laneSum + next.rate > maxBelt + EPS) {
        i++;
        continue;
      }
      lane.push(next);
      laneSum += next.rate;
      remaining.splice(i, 1);
    }
    if (lane.length === 0) {
      merges.push(toPlan([remaining.shift()!]));
      continue;
    }
    const count = lane.length;
    if (count > 1 && !isSplitterFriendlyCount(count)) {
      const friendly = nearestFriendlyAtMost(count);
      const use = lane.slice(0, friendly);
      remaining.unshift(...lane.slice(friendly));
      merges.push(toPlan(use));
      continue;
    }
    merges.push(toPlan(lane));
  }

  return merges;
}

function nearestFriendlyAtMost(n: number): number {
  for (let k = n; k >= 1; k--) {
    if (k === 1 || isSplitterFriendlyCount(k)) return k;
  }
  return 1;
}

/**
 * Pack machine banks per destination, then form belt-capped output lanes that
 * each feed exactly one destination (leftover on a lane → overflow to storage).
 * When `forbidExcess` is set (ingot stages), lane leftovers stay on the
 * production destination instead of overflowing to storage.
 */
export function packDestinationOutputs(
  recipe: Recipe,
  destinations: DestinationDemand[],
  maxBelt: number,
  surplusRate: number = 0,
  forbidExcess: boolean = false,
): { groups: MachineGroupPlan[]; outputMerges: MergePlan[] } {
  const primaryPerMachine = recipePrimaryOutputPerMinute(recipe);
  if (primaryPerMachine <= EPS) {
    return { groups: [], outputMerges: [] };
  }

  const ordered = [...destinations]
    .filter((d) => d.rate > EPS && d.to.kind !== "excess")
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        a.to.kind.localeCompare(b.to.kind) ||
        a.to.id.localeCompare(b.to.id),
    );

  const allConfigs: MachineConfig[] = [];
  const outputMerges: MergePlan[] = [];
  let bankOffset = 0;

  const appendPack = (
    configs: MachineConfig[],
    to: { kind: FlowKind; id: string },
    consumerRate: number,
  ) => {
    if (configs.length === 0) return;
    const bankRates = configs.map(
      (c) => primaryPerMachine * c.effectiveMachines,
    );
    const localMerges = buildOutputMerges(bankRates, maxBelt);
    const packOut = bankRates.reduce((s, r) => s + r, 0);
    let remainingDemand = Math.min(consumerRate, packOut);

    for (const merge of localMerges) {
      const take = Math.min(remainingDemand, merge.rate);
      remainingDemand -= take;
      if (take > EPS || forbidExcess) {
        outputMerges.push({
          ...merge,
          sourceBankIndexes: merge.sourceBankIndexes.map((i) => i + bankOffset),
          to,
          // Ingots: assign the whole lane to the consumer (no storage dump).
          consumerRate: forbidExcess ? merge.rate : take,
        });
      } else {
        outputMerges.push({
          ...merge,
          sourceBankIndexes: merge.sourceBankIndexes.map((i) => i + bankOffset),
          to: { kind: "excess", id: recipe.outputs[0]!.item },
          consumerRate: 0,
        });
      }
    }
    allConfigs.push(...configs);
    bankOffset += configs.length;
  };

  for (const dest of ordered) {
    const needEff = dest.rate / primaryPerMachine;
    const configs = packMachineBanks(recipe, needEff, {
      maxBeltCapacity: maxBelt,
    });
    appendPack(configs, dest.to, dest.rate);
  }

  if (surplusRate > EPS && !forbidExcess) {
    const needEff = surplusRate / primaryPerMachine;
    const configs = packMachineBanks(recipe, needEff, {
      maxBeltCapacity: maxBelt,
    });
    appendPack(
      configs,
      { kind: "excess", id: recipe.outputs[0]!.item },
      0,
    );
  }

  // If destination packs under-cover total crafts, fill remainder as excess
  // (caller may also pass surplusRate). Covered by appendPack consumerRate=0.

  const groups: MachineGroupPlan[] = allConfigs.map((c) => ({
    machines: c.machines,
    clock: c.clock,
    effectiveMachines: c.effectiveMachines,
    inputSplit: inputSplitForGroup(c.machines),
    outputPerMinute: primaryPerMachine * c.effectiveMachines,
  }));

  return { groups, outputMerges };
}

function collectStageDestinations(
  recipeId: string,
  primaryOutput: ItemId,
  recipeCrafts: Map<string, number>,
  targetRates: Map<ItemId, number>,
): DestinationDemand[] {
  const dests: DestinationDemand[] = [];
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      if (input.item !== primaryOutput) continue;
      const rate = input.amount * crafts;
      if (rate <= EPS) continue;
      dests.push({ to: { kind: "recipe", id: recipe.id }, rate });
    }
  }
  const target = targetRates.get(primaryOutput) ?? 0;
  if (target > EPS) {
    dests.push({ to: { kind: "target", id: primaryOutput }, rate: target });
  }
  void recipeId;
  return dests;
}

/**
 * Build stages with destination-first output belts when consumer rates are
 * known; otherwise pack for total crafts only (BOM / early reconcile).
 */
export function buildStages(
  recipeCrafts: Map<string, number>,
  maxBeltCapacity: number = DEFAULT_MAX_BELT_CAPACITY,
  targetRates: Map<ItemId, number> = new Map(),
  excessRates: Map<ItemId, number> = new Map(),
): ProductionStage[] {
  const stages: ProductionStage[] = [];
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    const primary = recipe.outputs[0]!;
    const primaryPerMachine = recipePrimaryOutputPerMinute(recipe);
    const cyclesPerMin = recipeCyclesPerMinute(recipe);
    const needEff = crafts / cyclesPerMin;
    const outputFromCrafts = crafts * primary.amount;

    const dests = collectStageDestinations(
      recipe.id,
      primary.item,
      recipeCrafts,
      targetRates,
    );
    const isIngot = itemById[primary.item]?.isIngot === true;
    const demandSum = dests.reduce((s, d) => s + d.rate, 0);
    const excessFloor = isIngot ? 0 : (excessRates.get(primary.item) ?? 0);
    const leftoverProd = Math.max(0, outputFromCrafts - demandSum);
    // Pure excess stage (no production consumers): pack for excess/crafts.
    // Ingots never overflow to storage — surplus is converted downstream.
    const surplusForExcess = isIngot
      ? 0
      : dests.length === 0
        ? Math.max(leftoverProd, excessFloor, outputFromCrafts)
        : leftoverProd;

    let groups: MachineGroupPlan[];
    let outputMerges: MergePlan[];

    if (dests.length > 0 || surplusForExcess > EPS) {
      const packed = packDestinationOutputs(
        recipe,
        dests,
        maxBeltCapacity,
        surplusForExcess,
        isIngot,
      );
      groups = packed.groups;
      outputMerges = packed.outputMerges;
    } else {
      const configs = packMachineBanks(recipe, needEff, {
        maxBeltCapacity,
      });
      groups = configs.map((c) => ({
        machines: c.machines,
        clock: c.clock,
        effectiveMachines: c.effectiveMachines,
        inputSplit: inputSplitForGroup(c.machines),
        outputPerMinute: primaryPerMachine * c.effectiveMachines,
      }));
      outputMerges = buildOutputMerges(
        groups.map((g) => g.outputPerMinute),
        maxBeltCapacity,
      ).map((m) => ({
        ...m,
        to: { kind: "excess" as const, id: primary.item },
        consumerRate: 0,
      }));
    }

    // Cover any craft shortfall from destination packing under-coverage.
    // For ingots, attach the shortfall pack to the largest production
    // destination instead of overflowing to storage.
    const packedEff = groups.reduce((s, g) => s + g.effectiveMachines, 0);
    if (packedEff + EPS < needEff) {
      const extra = packMachineBanks(recipe, needEff - packedEff, {
        maxBeltCapacity,
      });
      const offset = groups.length;
      for (const c of extra) {
        groups.push({
          machines: c.machines,
          clock: c.clock,
          effectiveMachines: c.effectiveMachines,
          inputSplit: inputSplitForGroup(c.machines),
          outputPerMinute: primaryPerMachine * c.effectiveMachines,
        });
      }
      const extraMerges = buildOutputMerges(
        extra.map((c) => primaryPerMachine * c.effectiveMachines),
        maxBeltCapacity,
      );
      const fallbackDest =
        isIngot && dests.length > 0
          ? [...dests].sort((a, b) => b.rate - a.rate)[0]!.to
          : ({ kind: "excess" as const, id: primary.item } as const);
      for (const m of extraMerges) {
        outputMerges.push({
          ...m,
          sourceBankIndexes: m.sourceBankIndexes.map((i) => i + offset),
          to: fallbackDest,
          consumerRate: isIngot ? m.rate : 0,
        });
      }
    }

    const outputPerMinute = groups.reduce((s, g) => s + g.outputPerMinute, 0);
    const inputBelts = buildStageInputBelts(recipe, groups, maxBeltCapacity);
    stages.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      building: buildingName[recipe.building] ?? recipe.building,
      primaryOutput: primary.item,
      groups,
      outputPerMinute,
      outputMerges,
      inputBelts,
    });
  }
  return orderStagesByDependency(stages);
}

/**
 * Build the factory network: stages with multi-group machines, consumer edges,
 * splitter plans for input manifolds and output shares, and output merges.
 */
export function buildFactoryNetwork(
  recipeCrafts: Map<string, number>,
  targetRates: Map<ItemId, number>,
  excessRates: Map<ItemId, number>,
  maxBeltCapacity: number = DEFAULT_MAX_BELT_CAPACITY,
): FactoryNetwork {
  const stages = buildStages(
    recipeCrafts,
    maxBeltCapacity,
    targetRates,
    excessRates,
  );

  const edges: FlowEdge[] = [];

  // Raw → recipe edges (no destination-lane model)
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      const rate = input.amount * crafts;
      if (rate <= EPS) continue;
      const item = itemById[input.item];
      if (!item?.isRaw) continue;
      edges.push({
        item: input.item,
        rate,
        from: { kind: "raw", id: input.item },
        to: { kind: "recipe", id: recipe.id },
        fromLaneIndex: null,
        outputSplit: mergeOnlyPlan(),
      });
    }
  }

  // Stage output edges from destination-first lanes
  for (const stage of stages) {
    const from = { kind: "stage" as const, id: stage.recipeId };
    const item = stage.primaryOutput;
    let overflowAccounted = 0;

    for (let lane = 0; lane < stage.outputMerges.length; lane++) {
      const merge = stage.outputMerges[lane]!;
      const to = merge.to ?? { kind: "excess" as const, id: item };
      const consumerRate = merge.consumerRate ?? 0;
      const overflow = Math.max(0, merge.rate - consumerRate);

      if (to.kind !== "excess" && consumerRate > EPS) {
        const fillsLane = overflow <= EPS;
        edges.push({
          item,
          rate: consumerRate,
          from,
          to,
          fromLaneIndex: lane,
          outputSplit: fillsLane
            ? mergeOnlyPlan()
            : {
                ratio: friendlyRatio(consumerRate, merge.rate),
                steps: (() => {
                  const ratio = friendlyRatio(consumerRate, merge.rate);
                  return ratio
                    ? splitStepsForRatio(ratio.num, ratio.den)
                    : [];
                })(),
                mergeOnly: false,
                restAfterOverflow: true,
              },
        });
      }

      if (overflow > EPS) {
        overflowAccounted += overflow;
        edges.push({
          item,
          rate: overflow,
          from,
          to: { kind: "excess", id: item },
          fromLaneIndex: lane,
          outputSplit: overflowPlan(),
        });
      } else if (to.kind === "excess" && merge.rate > EPS) {
        overflowAccounted += merge.rate;
        edges.push({
          item,
          rate: merge.rate,
          from,
          to: { kind: "excess", id: item },
          fromLaneIndex: lane,
          outputSplit: overflowPlan(),
        });
      }
    }

    const scheduledExcess = excessRates.get(item) ?? 0;
    const residual = scheduledExcess - overflowAccounted;
    if (residual > EPS) {
      edges.push({
        item,
        rate: residual,
        from,
        to: { kind: "excess", id: item },
        fromLaneIndex: null,
        outputSplit: overflowPlan(),
      });
    }
  }

  edges.sort((a, b) => {
    const an = itemById[a.item]?.name ?? a.item;
    const bn = itemById[b.item]?.name ?? b.item;
    return (
      an.localeCompare(bn) ||
      a.to.kind.localeCompare(b.to.kind) ||
      a.to.id.localeCompare(b.to.id)
    );
  });

  const chains = buildChainGroups(
    stages,
    [...targetRates.keys()].filter((item) => (targetRates.get(item) ?? 0) > EPS),
  );

  return { stages, chains, edges };
}
