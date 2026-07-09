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
};

const defaultTargets: TargetSpec[] = [
  { item: "motor", minRate: 2, weight: 60 },
  { item: "encased-industrial-beam", minRate: 2, weight: 40 },
];

export function PlannerApp() {
  const [rawAvailable, setRawAvailable] =
    useState<Partial<Record<ItemId, number>>>(defaultRaws);
  const [targets, setTargets] = useState<TargetSpec[]>(defaultTargets);
  const [excess, setExcess] = useState<ExcessSpec[]>([]);

  const result = useMemo(
    () => solve({ rawAvailable, targets, excess }),
    [rawAvailable, targets, excess],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-primary">
          Tier 0–4 · Standard recipes
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Resource-Max Planner
        </h1>
        <p className="max-w-2xl text-muted-foreground text-pretty">
          Enter your ore rates and minimum end-product targets. Leftover
          capacity is split by the balance sliders so every stage stays
          recipe-efficient.
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
          <ExcessPanel excess={excess} onChange={setExcess} />
        </div>
        <ResultsPanel result={result} />
      </div>

      <footer className="border-t border-border/70 pt-4 text-xs text-muted-foreground">
        Client-side only · static export ready · no alternate recipes or layout
        planning in v1
      </footer>
    </div>
  );
}
