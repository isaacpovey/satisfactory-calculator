"use client";

import type { ExactSolveProgress } from "@/lib/solver";
import {
  formatBranchesPerSec,
  formatPhaseMs,
  readSolverRuntimeInfo,
  type CompletedPhaseTiming,
  type SolverRuntimeInfo,
} from "@/lib/solver/runtime-diagnostics";
import { cn } from "@/lib/utils";

interface SolveDiagnosticsPanelProps {
  runtime?: SolverRuntimeInfo;
  activeProgress?: ExactSolveProgress | null;
  completedPhases?: readonly CompletedPhaseTiming[];
  open?: boolean;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ok ? "bg-util-high/15 text-util-high" : "bg-destructive/15 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

export function SolveDiagnosticsPanel({
  runtime = readSolverRuntimeInfo(),
  activeProgress = null,
  completedPhases = [],
  open = false,
}: SolveDiagnosticsPanelProps) {
  const threadingWarning = !runtime.threadingReady;
  const firefoxNote = runtime.isFirefoxFamily;

  return (
    <details
      className="rounded-lg bg-muted/40 ring-1 ring-foreground/8 open:bg-muted/55"
      open={open}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        Solver runtime diagnostics
      </summary>
      <div className="space-y-3 border-t border-foreground/8 px-3 py-2.5 text-xs">
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            ok={runtime.crossOriginIsolated}
            label={runtime.crossOriginIsolated ? "isolated" : "not isolated"}
          />
          <StatusBadge
            ok={runtime.sharedArrayBuffer}
            label={runtime.sharedArrayBuffer ? "SAB on" : "SAB off"}
          />
          {runtime.hardwareConcurrency !== null ? (
            <span className="rounded bg-card px-1.5 py-0.5 tabular-nums ring-1 ring-foreground/8">
              {runtime.hardwareConcurrency} cores
            </span>
          ) : null}
          {activeProgress ? (
            <span className="rounded bg-card px-1.5 py-0.5 tabular-nums ring-1 ring-foreground/8">
              {activeProgress.searchWorkers} workers
            </span>
          ) : null}
        </div>

        {threadingWarning ? (
          <p className="text-destructive">
            Threaded CP-SAT needs cross-origin isolation and SharedArrayBuffer. Without both, solves
            may run single-threaded and take much longer.
          </p>
        ) : null}

        {firefoxNote ? (
          <p className="text-muted-foreground">
            Firefox-family browsers can be slower than Chromium for this WASM solver even with
            workers enabled. Compare branches/s below against Chrome if a solve feels stuck.
          </p>
        ) : null}

        {activeProgress?.label === "total splitter and merger devices" ? (
          <p className="text-muted-foreground">
            Minimizing splitter and merger devices is often the longest phase on large factories.
            Low CPU use is normal while CP-SAT finishes its optimality proof.
          </p>
        ) : null}

        {completedPhases.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 pr-2 font-medium">Phase</th>
                  <th className="pb-1 pr-2 font-medium">Time</th>
                  <th className="pb-1 pr-2 font-medium">Branches</th>
                  <th className="pb-1 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {completedPhases.map((phase) => (
                  <tr key={phase.phase} className="border-t border-foreground/6">
                    <td className="py-1 pr-2">{phase.label}</td>
                    <td className="py-1 pr-2">{formatPhaseMs(phase.phaseMs)}</td>
                    <td className="py-1 pr-2">{phase.numBranches.toLocaleString()}</td>
                    <td className="py-1">{formatBranchesPerSec(phase.branchesPerSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeProgress?.status === "solving" ? (
          <p className="text-muted-foreground">
            Phase {activeProgress.phase}/{activeProgress.phaseCount}: {activeProgress.label}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Phase timings appear here after each objective completes.
          </p>
        )}
      </div>
    </details>
  );
}
