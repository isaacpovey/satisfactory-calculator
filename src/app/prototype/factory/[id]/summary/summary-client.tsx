"use client";

import { use } from "react";
import { FactoryShell } from "@/components/planner/prototype/factory-shell";
import { SummaryView } from "@/components/planner/prototype/summary-view";
import {
  FactoryErrorState,
  FactoryLoadingState,
  useFactory,
} from "@/components/planner/prototype/use-factory";

export function FactorySummaryClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { factory, loading, error } = useFactory(id);

  if (loading) {
    return (
      <FactoryLoadingState message="Loading factory…" />
    );
  }

  if (error || !factory) {
    return <FactoryErrorState message={error ?? "Factory not found"} />;
  }

  return (
    <FactoryShell factory={factory}>
      <SummaryView factory={factory} />
    </FactoryShell>
  );
}
