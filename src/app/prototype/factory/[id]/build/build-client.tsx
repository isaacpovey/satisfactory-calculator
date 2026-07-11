"use client";

import { use, useCallback, useState } from "react";
import { FactoryShell } from "@/components/planner/prototype/factory-shell";
import { BuildView } from "@/components/planner/prototype/build-view";
import {
  FactoryErrorState,
  FactoryLoadingState,
  useFactory,
} from "@/components/planner/prototype/use-factory";
import type { SavedFactory } from "@/lib/factory-storage";

export function FactoryBuildClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { factory, loading, error, refresh } = useFactory(id);
  const [localFactory, setLocalFactory] = useState<SavedFactory | null>(null);

  const handleUpdate = useCallback(
    (updated: SavedFactory) => {
      setLocalFactory(updated);
      refresh();
    },
    [refresh],
  );

  if (loading) {
    return (
      <FactoryLoadingState message="Loading factory…" />
    );
  }

  if (error || !factory) {
    return <FactoryErrorState message={error ?? "Factory not found"} />;
  }

  const displayFactory = localFactory ?? factory;

  return (
    <FactoryShell factory={displayFactory}>
      <BuildView factory={displayFactory} onFactoryUpdate={handleUpdate} />
    </FactoryShell>
  );
}
