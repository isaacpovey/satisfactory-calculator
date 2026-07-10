import { scarceRawIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import type { RateMap } from "./bom";
import type { TargetSpec } from "./types";

const EPS = 1e-9;

/** Hard cap on hill-climb iterations per phase — keeps browser solves bounded. */
export const MAX_TARGET_ITERATIONS = 48;
export const MAX_SOAK_ITERATIONS = 96;
/** Excess sinks probed per iteration (rotating window over fillOrder). */
export const MAX_EXCESS_PROBE = 8;
/** Stop scanning once this many growth moves are collected. */
const MAX_RANKED_COLLECT = 5;

export interface PlanScore {
  /** Sum of min(useful used, available) across scarce raws (overallUtil numerator). */
  usefulOre: number;
  /** Weighted target extra — tie-break only. */
  weightBonus: number;
}

export type SinkKind = "target" | "excess";

export interface SinkMove {
  kind: SinkKind;
  item: ItemId;
  rate: number;
}

export type OptimizeMode = "target" | "excess" | "ingot";

export interface SinkOptimizerDeps {
  available: RateMap;
  maxBeltCapacity: number;
  targets: TargetSpec[];
  soakCandidates: readonly ItemId[];
  fillOrder: readonly ItemId[];
  targetExtra: Map<ItemId, number>;
  excessRates: Map<ItemId, number>;
  buildSinks: () => { item: ItemId; rate: number }[];
  planFitsAvailable: (
    sinks: { item: ItemId; rate: number }[],
    available: RateMap,
    maxBeltCapacity: number,
  ) => boolean;
  leftoverFromPlan: (
    sinks: { item: ItemId; rate: number }[],
    available: RateMap,
    maxBeltCapacity: number,
  ) => RateMap;
  expandSinks: (
    sinks: { item: ItemId; rate: number }[],
    maxBeltCapacity: number,
  ) => { recipeCrafts: Map<string, number>; raws: RateMap };
  rawsLockedInLeftoverIngots: (
    sinks: { item: ItemId; rate: number }[],
    maxBeltCapacity: number,
    recipeCrafts?: Map<string, number>,
  ) => RateMap;
  leftoverIngotsFromPlan: (
    sinks: { item: ItemId; rate: number }[],
    maxBeltCapacity: number,
    recipeCrafts?: Map<string, number>,
  ) => RateMap;
  collectGrowthRates: (
    itemId: ItemId,
    current: number,
    leftover: RateMap,
  ) => number[];
  collectIngotConversionRates: (
    itemId: ItemId,
    current: number,
    leftoverIngot: number,
    ingotId: ItemId,
  ) => number[];
  consumesItem: (product: ItemId, intermediate: ItemId) => boolean;
  largestFittingRate: (
    rates: number[],
    setRate: (rate: number) => void,
    restore: () => void,
    available: RateMap,
    buildSinks: () => { item: ItemId; rate: number }[],
    maxBeltCapacity: number,
  ) => number | null;
}

export interface OptimizeOptions {
  /** Which move families to consider (default: all). */
  modes?: readonly OptimizeMode[];
  /** Override iteration budget (defaults depend on mode). */
  maxIterations?: number;
}

export function comparePlanScore(a: PlanScore, b: PlanScore): number {
  if (a.usefulOre > b.usefulOre + EPS) return 1;
  if (b.usefulOre > a.usefulOre + EPS) return -1;
  if (a.weightBonus > b.weightBonus + EPS) return 1;
  if (b.weightBonus > a.weightBonus + EPS) return -1;
  return 0;
}

/** Useful scarce ore consumed (numerator of overallUtilization). */
export function usefulOreUsed(deps: SinkOptimizerDeps): number {
  const scored = scorePlan(deps);
  return scored?.usefulOre ?? 0;
}

export function scorePlan(deps: SinkOptimizerDeps): PlanScore | null {
  const sinks = deps.buildSinks();
  const { raws, recipeCrafts } = deps.expandSinks(sinks, deps.maxBeltCapacity);

  for (const id of scarceRawIds) {
    if ((raws.get(id) ?? 0) > (deps.available.get(id) ?? 0) + EPS) {
      return null;
    }
  }

  const unusedIngotRaws = deps.rawsLockedInLeftoverIngots(
    sinks,
    deps.maxBeltCapacity,
    recipeCrafts,
  );

  let usefulOre = 0;
  for (const id of scarceRawIds) {
    const avail = deps.available.get(id) ?? 0;
    if (avail <= EPS) continue;
    const extracted = raws.get(id) ?? 0;
    const locked = unusedIngotRaws.get(id) ?? 0;
    const used = Math.max(0, extracted - locked);
    usefulOre += Math.min(used, avail);
  }

  let weightBonus = 0;
  for (const t of deps.targets) {
    if (t.weight <= EPS) continue;
    weightBonus += (deps.targetExtra.get(t.item) ?? 0) * t.weight;
  }

  return { usefulOre, weightBonus };
}

function moveKey(moves: SinkMove[]): string {
  return moves
    .map((m) => `${m.kind}:${m.item}:${m.rate.toFixed(9)}`)
    .sort()
    .join("|");
}

function setSinkRate(
  deps: SinkOptimizerDeps,
  move: SinkMove,
  rate: number,
): () => void {
  const map = move.kind === "target" ? deps.targetExtra : deps.excessRates;
  const prev = map.get(move.item) ?? 0;
  map.set(move.item, rate);
  return () => map.set(move.item, prev);
}

function canUseLeftover(
  coeffs: Partial<Record<ItemId, number>>,
  leftover: RateMap,
): boolean {
  for (const id of scarceRawIds) {
    if ((leftover.get(id) ?? 0) > EPS && (coeffs[id] ?? 0) > EPS) return true;
  }
  return false;
}

function estimateOreGain(
  coeffs: Partial<Record<ItemId, number>>,
  deltaRate: number,
  leftover: RateMap,
): number {
  let gain = 0;
  for (const id of scarceRawIds) {
    const c = coeffs[id] ?? 0;
    if (c <= EPS) continue;
    gain += Math.min(c * deltaRate, leftover.get(id) ?? 0);
  }
  return gain;
}

function weightBonusForMove(
  deps: SinkOptimizerDeps,
  move: SinkMove,
  currentRate: number,
): number {
  if (move.kind !== "target") return 0;
  const t = deps.targets.find((x) => x.item === move.item);
  if (!t || t.weight <= EPS) return 0;
  return (move.rate - currentRate) * t.weight;
}

function bestGrowthMove(
  deps: SinkOptimizerDeps,
  kind: SinkKind,
  itemId: ItemId,
  leftover: RateMap,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
): { move: SinkMove; proxy: number; weightBonus: number } | null {
  const coeffs = exactRawCoefficients(itemId);
  if (!canUseLeftover(coeffs, leftover)) return null;

  const map = kind === "target" ? deps.targetExtra : deps.excessRates;
  const current = map.get(itemId) ?? 0;
  const rates = deps.collectGrowthRates(itemId, current, leftover);
  if (rates.length === 0) return null;

  const best = deps.largestFittingRate(
    rates,
    (rate) => map.set(itemId, rate),
    () => map.set(itemId, current),
    deps.available,
    deps.buildSinks,
    deps.maxBeltCapacity,
  );
  if (best === null || best <= current + EPS) return null;

  const move: SinkMove = { kind, item: itemId, rate: best };
  return {
    move,
    proxy: estimateOreGain(coeffs, best - current, leftover),
    weightBonus: weightBonusForMove(deps, move, current),
  };
}

function bestIngotMove(
  deps: SinkOptimizerDeps,
  ingotId: ItemId,
  leftoverIngot: number,
): { move: SinkMove; proxy: number } | null {
  let best: { move: SinkMove; proxy: number } | null = null;

  for (const item of deps.fillOrder) {
    if (!deps.consumesItem(item, ingotId)) continue;
    const current = deps.excessRates.get(item) ?? 0;
    const rates = deps.collectIngotConversionRates(
      item,
      current,
      leftoverIngot,
      ingotId,
    );
    if (rates.length === 0) continue;

    const fit = deps.largestFittingRate(
      rates,
      (rate) => deps.excessRates.set(item, rate),
      () => deps.excessRates.set(item, current),
      deps.available,
      deps.buildSinks,
      deps.maxBeltCapacity,
    );
    if (fit === null || fit <= current + EPS) continue;

    deps.excessRates.set(item, fit);
    const after =
      deps.leftoverIngotsFromPlan(deps.buildSinks(), deps.maxBeltCapacity).get(
        ingotId,
      ) ?? 0;
    deps.excessRates.set(item, current);
    const ingotUsed = leftoverIngot - after;
    if (ingotUsed <= EPS) continue;

    const move: SinkMove = { kind: "excess", item, rate: fit };
    const candidate = { move, proxy: ingotUsed };
    if (
      !best ||
      candidate.proxy > best.proxy + EPS ||
      (Math.abs(candidate.proxy - best.proxy) <= EPS &&
        moveKey([candidate.move]).localeCompare(moveKey([best.move])) < 0)
    ) {
      best = candidate;
    }
  }

  return best;
}

interface RankedCandidate {
  moves: SinkMove[];
  proxy: number;
  weightBonus: number;
}

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  if (a.proxy > b.proxy + EPS) return -1;
  if (b.proxy > a.proxy + EPS) return 1;
  if (a.weightBonus > b.weightBonus + EPS) return -1;
  if (b.weightBonus > a.weightBonus + EPS) return 1;
  return moveKey(a.moves).localeCompare(moveKey(b.moves));
}

