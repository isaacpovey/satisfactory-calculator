import type { ItemId } from "@/data/types";
import type { SolveResult } from "./types";

const EPS = 1e-6;

export interface ResultChanges {
  overall: boolean;
  raws: Set<ItemId>;
  targets: Set<ItemId>;
  stages: Set<string>;
  excess: Set<ItemId>;
  items: Set<ItemId>;
}

export function emptyChanges(): ResultChanges {
  return {
    overall: false,
    raws: new Set(),
    targets: new Set(),
    stages: new Set(),
    excess: new Set(),
    items: new Set(),
  };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

/** Diff two solve results for UI highlight. `prev === null` → no highlights. */
export function diffSolveResults(prev: SolveResult | null, next: SolveResult): ResultChanges {
  if (!prev) return emptyChanges();

  const changes = emptyChanges();
  if (!near(prev.overallUtilization, next.overallUtilization)) {
    changes.overall = true;
  }

  const prevRaw = new Map(prev.raws.map((r) => [r.item, r]));
  for (const r of next.raws) {
    const p = prevRaw.get(r.item);
    if (
      !p ||
      !near(p.used, r.used) ||
      !near(p.available, r.available) ||
      !near(p.utilization, r.utilization)
    ) {
      changes.raws.add(r.item);
    }
  }

  const prevTarget = new Map(prev.targets.map((t) => [t.item, t]));
  for (const t of next.targets) {
    const p = prevTarget.get(t.item);
    if (
      !p ||
      !near(p.totalRate, t.totalRate) ||
      !near(p.plannedMinRate, t.plannedMinRate) ||
      !near(p.extraRate, t.extraRate)
    ) {
      changes.targets.add(t.item);
    }
  }

  const prevStage = new Map(prev.network.stages.map((s) => [s.recipeId, s]));
  for (const s of next.network.stages) {
    const p = prevStage.get(s.recipeId);
    if (!p || !near(p.outputPerMinute, s.outputPerMinute)) {
      changes.stages.add(s.recipeId);
      continue;
    }
    if (p.groups.length !== s.groups.length) {
      changes.stages.add(s.recipeId);
      continue;
    }
    for (let i = 0; i < s.groups.length; i++) {
      const pg = p.groups[i]!;
      const ng = s.groups[i]!;
      if (
        pg.machines !== ng.machines ||
        !near(pg.clock, ng.clock) ||
        !near(pg.effectiveMachines, ng.effectiveMachines)
      ) {
        changes.stages.add(s.recipeId);
        break;
      }
    }
  }
  for (const id of prevStage.keys()) {
    if (!next.network.stages.some((s) => s.recipeId === id)) {
      changes.stages.add(id);
    }
  }

  const prevExcess = new Map(prev.excess.map((e) => [e.item, e]));
  for (const e of next.excess) {
    const p = prevExcess.get(e.item);
    if (!p || !near(p.rate, e.rate) || !near(p.autoRate, e.autoRate)) {
      if (e.rate > EPS || (p?.rate ?? 0) > EPS) changes.excess.add(e.item);
    }
  }

  const prevItem = new Map(prev.items.map((i) => [i.item, i]));
  for (const row of next.items) {
    const p = prevItem.get(row.item);
    if (
      !p ||
      !near(p.produced, row.produced) ||
      !near(p.consumed, row.consumed) ||
      !near(p.net, row.net)
    ) {
      changes.items.add(row.item);
    }
  }

  return changes;
}
