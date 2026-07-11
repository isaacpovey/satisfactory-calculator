"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { solveExact, type ExactSolveProgress } from "@/lib/solver";
import { BROWSER_FACTORY_BENCHMARK_INPUT } from "@/lib/solver/benchmark-config";
import {
  branchesPerSecond,
  formatBranchesPerSec,
  formatPhaseMs,
  readSolverRuntimeInfo,
  type CompletedPhaseTiming,
} from "@/lib/solver/runtime-diagnostics";

interface BenchmarkState {
  status: "running" | "complete" | "error";
  totalMs: number;
  phases: CompletedPhaseTiming[];
  feasible: boolean | null;
  error: string | null;
}

function toCompletedPhase(progress: ExactSolveProgress): CompletedPhaseTiming | null {
  if (progress.status !== "complete" || progress.phaseMs === undefined) return null;
  const numBranches = progress.numBranches ?? 0;
  return {
    phase: progress.phase,
    label: progress.label,
    phaseMs: progress.phaseMs,
    numBranches,
    numConflicts: progress.numConflicts ?? 0,
    searchWorkers: progress.searchWorkers,
    branchesPerSec: branchesPerSecond(progress.phaseMs, numBranches),
  };
}

export default function BenchmarkPage() {
  const runtime = useMemo(() => readSolverRuntimeInfo(), []);
  const [state, setState] = useState<BenchmarkState>({
    status: "running",
    totalMs: 0,
    phases: [],
    feasible: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const phases: CompletedPhaseTiming[] = [];
    const started = performance.now();

    console.info("[browser-benchmark] runtime", {
      ...runtime,
      userAgent: navigator.userAgent,
    });

    void solveExact(BROWSER_FACTORY_BENCHMARK_INPUT, {
      searchWorkers: 8,
      onProgress: (progress) => {
        const timing = toCompletedPhase(progress);
        if (!timing) return;
        phases.push(timing);
        console.info(
          `[browser-benchmark] phase ${timing.phase} ${timing.label}: ${timing.phaseMs.toFixed(0)}ms` +
            ` · ${timing.numBranches} branches · ${timing.searchWorkers} workers`,
        );
        if (!cancelled) {
          setState({
            status: "running",
            totalMs: performance.now() - started,
            phases: [...phases],
            feasible: null,
            error: null,
          });
        }
      },
    })
      .then((solveResult) => {
        if (cancelled) return;
        const totalMs = performance.now() - started;
        const finalState: BenchmarkState = {
          status: "complete",
          totalMs,
          phases,
          feasible: solveResult.feasible,
          error: null,
        };
        console.info("[browser-benchmark] complete", finalState);
        setState(finalState);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[browser-benchmark] error", message);
        setState({
          status: "error",
          totalMs: performance.now() - started,
          phases,
          feasible: null,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [runtime]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-xs text-muted-foreground">
          <Link href="/" className="underline underline-offset-2 hover:text-foreground">
            Back to planner
          </Link>
        </p>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Solver benchmark</h1>
        <p className="text-sm text-muted-foreground">
          Runs the saved browser factory snapshot (1860 iron, 540 copper, full excess floors) with 8
          CP-SAT workers. Use this page to compare branches/s across browsers.
        </p>
      </header>

      <section className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8">
        <h2 className="font-heading text-sm font-semibold">Runtime</h2>
        <dl className="mt-2 grid gap-1 text-sm tabular-nums">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">crossOriginIsolated</dt>
            <dd>{runtime.crossOriginIsolated ? "true" : "false"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">SharedArrayBuffer</dt>
            <dd>{runtime.sharedArrayBuffer ? "true" : "false"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">hardwareConcurrency</dt>
            <dd>{runtime.hardwareConcurrency ?? "unknown"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Firefox family</dt>
            <dd>{runtime.isFirefoxFamily ? "yes" : "no"}</dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8"
        data-testid="benchmark-result"
        data-status={state.status}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-sm font-semibold">Result</h2>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {state.status}
          </span>
        </div>
        <p className="mt-2 text-sm tabular-nums">
          Total: {formatPhaseMs(state.totalMs)}
          {state.feasible !== null ? ` · feasible: ${state.feasible ? "yes" : "no"}` : ""}
        </p>
        {state.error !== null && state.error.length > 0 ? (
          <p className="mt-2 text-sm text-destructive">{state.error}</p>
        ) : null}
        {state.phases.length > 0 ? (
          <table className="mt-4 w-full text-left text-sm tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Phase</th>
                <th className="pb-2 pr-3 font-medium">Time</th>
                <th className="pb-2 pr-3 font-medium">Branches</th>
                <th className="pb-2 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {state.phases.map((phase) => (
                <tr key={phase.phase} className="border-t border-foreground/8">
                  <td className="py-2 pr-3">{phase.label}</td>
                  <td className="py-2 pr-3">{formatPhaseMs(phase.phaseMs)}</td>
                  <td className="py-2 pr-3">{phase.numBranches.toLocaleString()}</td>
                  <td className="py-2">{formatBranchesPerSec(phase.branchesPerSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Running benchmark…</p>
        )}
      </section>

      <pre className="overflow-auto rounded-xl bg-muted/40 p-4 text-xs ring-1 ring-foreground/8">
        {JSON.stringify({ runtime, ...state, userAgent: navigator.userAgent }, null, 2)}
      </pre>
    </main>
  );
}
