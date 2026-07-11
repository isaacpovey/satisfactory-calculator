import type { PlannerInput, SolveResult } from "@/lib/solver/types";

export const FACTORIES_STORAGE_KEY = "satisfactory-factories:v1";

export interface SavedFactory {
  id: string;
  name: string;
  createdAt: string;
  plannerInput: PlannerInput;
  result: SolveResult;
  builtSections: string[];
}

interface FactoriesPersistedState {
  version: 1;
  factories: SavedFactory[];
}

function readState(): FactoriesPersistedState {
  if (typeof window === "undefined") {
    return { version: 1, factories: [] };
  }
  try {
    const raw = window.localStorage.getItem(FACTORIES_STORAGE_KEY);
    if (!raw) return { version: 1, factories: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, factories: [] };
    const data = parsed as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.factories)) {
      return { version: 1, factories: [] };
    }
    return { version: 1, factories: data.factories as SavedFactory[] };
  } catch {
    return { version: 1, factories: [] };
  }
}

function writeState(state: FactoriesPersistedState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(FACTORIES_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function listFactories(): SavedFactory[] {
  return readState().factories.toSorted(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getFactory(id: string): SavedFactory | null {
  return readState().factories.find((f) => f.id === id) ?? null;
}

export function saveFactory(factory: SavedFactory): boolean {
  const state = readState();
  const idx = state.factories.findIndex((f) => f.id === factory.id);
  if (idx >= 0) {
    state.factories[idx] = factory;
  } else {
    state.factories.push(factory);
  }
  return writeState(state);
}

export function deleteFactory(id: string): boolean {
  const state = readState();
  const next = state.factories.filter((f) => f.id !== id);
  if (next.length === state.factories.length) return true;
  return writeState({ version: 1, factories: next });
}

export function toggleBuiltSection(
  factoryId: string,
  sectionId: string,
  checked: boolean,
): SavedFactory | null {
  const state = readState();
  const idx = state.factories.findIndex((f) => f.id === factoryId);
  if (idx < 0) return null;

  const factory = state.factories[idx]!;
  const set = new Set(factory.builtSections);
  if (checked) {
    set.add(sectionId);
  } else {
    set.delete(sectionId);
  }
  const updated: SavedFactory = { ...factory, builtSections: [...set] };
  state.factories[idx] = updated;
  if (!writeState(state)) return null;
  return updated;
}

export function createFactoryId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `factory-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const DEMO_FACTORY_ID = "demo";

export function ensureDemoFactory(factory: SavedFactory): boolean {
  const state = readState();
  const exists = state.factories.some((f) => f.id === DEMO_FACTORY_ID);
  if (exists) return true;
  const demo: SavedFactory = { ...factory, id: DEMO_FACTORY_ID };
  state.factories.push(demo);
  return writeState(state);
}