function modesEnabled(
  modes: readonly OptimizeMode[],
  mode: OptimizeMode,
): boolean {
  return modes.includes(mode);
}

function collectRankedSingles(
  deps: SinkOptimizerDeps,
  modes: readonly OptimizeMode[],
  leftover: RateMap,
  hasLeftover: boolean,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
  iter: number,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  if (modesEnabled(modes, "target")) {
    for (const t of deps.targets) {
      if (t.weight <= EPS) continue;
      const found = bestGrowthMove(
        deps,
        "target",
        t.item,
        leftover,
        exactRawCoefficients,
      );
      if (found) {
        ranked.push({
          moves: [found.move],
          proxy: found.proxy,
          weightBonus: found.weightBonus,
        });
      }
    }
  }

  if (modesEnabled(modes, "excess") && hasLeftover) {
    const order = deps.fillOrder;
    const offset = order.length > 0 ? iter % order.length : 0;
    let probed = 0;
    let collected = 0;
    for (let k = 0; k < order.length && probed < MAX_EXCESS_PROBE; k++) {
      if (collected >= MAX_RANKED_COLLECT) break;
      const item = order[(offset + k) % order.length]!;
      if (!canUseLeftover(exactRawCoefficients(item), leftover)) continue;
      probed++;
      const found = bestGrowthMove(
        deps,
        "excess",
        item,
        leftover,
        exactRawCoefficients,
      );
      if (found) {
        ranked.push({
          moves: [found.move],
          proxy: found.proxy,
          weightBonus: found.weightBonus,
        });
        collected++;
      }
    }
  }

  if (modesEnabled(modes, "ingot")) {
    const leftoverIngots = deps.leftoverIngotsFromPlan(
      deps.buildSinks(),
      deps.maxBeltCapacity,
    );
    for (const [ingot, amount] of leftoverIngots) {
      if (amount <= EPS) continue;
      const found = bestIngotMove(deps, ingot, amount);
      if (found) {
        ranked.push({
          moves: [found.move],
          proxy: found.proxy,
          weightBonus: 0,
        });
      }
    }
  }

  ranked.sort(compareRanked);
  return ranked;
}

