// Rust/WASM exact production optimizer wrapper. Presents the same interface
// as the CP-SAT `solveExactProduction` in `../exact/optimizer.ts`, backed by
// the Pumpkin-based solver in `rust/solver` compiled to WebAssembly.

import type {
  ExactOptimizerInput,
  ExactOptimizerResult,
  ExactSolveProgress,
} from "../exact/optimizer-types";
import { validateExactSolution } from "../exact/validation";
import { fromRustSolverResult, toRustSolverInput, type RustSolverResult } from "./serialize";

/** Messages posted by `public/rust-solver/worker.js`. */
type RustWorkerResponse =
  | { type: "progress"; phase: number; label: string; status: string; phaseMs?: number }
  | { type: "result"; resultJson: string }
  | { type: "error"; message: string };

const PHASE_COUNT = 6;

function emptyResult(status: "INFEASIBLE" | "CANCELLED"): ExactOptimizerResult {
  return {
    feasible: false,
    proofStatus: status,
    selectedBanks: [],
    targets: [],
    excess: [],
    raws: [],
    items: [],
    objective: null,
  };
}

function reportProgress(
  input: ExactOptimizerInput,
  phase: number,
  label: string,
  status: string,
  phaseMs: number | undefined,
): void {
  const progress: ExactSolveProgress = {
    phase,
    phaseCount: PHASE_COUNT,
    label,
    status: status === "complete" ? "complete" : "solving",
    searchWorkers: 1,
    hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? null,
    ...(phaseMs === undefined ? {} : { phaseMs }),
  };
  input.onProgress?.(progress);
}

import type * as WasmModuleNamespace from "./pkg/satisfactory_exact_solver.js";

type WasmModule = typeof WasmModuleNamespace;

let inProcessModule: Promise<WasmModule> | null = null;

/** Loads and initializes the WASM module once per process. */
function loadInProcessModule(): Promise<WasmModule> {
  inProcessModule ??= (async () => {
    const wasm = await import("./pkg/satisfactory_exact_solver.js");
    const { readFile } = await import("node:fs/promises");
    const wasmPath = new URL("./pkg/satisfactory_exact_solver_bg.wasm", import.meta.url);
    const bytes = await readFile(wasmPath);
    await wasm.default({ module_or_path: bytes });
    return wasm;
  })();
  return inProcessModule;
}

/** Runs the WASM solver synchronously in-process (Node / test environments). */
async function solveInProcess(
  input: ExactOptimizerInput,
  inputJson: string,
): Promise<RustSolverResult> {
  const wasm = await loadInProcessModule();
  const resultJson = wasm.solve_exact(
    inputJson,
    (phase: number, label: string, status: string, phaseMs?: number) => {
      reportProgress(input, phase, label, status, phaseMs);
    },
  );
  return JSON.parse(resultJson) as RustSolverResult;
}

/**
 * Runs the WASM solver in a dedicated worker (browser environments). The
 * worker and its wasm-bindgen assets are served from `public/rust-solver/`
 * so the same plain URLs work in dev and in the static export.
 */
function solveInWorker(input: ExactOptimizerInput, inputJson: string): Promise<RustSolverResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/rust-solver/worker.js", { type: "module" });
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      action();
    };
    const onAbort = () => {
      finish(() => {
        reject(new DOMException("Rust exact solve cancelled", "AbortError"));
      });
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<RustWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        reportProgress(input, message.phase, message.label, message.status, message.phaseMs);
        return;
      }
      if (message.type === "result") {
        finish(() => {
          resolve(JSON.parse(message.resultJson) as RustSolverResult);
        });
        return;
      }
      finish(() => {
        reject(new Error(message.message));
      });
    };
    worker.onerror = (event) => {
      finish(() => {
        reject(new Error(`Rust solver worker failed: ${event.message}`));
      });
    };
    worker.postMessage({ inputJson });
  });
}

/**
 * Finds and proves the complete lexicographic optimum with the Rust/WASM
 * solver. Mirrors `solveExactProduction`: no time limit or gap is accepted,
 * and the returned solution is re-validated independently in TypeScript.
 */
export async function solveExactProductionRust(
  input: ExactOptimizerInput,
): Promise<ExactOptimizerResult> {
  if (input.signal?.aborted) return emptyResult("CANCELLED");
  const inputJson = JSON.stringify(toRustSolverInput(input));

  // or-tools-wasm installs a global `Worker` polyfill in Node, so detect Node
  // directly instead of feature-testing `Worker`.
  const isNode =
    typeof window === "undefined" &&
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string";
  let rustResult: RustSolverResult;
  try {
    rustResult = isNode
      ? await solveInProcess(input, inputJson)
      : await solveInWorker(input, inputJson);
  } catch (error: unknown) {
    if (input.signal?.aborted) return emptyResult("CANCELLED");
    throw error;
  }
  if (input.signal?.aborted) return emptyResult("CANCELLED");

  const result = fromRustSolverResult(rustResult);
  if (!result.feasible) return result;

  const validation = validateExactSolution(input, result);
  if (!validation.valid) {
    throw new Error(
      `Rust exact solution failed independent validation:\n${validation.issues.join("\n")}`,
    );
  }
  return result;
}
