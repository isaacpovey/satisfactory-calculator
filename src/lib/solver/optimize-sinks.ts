import { scarceRawIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import type { RateMap } from "./bom";
import type { TargetSpec } from "./types";

const EPS = 1e-9;

/** Hard cap on hill-climb iterations per phase — keeps browser solves bounded. */
export const MAX_TARGET_ITERATIONS = 48;
export const MAX_SOAK_ITERATIONS = 96;
/** Wall-clock budget reserved for future early-exit (iteration caps bound solves today). */
export const MAX_OPTIMIZATION_MS = 250;
/** Excess sinks probed per iteration (rotating window over fillOrder). */
export const MAX_EXCESS_PROBE = 8;
/** Stop scanning once this many excess growth candidates are collected per iteration. */
export const MAX_RANKED_COLLECT = 5;
/** Evaluate up to this many feasible rates from the high end of the rate ladder. */
export const MAX_RATE_PROBES = 4;

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

/** Largest rate in ascending `rates` that keeps the plan within available raws. */
function largestFeasibleIndex(
  deps: SinkOptimizerDeps,
  kind: SinkKind,
  itemId: ItemId,
  current: number,
  rates: number[],
): number {
  const map = kind === "target" ? deps.targetExtra : deps.excessRates;
  const candidates = rates.filter((rate) => rate > current + EPS);
  if (candidates.length === 0) return -1;

  let lo = 0;
  let hi = candidates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rate = candidates[mid]!;
    map.set(itemId, rate);
    if (deps.planFitsAvailable(deps.buildSinks(), deps.available, deps.maxBeltCapacity)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  map.set(itemId, current);
  return best;
}

function bestImprovingMove(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  kind: SinkKind,
  itemId: ItemId,
  current: number,
  rates: number[],
): ScoredCandidate | null {
  const candidates = rates.filter((rate) => rate > current + EPS);
  if (candidates.length === 0) return null;

  const maxFeasibleIdx = largestFeasibleIndex(
    deps,
    kind,
    itemId,
    current,
    rates,
  );
  if (maxFeasibleIdx < 0) return null;

  let best: ScoredCandidate | null = null;
  const probeEnd = Math.max(0, maxFeasibleIdx - MAX_RATE_PROBES + 1);
  for (let i = maxFeasibleIdx; i >= probeEnd; i--) {
    const rate = candidates[i]!;
    const move: SinkMove = { kind, item: itemId, rate };
    const scored = scoreCandidateMove(deps, baseline, move);
    if (!scored) continue;
    if (!best || compareScoredCandidates(scored, best) < 0) {
      best = scored;
    }
  }

  return best;
}

function growthMove(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  kind: SinkKind,
  itemId: ItemId,
  leftover: RateMap,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
): ScoredCandidate | null {
  const coeffs = exactRawCoefficients(itemId);
  if (!canUseLeftover(coeffs, leftover)) return null;

  const map = kind === "target" ? deps.targetExtra : deps.excessRates;
  const current = map.get(itemId) ?? 0;
  const rates = deps.collectGrowthRates(itemId, current, leftover);
  if (rates.length === 0) return null;

  return bestImprovingMove(deps, baseline, kind, itemId, current, rates);
}

function collectIngotMoves(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  ingotId: ItemId,
  leftoverIngot: number,
): ScoredCandidate[] {
  const moves: ScoredCandidate[] = [];

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

    const scored = bestImprovingMove(
      deps,
      baseline,
      "excess",
      item,
      current,
      rates,
    );
    if (scored) moves.push(scored);
  }

  return moves;
}

function modesEnabled(
  modes: readonly OptimizeMode[],
  mode: OptimizeMode,
): boolean {
  return modes.includes(mode);
}

function leftoverValue(
  coeffs: Partial<Record<ItemId, number>>,
  leftover: RateMap,
): number {
  let total = 0;
  for (const id of scarceRawIds) {
    total += (coeffs[id] ?? 0) * (leftover.get(id) ?? 0);
  }
  return total;
}

/** Best excess sink to probe for a single leftover raw. */
function bestSinkForRaw(
  rawId: ItemId,
  fillOrder: readonly ItemId[],
  leftover: RateMap,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
): ItemId | null {
  let best: ItemId | null = null;
  let bestValue = 0;
  for (const item of fillOrder) {
    const coeff = exactRawCoefficients(item)[rawId] ?? 0;
    if (coeff <= EPS) continue;
    const value = coeff * (leftover.get(rawId) ?? 0);
    if (value > bestValue + EPS) {
      bestValue = value;
      best = item;
    }
  }
  return best;
}

/**
 * Excess probe order: one high-value sink per leftover raw, then global value
 * ranking, then a rotating offset so later iterations reach other candidates.
 */
export function buildExcessProbeOrder(
  deps: SinkOptimizerDeps,
  leftover: RateMap,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
  iter: number,
): ItemId[] {
  const seen = new Set<ItemId>();
  const order: ItemId[] = [];

  for (const rawId of scarceRawIds) {
    if ((leftover.get(rawId) ?? 0) <= EPS) continue;
    const item = bestSinkForRaw(
      rawId,
      deps.fillOrder,
      leftover,
      exactRawCoefficients,
    );
    if (item && !seen.has(item)) {
      seen.add(item);
      order.push(item);
    }
  }

  const valueRanked = [...deps.fillOrder].sort((a, b) => {
    const value = (item: ItemId) =>
      leftoverValue(exactRawCoefficients(item), leftover);
    return value(b) - value(a) || a.localeCompare(b);
  });
  for (const item of valueRanked) {
    if (!seen.has(item)) {
      seen.add(item);
      order.push(item);
    }
  }

  if (order.length <= 1) return order;
  const offset = iter % order.length;
  return [...order.slice(offset), ...order.slice(0, offset)];
}

/** Collect feasible single-move candidates (bounded excess window). */
function collectCandidateMoves(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  modes: readonly OptimizeMode[],
  leftover: RateMap,
  hasLeftover: boolean,
  exactRawCoefficients: (item: ItemId) => Partial<Record<ItemId, number>>,
  iter: number,
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  if (modesEnabled(modes, "target")) {
    for (const t of deps.targets) {
      const scored = growthMove(
        deps,
        baseline,
        "target",
        t.item,
        leftover,
        exactRawCoefficients,
      );
      if (scored) candidates.push(scored);
    }
  }

  if (modesEnabled(modes, "excess") && hasLeftover) {
    const order = buildExcessProbeOrder(deps, leftover, exactRawCoefficients, iter);
    let probed = 0;
    let collected = 0;
    for (let k = 0; k < order.length && probed < MAX_EXCESS_PROBE; k++) {
      if (collected >= MAX_RANKED_COLLECT) break;
      const item = order[k]!;
      if (!canUseLeftover(exactRawCoefficients(item), leftover)) continue;
      probed++;
      const scored = growthMove(
        deps,
        baseline,
        "excess",
        item,
        leftover,
        exactRawCoefficients,
      );
      if (scored) {
        candidates.push(scored);
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
      candidates.push(...collectIngotMoves(deps, baseline, ingot, amount));
    }
  }

  return candidates;
}

interface ScoredCandidate {
  move: SinkMove;
  score: PlanScore;
}

function scoreCandidateMove(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  move: SinkMove,
): ScoredCandidate | null {
  const restore = setSinkRate(deps, move, move.rate);
  const score = scorePlan(deps);
  restore();
  if (!score) return null;
  if (comparePlanScore(score, baseline) <= 0) return null;
  return { move, score };
}

function compareScoredCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  const byScore = comparePlanScore(b.score, a.score);
  if (byScore !== 0) return byScore;
  return moveKey([a.move]).localeCompare(moveKey([b.move]));
}

/** Pick the move that maximizes usefulOre then weightBonus via scorePlan. */
export function selectBestScoredMove(
  deps: SinkOptimizerDeps,
  baseline: PlanScore,
  candidates: readonly SinkMove[],
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const move of candidates) {
    const scored = scoreCandidateMove(deps, baseline, move);
    if (!scored) continue;
    if (!best || compareScoredCandidates(scored, best) < 0) {
      best = scored;
    }
  }
  return best;
}

function applyMove(deps: SinkOptimizerDeps, move: SinkMove): void {
  setSinkRate(deps, move, move.rate);
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
 * Bounded hill-climb: each iteration collects a capped set of feasible moves,
 * scores every candidate with scorePlan, rejects infeasible or non-improving
 * moves, and applies the one that maximizes useful ore (weight tie-break).
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
    const baseline = scorePlan(deps);
    if (!baseline) break;

    const leftover = deps.leftoverFromPlan(
      deps.buildSinks(),
      deps.available,
      deps.maxBeltCapacity,
    );
    const hasLeftover = [...leftover.values()].some((v) => v > EPS);

    if (!hasMeaningfulLeftover(deps, leftover, modes, hasLeftover)) break;

    const candidates = collectCandidateMoves(
      deps,
      baseline,
      modes,
      leftover,
      hasLeftover,
      exactRawCoefficients,
      iter,
    );
    if (candidates.length === 0) break;

    let best = candidates[0]!;
    for (let i = 1; i < candidates.length; i++) {
      const scored = candidates[i]!;
      if (compareScoredCandidates(scored, best) < 0) best = scored;
    }

    applyMove(deps, best.move);
  }
}
