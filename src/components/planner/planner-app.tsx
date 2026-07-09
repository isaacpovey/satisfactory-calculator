"use client";

import { useMemo, useState } from "react";
import type { ItemId } from "@/data/types";
import type { ExcessSpec, TargetSpec } from "@/lib/solver/types";
import { solve } from "@/lib/solver";
import { Separator } from "@/components/ui/separator";
import { RawInputsPanel } from "./raw-inputs-panel";
import { TargetsPanel } from "./targets-panel";
import { ExcessPanel } from "./excess-panel";
import { ResultsPanel } from "./results-panel";

const defaultRaws: Partial<Record<ItemId, number>> = {
  "iron-ore": 120,
  "copper-ore": 60,
  limestone: 60,
  coal: 60,
  "caterium-ore": 60,
  "raw-quartz": 60,
  sulfur: 60,
};

const defaultTargets: TargetSpec[] = [
  { item: "motor", minRate: 2, weight: 60 },
  { item: "encased-industrial-beam", minRate: 2, weight: 40 },
];

export function PlannerApp() {
  const [rawAvailable, setRawAvailable] =
    useState<Partial<Record<ItemId, number>>>(defaultRaws);
  const [targets, setTargets] = useState<TargetSpec[]>(defaultTargets);
  const [excessFloors, setExcessFloors] = useState<
    Partial<Record<ItemId, number>>
  >({});

  const excessInput: ExcessSpec[] = useMemo(
    () =>
      Object.entries(excessFloors)
        .filter(([, rate]) => (rate ?? 0) > 0)
        .map(([item, rate]) => ({ item: item as ItemId, rate: rate ?? 0 })),
    [excessFloors],
  );

  const result = useMemo(
    () => solve({ rawAvailable, targets, excess: excessInput }),
    [rawAvailable, targets, excessInput],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-primary">
          Tier 0–4 · MAM Caterium / Quartz / Sulfur
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Resource-Max Planner
        </h1>
        <p className="max-w-2xl text-muted-foreground text-pretty">
          Enter ore rates and minimum end products. Leftover capacity is split
          by balance sliders, then soaked into chain intermediaries (complex
          parts first) using whole machines and easy underclocks.
        </p>
      </header>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <RawInputsPanel
            values={rawAvailable}
            onChange={(item, value) =>
              setRawAvailable((prev) => ({ ...prev, [item]: value }))
            }
          />
          <TargetsPanel targets={targets} onChange={setTargets} />
          <ExcessPanel
            excess={result.excess}
            floors={excessFloors}
            onFloorChange={(item, rate) =>
              setExcessFloors((prev) => ({
                ...prev,
                [item as ItemId]: rate,
              }))
            }
          />
        </div>
        <ResultsPanel result={result} />
      </div>

      <footer className="border-t border-border/70 pt-4 text-xs text-muted-foreground">
        Client-side only · clocks 100/75/50/25% · splitter-friendly leftover
        shares · auto excess fill
      </footer>
    </div>
  );
}