function applyTopRanked(deps: SinkOptimizerDeps, ranked: RankedCandidate[]): boolean {
  if (ranked.length === 0) return false;
  for (const move of ranked[0]!.moves) {
    setSinkRate(deps, move, move.rate);
  }
  return true;
}

function hasMeaningfulLeftover(
  deps: SinkOptimizerDeps,
  leftover: RateMap,
  modes: readonly OptimizeMode[],
  hasRawLeftover: boolean,
): boolean {
  if (hasRawLeftover) return true;
  if (!modesEnabled(modes, "ingot")) return false;
  const leftoverIngots = deps.leftoverIngotsFromPlan(
    deps.buildSinks(),
    deps.maxBeltCapacity,
  );
  return [...leftoverIngots.values()].some((v) => v > EPS);
}

/**
 * Bounded hill-climb: each iteration picks the best feasible sink-rate change
 * (single or joint pair) that maximizes useful ore consumed; target weights
 * break ties only. Proxy ranking avoids full expand on every candidate.
 */
export function optimizeSinkRates(
  deps: SinkOptimizerDeps,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
  options: OptimizeOptions = {},
): void {
  const modes = options.modes ?? (["target", "excess", "ingot"] as const);
  const maxIterations =
    options.maxIterations ??
    (modes.length === 1 && modes[0] === "target"
      ? MAX_TARGET_ITERATIONS
      : MAX_SOAK_ITERATIONS);

  if (!scorePlan(deps)) return;

  for (let iter = 0; iter < maxIterations; iter++) {
    const leftover = deps.leftoverFromPlan(
      deps.buildSinks(),
      deps.available,
      deps.maxBeltCapacity,
    );
    const hasLeftover = [...leftover.values()].some((v) => v > EPS);

    if (!hasMeaningfulLeftover(deps, leftover, modes, hasLeftover)) break;

    const ranked = collectRankedSingles(
      deps,
      modes,
      leftover,
      hasLeftover,
      exactRawCoefficients,
      iter,
    );
    if (ranked.length === 0) break;

    if (!applyTopRanked(deps, ranked)) break;
  }
}
