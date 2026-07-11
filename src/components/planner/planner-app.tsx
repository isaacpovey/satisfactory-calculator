"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DEFAULT_MAX_BELT_CAPACITY } from "@/data/belts";
import type { ItemId } from "@/data/types";
import type { ExactSolveProgress } from "@/lib/solver";
import { loadPlannerState, hasStoredPlannerState, savePlannerState } from "@/lib/planner-storage";
import {
  getFactory,
  saveFactoryFromCompute,
  setSessionFactoryId,
} from "@/lib/factory-storage";
import { solveExact } from "@/lib/solver";
import { excessPanelItems, pruneExcessFloors } from "@/lib/solver/chain-intermediates";
import type { ExcessResult, ExcessSpec, PlannerInput, TargetSpec } from "@/lib/solver/types";
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

interface PlannerDraftState {
  rawAvailable: Partial<Record<ItemId, number>>;
  targets: TargetSpec[];
  excessFloors: Partial<Record<ItemId, number>>;
  maxBeltCapacity: number;
}

const defaultPlannerState: PlannerDraftState = {
  rawAvailable: defaultRaws,
  targets: defaultTargets,
  excessFloors: {},
  maxBeltCapacity: DEFAULT_MAX_BELT_CAPACITY,
};

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

function excessFloorsFromInput(excess: ExcessSpec[]): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const row of excess) {
    out[row.item] = row.rate;
  }
  return out;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function PlannerApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editFactoryId = searchParams.get("edit");

  const [rawAvailable, setRawAvailable] = useState(defaultPlannerState.rawAvailable);
  const [targets, setTargets] = useState(defaultPlannerState.targets);
  const [excessFloors, setExcessFloors] = useState(defaultPlannerState.excessFloors);
  const [maxBeltCapacity, setMaxBeltCapacity] = useState(defaultPlannerState.maxBeltCapacity);
  const [storageReady, setStorageReady] = useState(
    () => typeof window === "undefined" || !hasStoredPlannerState(),
  );

  const [computedFingerprint, setComputedFingerprint] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [solveProgress, setSolveProgress] = useState<ExactSolveProgress | null>(null);
  const [completedPhases, setCompletedPhases] = useState<CompletedPhaseTiming[]>([]);
  const [solverRuntime] = useState(readSolverRuntimeInfo);
  const [solveElapsedSeconds, setSolveElapsedSeconds] = useState(0);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const editingFactoryIdRef = useRef<string | null>(null);
  const computeGen = useRef(0);
  const activeSolve = useRef<AbortController | null>(null);
  const skipPruneForInitialTargets = useRef(true);
  const initialComputeDone = useRef(false);

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

  const deferredTargets = useDeferredValue(targets);
  const sparePartsRecomputing = !storageReady || targets !== deferredTargets;

  const excessItemIds = useMemo(
    () => (storageReady ? excessPanelItems(deferredTargets) : []),
    [storageReady, deferredTargets],
  );

  const editingFactory = editFactoryId ? getFactory(editFactoryId) : null;

  const handleTargetsChange = useCallback((next: TargetSpec[]) => {
    startTransition(() => setTargets(next));
  }, []);

  const applyGlobalMinimum = useCallback(
    (rate: number) => {
      if (!Number.isFinite(rate) || rate < 0) return;
      setExcessFloors((prev) => {
        const next = { ...prev };
        for (const id of excessItemIds) {
          next[id] = rate;
        }
        return next;
      });
    },
    [excessItemIds],
  );

  const excessRows: ExcessResult[] = useMemo(() => {
    const solvedResult = editingFactory && !dirty ? editingFactory.result : null;
    if (solvedResult) {
      const solvedByItem = new Map(solvedResult.excess.map((row) => [row.item, row]));
      return excessItemIds.map((item) => {
        const solved = solvedByItem.get(item);
        return (
          solved ?? {
            item,
            requestedRate: excessFloors[item] ?? 0,
            rate: 0,
            autoRate: 0,
          }
        );
      });
    }
    return excessItemIds.map((item) => ({
      item,
      requestedRate: excessFloors[item] ?? 0,
      rate: 0,
      autoRate: 0,
    }));
  }, [excessItemIds, editingFactory, dirty, excessFloors]);

  useEffect(() => {
    if (skipPruneForInitialTargets.current) {
      skipPruneForInitialTargets.current = false;
      return;
    }
    setExcessFloors((prev) => {
      const next = pruneExcessFloors(targets, prev);
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [targets]);

  useEffect(() => {
    if (editFactoryId) {
      const factory = getFactory(editFactoryId);
      if (factory) {
        setRawAvailable(factory.plannerInput.rawAvailable);
        setTargets(factory.plannerInput.targets);
        setExcessFloors(
          pruneExcessFloors(
            factory.plannerInput.targets,
            excessFloorsFromInput(factory.plannerInput.excess),
          ),
        );
        setMaxBeltCapacity(
          factory.plannerInput.maxBeltCapacity ?? DEFAULT_MAX_BELT_CAPACITY,
        );
        setComputedFingerprint(inputFingerprint(factory.plannerInput));
        editingFactoryIdRef.current = editFactoryId;
        setSessionFactoryId(editFactoryId);
        setStorageReady(true);
        initialComputeDone.current = true;
        return;
      }
    }

    if (!hasStoredPlannerState()) {
      setStorageReady(true);
      return;
    }

    const saved = loadPlannerState();
    if (saved) {
      setRawAvailable(saved.rawAvailable);
      setTargets(saved.targets);
      setExcessFloors(pruneExcessFloors(saved.targets, saved.excessFloors));
      setMaxBeltCapacity(saved.maxBeltCapacity);
    }
    editingFactoryIdRef.current = null;
    setStorageReady(true);
  }, [editFactoryId]);

  useEffect(() => {
    if (!storageReady || editFactoryId) return;
    savePlannerState({
      version: 1,
      rawAvailable,
      targets,
      excessFloors,
      maxBeltCapacity,
    });
  }, [storageReady, editFactoryId, rawAvailable, targets, excessFloors, maxBeltCapacity]);

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

  const runCompute = useCallback(
    (input: PlannerInput) => {
      activeSolve.current?.abort();
      const controller = new AbortController();
      activeSolve.current = controller;
      const gen = ++computeGen.current;
      setComputing(true);
      setSolveProgress(null);
      setCompletedPhases([]);
      setSolveError(null);

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

          const factoryId = editingFactoryIdRef.current ?? undefined;
          const saved = saveFactoryFromCompute(input, next, {
            id: factoryId,
            preserveBuiltSections: !!factoryId,
          });

          if (!saved) {
            setSolveError("Plan computed but could not be saved to this browser.");
            return;
          }

          setComputedFingerprint(inputFingerprint(input));
          router.push(`/factory?id=${saved.id}`);
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
    },
    [router],
  );

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

  useEffect(() => {
    if (!storageReady || initialComputeDone.current || computing || editFactoryId) return;
    initialComputeDone.current = true;
    runCompute(draftInput);
  }, [storageReady, computing, editFactoryId, draftInput, runCompute]);

  if (!storageReady) {
    return (
      <div
        className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-8"
        aria-busy
        aria-live="polite"
      >
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        <div className="space-y-1 text-center">
          <p className="font-heading text-base font-semibold">Loading saved planner</p>
          <p className="text-sm text-muted-foreground">Restoring your inputs from this browser</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Satisfactory · Tier 0–4
        </p>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Resource-Max Planner
        </h1>
        <p className="text-base text-muted-foreground text-pretty">
          Set your ore rates and minimum products, then compute. Results open on a summary page with
          a full build plan you can track section by section.
        </p>
        {editingFactory ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            Editing{" "}
            <Link
              href={`/factory?id=${editingFactory.id}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {editingFactory.name}
            </Link>
            . Recompute to update that factory.
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-5">
        <RawInputsPanel
          values={rawAvailable}
          onChange={(item, value) => setRawAvailable((prev) => ({ ...prev, [item]: value }))}
        />
        <BeltTierPanel maxBeltCapacity={maxBeltCapacity} onChange={setMaxBeltCapacity} />
        <TargetsPanel targets={targets} onChange={handleTargetsChange} />
        <ExcessPanel
          excess={excessRows}
          floors={excessFloors}
          loading={sparePartsRecomputing}
          onApplyGlobalMinimum={applyGlobalMinimum}
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
              Inputs changed — recompute to update results
            </p>
          ) : solveError ? (
            <p className="text-xs font-medium text-destructive">{solveError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {computing
                ? showDetailedProgress && solveProgress
                  ? `Phase ${solveProgress.phase} of ${solveProgress.phaseCount}: ${solveProgress.label} · ${formatElapsed(solveElapsedSeconds)} elapsed`
                  : "Proving the global optimum…"
                : computedFingerprint
                  ? "Plan is up to date"
                  : "Ready to compute"}
            </p>
          )}
          <Button
            type="button"
            size="lg"
            className="w-full font-heading"
            disabled={!computing && !dirty && computedFingerprint !== null}
            variant={computing ? "outline" : "default"}
            onClick={computing ? cancelCompute : () => runCompute(draftInput)}
          >
            {computing ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Cancel solve
              </>
            ) : dirty || !computedFingerprint ? (
              "Compute plan"
            ) : (
              "Up to date"
            )}
          </Button>
          <SolveDiagnosticsPanel
            runtime={solverRuntime}
            activeProgress={computing ? solveProgress : null}
            completedPhases={completedPhases}
            open={showDetailedProgress}
          />
        </div>

        {computing ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl bg-card/70 p-8 text-center ring-1 ring-foreground/8">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-heading font-semibold">Proving the global optimum…</p>
            <p className="text-sm text-muted-foreground">
              {showDetailedProgress && solveProgress
                ? `Phase ${solveProgress.phase} of ${solveProgress.phaseCount} · ${solveProgress.label}`
                : "Checking every non-dominated clock and machine-bank pattern"}
            </p>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-foreground/8 pt-4 text-xs text-muted-foreground">
        Exact recipe-specific clocks · globally optimal machine banks · conserved item flows ·
        demand-balanced manifolds · saved in this browser ·{" "}
        <Link href="/factories" className="underline underline-offset-2 hover:text-foreground">
          saved factories
        </Link>
        {" · "}
        <Link href="/benchmark" className="underline underline-offset-2 hover:text-foreground">
          solver benchmark
        </Link>
      </footer>
    </div>
  );
}
