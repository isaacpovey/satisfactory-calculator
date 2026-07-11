import type { ExactSolveProgress } from "./exact";

export interface SolverRuntimeInfo {
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number | null;
  readonly isFirefoxFamily: boolean;
  readonly threadingReady: boolean;
}

export interface CompletedPhaseTiming {
  readonly phase: number;
  readonly label: string;
  readonly phaseMs: number;
  readonly numBranches: number;
  readonly numConflicts: number;
  readonly searchWorkers: number;
  readonly branchesPerSec: number;
}

export function readSolverRuntimeInfo(): SolverRuntimeInfo {
  const crossOriginIsolated =
    typeof globalThis.crossOriginIsolated === "boolean" ? globalThis.crossOriginIsolated : false;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const hardwareConcurrency =
    typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : null;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isFirefoxFamily = /firefox|zen/i.test(userAgent);
  return {
    crossOriginIsolated,
    sharedArrayBuffer,
    hardwareConcurrency,
    isFirefoxFamily,
    threadingReady: crossOriginIsolated && sharedArrayBuffer,
  };
}

export function branchesPerSecond(phaseMs: number, numBranches: number): number {
  if (phaseMs <= 0) return 0;
  return (numBranches / phaseMs) * 1000;
}

export function completedPhaseTiming(progress: ExactSolveProgress): CompletedPhaseTiming | null {
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

export function formatPhaseMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatBranchesPerSec(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k/s`;
  return `${value.toFixed(0)}/s`;
}
