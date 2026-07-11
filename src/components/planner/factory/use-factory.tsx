"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { getFactory, type SavedFactory } from "@/lib/factory-storage";

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
    setLoading(true);
    setError(null);
    const saved = getFactory(id);
    if (!saved) {
      setFactory(null);
      setError("Factory not found");
    } else {
      setFactory(saved);
    }
    setLoading(false);
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
      <Link href="/factories" className="mt-4 inline-block text-sm text-primary underline">
        Back to saved factories
      </Link>
    </div>
  );
}
