import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlannerState,
  PLANNER_STORAGE_KEY,
  savePlannerState,
} from "./planner-storage";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  return storage;
}

describe("planner-storage", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("round-trips valid planner state", () => {
    savePlannerState({
      version: 1,
      rawAvailable: { "iron-ore": 1860, limestone: 420 },
      targets: [{ item: "concrete", minRate: 5, weight: 50 }],
      excessFloors: { "iron-rod": 5 },
    });

    const loaded = loadPlannerState();
    expect(loaded).toEqual({
      version: 1,
      rawAvailable: { "iron-ore": 1860, limestone: 420 },
      targets: [{ item: "concrete", minRate: 5, weight: 50 }],
      excessFloors: { "iron-rod": 5 },
    });
    expect(window.localStorage.getItem(PLANNER_STORAGE_KEY)).toBeTruthy();
  });

  it("drops unknown items and invalid numbers", () => {
    window.localStorage.setItem(
      PLANNER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        rawAvailable: { "iron-ore": 10, "not-an-item": 99, coal: "x" },
        targets: [
          { item: "motor", minRate: 2, weight: 60 },
          { item: "bogus", minRate: 1, weight: 1 },
          { item: "concrete", minRate: -3, weight: 150 },
        ],
        excessFloors: { stator: 5, nope: 1 },
      }),
    );

    expect(loadPlannerState()).toEqual({
      version: 1,
      rawAvailable: { "iron-ore": 10 },
      targets: [
        { item: "motor", minRate: 2, weight: 60 },
        { item: "concrete", minRate: 0, weight: 100 },
      ],
      excessFloors: { stator: 5 },
    });
  });

  it("returns null for corrupt or wrong-version payloads", () => {
    window.localStorage.setItem(PLANNER_STORAGE_KEY, "{not-json");
    expect(loadPlannerState()).toBeNull();

    window.localStorage.setItem(
      PLANNER_STORAGE_KEY,
      JSON.stringify({
        version: 99,
        rawAvailable: {},
        targets: [],
        excessFloors: {},
      }),
    );
    expect(loadPlannerState()).toBeNull();
  });
});
