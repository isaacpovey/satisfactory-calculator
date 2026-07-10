"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import type { ItemId } from "@/data/types";
import type { ExcessSpec, PlannerInput, SolveResult, TargetSpec } from "@/lib/solver/types";
import { loadPlannerState, savePlannerState } from "@/lib/planner-storage";
import { solve } from "@/lib/solver";
import { diffSolveResults, emptyChanges } from "@/lib/solver/diff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BeltTierPanel } from "./belt-tier-panel";
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

function inputFingerprint(input: PlannerInput): string {
  return JSON.stringify({
    raw: input.rawAvailable,
    targets: input.targets,
    excess: input.excess,
    maxBeltCapacity: input.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY,
  });
}

function buildExcessInput(floors: Partial<Record<ItemId, number>>): ExcessSpec[] {
  return Object.entries(floors)
    .filter(([, rate]) => (rate ?? 0) > 0)
    .map(([item, rate]) => ({ item: item as ItemId, rate: rate ?? 0 }));
}

export function PlannerApp() {
  const [rawAvailable, setRawAvailable] = useState<Partial<Record<ItemId, number>>>(defaultRaws);
  const [targets, setTargets] = useState<TargetSpec[]>(defaultTargets);
  const [excessFloors, setExcessFloors] = useState<Partial<Record<ItemId, number>>>({});
  const [maxBeltCapacity, setMaxBeltCapacity] = useState(DEFAULT_MAX_BELT_CAPACITY);
  const [hydrated, setHydrated] = useState(false);

  const [result, setResult] = useState<SolveResult | null>(null);
  const [computedFingerprint, setComputedFingerprint] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [changes, setChanges] = useState(emptyChanges);
  const prevResultRef = useRef<SolveResult | null>(null);
  const computeGen = useRef(0);

  const draftInput: PlannerInput = useMemo(
    () => ({
      rawAvailable,
      targets,
      excess: buildExcessInput(excessFloors),
      maxBeltCapacity,
    }),
    [rawAvailable, targets, excessFloors, maxBeltCapacity],
  );

  const draftFingerprint = useMemo(() => inputFingerprint(draftInput), [draftInput]);

  const dirty = computedFingerprint !== null && draftFingerprint !== computedFingerprint;

  useEffect(() => {
    const saved = loadPlannerState();
    if (saved) {
      setRawAvailable(saved.rawAvailable);
      setTargets(saved.targets);
      setExcessFloors(saved.excessFloors);
      setMaxBeltCapacity(saved.maxBeltCapacity);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePlannerState({
      version: 1,
      rawAvailable,
      targets,
      excessFloors,
      maxBeltCapacity,
    });
  }, [hydrated, rawAvailable, targets, excessFloors, maxBeltCapacity]);

  const runCompute = useCallback((input: PlannerInput) => {
    const gen = ++computeGen.current;
    setComputing(true);
    setChanges(emptyChanges());

    // Yield so the loading overlay can paint before the sync solve blocks.
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (gen !== computeGen.current) return;
        const next = solve(input);
        if (gen !== computeGen.current) return;
        setChanges(diffSolveResults(prevResultRef.current, next));
        prevResultRef.current = next;
        setResult(next);
        setComputedFingerprint(inputFingerprint(input));
        setComputing(false);
      }, 0);
    });
  }, []);

  const initialComputeDone = useRef(false);

  // Initial compute after hydrate (uses saved or default draft).
  useEffect(() => {
    if (!hydrated || initialComputeDone.current || result !== null || computing) return;
    initialComputeDone.current = true;
    runCompute({
      rawAvailable,
      targets,
      excess: buildExcessInput(excessFloors),
      maxBeltCapacity,
    });
  }, [
    hydrated,
    result,
    computing,
    rawAvailable,
    targets,
    excessFloors,
    maxBeltCapacity,
    runCompute,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Satisfactory · Tier 0–4
        </p>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Resource-Max Planner
        </h1>
        <p className="text-base text-muted-foreground text-pretty">
          Set your ore rates and minimum products, then compute. Leftover capacity fills by balance
          weight and soaks into spare parts — never raw ingots — with buildable machine banks and
          splitter shares.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5">
          <RawInputsPanel
            values={rawAvailable}
            onChange={(item, value) => setRawAvailable((prev) => ({ ...prev, [item]: value }))}
          />
          <BeltTierPanel maxBeltCapacity={maxBeltCapacity} onChange={setMaxBeltCapacity} />
          <TargetsPanel targets={targets} onChange={setTargets} />
          <ExcessPanel
            excess={result?.excess ?? []}
            floors={excessFloors}
            onFloorChange={(item, rate) =>
              setExcessFloors((prev) => ({
                ...prev,
                [item as ItemId]: rate,
              }))
            }
          />

          <div
            className={cn(
              "sticky bottom-4 z-10 flex flex-col gap-2 rounded-xl p-3 ring-1 backdrop-blur-sm",
              dirty ? "bg-primary/12 ring-primary/35" : "bg-card/95 ring-foreground/8",
            )}
          >
            {dirty ? (
              <p className="text-xs font-medium text-primary">
                Inputs changed — results are out of date
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {computing
                  ? "Computing plan…"
                  : result
                    ? "Results match current inputs"
                    : "Ready to compute"}
              </p>
            )}
            <Button
              type="button"
              size="lg"
              className="w-full font-heading"
              disabled={computing || (!dirty && result !== null)}
              onClick={() => runCompute(draftInput)}
            >
              {computing ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Computing…
                </>
              ) : dirty ? (
                "Compute plan"
              ) : result ? (
                "Up to date"
              ) : (
                "Compute plan"
              )}
            </Button>
          </div>
        </aside>

        <main className="min-w-0">
          <ResultsPanel
            result={result}
            computing={computing}
            stale={dirty && !computing}
            changes={changes}
          />
        </main>
      </div>

      <footer className="border-t border-foreground/8 pt-4 text-xs text-muted-foreground">
        Clocks 100 / 75 / 66.67 / 50 / 33.33 / 25% · belt-capped machine banks · nested 1/2 + 1/3
        splits & merges · overflow to storage · saved in this browser
      </footer>
    </div>
  );
}
