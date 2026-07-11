"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import type { ItemId } from "@/data/types";
import type { ExactSolveProgress } from "@/lib/solver";
import { loadPlannerState, savePlannerState } from "@/lib/planner-storage";
import { solveExact } from "@/lib/solver";
import { diffSolveResults, emptyChanges } from "@/lib/solver/diff";
import type { ExcessSpec, PlannerInput, SolveResult, TargetSpec } from "@/lib/solver/types";
import {
  completedPhaseTiming,
  readSolverRuntimeInfo,
  type CompletedPhaseTiming,
} from "@/lib/solver/runtime-diagnostics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BeltTierPanel } from "./belt-tier-panel";
import { RawInputsPanel } from "./raw-inputs-panel";
import { TargetsPanel } from "./targets-panel";
import { ExcessPanel } from "./excess-panel";
import { ResultsPanel } from "./results-panel";
import { SolveDiagnosticsPanel } from "./solve-diagnostics-panel";

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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
  const [solveProgress, setSolveProgress] = useState<ExactSolveProgress | null>(null);
  const [completedPhases, setCompletedPhases] = useState<CompletedPhaseTiming[]>([]);
  const [solverRuntime] = useState(readSolverRuntimeInfo);
  const [solveElapsedSeconds, setSolveElapsedSeconds] = useState(0);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [changes, setChanges] = useState(emptyChanges);
  const prevResultRef = useRef<SolveResult | null>(null);
  const computeGen = useRef(0);
  const activeSolve = useRef<AbortController | null>(null);

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

  useEffect(() => {
    if (!computing) {
      setShowDetailedProgress(false);
      setSolveElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    let intervalId: number | undefined;
    const revealId = window.setTimeout(() => {
      setShowDetailedProgress(true);
      setSolveElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      intervalId = window.setInterval(() => {
        setSolveElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    }, 15_000);

    return () => {
      window.clearTimeout(revealId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [computing]);

  const runCompute = useCallback((input: PlannerInput) => {
    activeSolve.current?.abort();
    const controller = new AbortController();
    activeSolve.current = controller;
    const gen = ++computeGen.current;
    setComputing(true);
    setSolveProgress(null);
    setCompletedPhases([]);
    setSolveError(null);
    setChanges(emptyChanges());

    void solveExact(input, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (gen !== computeGen.current) return;
        setSolveProgress(progress);
        const timing = completedPhaseTiming(progress);
        if (timing) {
          setCompletedPhases((previous) => {
            if (previous.some((entry) => entry.phase === timing.phase)) return previous;
            return [...previous, timing];
          });
        }
      },
    })
      .then((next) => {
        if (gen !== computeGen.current) return;
        if (next.proofStatus === "CANCELLED") {
          setSolveError("Solve cancelled before optimality was proven.");
          return;
        }
        setChanges(diffSolveResults(prevResultRef.current, next));
        prevResultRef.current = next;
        setResult(next);
        setComputedFingerprint(inputFingerprint(input));
      })
      .catch((error: unknown) => {
        if (gen !== computeGen.current || controller.signal.aborted) return;
        setSolveError(error instanceof Error ? error.message : "The exact solver failed.");
      })
      .finally(() => {
        if (gen !== computeGen.current) return;
        setComputing(false);
        if (activeSolve.current === controller) activeSolve.current = null;
      });
  }, []);

  const cancelCompute = useCallback(() => {
    activeSolve.current?.abort();
    activeSolve.current = null;
    computeGen.current++;
    setComputing(false);
    setSolveProgress(null);
    setCompletedPhases([]);
    setSolveError("Solve cancelled before optimality was proven.");
  }, []);

  useEffect(
    () => () => {
      activeSolve.current?.abort();
    },
    [],
  );

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
            ) : solveError ? (
              <p className="text-xs font-medium text-destructive">{solveError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {computing
                  ? showDetailedProgress && solveProgress
                    ? `Phase ${solveProgress.phase} of ${solveProgress.phaseCount}: ${solveProgress.label} · ${formatElapsed(solveElapsedSeconds)} elapsed`
                    : "Proving the global optimum…"
                  : result
                    ? "Results match current inputs"
                    : "Ready to compute"}
              </p>
            )}
            <Button
              type="button"
              size="lg"
              className="w-full font-heading"
              disabled={!computing && !dirty && result !== null}
              variant={computing ? "outline" : "default"}
              onClick={computing ? cancelCompute : () => runCompute(draftInput)}
            >
              {computing ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Cancel solve
                </>
              ) : dirty ? (
                "Compute plan"
              ) : result ? (
                "Up to date"
              ) : (
                "Compute plan"
              )}
            </Button>
            <SolveDiagnosticsPanel
              runtime={solverRuntime}
              activeProgress={computing ? solveProgress : null}
              completedPhases={completedPhases}
              open={showDetailedProgress}
            />
          </div>
        </aside>

        <main className="min-w-0">
          <ResultsPanel
            result={result}
            computing={computing}
            progress={showDetailedProgress ? solveProgress : null}
            elapsedSeconds={showDetailedProgress ? solveElapsedSeconds : undefined}
            stale={dirty && !computing}
            changes={changes}
          />
        </main>
      </div>

      <footer className="border-t border-foreground/8 pt-4 text-xs text-muted-foreground">
        Exact recipe-specific clocks · globally optimal machine banks · conserved item flows ·
        demand-balanced manifolds · saved in this browser ·{" "}
        <Link href="/benchmark" className="underline underline-offset-2 hover:text-foreground">
          solver benchmark
        </Link>
      </footer>
    </div>
  );
}
