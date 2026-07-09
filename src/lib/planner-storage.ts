import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";
import type { TargetSpec } from "@/lib/solver/types";

export const PLANNER_STORAGE_KEY = "satisfactory-planner:v1";

export interface PlannerPersistedState {
  version: 1;
  rawAvailable: Partial<Record<ItemId, number>>;
  targets: TargetSpec[];
  excessFloors: Partial<Record<ItemId, number>>;
}

function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && value in itemById;
}

function sanitizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function sanitizeRaws(
  value: unknown,
): Partial<Record<ItemId, number>> | null {
  if (!value || typeof value !== "object") return null;
  const out: Partial<Record<ItemId, number>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isItemId(key)) continue;
    const n = sanitizeNumber(raw);
    if (n === null) continue;
    out[key] = n;
  }
  return out;
}

function sanitizeTargets(value: unknown): TargetSpec[] | null {
  if (!Array.isArray(value)) return null;
  const out: TargetSpec[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (!isItemId(row.item)) continue;
    const minRate = sanitizeNumber(row.minRate);
    const weight = sanitizeNumber(row.weight);
    if (minRate === null || weight === null) continue;
    out.push({
      item: row.item,
      minRate,
      weight: Math.min(100, weight),
    });
  }
  return out;
}

function sanitizeExcessFloors(
  value: unknown,
): Partial<Record<ItemId, number>> | null {
  return sanitizeRaws(value);
}

export function loadPlannerState(): PlannerPersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLANNER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Record<string, unknown>;
    if (data.version !== 1) return null;

    const rawAvailable = sanitizeRaws(data.rawAvailable);
    const targets = sanitizeTargets(data.targets);
    const excessFloors = sanitizeExcessFloors(data.excessFloors);
    if (!rawAvailable || !targets || !excessFloors) return null;

    return {
      version: 1,
      rawAvailable,
      targets,
      excessFloors,
    };
  } catch {
    return null;
  }
}

export function savePlannerState(state: PlannerPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode — ignore; planner still works in-memory.
  }
}
