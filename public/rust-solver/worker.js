// Dedicated module worker running the Rust/WASM exact solver off the main
// thread. Served as a plain static asset (like the or-tools runtime assets)
// so it works identically in `next dev` and the static export.
//
// Protocol: receives `{ inputJson }`, posts
//   { type: "progress", phase, label, status, phaseMs? }
//   { type: "result", resultJson }
//   { type: "error", message }

import init, { solve_exact } from "./satisfactory_exact_solver.js";

const ready = init({
  module_or_path: new URL("./satisfactory_exact_solver_bg.wasm", import.meta.url),
});

self.onmessage = (event) => {
  void (async () => {
    try {
      await ready;
      const resultJson = solve_exact(event.data.inputJson, (phase, label, status, phaseMs) => {
        self.postMessage({ type: "progress", phase, label, status, phaseMs });
      });
      self.postMessage({ type: "result", resultJson });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
