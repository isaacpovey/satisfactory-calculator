"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FactoryShell } from "@/components/planner/factory/factory-shell";
import { SummaryView } from "@/components/planner/factory/summary-view";
import { BuildView } from "@/components/planner/factory/build-view";
import {
  FactoryErrorState,
  FactoryLoadingState,
  useFactory,
} from "@/components/planner/factory/use-factory";
import type { SavedFactory } from "@/lib/factory-storage";

export default function FactoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const view = searchParams.get("view") === "build" ? "build" : "summary";

  const { factory, loading, error, refresh } = useFactory(id ?? "");
  const [localFactory, setLocalFactory] = useState<SavedFactory | null>(null);

  const handleUpdate = useCallback(
    (updated: SavedFactory) => {
      setLocalFactory(updated);
      refresh();
    },
    [refresh],
  );

  if (!id) {
    return <FactoryErrorState message="No factory selected" />;
  }

  if (loading) {
    return <FactoryLoadingState />;
  }

  if (error || !factory) {
    return <FactoryErrorState message={error ?? "Factory not found"} />;
  }

  const displayFactory = localFactory ?? factory;

  const shellFactory = displayFactory;
  const isBuild = view === "build";

  return (
    <FactoryShell
      factory={shellFactory}
      view={isBuild ? "build" : "summary"}
      onNavigate={(nextView) => router.push(`/factory?id=${id}&view=${nextView}`)}
    >
      {isBuild ? (
        <BuildView factory={displayFactory} onFactoryUpdate={handleUpdate} />
      ) : (
        <SummaryView
          factory={displayFactory}
          onFactoryUpdate={handleUpdate}
          onViewBuild={() => router.push(`/factory?id=${id}&view=build`)}
        />
      )}
    </FactoryShell>
  );
}
