import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import { itemById } from "@/data/items";
import { getRecipeForProduct, recipes as allRecipes } from "@/data/recipes";
import type { ItemId, Recipe } from "@/data/types";
import {
  friendlyRatio,
  isSplitterFriendlyCount,
  splitStepsForCount,
  splitStepsForRatio,
} from "./constraints";
import { groupInputRates } from "./group-inputs";
import type { MachineGroupPlan, SplitPlan, StageInputBelt, StageInputBeltFeed } from "./types";

const EPS = 1e-9;

function mergeOnlyPlan(): SplitPlan {
  return { ratio: { num: 1, den: 1 }, steps: [], mergeOnly: true };
}

function equalSplitPlan(n: number): SplitPlan {
  if (n <= 1) return mergeOnlyPlan();
  if (!isSplitterFriendlyCount(n)) {
    return { ratio: null, steps: [], mergeOnly: false };
  }
  return {
    ratio: { num: 1, den: n },
    steps: splitStepsForCount(n),
    mergeOnly: false,
  };
}

function sharePlan(part: number, whole: number): SplitPlan {
  if (whole <= EPS || Math.abs(part - whole) <= EPS) return mergeOnlyPlan();
  const ratio = friendlyRatio(part, whole);
  if (!ratio) return { ratio: null, steps: [], mergeOnly: false };
  if (ratio.num === 0) {
    return { ratio, steps: [], mergeOnly: true };
  }
  return {
    ratio,
    steps: splitStepsForRatio(ratio.num, ratio.den),
    mergeOnly: false,
  };
}

function sourceForItem(item: ItemId): StageInputBelt["from"] {
  const meta = itemById[item];
  if (meta?.isRaw) return { kind: "raw", id: item };
  const producer = getRecipeForProduct(item);
  if (producer) return { kind: "stage", id: producer.id };
  return { kind: "raw", id: item };
}

interface BankDemand {
  bankIndex: number;
  rate: number;
  machines: number;
  perMachine: number;
}

type Slot = { bankIndex: number; rate: number };

function collapseFeeds(chosen: Slot[]): StageInputBeltFeed[] {
  const byBank = new Map<number, StageInputBeltFeed>();
  for (const c of chosen) {
    const prev = byBank.get(c.bankIndex);
    if (prev) {
      prev.rate += c.rate;
      prev.machines += 1;
    } else {
      byBank.set(c.bankIndex, {
        bankIndex: c.bankIndex,
        rate: c.rate,
        machines: 1,
      });
    }
  }
  return [...byBank.values()].sort((a, b) => a.bankIndex - b.bankIndex);
}

function splitForFeeds(
  feeds: StageInputBeltFeed[],
  slotCount: number,
  beltRate: number,
): SplitPlan {
  if (feeds.length === 1) {
    return slotCount === 1 ? mergeOnlyPlan() : equalSplitPlan(slotCount);
  }
  // One machine from each of several banks — equal N-way when friendly
  if (feeds.every((f) => f.machines === 1) && feeds.length === slotCount) {
    return equalSplitPlan(slotCount);
  }
  return sharePlan(feeds[0]!.rate, beltRate);
}

/**
 * Pack one input item's bank demands into belt-capped lanes.
 *
 * 1. Whole bank on its own belt when rate ≤ maxBelt (common case).
 * 2. Otherwise peel into per-machine slots and pack equal-rate slots onto
 *    shared belts (allows one belt → one machine in each of several banks).
 */
