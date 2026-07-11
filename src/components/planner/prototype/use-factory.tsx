"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DEMO_FACTORY_ID,
  ensureDemoFactory,
  getFactory,
  type SavedFactory,
} from "@/lib/factory-storage";
import { DEMO_FACTORY_FIXTURE } from "@/lib/fixtures/demo-factory";

let demoSeedPromise: Promise<SavedFactory> | null = null;

function seedDemoFactory(): Promise<SavedFactory> {
  const existing = getFactory(DEMO_FACTORY_ID);
  if (existing) return Promise.resolve(existing);

  demoSeedPromise ??= Promise.resolve().then(() => {
    const factory: SavedFactory = {
      id: DEMO_FACTORY_ID,
      name: DEMO_FACTORY_FIXTURE.name,
      createdAt: new Date().toISOString(),
      plannerInput: DEMO_FACTORY_FIXTURE.plannerInput,
      result: DEMO_FACTORY_FIXTURE.result,
      builtSections: [],
    };
    ensureDemoFactory(factory);
    return factory;
  });

  return demoSeedPromise;
}

export function useFactory(id: string): {
  factory: SavedFactory | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [factory, setFactory] = useState<SavedFactory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        if (id === DEMO_FACTORY_ID) {
          const demo = await seedDemoFactory();
          if (!cancelled) setFactory(demo);
          return;
        }

        const saved = getFactory(id);
        if (!saved) {
          if (!cancelled) setError("Factory not found");
          return;
        }
        if (!cancelled) setFactory(saved);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load factory");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  return { factory, loading, error, refresh };
}

export function FactoryLoadingState({ message }: { message?: string }) {
  return (
    <div className="mx-auto flex min-h-64 max-w-7xl flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <Loader2 className="size-8 animate-spin text-primary" />
      <p className="font-heading font-semibold">{message ?? "Loading factory…"}</p>
    </div>
  );
}

export function FactoryErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 text-center">
      <p className="font-heading font-semibold text-destructive">{message}</p>
    </div>
  );
}
