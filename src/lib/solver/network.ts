import { buildings, itemById } from "@/data/items";
import {
  getRecipeForProduct,
  recipes as allRecipes,
  recipeCyclesPerMinute,
} from "@/data/recipes";
import type { ItemId } from "@/data/types";
import {
  friendlyRatio,
  isSplitterFriendlyCount,
  representMachinesMulti,
  splitStepsForCount,
  splitStepsForRatio,
} from "./constraints";
import type {
  FactoryNetwork,
  FlowEdge,
  MachineGroupPlan,
  ProductionStage,
  SplitPlan,
} from "./types";

const EPS = 1e-9;

const buildingName = Object.fromEntries(
  buildings.map((b) => [b.id, b.name]),
) as Record<string, string>;

function mergeOnlyPlan(): SplitPlan {
  return { ratio: { num: 1, den: 1 }, steps: [], mergeOnly: true };
}

function unfriendlyPlan(): SplitPlan {
  return { ratio: null, steps: [], mergeOnly: false };
}

export function inputSplitForGroup(machines: number): SplitPlan {
  if (machines <= 1) return mergeOnlyPlan();
  if (!isSplitterFriendlyCount(machines)) return unfriendlyPlan();
  const steps = splitStepsForCount(machines);
  return {
    ratio: { num: 1, den: machines },
    steps,
    mergeOnly: false,
  };
}

function outputSplitForShare(rate: number, parentRate: number): SplitPlan {
  if (parentRate <= EPS) return mergeOnlyPlan();
  if (rate <= EPS) {
    return { ratio: { num: 0, den: 1 }, steps: [], mergeOnly: true };
  }
  if (Math.abs(rate - parentRate) <= EPS) return mergeOnlyPlan();

  const ratio = friendlyRatio(rate, parentRate);
  if (!ratio) return unfriendlyPlan();
  if (ratio.num === 1 && ratio.den === 1) return mergeOnlyPlan();
  if (ratio.num === 0) {
    return { ratio, steps: [], mergeOnly: true };
  }
  return {
    ratio,
    steps: splitStepsForRatio(ratio.num, ratio.den),
    mergeOnly: false,
  };
}

export function buildStages(
  recipeCrafts: Map<string, number>,
): ProductionStage[] {
  const stages: ProductionStage[] = [];
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    const exactMachines = crafts / recipeCyclesPerMinute(recipe);
    const configs = representMachinesMulti(exactMachines, {
      anyMachineCount: true,
    });
    const primary = recipe.outputs[0]!;
    const groups: MachineGroupPlan[] = configs.map((c) => ({
      machines: c.machines,
      clock: c.clock,
      effectiveMachines: c.effectiveMachines,
      inputSplit: inputSplitForGroup(c.machines),
    }));
    stages.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      building: buildingName[recipe.building] ?? recipe.building,
      primaryOutput: primary.item,
      groups,
      outputPerMinute: primary.amount * crafts,
    });
  }
  stages.sort((a, b) => a.recipeName.localeCompare(b.recipeName));
  return stages;
}

/**
 * Build the factory network: stages with multi-group machines, consumer edges,
 * and splitter plans for input manifolds and output shares.
 */
export function buildFactoryNetwork(
  recipeCrafts: Map<string, number>,
  targetRates: Map<ItemId, number>,
  excessRates: Map<ItemId, number>,
): FactoryNetwork {
  const stages = buildStages(recipeCrafts);

  // Produced rate per item from stages
  const produced = new Map<ItemId, number>();
  for (const stage of stages) {
    produced.set(
      stage.primaryOutput,
      (produced.get(stage.primaryOutput) ?? 0) + stage.outputPerMinute,
    );
  }

  type Pending = {
    item: ItemId;
    rate: number;
    from: FlowEdge["from"];
    to: FlowEdge["to"];
  };
  const pending: Pending[] = [];

  // Recipe → recipe / raw → recipe edges
  for (const recipe of allRecipes) {
    const crafts = recipeCrafts.get(recipe.id) ?? 0;
    if (crafts <= EPS) continue;
    for (const input of recipe.inputs) {
      const rate = input.amount * crafts;
      if (rate <= EPS) continue;
      const item = itemById[input.item];
      if (!item) continue;
      if (item.isRaw) {
        pending.push({
          item: input.item,
          rate,
          from: { kind: "raw", id: input.item },
          to: { kind: "recipe", id: recipe.id },
        });
      } else {
        const producer = getRecipeForProduct(input.item);
        if (!producer) continue;
        pending.push({
          item: input.item,
          rate,
          from: { kind: "stage", id: producer.id },
          to: { kind: "recipe", id: recipe.id },
        });
      }
    }
  }

  // Stage → target / excess sinks
  for (const [item, rate] of targetRates) {
    if (rate <= EPS) continue;
    const producer = getRecipeForProduct(item);
    if (!producer) continue;
    pending.push({
      item,
      rate,
      from: { kind: "stage", id: producer.id },
      to: { kind: "target", id: item },
    });
  }
  for (const [item, rate] of excessRates) {
    if (rate <= EPS) continue;
    const producer = getRecipeForProduct(item);
    if (!producer) continue;
    pending.push({
      item,
      rate,
      from: { kind: "stage", id: producer.id },
      to: { kind: "excess", id: item },
    });
  }

  // Group siblings by from+item for output split parent rate
  const groups = new Map<string, Pending[]>();
  for (const edge of pending) {
    const key = `${edge.from.kind}:${edge.from.id}|${edge.item}`;
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }

  const edges: FlowEdge[] = [];
  for (const siblings of groups.values()) {
    const parentFromProduction =
      siblings[0]!.from.kind === "stage"
        ? (produced.get(siblings[0]!.item) ?? 0)
        : siblings.reduce((s, e) => s + e.rate, 0);
    const siblingSum = siblings.reduce((s, e) => s + e.rate, 0);
    // Prefer actual sibling sum when it matches production; else use production
    const parentRate =
      parentFromProduction > EPS
        ? Math.max(parentFromProduction, siblingSum)
        : siblingSum;

    const sole = siblings.length === 1;
    for (const edge of siblings) {
      edges.push({
        item: edge.item,
        rate: edge.rate,
        from: edge.from,
        to: edge.to,
        outputSplit: sole
          ? mergeOnlyPlan()
          : outputSplitForShare(edge.rate, parentRate),
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

  return { stages, edges };
}