export function packInputBeltsForItem(
  item: ItemId,
  demands: BankDemand[],
  maxBelt: number,
): StageInputBelt[] {
  const active = demands.filter((d) => d.rate > EPS);
  if (active.length === 0) return [];

  const from = sourceForItem(item);
  const belts: StageInputBelt[] = [];
  const slots: Slot[] = [];

  for (const d of active) {
    if (d.machines <= 0) continue;
    if (d.rate <= maxBelt + EPS) {
      belts.push({
        item,
        rate: d.rate,
        split: mergeOnlyPlan(),
        feeds: [
          {
            bankIndex: d.bankIndex,
            rate: d.rate,
            machines: d.machines,
          },
        ],
        from,
      });
      continue;
    }
    for (let m = 0; m < d.machines; m++) {
      slots.push({ bankIndex: d.bankIndex, rate: d.perMachine });
    }
  }

  // Also try to share belts across banks when several small equal-rate
  // whole-bank demands could combine under capacity (optional packing).
  // For now dedicated whole-bank belts stay as-is; only oversize banks use slots.

  slots.sort((a, b) => b.rate - a.rate || a.bankIndex - b.bankIndex);

  while (slots.length > 0) {
    const rate = slots[0]!.rate;
    const sameCount = slots.filter((s) => Math.abs(s.rate - rate) <= EPS).length;
    const maxOnBelt = Math.max(1, Math.floor(maxBelt / rate + EPS));
    let take = Math.min(sameCount, maxOnBelt);
    while (take > 1 && !isSplitterFriendlyCount(take)) take--;
    if (take < 1) take = 1;

    const chosen: Slot[] = [];
    for (let i = 0; i < slots.length && chosen.length < take;) {
      if (Math.abs(slots[i]!.rate - rate) <= EPS) {
        chosen.push(slots[i]!);
        slots.splice(i, 1);
      } else {
        i++;
      }
    }

    const beltRate = chosen.reduce((s, c) => s + c.rate, 0);
    const feeds = collapseFeeds(chosen);
    belts.push({
      item,
      rate: beltRate,
      split: splitForFeeds(feeds, chosen.length, beltRate),
      feeds,
      from,
    });
  }

  belts.sort(
    (a, b) => (a.feeds[0]?.bankIndex ?? 0) - (b.feeds[0]?.bankIndex ?? 0) || b.rate - a.rate,
  );
  return belts;
}

/**
 * Optionally co-pack equal per-machine demands from different banks onto
 * shared belts when each bank alone is under capacity but we want fewer belts.
 * Currently unused in the default path — whole banks keep dedicated belts.
 * Exported for tests / future soak packing.
 */
export function packSharedMachineSlots(
  item: ItemId,
  slots: Slot[],
  maxBelt: number,
): StageInputBelt[] {
  const from = sourceForItem(item);
  const remaining = [...slots].sort((a, b) => b.rate - a.rate || a.bankIndex - b.bankIndex);
  const belts: StageInputBelt[] = [];

  while (remaining.length > 0) {
    const rate = remaining[0]!.rate;
    const sameCount = remaining.filter((s) => Math.abs(s.rate - rate) <= EPS).length;
    const maxOnBelt = Math.max(1, Math.floor(maxBelt / rate + EPS));
    let take = Math.min(sameCount, maxOnBelt);
    while (take > 1 && !isSplitterFriendlyCount(take)) take--;
    if (take < 1) take = 1;

    const chosen: Slot[] = [];
    for (let i = 0; i < remaining.length && chosen.length < take;) {
      if (Math.abs(remaining[i]!.rate - rate) <= EPS) {
        chosen.push(remaining[i]!);
        remaining.splice(i, 1);
      } else {
        i++;
      }
    }
    const beltRate = chosen.reduce((s, c) => s + c.rate, 0);
    const feeds = collapseFeeds(chosen);
    belts.push({
      item,
      rate: beltRate,
      split: splitForFeeds(feeds, chosen.length, beltRate),
      feeds,
      from,
    });
  }
  return belts;
}

/** Build all input belts for a stage's machine banks. */
export function buildStageInputBelts(
  recipe: Recipe,
  groups: MachineGroupPlan[],
  maxBeltCapacity: number = DEFAULT_MAX_BELT_CAPACITY,
): StageInputBelt[] {
  if (groups.length === 0) return [];
  const belts: StageInputBelt[] = [];

  for (const input of recipe.inputs) {
    const demands: BankDemand[] = groups.map((group, bankIndex) => {
      const rates = groupInputRates(recipe.id, group);
      const row = rates.find((r) => r.item === input.item);
      const total = row?.totalRate ?? 0;
      const per = row?.perMachineRate ?? (group.machines > 0 ? total / group.machines : 0);
      return {
        bankIndex,
        rate: total,
        machines: group.machines,
        perMachine: per,
      };
    });
    belts.push(...packInputBeltsForItem(input.item, demands, maxBeltCapacity));
  }

  return belts;
}

export function recipeById(id: string): Recipe | undefined {
  return allRecipes.find((r) => r.id === id);
}
