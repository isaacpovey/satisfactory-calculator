# Rust exact solver (exploration)

A native-Rust replacement for the `or-tools-wasm` CP-SAT backend of the exact
production optimizer (`src/lib/solver/exact/optimizer.ts`), compiled to
WebAssembly. Everything is pure Rust — the CP backend is
[Pumpkin](https://github.com/consol-lab/pumpkin), a lazy-clause-generation
constraint programming solver from TU Delft, so no C++ toolchain or Emscripten
is involved.

## What is ported

The full exact pipeline is re-implemented natively, mirroring the TypeScript
module-for-module:

| Rust module      | TypeScript source                          |
| ---------------- | ------------------------------------------ |
| `rational.rs`    | `exact/rational.ts` (BigInt rationals)     |
| `graph.rs`       | `exact/recipe-graph.ts`                    |
| `underclocks.rs` | `exact/underclocks.ts`                     |
| `bounds.rs`      | `exact/bounds.ts`                          |
| `patterns.rs`    | `exact/bank-patterns.ts`                   |
| `optimizer.rs`   | `exact/optimizer.ts` + `integer-linear.ts` |
| `validation.rs`  | `exact/validation.ts`                      |

The model, the six-phase lexicographic objective hierarchy, the
dominance/symmetry reductions, the post-phase domain tightening, the
warm-start hints between phases, and the independent post-solve validation are
all preserved. The solver is data-agnostic: items/recipes are part of the JSON
input (`data.rs`), so game-data changes never require a Rust rebuild.

## Solver-specific modelling differences

Pumpkin differs from CP-SAT in ways that forced two model adjustments (both
semantics-preserving):

- **32-bit domains** — CP-SAT accepts 64-bit coefficients; Pumpkin variables
  and affine views are `i32`. Rows are scaled by the per-row denominator LCM
  exactly like the TypeScript, then reduced by the coefficient GCD, and every
  term is checked against `i32` (`checked_i32`) so overflow fails loudly
  instead of silently.
- **Sum-tree decomposition** — wide linear rows are catastrophic under lazy
  clause generation: every learned nogood mentions one predicate per row term,
  and the undecomposed model learned nogoods with average LBD > 150 (pure
  satisfiability of a ~230-variable model did not finish in 15 s). All rows
  wider than 4 terms are decomposed into balanced partial-sum trees
  (`SUM_TREE_ARITY`), which brought the same check to ~20 ms. Because Pumpkin
  cannot create variables once search has started, the bank-representation
  link totals are built as unconstrained sum trees up front and pinned to zero
  after phase 2.
- **Branching** — Pumpkin's default backup brancher (random selector/splitter)
  never converges on the huge bank-multiplicity domains; the port uses
  VSIDS-style autonomous search with an input-order / smallest-value backup,
  plus `WarmStart` branchers carrying the previous phase's solution (the
  analog of CP-SAT solution hints).

## Results

Everything is proven optimal and passes the same independent validation as the
CP-SAT path; the parity suite (`tests/parity.rs`, and
`src/lib/solver/rust/optimizer.test.ts` against the real engine) checks the
brute-force oracle and cross-engine equality of the full objective vector.

Performance (this machine, single run):

| Scenario                                                   | or-tools CP-SAT (8 threads) | Rust/Pumpkin (1 thread)                                             |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| Quickwire 200/min (native)                                 | —                           | ~2–3 s                                                              |
| Quickwire 200/min (browser WASM)                           | ~1.4 s                      | ~4.6 s                                                              |
| Full factory benchmark (`BROWSER_FACTORY_BENCHMARK_INPUT`) | ~68 s (Node)                | phase 1 ≈ 34 s, phase 2 ≈ 6 s, **phase 3 did not finish in 38 min** |

The full-factory phase 3 (minimize physical machines over ~2900 bank-pattern
variables) is where CP-SAT's LP relaxation, parallel portfolio, and core-guided
objective handling dominate. Pumpkin's `LinearSatUnsat` walks the objective
bound down one unit per re-solve with no dual bounding, which does not close
the gap on a problem this large. Small and mid-size configs are practical.

Trade-offs versus `or-tools-wasm`:

- **Binary size** — ~1.2 MB WASM vs ~10 MB+ of Emscripten runtimes.
- **No COOP/COEP requirement** — Pumpkin is single-threaded, so no
  `SharedArrayBuffer`, no cross-origin isolation headers, and it works on
  static hosts that cannot set headers (verified against the static export
  served without headers).
- **No worker-bridge patch** — the runtime is a plain module worker in
  `public/rust-solver/` with no bundler integration needed.
- **Performance** — single-threaded and much weaker objective bounding; large
  factories are currently impractical (see table).

## Building

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli

# native tests + parity suite
cargo test --release

# rebuild the WASM used by the app (writes src/lib/solver/rust/pkg and
# public/rust-solver)
../../scripts/build-rust-solver.sh
```

Test fixtures under `fixtures/` are generated from the app's game data with
`node --experimental-strip-types scripts/export-solver-fixture.mjs`.

Diagnostics:

```bash
cargo run --release --example probe -- quickwire [time_limit_ms]
cargo run --release --example probe -- benchmark [time_limit_ms]
PROBE_SATISFY=1 cargo run --release --example probe -- quickwire 30000
```

## Using from the app

The engine is selectable per solve:

```ts
await solveExact(input, { engine: "rust" }); // Pumpkin WASM (worker in browser)
await solveExact(input, { engine: "cp-sat" }); // default or-tools CP-SAT
```

`/benchmark?engine=rust&config=quickwire` runs the in-browser comparison.
