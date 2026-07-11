#!/usr/bin/env bash
# Builds the Rust exact solver to WebAssembly and regenerates the JS bindings
# consumed by src/lib/solver/rust. Requires the Rust toolchain with the
# wasm32-unknown-unknown target and wasm-bindgen-cli.
set -euo pipefail

cd "$(dirname "$0")/../rust/solver"

cargo build --release --target wasm32-unknown-unknown
wasm-bindgen \
  --target web \
  --out-dir ../../src/lib/solver/rust/pkg \
  target/wasm32-unknown-unknown/release/satisfactory_exact_solver.wasm

# Browser copy: the worker in public/rust-solver loads these at runtime as
# plain static assets (survives the static export unmodified).
cp ../../src/lib/solver/rust/pkg/satisfactory_exact_solver.js \
  ../../src/lib/solver/rust/pkg/satisfactory_exact_solver_bg.wasm \
  ../../public/rust-solver/

echo "Wrote src/lib/solver/rust/pkg and public/rust-solver"
